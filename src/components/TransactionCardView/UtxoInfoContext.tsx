"use client";

// UTxO resolver: a dataloader that resolves transaction input / collateral /
// reference-input references ("txHash#index") to their on-chain UTxO (address,
// value, datum, reference script) on demand — the same way pool/asset info is
// resolved — so inputs render fully (resolved value + dapp card) without having
// to run a full validation first. Lookups from one render pass are coalesced
// into a single batched (chunked) provider request, and results are persisted
// in IndexedDB: a UTxO is immutable, so a resolved ref never needs refetching.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createStore, del, entries, set } from "idb-keyval";
import type { NetworkType } from "@cardananium/cquisitor-lib";
import type { DataProvider } from "@/utils/transactionValidation";
import { KoiosClient, type BlockchainDataClient } from "@/utils/koiosClient";
import { BlockfrostClient } from "@/utils/blockfrostClient";
import type { KoiosUtxoInfo } from "./types";

/** undefined = not requested / loading; null = looked up but not found. */
export type UtxoInfoState = KoiosUtxoInfo | null | undefined;

interface UtxoInfoContextValue {
  get(ref: string): UtxoInfoState;
  request(ref: string): void;
  enabled: boolean;
}

const UtxoInfoContext = createContext<UtxoInfoContextValue>({
  get: () => undefined,
  request: () => {},
  enabled: false,
});

const SUPPORTED_NETWORKS: ReadonlyArray<NetworkType> = ["mainnet", "preview", "preprod"];

function makeUtxoClient(
  provider: DataProvider,
  network: string,
  apiKey: string,
): BlockchainDataClient | null {
  if (!SUPPORTED_NETWORKS.includes(network as NetworkType)) return null;
  const net = network as NetworkType;
  try {
    if (provider === "blockfrost") {
      return apiKey ? new BlockfrostClient({ network: net, apiKey }) : null;
    }
    return new KoiosClient({ network: net, apiKey: apiKey || undefined });
  } catch {
    return null;
  }
}

// Persistent cache (IndexedDB) mirrored in memory for synchronous reads. UTxOs
// are immutable, so a 24h TTL is purely a housekeeping bound. `null` (ref not
// found / already pruned) is cached too, so it isn't retried repeatedly.
type CacheEntry = { utxo: KoiosUtxoInfo | null; at: number };
const UTXO_TTL_MS = 24 * 60 * 60 * 1000;
const idbStore = createStore("cquisitor-utxo-info", "entries");
const utxoCache = new Map<string, CacheEntry>();
const hasIdb = (): boolean => typeof indexedDB !== "undefined";

let hydration: Promise<void> | null = null;
function hydrateUtxoCache(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    if (!hasIdb()) return;
    try {
      const now = Date.now();
      for (const [ref, entry] of await entries<string, CacheEntry>(idbStore)) {
        if (entry && now - entry.at <= UTXO_TTL_MS) utxoCache.set(ref, entry);
        else void del(ref, idbStore);
      }
    } catch {
      /* unavailable — network-only */
    }
  })();
  return hydration;
}

function cacheGet(ref: string): UtxoInfoState {
  const entry = utxoCache.get(ref);
  if (!entry) return undefined;
  if (Date.now() - entry.at > UTXO_TTL_MS) {
    utxoCache.delete(ref);
    if (hasIdb()) void del(ref, idbStore);
    return undefined;
  }
  return entry.utxo;
}

function cacheSet(ref: string, utxo: KoiosUtxoInfo | null): void {
  const entry: CacheEntry = { utxo, at: Date.now() };
  utxoCache.set(ref, entry);
  if (hasIdb()) void set(ref, entry, idbStore).catch(() => {});
}

export function UtxoInfoProvider({
  provider,
  apiKey,
  network,
  refs,
  children,
}: {
  provider?: DataProvider;
  apiKey?: string;
  network?: string;
  /**
   * Input / collateral / reference-input refs ("txHash#index") collected from
   * the whole tx, prefetched in one batch. Components may still lazily request
   * any ref not in this set.
   */
  refs?: ReadonlySet<string>;
  children: ReactNode;
}) {
  const [data, setData] = useState<Map<string, KoiosUtxoInfo | null>>(() => new Map());
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    hydrateUtxoCache().then(() => {
      if (!active) return;
      setHydrated(true);
      setData((prev) => new Map(prev));
    });
    return () => {
      active = false;
    };
  }, []);

  const client = useMemo(
    () => (provider && network ? makeUtxoClient(provider, network, apiKey ?? "") : null),
    [provider, network, apiKey],
  );

  // Cache + state are keyed by `${network}:${ref}` so a resolved UTxO on one
  // network is never served for a query on another (a tx hash / ref is
  // network-specific). The bare ref is still what's sent to the network client.
  const flush = useCallback(() => {
    timer.current = null;
    const refs = Array.from(pending.current);
    pending.current.clear();
    if (refs.length === 0) return;
    const prefix = `${network ?? "?"}:`;
    const markNotFound = () =>
      setData((prev) => {
        const next = new Map(prev);
        for (const r of refs) if (!next.has(prefix + r)) next.set(prefix + r, null);
        return next;
      });
    if (!client) {
      markNotFound();
      return;
    }
    client
      .getUtxoInfo(refs)
      .then((utxos) => {
        const byRef = new Map<string, KoiosUtxoInfo>(
          utxos.map((u) => [`${u.tx_hash}#${u.tx_index}`, u]),
        );
        setData((prev) => {
          const next = new Map(prev);
          for (const r of refs) {
            const utxo = byRef.get(r) ?? null;
            next.set(prefix + r, utxo);
            cacheSet(prefix + r, utxo);
          }
          return next;
        });
      })
      .catch(markNotFound);
  }, [client, network]);

  const request = useCallback(
    (ref: string) => {
      if (!ref || pending.current.has(ref)) return;
      const key = `${network ?? "?"}:${ref}`;
      if (dataRef.current.has(key) || cacheGet(key) !== undefined) return;
      pending.current.add(ref);
      if (timer.current == null) timer.current = setTimeout(flush, 60);
    },
    [flush, network],
  );

  useEffect(() => {
    if (!client || !refs || !hydrated) return;
    for (const r of refs) request(r);
  }, [client, refs, request, hydrated]);

  const value = useMemo<UtxoInfoContextValue>(
    () => ({
      get: (ref) => {
        const key = `${network ?? "?"}:${ref}`;
        return data.has(key) ? data.get(key) : cacheGet(key);
      },
      request,
      enabled: !!client,
    }),
    [data, request, client, network],
  );

  return <UtxoInfoContext.Provider value={value}>{children}</UtxoInfoContext.Provider>;
}

/**
 * Resolve a UTxO ref ("txHash#index"), fetching it (batched, cached) on first
 * use. `undefined` while loading / disabled, `null` when not found. Pass a
 * falsy ref to opt out (e.g. when the value is already known from validation).
 */
export function useUtxoInfo(ref: string | null | undefined): UtxoInfoState {
  const ctx = useContext(UtxoInfoContext);
  useEffect(() => {
    if (ref && ctx.enabled) ctx.request(ref);
  }, [ref, ctx]);
  if (!ref) return undefined;
  return ctx.get(ref);
}
