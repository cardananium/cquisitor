"use client";

// Asset-metadata dataloader: a small React context that batches (policyId,
// assetName) lookups across every asset shown in the view into one provider
// request (Koios bulk `asset_info`, or Blockfrost concurrent `/assets`), caches
// the results, and re-renders consumers when they arrive. Used by the shared
// AssetNameWithTooltip so any asset display gets ticker / decimals / registry
// metadata regardless of which card renders it.

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
import { KoiosClient, type AssetMetadata, type BlockchainDataClient } from "@/utils/koiosClient";
import { BlockfrostClient } from "@/utils/blockfrostClient";

/** undefined = not requested/loading; null = looked up but not found. */
export type AssetMetaState = AssetMetadata | null | undefined;

interface AssetInfoContextValue {
  get(unit: string): AssetMetaState;
  request(unit: string): void;
  enabled: boolean;
}

const AssetInfoContext = createContext<AssetInfoContextValue>({
  get: () => undefined,
  request: () => {},
  enabled: false,
});

const SUPPORTED_NETWORKS: ReadonlyArray<NetworkType> = ["mainnet", "preview", "preprod"];

function makeAssetClient(
  provider: DataProvider,
  network: string,
  apiKey: string,
): BlockchainDataClient | null {
  if (!SUPPORTED_NETWORKS.includes(network as NetworkType)) return null;
  const net = network as NetworkType;
  try {
    if (provider === "blockfrost") {
      // Blockfrost requires a project_id; without one we can't enrich.
      return apiKey ? new BlockfrostClient({ network: net, apiKey }) : null;
    }
    // Koios works key-less (rate-limited), so always enable it.
    return new KoiosClient({ network: net, apiKey: apiKey || undefined });
  } catch {
    return null;
  }
}

// Persistent metadata cache with a 1-hour TTL, backed by IndexedDB (idb-keyval)
// and mirrored in memory for synchronous reads. The in-memory map is hydrated
// from IndexedDB on mount, so already-fetched assets survive card re-renders,
// transaction switches AND full page reloads without refetching. `null` (asset
// has no metadata) is cached too, so unknown assets aren't retried for an hour.
// IndexedDB (not localStorage) is used because registry logos make entries large
// and would blow the ~5 MB localStorage budget.
type CacheEntry = { meta: AssetMetadata | null; at: number };
const ASSET_TTL_MS = 60 * 60 * 1000;
const idbStore = createStore("cquisitor-asset-meta", "entries");
const assetCache = new Map<string, CacheEntry>();
const hasIdb = (): boolean => typeof indexedDB !== "undefined";

let hydration: Promise<void> | null = null;
/** Load non-expired entries from IndexedDB into the in-memory mirror, once. */
function hydrateAssetCache(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    if (!hasIdb()) return;
    try {
      const now = Date.now();
      for (const [unit, entry] of await entries<string, CacheEntry>(idbStore)) {
        if (entry && now - entry.at <= ASSET_TTL_MS) assetCache.set(unit, entry);
        else void del(unit, idbStore);
      }
    } catch {
      /* unavailable (private mode / quota) — fall back to network-only */
    }
  })();
  return hydration;
}

function cacheGet(unit: string): AssetMetadata | null | undefined {
  const entry = assetCache.get(unit);
  if (!entry) return undefined;
  if (Date.now() - entry.at > ASSET_TTL_MS) {
    assetCache.delete(unit);
    if (hasIdb()) void del(unit, idbStore);
    return undefined;
  }
  return entry.meta;
}

function cacheSet(unit: string, meta: AssetMetadata | null): void {
  const entry: CacheEntry = { meta, at: Date.now() };
  assetCache.set(unit, entry);
  if (hasIdb()) void set(unit, entry, idbStore).catch(() => {});
}

export function AssetInfoProvider({
  provider,
  apiKey,
  network,
  units,
  children,
}: {
  provider?: DataProvider;
  apiKey?: string;
  network?: string;
  /**
   * Asset units (lowercase policyId+assetNameHex) collected centrally from the
   * whole decoded transaction, prefetched as one batch. Components may still
   * lazily request anything not in this set (e.g. assets named only in a datum).
   */
  units?: ReadonlySet<string>;
  children: ReactNode;
}) {
  const [data, setData] = useState<Map<string, AssetMetadata | null>>(() => new Map());
  // Mirror of `data` for the stable `request` callback to dedup against without
  // depending on it. Updated in an effect (never during render).
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Load the persisted (IndexedDB) cache once, then re-render so consumers
  // re-read `get` and the prefetch effect can skip already-cached units.
  useEffect(() => {
    let active = true;
    hydrateAssetCache().then(() => {
      if (!active) return;
      setHydrated(true);
      // Bump `data` identity so the context value changes and consumers re-read
      // `get` — needed when every asset is cache-served and nothing else fetches.
      setData((prev) => new Map(prev));
    });
    return () => {
      active = false;
    };
  }, []);

  const client = useMemo(
    () => (provider && network ? makeAssetClient(provider, network, apiKey ?? "") : null),
    [provider, network, apiKey],
  );

  // Cache + state are keyed by `${network}:${unit}` so metadata cached on one
  // network is never served for a query on another. The bare unit is still what
  // the network client receives.
  const flush = useCallback(() => {
    timer.current = null;
    const units = Array.from(pending.current);
    pending.current.clear();
    if (units.length === 0) return;
    const prefix = `${network ?? "?"}:`;
    const markNotFound = () =>
      setData((prev) => {
        const next = new Map(prev);
        for (const u of units) if (!next.has(prefix + u)) next.set(prefix + u, null);
        return next;
      });
    if (!client) {
      markNotFound();
      return;
    }
    client
      .getAssetInfo(units)
      .then((infos) => {
        const byUnit = new Map(infos.map((i) => [i.unit, i] as const));
        setData((prev) => {
          const next = new Map(prev);
          for (const u of units) {
            const meta = byUnit.get(u) ?? null;
            next.set(prefix + u, meta);
            cacheSet(prefix + u, meta); // remember for an hour across remounts
          }
          return next;
        });
      })
      .catch(markNotFound);
  }, [client, network]);

  const request = useCallback(
    (unit: string) => {
      if (!unit || pending.current.has(unit)) return;
      const key = `${network ?? "?"}:${unit}`;
      // A fresh cache entry is served via the `get` read-through below — no
      // fetch needed (and no setState here, which would cascade in an effect).
      if (dataRef.current.has(key) || cacheGet(key) !== undefined) return;
      pending.current.add(unit);
      // Coalesce all lookups from a single render pass into one batch.
      if (timer.current == null) timer.current = setTimeout(flush, 60);
    },
    [flush, network],
  );

  // Prefetch the centrally-collected units as one batch once the client is
  // ready (they coalesce with any lazy component requests in the same window).
  useEffect(() => {
    if (!client || !units || !hydrated) return;
    for (const u of units) request(u);
  }, [client, units, request, hydrated]);

  const value = useMemo<AssetInfoContextValue>(
    () => ({
      // Read through to the persisted cache for units not in this instance's
      // state (e.g. served from IndexedDB after a reload, or lazily requested).
      get: (unit) => {
        const key = `${network ?? "?"}:${unit}`;
        return data.has(key) ? data.get(key) : cacheGet(key);
      },
      request,
      enabled: !!client,
    }),
    [data, request, client, network],
  );

  return <AssetInfoContext.Provider value={value}>{children}</AssetInfoContext.Provider>;
}

// Synthetic metadata for ada so callers never have to special-case it.
const ADA_META: AssetMetadata = {
  unit: "",
  policyId: "",
  assetNameHex: "",
  fingerprint: null,
  decimals: 6,
  ticker: "ADA",
  name: "Cardano",
  description: null,
  url: null,
  logo: null,
  totalSupply: null,
};

/**
 * Resolve metadata for one asset, requesting it (batched) on first use.
 * Returns ADA's synthetic metadata for the empty asset, `undefined` while
 * loading / when enrichment is disabled, `null` when not found, else the data.
 */
export function useAssetMeta(policyId: string, assetName: string): AssetMetaState {
  const ctx = useContext(AssetInfoContext);
  const isAda = policyId === "" && assetName === "";
  const unit = (policyId + assetName).toLowerCase();
  useEffect(() => {
    if (!isAda && ctx.enabled) ctx.request(unit);
  }, [unit, isAda, ctx]);
  if (isAda) return ADA_META;
  return ctx.get(unit);
}
