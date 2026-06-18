// Normalized, completeness-oriented view of SundaeSwap order/pool datums.
//
// The bespoke `SundaeOrderPanel` renders the parsed datum directly and, for
// brevity, silently drops several meaningful fields (the `extension` Data, the
// destination's inline/hash datum, the individual signers of a multisig owner,
// the Strategy/Record sub-fields, etc.). This module walks EVERY field of each
// datum and emits a `DexOrderView` row for it — the same normalized shape the
// generic DEX panel renders — so nothing on-chain is hidden.
//
// Field meanings are taken from the authoritative Aiken source:
//   SundaeSwap-finance/sundae-contracts lib/types/order.ak and lib/types/pool.ak
//     OrderDatum  { pool_ident, owner, max_protocol_fee, destination, details, extension }
//     Destination = Fixed { address, datum } | Self
//     Order       = Strategy { auth } | Swap { offer, min_received }
//                 | Deposit { assets } | Withdrawal { amount }
//                 | Donation { assets } | Record { policy }
//     PoolDatum   { identifier, assets, circulating_lp, bid_fees_per_10_thousand,
//                   ask_fees_per_10_thousand, fee_manager, market_open, protocol_fees }

import type { DexOrderView, DexRow } from "@/utils/protocols/dex/registry";
import { isConstr, type PD } from "./plutusData";
import type {
  V3OrderDatum,
  Order,
  Destination,
  DatumOption,
  MultisigScript,
  Credential,
  StakeCredential,
  StrategyAuthorization,
  AssetAmount,
  SundaePoolDatum,
  V3PoolDatum,
  StableswapPoolDatum,
  SundaeIssue,
} from "./v3";
import type { V1PoolDatum } from "./v1";

// --- small helpers ---------------------------------------------------------

function credKind(c: Credential): string {
  return c.kind === "Script" ? "script" : "key";
}

function stakeSuffix(stake: StakeCredential | null): string {
  if (!stake) return "";
  if (stake.kind === "Inline") {
    return ` / stake ${credKind(stake.credential)} ${stake.credential.hash}`;
  }
  return ` / stake pointer (${stake.slotNumber}, ${stake.transactionIndex}, ${stake.certificateIndex})`;
}

function assetRow(label: string, a: AssetAmount): DexRow {
  // ada = ("", "") → surface as a native asset; the panel decorates the symbol.
  return { label, asset: { policyId: a.policyId, assetName: a.assetName, amount: a.amount } };
}

// A `MultisigScript` (sundae/multisig). Signature/Script carry a 28-byte hash;
// the logical combinators (AllOf/AnyOf/AtLeast) recurse into nested scripts —
// which the bespoke panel collapses to a bare count. Emit one row per leaf.
function multisigRows(label: string, m: MultisigScript): DexRow[] {
  switch (m.kind) {
    case "Signature":
      return [{ label: `${label} (signature)`, value: m.keyHash, hash: true }];
    case "Script":
      return [{ label: `${label} (script)`, value: m.scriptHash, hash: true }];
    case "Before":
      return [{ label: `${label} (before)`, value: `${m.time} (POSIXTime ms)` }];
    case "After":
      return [{ label: `${label} (after)`, value: `${m.time} (POSIXTime ms)` }];
    case "AllOf":
    case "AnyOf":
      return [
        { label: `${label} (${m.kind === "AllOf" ? "all of" : "any of"})`, value: `${m.scripts.length} signer(s)` },
        ...m.scripts.flatMap((s, i) => multisigRows(`${label} #${i + 1}`, s)),
      ];
    case "AtLeast":
      return [
        { label: `${label} (at least)`, value: `${m.required} of ${m.scripts.length}` },
        ...m.scripts.flatMap((s, i) => multisigRows(`${label} #${i + 1}`, s)),
      ];
  }
}

function strategyAuthRows(label: string, a: StrategyAuthorization): DexRow[] {
  return a.kind === "Signature"
    ? [{ label: `${label} (signature)`, value: a.signer, hash: true }]
    : [{ label: `${label} (script)`, value: a.scriptHash, hash: true }];
}

// The destination's `datum: Datum` (None / Hash(b32) / Inline(data)). The panel
// only shows "Hash <short>" / "Inline"; surface the FULL hash and the inline
// data's shape so the receiver's pinned datum isn't hidden.
function datumOptionRows(label: string, d: DatumOption): DexRow[] {
  switch (d.kind) {
    case "NoDatum":
      return [{ label, value: "none" }];
    case "DatumHash":
      return [{ label: `${label} (hash)`, value: d.hash, hash: true }];
    case "InlineDatum":
      return [{ label: `${label} (inline)`, value: describeInline(d.data), mono: true }];
  }
}

function describeInline(d: PD): string {
  if (isConstr(d)) return `Constr ${d.constructor} [${d.fields.length} field(s)]`;
  if ("list" in d) return `List [${d.list.length}]`;
  if ("map" in d) return `Map {${d.map.length}}`;
  if ("int" in d) return String(d.int);
  if ("bytes" in d) return `0x${d.bytes}`;
  return "data";
}

function destinationRows(dest: Destination): DexRow[] {
  if (dest.kind === "Self") {
    return [{ label: "Destination", value: "Self (returns to the order address)" }];
  }
  const c = dest.address.paymentCredential;
  return [
    {
      label: `Destination (${credKind(c)})`,
      value: `${c.hash}${stakeSuffix(dest.address.stakeCredential)}`,
      hash: true,
    },
    ...datumOptionRows("Destination datum", dest.datum),
  ];
}

function orderRows(o: Order): { kind: string; rows: DexRow[] } {
  switch (o.kind) {
    case "Swap":
      return {
        kind: "Swap",
        rows: [assetRow("Offer", o.offer), assetRow("Min received", o.minReceived)],
      };
    case "Deposit":
      return {
        kind: "Deposit",
        rows: [assetRow("Deposit asset A", o.assets[0]), assetRow("Deposit asset B", o.assets[1])],
      };
    case "Donation":
      return {
        kind: "Donation",
        rows: [assetRow("Donate asset A", o.assets[0]), assetRow("Donate asset B", o.assets[1])],
      };
    case "Withdrawal":
      return { kind: "Withdrawal", rows: [assetRow("LP to burn", o.lpAmount)] };
    case "Strategy":
      return { kind: "Strategy", rows: strategyAuthRows("Strategy authorization", o.auth) };
    case "Record":
      return {
        kind: "Record",
        rows: [
          { label: "Record policy", value: o.policy.policyId, hash: true },
          { label: "Record asset name", value: o.policy.assetName || "(empty)", mono: true },
        ],
      };
  }
}

// The `extension: Data` field is an opaque, protocol-extensible payload. On
// mainnet it is almost always the canonical empty `Constr 0 []` (CBOR d87980)
// but real, non-empty values DO occur — surface its raw shape rather than hide
// it. Returns null when it is the canonical "no extension" so we don't add noise.
function extensionRow(ext: PD): DexRow | null {
  const empty =
    (isConstr(ext) && ext.constructor === 0 && ext.fields.length === 0) ||
    ("bytes" in ext && (ext.bytes === "d87980" || ext.bytes === ""));
  if (empty) return null;
  if ("bytes" in ext) return { label: "Extension (raw CBOR)", value: `0x${ext.bytes}`, mono: true };
  return { label: "Extension", value: describeInline(ext), mono: true };
}

// --- public builders -------------------------------------------------------

const FEE_BPS_DENOM = 10_000;

function pct(perTenK: bigint): string {
  return `${((Number(perTenK) / FEE_BPS_DENOM) * 100).toFixed(3)}%`;
}

export function buildSundaeOrderView(
  datum: V3OrderDatum,
  protocol: "V3" | "Stableswap",
  issues: SundaeIssue[] = []
): DexOrderView {
  const details = orderRows(datum.details);
  const rows: DexRow[] = [
    // 0: pool_ident: Option<Ident> — the 28-byte pool this order targets.
    {
      label: "Pool ident",
      value: datum.poolIdent ?? "none (any pool)",
      hash: datum.poolIdent !== null,
    },
    // 4: details — the order action's own fields.
    ...details.rows,
    // 2: max_protocol_fee: Int — lovelace cap paid to the scooper.
    { label: "Max protocol fee", value: `${datum.maxProtocolFee.toLocaleString()} lovelace` },
    // 1: owner: MultisigScript — who may cancel/control the order.
    ...multisigRows("Owner", datum.owner),
    // 3: destination — where funds are paid + the pinned receiver datum.
    ...destinationRows(datum.destination),
  ];
  // 5: extension: Data — opaque, only when non-empty.
  const ext = extensionRow(datum.extension);
  if (ext) rows.push(ext);

  return {
    protocol: `Sundae ${protocol}`,
    role: "order",
    kind: details.kind,
    rows,
    issues,
  };
}

function poolPairRows(p: { assetA: { policyId: string; assetName: string }; assetB: { policyId: string; assetName: string } }): DexRow[] {
  return [
    { label: "Asset A", asset: { policyId: p.assetA.policyId, assetName: p.assetA.assetName } },
    { label: "Asset B", asset: { policyId: p.assetB.policyId, assetName: p.assetB.assetName } },
  ];
}

function feeManagerRows(m: MultisigScript | null, label = "Fee manager"): DexRow[] {
  if (!m) return [{ label, value: "none" }];
  return multisigRows(label, m);
}

export function buildSundaePoolView(datum: SundaePoolDatum): DexOrderView {
  if (datum.kind === "V1") return buildV1PoolView(datum);
  if (datum.kind === "Stableswap") return buildStableswapPoolView(datum);
  return buildV3PoolView(datum);
}

function buildV3PoolView(d: V3PoolDatum): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool ident", value: d.identifier, hash: true },
    ...poolPairRows(d),
    { label: "Circulating LP", value: d.circulatingLp.toLocaleString() },
    { label: "Bid fee (A→B)", value: pct(d.bidFeesPer10K) },
    { label: "Ask fee (B→A)", value: pct(d.askFeesPer10K) },
    ...feeManagerRows(d.feeManager),
    { label: "Market opens", value: `${d.marketOpenSlot} (POSIXTime ms)` },
    { label: "Protocol fees (reserved)", value: `${d.protocolFees.toLocaleString()} lovelace` },
  ];
  return { protocol: "Sundae V3", role: "pool", kind: "Pool", rows, issues: [] };
}

function buildStableswapPoolView(d: StableswapPoolDatum): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool ident", value: d.identifier, hash: true },
    ...poolPairRows(d),
    { label: "Circulating LP", value: d.circulatingLp.toLocaleString() },
    { label: "LP fee (bid / ask)", value: `${pct(d.lpBidFeesPer10K)} / ${pct(d.lpAskFeesPer10K)}` },
    { label: "Protocol fee (bid / ask)", value: `${pct(d.protocolBidFeesPer10K)} / ${pct(d.protocolAskFeesPer10K)}` },
    ...feeManagerRows(d.feeManager),
    { label: "Market opens", value: `${d.marketOpenSlot} (POSIXTime ms)` },
    {
      label: "Accumulated protocol fees",
      value: `flat ${d.protocolFeesFlat.toLocaleString()} lovelace · A ${d.protocolFeesA.toLocaleString()} · B ${d.protocolFeesB.toLocaleString()}`,
    },
    { label: "Amplification (A factor)", value: d.linearAmplification.toString() },
    { label: "Invariant D (cached)", value: d.sumInvariant.toString(), mono: true },
    ...feeManagerRows(d.linearAmplificationManager, "Amplification manager"),
  ];
  return { protocol: "Sundae Stableswap", role: "pool", kind: "Pool", rows, issues: [] };
}

function buildV1PoolView(d: V1PoolDatum): DexOrderView {
  const feePct =
    d.feeDenominator > BigInt(0)
      ? ` (${((Number(d.feeNumerator) / Number(d.feeDenominator)) * 100).toFixed(2)}%)`
      : "";
  const rows: DexRow[] = [
    { label: "Pool ident", value: d.identifier, hash: true },
    ...poolPairRows(d),
    { label: "Circulating LP", value: d.circulatingLp.toLocaleString() },
    {
      label: "Swap fee",
      value: `${d.feeNumerator} / ${d.feeDenominator}${feePct}`,
    },
  ];
  return { protocol: "Sundae V1", role: "pool", kind: "Pool", rows, issues: [] };
}
