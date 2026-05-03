// Lightweight client for the SundaeSwap GraphQL API
// (https://api.sundae.fi/graphql).
//
// Used to enrich the V3 order panel with the pool's asset pair. We cache by
// pool ident in memory for the lifetime of the page, with negative caching
// for unknown idents so we don't hammer the API on misses.

const ENDPOINT = "https://api.sundae.fi/graphql";

export interface SundaeAsset {
  id: string;
  policyId: string;
  // The hex-encoded asset name. The API returns this under `assetName` for
  // some asset records and the human label under `name`. We normalize both.
  assetNameHex: string;
  name: string | null;
  ticker: string | null;
  decimals: number | null;
}

export interface SundaePoolInfo {
  id: string;
  version: "V1" | "V3" | "Stableswaps" | string;
  assetA: SundaeAsset;
  assetB: SundaeAsset;
  // Bid/ask fees as a [numerator, denominator] fraction. Conventionally over
  // 10,000 (basis points), but we keep both halves so callers don't need to
  // assume the denominator. For stableswap pools, these are the LP-share fee
  // and `protocolBidFee` / `protocolAskFee` carry the protocol's share.
  bidFee: [number, number];
  askFee: [number, number];
  protocolBidFee: [number, number] | null;
  protocolAskFee: [number, number] | null;
  // Stableswap-only: `A` factor for the Curve-style invariant.
  linearAmplificationFactor: number | null;
  // Current pool reserves (raw on-chain integer amounts).
  reserveA: bigint;
  reserveB: bigint;
  reserveLP: bigint;
  // The LP token's asset class — needed to identify withdraw orders' burn input.
  assetLP: SundaeAsset;
}

interface RawAsset {
  id: string;
  policyId: string;
  assetName: string | null;
  assetNameHex: string | null;
  name: string | null;
  ticker: string | null;
  decimals: number | null;
}

const POOL_QUERY = `
  query PoolById($id: ID!) {
    pools {
      byId(id: $id) {
        id
        version
        bidFee
        askFee
        protocolBidFee
        protocolAskFee
        linearAmplificationFactor
        assetA { id policyId assetName assetNameHex name ticker decimals }
        assetB { id policyId assetName assetNameHex name ticker decimals }
        assetLP { id policyId assetName assetNameHex name ticker decimals }
        current {
          quantityA { quantity }
          quantityB { quantity }
          quantityLP { quantity }
        }
      }
    }
  }
`;

type PoolEntry = SundaePoolInfo | null;

const cache = new Map<string, PoolEntry>();
const inflight = new Map<string, Promise<PoolEntry>>();

function normalizeAsset(raw: RawAsset): SundaeAsset {
  // Special-case ada.lovelace — the API returns assetName="lovelace" and
  // policyId="ada" which doesn't match the on-chain encoding (both empty).
  if (raw.id === "ada.lovelace") {
    return {
      id: "ada.lovelace",
      policyId: "",
      assetNameHex: "",
      name: "ADA",
      ticker: "ADA",
      decimals: raw.decimals ?? 6,
    };
  }
  return {
    id: raw.id,
    policyId: raw.policyId,
    // Prefer the explicit hex; fall back to assetName which is sometimes hex,
    // sometimes a human label depending on the asset.
    assetNameHex: raw.assetNameHex ?? raw.assetName ?? "",
    name: raw.name,
    ticker: raw.ticker,
    decimals: raw.decimals,
  };
}

interface RawPool {
  id: string;
  version: string;
  bidFee: [number, number];
  askFee: [number, number];
  protocolBidFee: [number, number] | null;
  protocolAskFee: [number, number] | null;
  linearAmplificationFactor: number | null;
  assetA: RawAsset;
  assetB: RawAsset;
  assetLP: RawAsset;
  current: {
    quantityA: { quantity: string };
    quantityB: { quantity: string };
    quantityLP: { quantity: string };
  };
}

async function fetchPool(poolIdent: string): Promise<PoolEntry> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: POOL_QUERY, variables: { id: poolIdent } }),
  });
  if (!res.ok) throw new Error(`sundae api: ${res.status}`);
  const json = (await res.json()) as {
    data?: { pools?: { byId?: RawPool | null } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors && json.errors.length > 0) {
    // "pool not found" errors are expected for unknown idents — return null.
    if (json.errors.some((e) => e.message.toLowerCase().includes("not found"))) {
      return null;
    }
    throw new Error(json.errors[0].message);
  }
  const pool = json.data?.pools?.byId;
  if (!pool) return null;
  return {
    id: pool.id,
    version: pool.version,
    assetA: normalizeAsset(pool.assetA),
    assetB: normalizeAsset(pool.assetB),
    assetLP: normalizeAsset(pool.assetLP),
    bidFee: pool.bidFee,
    askFee: pool.askFee,
    protocolBidFee: pool.protocolBidFee,
    protocolAskFee: pool.protocolAskFee,
    linearAmplificationFactor: pool.linearAmplificationFactor,
    reserveA: BigInt(pool.current.quantityA.quantity),
    reserveB: BigInt(pool.current.quantityB.quantity),
    reserveLP: BigInt(pool.current.quantityLP.quantity),
  };
}

export function getCachedPool(poolIdent: string): PoolEntry | undefined {
  return cache.get(poolIdent.toLowerCase());
}

export async function loadPool(poolIdent: string): Promise<PoolEntry> {
  const key = poolIdent.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = fetchPool(key)
    .then((info) => {
      cache.set(key, info);
      return info;
    })
    .catch((err) => {
      // Don't poison the cache on transient errors — but do clear the
      // in-flight slot so the next caller can retry.
      inflight.delete(key);
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
