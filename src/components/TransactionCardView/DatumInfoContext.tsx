"use client";

// Datum-by-hash resolver: an output can reference its datum only by hash, with
// the datum itself not present anywhere in the tx (nor its inputs / reference
// inputs). When the provider has seen that datum on-chain (Koios `datum_info` /
// Blockfrost `/scripts/datum`), resolve it on demand so the output can still be
// decoded. Datums are content-addressed (hash → fixed value), so results are
// cached for the process lifetime. Mirrors the pool/utxo resolvers.

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
import type { PD } from "@/utils/protocols/dex/plutusData";

export type DatumState = PD | null | undefined;

interface DatumInfoContextValue {
  get(hash: string): DatumState;
  request(hash: string): void;
  enabled: boolean;
}

const DatumInfoContext = createContext<DatumInfoContextValue>({
  get: () => undefined,
  request: () => {},
  enabled: false,
});

const SUPPORTED_NETWORKS: ReadonlyArray<NetworkType> = ["mainnet", "preview", "preprod"];

function makeClient(provider: DataProvider, network: string, apiKey: string): BlockchainDataClient | null {
  if (!SUPPORTED_NETWORKS.includes(network as NetworkType)) return null;
  const net = network as NetworkType;
  try {
    if (provider === "blockfrost") return apiKey ? new BlockfrostClient({ network: net, apiKey }) : null;
    return new KoiosClient({ network: net, apiKey: apiKey || undefined });
  } catch {
    return null;
  }
}

// Provider datum values arrive as plain JSON; coerce to PD (bigint ints).
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

export function DatumInfoProvider({
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
  const [data, setData] = useState<Map<string, PD | null>>(() => new Map());
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const inflight = useRef<Set<string>>(new Set());

  const client = useMemo(
    () => (provider && network ? makeClient(provider, network, apiKey ?? "") : null),
    [provider, network, apiKey],
  );

  const request = useCallback(
    (hash: string) => {
      if (!hash) return;
      const key = `${network ?? "?"}:${hash}`;
      if (dataRef.current.has(key) || inflight.current.has(key)) return;
      const set = (pd: PD | null) => setData((prev) => new Map(prev).set(key, pd));
      if (!client) {
        set(null);
        return;
      }
      inflight.current.add(key);
      client
        .getDatumByHash(hash)
        .then((raw) => set(raw != null ? toPD(raw) : null))
        .catch(() => set(null))
        .finally(() => inflight.current.delete(key));
    },
    [client, network],
  );

  const value = useMemo<DatumInfoContextValue>(
    () => ({ get: (hash) => data.get(`${network ?? "?"}:${hash}`), request, enabled: !!client }),
    [data, request, client, network],
  );

  return <DatumInfoContext.Provider value={value}>{children}</DatumInfoContext.Provider>;
}

/**
 * Resolve a datum by its hash (fetched once, cached) on first use. `undefined`
 * while loading / disabled, `null` when the provider doesn't know it.
 */
export function useDatum(hash: string | null | undefined): DatumState {
  const ctx = useContext(DatumInfoContext);
  useEffect(() => {
    if (hash && ctx.enabled) ctx.request(hash);
  }, [hash, ctx]);
  if (!hash) return undefined;
  return ctx.get(hash);
}
