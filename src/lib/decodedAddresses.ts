// Synchronous decoded-address cache. Decode runs in the worker; renders read this store.
// Callers that already await (tx decode, UTxO fetch) prime it first.
// Unprimed addresses are requested on render, then a version bump re-renders.
// All decodes go through the same worker transport as document passes.

import type { DecodedAddress } from "@/utils/addressTypes";
import { callLib } from "./cquisitorWorker";

/** Longer than a real bech32/base58/hex address; answered without calling the decoder. */
const MAX_ADDRESS_LENGTH = 512;

/** Cap: insertion order is eviction order so a long session cannot grow without bound. */
const MAX_ENTRIES = 4096;

/** `null` means decoded to nothing — not an address, or nothing could decode it. */
const decoded = new Map<string, DecodedAddress | null>();
const inFlight = new Set<string>();
const pending = new Set<string>();
let pendingFlush: ReturnType<typeof setTimeout> | null = null;

let version = 0;
const listeners = new Set<() => void>();

function announce(): void {
  version++;
  for (const listener of listeners) listener();
}

function remember(address: string, value: DecodedAddress | null): void {
  if (!decoded.has(address) && decoded.size >= MAX_ENTRIES) {
    const oldest = decoded.keys().next();
    if (!oldest.done) decoded.delete(oldest.value);
  }
  decoded.set(address, value);
}

/** Cached decode, `null` if it decoded to nothing, `undefined` if not decoded yet. Never calls the library. */
export function readDecodedAddress(address: string): DecodedAddress | null | undefined {
  return decoded.get(address);
}

async function decodeOne(address: string): Promise<void> {
  try {
    const value = await callLib<DecodedAddress>("decode_specific_type", [
      address,
      "Address",
      {},
    ]);
    remember(address, value ?? null);
  } catch {
    // Treat any failure as "nothing to show" so the miss is not retried every render.
    remember(address, null);
  } finally {
    inFlight.delete(address);
  }
}

/** Decode unknown addresses in `addresses`. Call from a pass that is already awaiting. */
export async function primeAddresses(addresses: Iterable<string>): Promise<void> {
  const wanted: string[] = [];
  let changed = false;
  for (const address of addresses) {
    if (!address || decoded.has(address) || inFlight.has(address)) continue;
    if (address.length > MAX_ADDRESS_LENGTH) {
      remember(address, null);
      changed = true;
      continue;
    }
    inFlight.add(address);
    pending.delete(address);
    wanted.push(address);
  }
  if (wanted.length > 0) {
    await Promise.all(wanted.map(decodeOne));
    changed = true;
  }
  if (changed) announce();
}

function flushPending(): void {
  pendingFlush = null;
  const batch = Array.from(pending);
  pending.clear();
  void primeAddresses(batch);
}

/** Schedule a decode without waiting; safe during render. Over-long strings are dropped, not cached. */
export function requestAddress(address: string): void {
  if (!address || address.length > MAX_ADDRESS_LENGTH) return;
  if (decoded.has(address) || inFlight.has(address) || pending.has(address)) return;
  pending.add(address);
  pendingFlush ??= setTimeout(flushPending, 0);
}

/** Bumps when a decode lands; include in memo deps that read the store. */
export function decodedAddressesVersion(): number {
  return version;
}

export function subscribeDecodedAddresses(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Empties the store. For tests that need to observe a miss. */
export function resetDecodedAddresses(): void {
  decoded.clear();
  pending.clear();
  if (pendingFlush !== null) {
    clearTimeout(pendingFlush);
    pendingFlush = null;
  }
  announce();
}

/** Walk bounds so collecting from an arbitrary payload cannot dominate a pass. */
const MAX_COLLECT_DEPTH = 16;
const MAX_COLLECTED = 4096;

/** Bech32 addr/stake shape. Prefix-only would also match the field name `address`. */
const ADDRESS_SHAPE = /^(addr|stake)(_test)?1[02-9ac-hj-np-z]{10,}$/;

/** Strings in `value` shaped like a Cardano address, including map keys (withdrawals). */
export function collectAddressStrings(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (found.size >= MAX_COLLECTED || depth > MAX_COLLECT_DEPTH) return;
    if (typeof node === "string") {
      if (node.length <= MAX_ADDRESS_LENGTH && ADDRESS_SHAPE.test(node)) {
        found.add(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        // Withdrawal maps are keyed by reward address.
        walk(key, depth + 1);
        walk(item, depth + 1);
      }
    }
  };
  walk(value, 0);
  return Array.from(found);
}
