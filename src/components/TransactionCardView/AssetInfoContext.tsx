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

  const client = useMemo(
    () => (provider && network ? makeAssetClient(provider, network, apiKey ?? "") : null),
    [provider, network, apiKey],
  );

  const flush = useCallback(() => {
    timer.current = null;
    const units = Array.from(pending.current);
    pending.current.clear();
    if (units.length === 0) return;
    const markNotFound = () =>
      setData((prev) => {
        const next = new Map(prev);
        for (const u of units) if (!next.has(u)) next.set(u, null);
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
          for (const u of units) next.set(u, byUnit.get(u) ?? null);
          return next;
        });
      })
      .catch(markNotFound);
  }, [client]);

  const request = useCallback(
    (unit: string) => {
      if (!unit || dataRef.current.has(unit) || pending.current.has(unit)) return;
      pending.current.add(unit);
      // Coalesce all lookups from a single render pass into one batch.
      if (timer.current == null) timer.current = setTimeout(flush, 60);
    },
    [flush],
  );

  // Prefetch the centrally-collected units as one batch once the client is
  // ready (they coalesce with any lazy component requests in the same window).
  useEffect(() => {
    if (!client || !units) return;
    for (const u of units) request(u);
  }, [client, units, request]);

  const value = useMemo<AssetInfoContextValue>(
    () => ({ get: (unit) => data.get(unit), request, enabled: !!client }),
    [data, request, client],
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
