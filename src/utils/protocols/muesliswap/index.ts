// MuesliSwap decoder: normalized views + adapter registration.
//
// MuesliSwap is a hybrid DEX. The adapter exposes two roles:
//   - "order": the order-book order/escrow (surface A).
//   - "pool":  the AMM surface, which has TWO datum shapes living at two
//     different script hashes — the ConstantProductPool datum (B1) and the
//     BatchOrder liquidity-order datum (B3). `decode` discriminates them by the
//     datum's field shape so a single role can render either.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD, PlutusAddress } from "@/utils/protocols/dex/plutusData";
import { isConstr } from "@/utils/protocols/dex/plutusData";
import {
  MUESLISWAP,
  matchMuesliSwapNftPolicy,
  matchMuesliSwapScriptHash,
} from "./constants";
import {
  classifyBatchOrderRedeemer,
  classifyOrderBookRedeemer,
  classifyOrderBookV2Redeemer,
  classifyPoolRedeemer,
  parseBatchOrderDatum,
  parseMuesliOrderBookV2Datum,
  parseOrderBookDatum,
  parsePoolDatum,
  type MuesliBatchOrderDatum,
  type MuesliOrderBookDatum,
  type MuesliOrderBookV2Datum,
  type MuesliOrderStep,
  type MuesliPoolDatum,
} from "./muesliswap";

// Build a row for an asset class: the panel renders the structured `asset`
// field like the asset table — decoded (human-readable) asset name with the
// full policy id on hover + copy. ada = ("", "") renders as "ADA".
function assetRow(label: string, asset: AssetClass): DexRow {
  return {
    label,
    asset: { policyId: asset.policyId, assetName: asset.assetName },
  };
}

// Build a credential row: the "key"/"script" descriptor moves into the label
// (e.g. "Creator (script)") and the FULL credential hash becomes the hash:true
// value.
function credentialRow(label: string, addr: PlutusAddress): DexRow {
  const c = addr.paymentCredential;
  const kind = c.kind === "Script" ? "script" : "key";
  return { label: `${label} (${kind})`, value: c.hash, hash: true };
}

// --- SURFACE A: order-book order ------------------------------------------

export function orderBookToView(datum: MuesliOrderBookDatum): DexOrderView {
  const issues: DexIssue[] = [];
  if (datum.buyAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Buy amount is not positive" });
  }
  if (datum.extraFields.length > 0) {
    issues.push({
      severity: "info",
      message:
        `Datum carries ${datum.extraFields.length} extra field(s) beyond the ` +
        "public 4-field layout (production order-book datum); not decoded.",
    });
  }
  const rows: DexRow[] = [
    { label: "Creator (PKH)", value: datum.creator, hash: true },
    { label: "Buy amount", value: datum.buyAmount.toLocaleString() },
  ];
  const buyAsset: AssetClass = {
    policyId: datum.buyCurrency,
    assetName: datum.buyToken,
  };
  const assets: DexAssetRow[] = [
    {
      label: "Buy",
      policyId: buyAsset.policyId,
      assetName: buyAsset.assetName,
      amount: datum.buyAmount,
    },
  ];
  return {
    protocol: "MuesliSwap (order-book)",
    role: "order",
    kind: "Limit order",
    rows,
    assets,
    issues,
  };
}

// --- SURFACE A2: order-book V2 production order ----------------------------

export function orderBookV2ToView(datum: MuesliOrderBookV2Datum): DexOrderView {
  const issues: DexIssue[] = [];
  if (datum.buyAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Buy amount is not positive" });
  }
  const buyAsset: AssetClass = { policyId: datum.buyCurrency, assetName: datum.buyToken };
  const sellAsset: AssetClass = { policyId: datum.sellCurrency, assetName: datum.sellToken };
  const rows: DexRow[] = [
    credentialRow("Creator", datum.creator),
    assetRow("Buy", buyAsset),
    { label: "Buy amount", value: datum.buyAmount.toLocaleString() },
    assetRow("Sell", sellAsset),
    { label: "Allow partial fill", value: datum.allowPartial ? "yes" : "no" },
    { label: "Lovelace attached", value: datum.lovelaceAttached.toLocaleString() },
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Buy",
      policyId: buyAsset.policyId,
      assetName: buyAsset.assetName,
      amount: datum.buyAmount,
    },
    { label: "Sell", policyId: sellAsset.policyId, assetName: sellAsset.assetName },
  ];
  return {
    protocol: "MuesliSwap (order-book v2)",
    role: "orderbook-v2-order",
    kind: "Limit order",
    rows,
    assets,
    issues,
  };
}

// --- SURFACE B1: AMM pool --------------------------------------------------

export function poolToView(datum: MuesliPoolDatum): DexOrderView {
  const rows: DexRow[] = [
    { label: "Swap fee", value: `${datum.swapFee} / 10000` },
    { label: "Total liquidity (LP)", value: datum.totalLiquidity.toLocaleString() },
    assetRow("Coin A", datum.coinA),
    assetRow("Coin B", datum.coinB),
  ];
  const assets: DexAssetRow[] = [
    { label: "Coin A", policyId: datum.coinA.policyId, assetName: datum.coinA.assetName },
    { label: "Coin B", policyId: datum.coinB.policyId, assetName: datum.coinB.assetName },
  ];
  return {
    protocol: "MuesliSwap (AMM)",
    role: "pool",
    kind: "Liquidity Pool (constant product)",
    rows,
    assets,
    issues: [],
  };
}

// --- SURFACE B3: AMM batch (liquidity) order -------------------------------

function stepLabel(step: MuesliOrderStep): string {
  switch (step.kind) {
    case "Deposit":
      return "Deposit liquidity";
    case "Withdraw":
      return "Withdraw liquidity";
    case "OneSideDeposit":
      return "One-side deposit";
  }
}

function stepRows(step: MuesliOrderStep): DexRow[] {
  switch (step.kind) {
    case "Deposit":
      return [{ label: "Min LP", value: step.minimumLP.toLocaleString() }];
    case "Withdraw":
      return [
        { label: "Min coin A", value: step.minimumCoinA.toLocaleString() },
        { label: "Min coin B", value: step.minimumCoinB.toLocaleString() },
      ];
    case "OneSideDeposit":
      return [
        assetRow("Desired coin", step.desiredCoin),
        { label: "Min LP", value: step.minimumLP.toLocaleString() },
      ];
  }
}

export function batchOrderToView(datum: MuesliBatchOrderDatum): DexOrderView {
  const issues: DexIssue[] = [];
  if (datum.scriptVersion !== MUESLISWAP.scriptVersionHex) {
    issues.push({
      severity: "warning",
      message: `Unexpected script version (expected "MuesliSwap_AMM")`,
    });
  }
  const assets: DexAssetRow[] = [];
  if (datum.step.kind === "OneSideDeposit") {
    assets.push({
      label: "Desired coin",
      policyId: datum.step.desiredCoin.policyId,
      assetName: datum.step.desiredCoin.assetName,
    });
  }
  const rows: DexRow[] = [
    ...stepRows(datum.step),
    { label: "Batcher fee", value: datum.batcherFee.toLocaleString() },
    { label: "Output ADA", value: datum.outputADA.toLocaleString() },
    datum.poolNftTokenName
      ? { label: "Pool NFT token name", value: datum.poolNftTokenName, hash: true }
      : { label: "Pool NFT token name", value: "none (legacy layout)" },
    credentialRow("Sender", datum.sender),
    credentialRow("Receiver", datum.receiver),
    datum.receiverDatumHash
      ? { label: "Receiver datum hash", value: datum.receiverDatumHash, hash: true }
      : { label: "Receiver datum hash", value: "none" },
  ];
  return {
    protocol: "MuesliSwap (AMM)",
    role: "pool",
    kind: stepLabel(datum.step),
    rows,
    assets,
    issues,
  };
}

// --- dispatch --------------------------------------------------------------

// The "pool" role covers two distinct datum shapes. Discriminate by structure:
// the BatchOrder datum's first field is an Address (Constr 0 with a nested
// Credential + Maybe-staking), while the PoolDatum's first field is an
// AssetClass (Constr 0 [bytes, bytes]). We test field[0]'s first sub-field:
// an Address's first field is itself a Constr (the Credential); a PoolDatum's
// coinA first field is bare bytes (the policy id).
function decodePoolSurface(datum: PD): DexOrderView {
  if (looksLikeBatchOrder(datum)) {
    return batchOrderToView(parseBatchOrderDatum(datum));
  }
  return poolToView(parsePoolDatum(datum));
}

function looksLikeBatchOrder(datum: PD): boolean {
  // Live mainnet carries two layouts: 8-field (with odPoolNftTokenName) and a
  // legacy 7-field one (without it). Both wrap an Address in field[0]; the
  // PoolDatum has only 4 fields with a bare-bytes-led AssetClass in field[0].
  if (
    !isConstr(datum) ||
    datum.constructor !== 0 ||
    (datum.fields.length !== 7 && datum.fields.length !== 8)
  ) {
    return false;
  }
  const first = datum.fields[0];
  // Address = Constr 0 [ Credential, Maybe Staking ]: its first field is a
  // Constr (the Credential). PoolDatum.coinA = Constr 0 [bytes, bytes]: its
  // first field is bare bytes.
  if (!isConstr(first) || first.fields.length < 1) return false;
  return isConstr(first.fields[0]);
}

export function decode(datum: PD, role: string): DexOrderView {
  if (role === "order") return orderBookToView(parseOrderBookDatum(datum));
  if (role === "orderbook-v2-order") {
    return orderBookV2ToView(parseMuesliOrderBookV2Datum(datum));
  }
  return decodePoolSurface(datum);
}

// Redeemers differ per surface; the adapter only knows the coarse role, so we
// best-effort classify against every redeemer family and return the first hit.
export function classifyRedeemer(redeemer: PD, role: string): string | null {
  if (role === "order") return classifyOrderBookRedeemer(redeemer);
  // V2 order-book uses the OPPOSITE index mapping (Constr 0 = Match).
  if (role === "orderbook-v2-order") return classifyOrderBookV2Redeemer(redeemer);
  return classifyPoolRedeemer(redeemer) ?? classifyBatchOrderRedeemer(redeemer);
}

registerDexAdapter({
  id: "muesliswap",
  label: "MuesliSwap",
  matchScriptHash: matchMuesliSwapScriptHash,
  matchNftPolicy: matchMuesliSwapNftPolicy,
  decode,
  classifyRedeemer,
});

export * from "./muesliswap";
export {
  MUESLISWAP,
  matchMuesliSwapNftPolicy,
  matchMuesliSwapScriptHash,
} from "./constants";
