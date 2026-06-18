// Charli3 oracle decoder: normalized feed view + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import {
  asBytes,
  asConstr,
  asInt,
  isConstr,
  isInt,
  isList,
  type PD,
} from "@/utils/protocols/dex/plutusData";
import { matchCharli3NftPolicy, matchCharli3ScriptHash } from "./constants";
import {
  charli3RealPrice,
  classifyCharli3Redeemer,
  parseCharli3Feed,
  validateCharli3Feed,
  type Charli3Feed,
  type Charli3OracleKind,
  type Charli3PriceMap,
} from "./feed";

function formatTimestampMs(ms: bigint): string {
  // POSIXTime in MILLISECONDS — render as ISO for readability.
  const asNumber = Number(ms);
  if (!Number.isFinite(asNumber)) return `${ms.toString()} ms`;
  const iso = new Date(asNumber).toISOString();
  return `${iso} (${ms.toString()} ms)`;
}

function priceRows(p: Charli3PriceMap, prefix: string): DexRow[] {
  const rows: DexRow[] = [];
  const real = charli3RealPrice(p);
  if (p.price != null) {
    rows.push({ label: `${prefix}Price (raw)`, value: p.price.toLocaleString() });
  } else if (p.priceRational != null) {
    rows.push({
      label: `${prefix}Price (rational)`,
      value: `${p.priceRational.numerator.toLocaleString()} / ${p.priceRational.denominator.toLocaleString()}`,
    });
  }
  if (p.precision != null) {
    rows.push({ label: `${prefix}Precision`, value: p.precision.toString() });
  }
  if (real != null) {
    rows.push({ label: `${prefix}Price (real)`, value: real.toString() });
  }
  if (p.timestamp != null) {
    rows.push({ label: `${prefix}Timestamp`, value: formatTimestampMs(p.timestamp) });
  }
  if (p.expiry != null) {
    rows.push({ label: `${prefix}Expiry`, value: formatTimestampMs(p.expiry) });
  }
  if (p.baseAssetSymbol != null || p.baseAssetName != null || p.baseAssetId != null) {
    rows.push({
      label: `${prefix}Base`,
      asset: {
        policyId: p.baseAssetSymbol ?? p.baseAssetId ?? "",
        assetName: p.baseAssetName ?? "",
      },
    });
  }
  if (p.quoteAssetSymbol != null || p.quoteAssetName != null || p.quoteAssetId != null) {
    rows.push({
      label: `${prefix}Quote`,
      asset: {
        policyId: p.quoteAssetSymbol ?? p.quoteAssetId ?? "",
        assetName: p.quoteAssetName ?? "",
      },
    });
  }
  if (p.customKeys.length > 0) {
    rows.push({
      label: `${prefix}Custom keys`,
      value: `${p.customKeys.length} provider field(s) (raw)`,
    });
  }
  return rows;
}

function feedAssets(feed: Charli3Feed): DexAssetRow[] {
  const assets: DexAssetRow[] = [];
  for (const p of feed.prices) {
    if (p.baseAssetId || p.baseAssetSymbol) {
      assets.push({
        label: "Base asset",
        policyId: p.baseAssetSymbol ?? p.baseAssetId ?? "",
        assetName: p.baseAssetName ?? "",
      });
    }
    if (p.quoteAssetId || p.quoteAssetSymbol) {
      assets.push({
        label: "Quote asset",
        policyId: p.quoteAssetSymbol ?? p.quoteAssetId ?? "",
        assetName: p.quoteAssetName ?? "",
      });
    }
  }
  return assets;
}

export function feedToView(feed: Charli3Feed): DexOrderView {
  const issues: DexIssue[] = validateCharli3Feed(feed);
  const rows: DexRow[] = [{ label: "Datum kind", value: feed.kind }];

  feed.prices.forEach((p, i) => {
    const prefix = feed.prices.length > 1 ? `[${i}] ` : "";
    rows.push(...priceRows(p, prefix));
  });

  if (feed.shared) {
    rows.push({ label: "Shared data", value: "present (merged into prices)" });
  }
  if (feed.extended) {
    const e = feed.extended;
    if (e.oracleProviderId != null) {
      rows.push({ label: "Provider id", value: e.oracleProviderId.toString() });
    }
    if (e.dataSourceCount != null) {
      rows.push({ label: "Data sources", value: e.dataSourceCount.toString() });
    }
    if (e.dataSignatoriesCount != null) {
      rows.push({ label: "Signatories", value: e.dataSignatoriesCount.toString() });
    }
    if (e.oracleProviderSignature != null) {
      rows.push({
        label: "Provider signature",
        value: e.oracleProviderSignature,
        hash: true,
      });
    }
  }

  const kind =
    feed.kind === "OracleFeed"
      ? feed.prices.length > 1
        ? `Price feed (${feed.prices.length} pairs)`
        : "Price feed"
      : feed.kind;

  return {
    protocol: "Charli3",
    role: "feed",
    kind,
    rows,
    assets: feedAssets(feed),
    issues,
  };
}

function tryHex(d: PD): string | null {
  try {
    return asBytes(d);
  } catch {
    return null;
  }
}

// Render an internal Charli3 oracle datum (NodeDatum / AggDatum / RewardDatum)
// structurally: node/signatory sets become hash lists, lists of
// `Constr0[hash, int]` become account → amount rows, and remaining ints/bytes
// are shown by position. The data is fully surfaced instead of erroring as
// "no price feed".
function describeInternal(node: PD, label: string, rows: DexRow[], depth: number): void {
  if (depth > 6) {
    rows.push({ label, value: "(nested)" });
    return;
  }
  if (isList(node) && node.list.length > 0) {
    if (node.list.every((x) => tryHex(x)?.length === 56)) {
      rows.push({ label: `${label} — ${node.list.length} node hash(es)` });
      node.list.forEach((x, i) => rows.push({ label: `  node ${i}`, value: asBytes(x), hash: true }));
      return;
    }
    if (
      node.list.every(
        (x) =>
          isConstr(x) &&
          x.constructor === 0 &&
          x.fields.length === 2 &&
          tryHex(x.fields[0])?.length === 56 &&
          isInt(x.fields[1]),
      )
    ) {
      rows.push({ label: `${label} — ${node.list.length} account(s)` });
      node.list.forEach((x) => {
        const c = asConstr(x);
        rows.push({ label: `  reward ${asInt(c.fields[1]).toLocaleString()}`, value: asBytes(c.fields[0]), hash: true });
      });
      return;
    }
    node.list.forEach((x, i) => describeInternal(x, `${label}[${i}]`, rows, depth + 1));
    return;
  }
  if (isInt(node)) {
    rows.push({ label, value: asInt(node).toLocaleString() });
    return;
  }
  const hx = tryHex(node);
  if (hx != null) {
    rows.push({ label, value: hx, hash: hx.length === 56 });
    return;
  }
  if (isConstr(node)) {
    if (node.fields.length === 1) {
      describeInternal(node.fields[0], label, rows, depth + 1);
      return;
    }
    node.fields.forEach((f, i) => describeInternal(f, `${label}.${i}`, rows, depth + 1));
    return;
  }
  rows.push({ label, value: "(structure)" });
}

// Internal Charli3 datum field layouts:
//   AggDatum    → OracleSettings (11 fields)
//   RewardDatum → OracleReward
//   NodeDatum   → NodeState
const ORACLE_SETTINGS_LABELS = [
  "Node operators", // 0 osNodeList: List<PubKeyHash>
  "Updated nodes (%)", // 1 osUpdatedNodes: Percent
  "Updated-node window", // 2 osUpdatedNodeTime: ms
  "Aggregate window", // 3 osAggregateTime: ms
  "Aggregate change (%)", // 4 osAggregateChange: Percent
  "Minimum deposit", // 5 osMinimumDeposit
  "Aggregate valid range", // 6 osAggregateValidRange: ms
  "Reward fees", // 7 osPriceRewards: PRewards[node, aggregate, platform]
  "IQR multiplier", // 8 osIQRMultiplier
  "Divergence (%)", // 9 osDivergence: Percent
  "Settings multisig", // 10 osPlatform: Platform[signers, threshold]
] as const;
const SETTINGS_MS_FIELDS = new Set([2, 3, 6]);

function fmtMs(ms: bigint): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return `${ms.toString()} ms`;
  for (const [u, s] of [[86400000, "d"], [3600000, "h"], [60000, "m"], [1000, "s"]] as const) {
    if (n % u === 0) return `${n / u}${s} (${ms.toString()} ms)`;
  }
  return `${ms.toString()} ms`;
}

function pkhListRows(label: string, list: PD[], rows: DexRow[]): void {
  rows.push({ label: `${label} (${list.length})` });
  list.forEach((x, j) => {
    const h = tryHex(x);
    if (h) rows.push({ label: `  ${j}`, value: h, hash: true });
  });
}

// AggDatum → OracleSettings (11 named fields).
function oracleSettingsRows(fields: PD[]): DexRow[] {
  const rows: DexRow[] = [];
  fields.forEach((f, i) => {
    const name = ORACLE_SETTINGS_LABELS[i] ?? `Field ${i}`;
    if (i === 0 && isList(f)) {
      pkhListRows(name, f.list, rows);
    } else if (i === 7 && isConstr(f)) {
      rows.push({ label: name });
      const sub = ["node", "aggregate", "platform"];
      f.fields.forEach((sf, j) => {
        if (isInt(sf)) rows.push({ label: `  ${sub[j] ?? j}`, value: asInt(sf).toLocaleString() });
      });
    } else if (i === 10 && isConstr(f) && f.fields.length === 2) {
      if (isList(f.fields[0])) pkhListRows(`${name} signers`, f.fields[0].list, rows);
      if (isInt(f.fields[1])) rows.push({ label: "  threshold", value: asInt(f.fields[1]).toLocaleString() });
    } else if (isInt(f)) {
      rows.push({ label: name, value: SETTINGS_MS_FIELDS.has(i) ? fmtMs(asInt(f)) : asInt(f).toLocaleString() });
    } else {
      describeInternal(f, name, rows, 0);
    }
  });
  return rows;
}

// RewardDatum → OracleReward[ List<RewardInfo[owner, quantity]>, platformReward ].
function oracleRewardRows(fields: PD[]): DexRow[] {
  const rows: DexRow[] = [];
  if (fields[0] && isList(fields[0])) {
    rows.push({ label: `Node rewards (${fields[0].list.length})` });
    for (const x of fields[0].list) {
      if (isConstr(x) && x.fields.length === 2) {
        const owner = tryHex(x.fields[0]);
        if (owner && isInt(x.fields[1])) {
          rows.push({ label: `  reward ${asInt(x.fields[1]).toLocaleString()}`, value: owner, hash: true });
        }
      }
    }
  }
  if (fields[1] && isInt(fields[1])) rows.push({ label: "Platform reward", value: asInt(fields[1]).toLocaleString() });
  return rows;
}

// NodeDatum → NodeState[ operator PubKeyHash, feed: Maybe<PriceData> ].
//
// The node's `feed` is the operator's OWN latest price submission, encoded as
//   Maybe<PriceData> = Constr0[ PriceData ]  (Just) | Constr1[]  (Nothing)
// where the push-oracle node PriceData is the bare tuple
//   PriceData = Constr0[ price (uint), timestamp (POSIXTime ms) ].
// (Verified live: every ADA/USD node UTxO carries Just(Constr0[price, ts]) with
// the price aligned to the consumer feed and a millisecond POSIXTime.) The old
// code rendered these as opaque "Feed.0"/"Feed.1", dropping their meaning.
function nodeStateRows(fields: PD[]): DexRow[] {
  const rows: DexRow[] = [];
  const op = tryHex(fields[0]);
  if (op) rows.push({ label: "Operator", value: op, hash: true });
  const feed = fields[1];
  if (feed && isConstr(feed)) {
    if (feed.constructor === 1 && feed.fields.length === 0) {
      rows.push({ label: "Submitted feed", value: "none (Nothing)" });
    } else if (
      feed.constructor === 0 &&
      feed.fields.length === 1 &&
      isConstr(feed.fields[0]) &&
      feed.fields[0].fields.length === 2 &&
      isInt(feed.fields[0].fields[0]) &&
      isInt(feed.fields[0].fields[1])
    ) {
      // Just( PriceData[ price, timestamp ] )
      const priceData = feed.fields[0];
      rows.push({ label: "Submitted price (raw)", value: asInt(priceData.fields[0]).toLocaleString() });
      rows.push({ label: "Submitted timestamp", value: formatTimestampMs(asInt(priceData.fields[1])) });
    } else {
      describeInternal(feed, "Submitted feed", rows, 0);
    }
  }
  return rows;
}

export function internalToView(kind: Charli3OracleKind, datum: PD): DexOrderView {
  const rows: DexRow[] = [{ label: "Datum kind", value: kind }];
  let node: PD = datum;
  while (isConstr(node) && node.fields.length === 1) node = node.fields[0];
  const fields = isConstr(node) ? node.fields : [node];
  if (kind === "AggDatum") rows.push(...oracleSettingsRows(fields));
  else if (kind === "RewardDatum") rows.push(...oracleRewardRows(fields));
  else if (kind === "NodeDatum") rows.push(...nodeStateRows(fields));
  else fields.forEach((f, i) => describeInternal(f, `Field ${i}`, rows, 0));
  return {
    protocol: "Charli3",
    role: "feed",
    kind,
    rows,
    issues: [{ severity: "info", message: `Internal oracle datum (${kind}); not a consumer price feed.` }],
  };
}

registerDexAdapter({
  id: "charli3",
  label: "Charli3",
  matchScriptHash: matchCharli3ScriptHash,
  matchNftPolicy: matchCharli3NftPolicy,
  decode: (datum: PD) => {
    const feed = parseCharli3Feed(datum);
    return feed.kind === "OracleFeed" || feed.kind === "Unknown"
      ? feedToView(feed)
      : internalToView(feed.kind, datum);
  },
  classifyRedeemer: (redeemer: PD) => classifyCharli3Redeemer(redeemer),
});

export * from "./feed";
export {
  CHARLI3,
  CHARLI3_FEED_ASSET_NAME,
  CHARLI3_FEED_NFT_POLICIES,
  CHARLI3_FEED_SCRIPT_HASHES,
  charli3PairForHash,
} from "./constants";
