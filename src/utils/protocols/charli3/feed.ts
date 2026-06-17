// Charli3 Oracle Feed datum parser — role "feed".
//
// The consumer datum is the PRICE FEED. Two implementations exist; they share the
// SAME integer-keyed price_map and the SAME outer-Constr disambiguation:
//
//   OUTER Constr index (OracleDatum):
//     0 -> OracleFeed (push) / AggState (pull)  *** PRICE-BEARING ***
//     1 -> NodeDatum  (push) / OracleSettings (pull)   internal
//     2 -> AggDatum   (push) / RewardAccount  (pull)   internal
//     3 -> RewardDatum (push)                          internal
//
// PUSH: the price feed is the BARE Constr0. Its children are an ORDERED,
//   self-identifying list filtered by each child's own Constr tag:
//     child Constr 0 = shared_data   (optional, 0|1)
//     child Constr 2 = price_data    (one or MORE)
//     child Constr 1 = extended_data (optional, 0|1)
//   price_data = Constr 2 [ price_map ]  (CBOR tag 123, single Map field).
//
// PULL: the price feed is Constr0 (AggState) wrapping a PriceData Constr whose
//   GenericData variant is Constr 2 [ price_map ].
//
// Robust strategy (handles BOTH): peel outer Constr; recurse its fields for any
// Constr with index 2 carrying a Map; read integer keys 0..9 from each.
//
// price_map keys:
//   0 price (uint, REQUIRED)   1 timestamp (ms)   2 expiry (ms)   3 precision
//   4 base asset_id (hex)      5 quote asset_id   6 base symbol   7 quote symbol
//   8 base name                9 quote name
// key 0 is usually a bare uint but a "CER" exchange-rate variant may store a
// Rational Constr0[num,den] — handled defensively.

import {
  asBytes,
  asInt,
  isConstr,
  isInt,
  isMap,
  type PD,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

// --- OracleDatum outer kind -----------------------------------------------

export type Charli3OracleKind =
  | "OracleFeed" // outer Constr 0 — the consumer price feed
  | "NodeDatum" // outer Constr 1
  | "AggDatum" // outer Constr 2
  | "RewardDatum" // outer Constr 3
  | "Unknown";

export function charli3OuterKind(ctor: number): Charli3OracleKind {
  switch (ctor) {
    case 0:
      return "OracleFeed";
    case 1:
      return "NodeDatum";
    case 2:
      return "AggDatum";
    case 3:
      return "RewardDatum";
    default:
      return "Unknown";
  }
}

// --- price_map (integer-keyed CBOR Map) ------------------------------------

export interface Charli3PriceMap {
  /** key 0 — scaled price (quote per 1 base). REQUIRED for a valid feed. */
  price: bigint | null;
  /** key 0 stored as a Rational Constr0[num,den] (CER variant), if present. */
  priceRational: { numerator: bigint; denominator: bigint } | null;
  /** key 1 — POSIXTime in MILLISECONDS (created). */
  timestamp: bigint | null;
  /** key 2 — POSIXTime in MILLISECONDS (expiry). */
  expiry: bigint | null;
  /** key 3 — decimals; real price = price / 10^precision (default 0). */
  precision: bigint | null;
  baseAssetId: string | null; // key 4
  quoteAssetId: string | null; // key 5
  baseAssetSymbol: string | null; // key 6
  quoteAssetSymbol: string | null; // key 7
  baseAssetName: string | null; // key 8
  quoteAssetName: string | null; // key 9
  /** Provider custom fields (keys <0 or >9) — left as raw PD passthrough. */
  customKeys: { key: bigint; value: PD }[];
}

function emptyPriceMap(): Charli3PriceMap {
  return {
    price: null,
    priceRational: null,
    timestamp: null,
    expiry: null,
    precision: null,
    baseAssetId: null,
    quoteAssetId: null,
    baseAssetSymbol: null,
    quoteAssetSymbol: null,
    baseAssetName: null,
    quoteAssetName: null,
    customKeys: [],
  };
}

function safeBytes(d: PD): string | null {
  try {
    return asBytes(d);
  } catch {
    return null;
  }
}

function parsePriceMapEntries(
  entries: { k: PD; v: PD }[],
  into: Charli3PriceMap,
): void {
  for (const { k, v } of entries) {
    if (!isInt(k)) {
      // Non-integer key is not part of the standard spec — keep as raw.
      into.customKeys.push({ key: BigInt(-1), value: v });
      continue;
    }
    const key = asInt(k);
    switch (key.toString()) {
      case "0":
        if (isInt(v)) {
          into.price = asInt(v);
        } else if (isConstr(v) && v.constructor === 0 && v.fields.length === 2) {
          // CER / exchange-rate variant: Rational Constr0[num, den].
          into.priceRational = {
            numerator: asInt(v.fields[0]),
            denominator: asInt(v.fields[1]),
          };
        } else {
          into.customKeys.push({ key, value: v });
        }
        break;
      case "1":
        if (isInt(v)) into.timestamp = asInt(v);
        break;
      case "2":
        if (isInt(v)) into.expiry = asInt(v);
        break;
      case "3":
        if (isInt(v)) into.precision = asInt(v);
        break;
      case "4":
        into.baseAssetId = safeBytes(v);
        break;
      case "5":
        into.quoteAssetId = safeBytes(v);
        break;
      case "6":
        into.baseAssetSymbol = safeBytes(v);
        break;
      case "7":
        into.quoteAssetSymbol = safeBytes(v);
        break;
      case "8":
        into.baseAssetName = safeBytes(v);
        break;
      case "9":
        into.quoteAssetName = safeBytes(v);
        break;
      default:
        // keys <0 or >9 — provider custom; raw passthrough.
        into.customKeys.push({ key, value: v });
        break;
    }
  }
}

function parsePriceMap(d: PD): Charli3PriceMap | null {
  if (!isMap(d)) return null;
  const out = emptyPriceMap();
  parsePriceMapEntries(d.map, out);
  return out;
}

// --- extended_data (Constr 1 [ Map<Int,_> ]) -------------------------------

export interface Charli3ExtendedData {
  oracleProviderId: bigint | null; // key 0
  dataSourceCount: bigint | null; // key 1
  dataSignatoriesCount: bigint | null; // key 2
  oracleProviderSignature: string | null; // key 3 (tstr)
  customKeys: { key: bigint; value: PD }[];
}

function parseExtendedData(d: PD): Charli3ExtendedData | null {
  if (!isConstr(d) || d.constructor !== 1 || d.fields.length !== 1) return null;
  const mapNode = d.fields[0];
  if (!isMap(mapNode)) return null;
  const out: Charli3ExtendedData = {
    oracleProviderId: null,
    dataSourceCount: null,
    dataSignatoriesCount: null,
    oracleProviderSignature: null,
    customKeys: [],
  };
  for (const { k, v } of mapNode.map) {
    if (!isInt(k)) continue;
    const key = asInt(k);
    switch (key.toString()) {
      case "0":
        if (isInt(v)) out.oracleProviderId = asInt(v);
        break;
      case "1":
        if (isInt(v)) out.dataSourceCount = asInt(v);
        break;
      case "2":
        if (isInt(v)) out.dataSignatoriesCount = asInt(v);
        break;
      case "3":
        out.oracleProviderSignature = safeBytes(v);
        break;
      default:
        out.customKeys.push({ key, value: v });
        break;
    }
  }
  return out;
}

// --- full feed datum -------------------------------------------------------

export interface Charli3Feed {
  kind: Charli3OracleKind;
  /** Every price_data block found (a feed may carry MULTIPLE priced pairs). */
  prices: Charli3PriceMap[];
  /** shared_data price_map (Constr0[Map{0:price_map}]) merged into prices. */
  shared: Charli3PriceMap | null;
  extended: Charli3ExtendedData | null;
}

// Recursively scan `node` for Constr index 2 carrying a Map (the GenericData /
// price_data variant), collecting every price_map. Bounded recursion depth keeps
// the push (bare children) and pull (AggState→GenericData) shapes both covered.
function collectPriceMaps(node: PD, depth: number, out: Charli3PriceMap[]): void {
  if (depth > 6) return;
  if (!isConstr(node)) return;
  if (node.constructor === 2) {
    for (const f of node.fields) {
      const pm = parsePriceMap(f);
      if (pm) out.push(pm);
    }
    // A price_data Constr 2 still might nest further (provider variants); fall
    // through so we don't miss deeper price_data blocks.
  }
  for (const f of node.fields) {
    if (isConstr(f)) collectPriceMaps(f, depth + 1, out);
  }
}

// shared_data = Constr 0 [ Map { 0 : price_map } ]. We look only among the
// DIRECT children of the outer feed Constr to avoid mistaking the address-style
// Constr0 wrappers used elsewhere.
function findSharedData(directChildren: PD[]): Charli3PriceMap | null {
  for (const child of directChildren) {
    if (!isConstr(child) || child.constructor !== 0 || child.fields.length !== 1) {
      continue;
    }
    const mapNode = child.fields[0];
    if (!isMap(mapNode)) continue;
    for (const { k, v } of mapNode.map) {
      if (isInt(k) && asInt(k).toString() === "0") {
        const pm = parsePriceMap(v);
        if (pm) return pm;
      }
    }
  }
  return null;
}

function findExtendedData(directChildren: PD[]): Charli3ExtendedData | null {
  for (const child of directChildren) {
    const ext = parseExtendedData(child);
    if (ext) return ext;
  }
  return null;
}

// Merge shared_data fields into a price_map where the price_map left them unset.
function mergeShared(price: Charli3PriceMap, shared: Charli3PriceMap): Charli3PriceMap {
  const merged: Charli3PriceMap = { ...price };
  const keys: (keyof Charli3PriceMap)[] = [
    "price",
    "priceRational",
    "timestamp",
    "expiry",
    "precision",
    "baseAssetId",
    "quoteAssetId",
    "baseAssetSymbol",
    "quoteAssetSymbol",
    "baseAssetName",
    "quoteAssetName",
  ];
  for (const key of keys) {
    if (merged[key] == null && shared[key] != null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = shared[key];
    }
  }
  return merged;
}

/**
 * Parse a Charli3 Oracle Feed datum. Accepts both push (bare OracleFeed Constr0
 * with price_data children) and pull (AggState Constr0[GenericData Constr2])
 * shapes. Throws only when the top-level value is not a Constr at all.
 */
export function parseCharli3Feed(data: PD): Charli3Feed {
  if (!isConstr(data)) {
    throw new Error(`Charli3 feed: expected Constr, got non-constructor datum`);
  }
  const kind = charli3OuterKind(data.constructor);
  const directChildren = data.fields;

  const rawPrices: Charli3PriceMap[] = [];
  collectPriceMaps(data, 0, rawPrices);

  const shared = findSharedData(directChildren);
  const extended = findExtendedData(directChildren);

  const prices = shared
    ? rawPrices.map((p) => mergeShared(p, shared))
    : rawPrices;

  return { kind, prices, shared, extended };
}

// --- redeemers (NOT needed for consumer feed decoding; for completeness) ----
//
// Consumers read the feed as a REFERENCE input, so no spend redeemer is present
// in typical DApp txs — only the oracle OPERATOR spends it. Both implementations
// encode the redeemer as a bare-enum Constr (index selects the action).

const PUSH_ORACLE_REDEEMERS = [
  "NodeUpdate", // 0
  "NodeCollect", // 1
  "PlatformCollect", // 2
  "Aggregate", // 3
  "UpdateSettings", // 4
  "AddNodes", // 5
  "DelNodes", // 6
  "OracleClose", // 7
  "AddFunds", // 8
] as const;

const PULL_ORACLE_REDEEMERS = [
  "OdvAggregate", // 0 (has AggregateMessage field)
  "OdvAggregateMsg", // 1
  "RedeemRewards", // 2 (RewardRedeemer, Int)
  "ManageSettings", // 3 (SettingsRedeemer)
  "ScaleDown", // 4
  "DismissRewards", // 5
] as const;

/**
 * Best-effort classification of an oracle spend redeemer by its Constr index.
 * Ambiguous between push and pull implementations (same indices, different
 * meaning), so we surface both readings. Returns null when not a Constr.
 */
export function classifyCharli3Redeemer(data: PD): string | null {
  if (!isConstr(data)) return null;
  const idx = data.constructor;
  const push = PUSH_ORACLE_REDEEMERS[idx];
  const pull = PULL_ORACLE_REDEEMERS[idx];
  if (push && pull) return `${push} (push) / ${pull} (pull)`;
  if (push) return `${push} (push)`;
  if (pull) return `${pull} (pull)`;
  return `Oracle redeemer #${idx}`;
}

// --- light validation ------------------------------------------------------

export function validateCharli3Feed(feed: Charli3Feed): DexIssue[] {
  const issues: DexIssue[] = [];
  if (feed.kind === "Unknown") {
    issues.push({
      severity: "error",
      message: "Outer Constr index is not 0..3 — not a Charli3 OracleDatum.",
    });
    return issues;
  }
  if (feed.kind !== "OracleFeed") {
    issues.push({
      severity: "info",
      message: `Internal oracle datum (${feed.kind}); not a consumer price feed.`,
    });
  }
  if (feed.prices.length === 0) {
    issues.push({
      severity: "error",
      message: "No price_data (Constr 2 [Map]) block found in the datum.",
    });
    return issues;
  }
  feed.prices.forEach((p, i) => {
    const tag = feed.prices.length > 1 ? ` [pair ${i}]` : "";
    if (p.price == null && p.priceRational == null) {
      issues.push({
        severity: "error",
        message: `price_map missing required key 0 (price)${tag}.`,
      });
    }
    if (p.timestamp == null) {
      issues.push({
        severity: "info",
        message: `price_map has no timestamp (key 1)${tag}.`,
      });
    }
    if (p.expiry != null && p.timestamp != null && p.expiry < p.timestamp) {
      issues.push({
        severity: "warning",
        message: `expiry (key 2) precedes timestamp (key 1)${tag}.`,
      });
    }
  });
  return issues;
}

/** Real price = price / 10^precision (precision defaults to 0 when absent). */
export function charli3RealPrice(p: Charli3PriceMap): number | null {
  if (p.price == null) {
    if (p.priceRational == null || p.priceRational.denominator === BigInt(0)) {
      return null;
    }
    return Number(p.priceRational.numerator) / Number(p.priceRational.denominator);
  }
  const precision = p.precision == null ? BigInt(0) : p.precision;
  const scale = Math.pow(10, Number(precision));
  return Number(p.price) / scale;
}
