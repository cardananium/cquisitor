// The decoded JSON as the tree viewers show it. Decoded documents can nest
// tens of thousands of levels (native scripts are exempt from the typed
// decoders' depth bound), so the walk keeps its own stack.

import { bech32 } from "bech32";
import { blake2b } from "@noble/hashes/blake2.js";

/** blake2b-224 of a bech32 `ed25519_pk…` key, as hex; `null` if it does not decode. */
export function computeVkeyHash(vkeyBech32: string): string | null {
  try {
    const decoded = bech32.decode(vkeyBech32, 100);
    const publicKeyBytes = bech32.fromWords(decoded.words);
    const hash = blake2b(new Uint8Array(publicKeyBytes), { dkLen: 28 });
    return Array.from(hash as Uint8Array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function isContainer(value: unknown): value is object {
  return value !== null && typeof value === "object" && !(value instanceof Uint8Array);
}

/** A leaf as the viewers show it: bigint as its digits, bytes as a number array. */
function prepareLeaf(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  return value;
}

/**
 * A copy of `data` with bigints as strings, byte arrays as number arrays, and
 * `vkey_hash` next to every bech32 `vkey`. Iterative: safe at any depth.
 */
export function prepareViewData(data: unknown): unknown {
  if (!isContainer(data)) return prepareLeaf(data);
  const root: unknown = Array.isArray(data) ? new Array(data.length) : {};
  const pending: Array<{ source: object; target: unknown }> = [{ source: data, target: root }];
  const place = (value: unknown): unknown => {
    if (!isContainer(value)) return prepareLeaf(value);
    const copy: unknown = Array.isArray(value) ? new Array(value.length) : {};
    pending.push({ source: value, target: copy });
    return copy;
  };
  while (pending.length > 0) {
    const { source, target } = pending.pop()!;
    if (Array.isArray(source)) {
      const out = target as unknown[];
      for (let i = 0; i < source.length; i++) out[i] = place(source[i]);
      continue;
    }
    const out = target as Record<string, unknown>;
    for (const [key, value] of Object.entries(source)) {
      out[key] = place(value);
      if (key === "vkey" && typeof value === "string" && value.startsWith("ed25519_pk")) {
        const vkeyHash = computeVkeyHash(value);
        if (vkeyHash) out["vkey_hash"] = vkeyHash;
      }
    }
  }
  return root;
}
