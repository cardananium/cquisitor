"use client";

// Pool-pair resolver: an order datum that swaps against an AMM pool usually
// stores only the pool's LP/pool token, not the two assets being traded. This
// context resolves that token to the pool UTxO (via Koios `asset_utxos` /
// Blockfrost address utxos), decodes the pool datum back into its (assetA,
// assetB) with the owning adapter's `parsePoolPair`, caches it, and re-renders
// consumers. Pools are few per tx, so each is resolved with its own request
// (no batching needed, unlike the per-asset metadata loader).

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
import { KoiosClient, type BlockchainDataClient } from "@/utils/koiosClient";
import { BlockfrostClient } from "@/utils/blockfrostClient";
import { getDexAdapter, type PoolPair, type PoolRef } from "@/utils/protocols/dex/registry";
import type { PD } from "@/utils/protocols/dex/plutusData";

/** undefined = not requested / loading; null = resolved but no pair found. */
export type PoolPairState = PoolPair | null | undefined;

interface PoolInfoContextValue {
  get(unit: string): PoolPairState;
  request(ref: PoolRef, adapterId: string): void;
  enabled: boolean;
}

const PoolInfoContext = createContext<PoolInfoContextValue>({
  get: () => undefined,
  request: () => {},
  enabled: false,
});

const SUPPORTED_NETWORKS: ReadonlyArray<NetworkType> = ["mainnet", "preview", "preprod"];

function makePoolClient(
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

// Provider datum values arrive as plain JSON (Koios encodes datum ints as JSON
// numbers); coerce the tree into PD so the adapter's parser can read it.
function toPD(v: unknown): PD {
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("int" in o) return { int: BigInt(o.int as string | number | bigint) };
    if ("bytes" in o) return { bytes: String(o.bytes) };
    if ("list" in o) return { list: (o.list as unknown[]).map(toPD) };
    if ("map" in o)
      return { map: (o.map as { k: unknown; v: unknown }[]).map((e) => ({ k: toPD(e.k), v: toPD(e.v) })) };
    if ("fields" in o)
      return {
        constructor: Number((o as { constructor: unknown }).constructor),
        fields: (o.fields as unknown[]).map(toPD),
      };
  }
  return { constructor: 0, fields: [] };
}

export function PoolInfoProvider({
  provider,
  apiKey,
  network,
  children,
}: {
  provider?: DataProvider;
  apiKey?: string;
  network?: string;
  children: ReactNode;
}) {
  const [data, setData] = useState<Map<string, PoolPair | null>>(() => new Map());
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const inflight = useRef<Set<string>>(new Set());

  const client = useMemo(
    () => (provider && network ? makePoolClient(provider, network, apiKey ?? "") : null),
    [provider, network, apiKey],
  );

  // State + in-flight set are keyed by `${network}:${unit}` so a pool resolved
  // on one network is never served for a query on another.
  const request = useCallback(
    (ref: PoolRef, adapterId: string) => {
      const unit = (ref.policyId + ref.assetName).toLowerCase();
      if (!unit) return;
      const key = `${network ?? "?"}:${unit}`;
      if (dataRef.current.has(key) || inflight.current.has(key)) return;
      const set = (pair: PoolPair | null) =>
        setData((prev) => new Map(prev).set(key, pair));
      if (!client) {
        set(null);
        return;
      }
      inflight.current.add(key);
      client
        .getPoolDatum(unit)
        .then((raw) => {
          let pair: PoolPair | null = null;
          if (raw != null) {
            try {
              pair = getDexAdapter(adapterId)?.parsePoolPair?.(toPD(raw), ref) ?? null;
            } catch {
              pair = null;
            }
          }
          set(pair);
        })
        .catch(() => set(null))
        .finally(() => inflight.current.delete(key));
    },
    [client, network],
  );

  const value = useMemo<PoolInfoContextValue>(
    () => ({ get: (unit) => data.get(`${network ?? "?"}:${unit}`), request, enabled: !!client }),
    [data, request, client, network],
  );

  return <PoolInfoContext.Provider value={value}>{children}</PoolInfoContext.Provider>;
}

/**
 * Resolve the trading pair for a view's `poolRef`, fetching it (once, cached) on
 * first use. `undefined` while loading / disabled, `null` when unresolved.
 */
export function usePoolPair(ref: PoolRef | undefined, adapterId: string): PoolPairState {
  const ctx = useContext(PoolInfoContext);
  const unit = ref ? (ref.policyId + ref.assetName).toLowerCase() : "";
  useEffect(() => {
    if (ref && ctx.enabled) ctx.request(ref, adapterId);
  }, [ref, unit, adapterId, ctx]);
  if (!ref) return undefined;
  return ctx.get(unit);
}

/** Whether pool resolution is configured (a provider/network is set). */
export function usePoolPairEnabled(): boolean {
  return useContext(PoolInfoContext).enabled;
}
