// CSWAP DEX decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRow,
  type PoolPair,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD, PlutusAddress } from "@/utils/protocols/dex/plutusData";
import type { DexRole } from "@/utils/protocols/dex/registry";
import { matchCswapScriptHash } from "./constants";
import {
  classifyCswapOrderRedeemer,
  classifyCswapPoolRedeemer,
  parseCswapOrder,
  parseCswapPool,
  validateCswapOrder,
  validateCswapPool,
  type CswapOrder,
  type CswapPool,
  type CswapValueLeg,
} from "./cswap";

// Compact leg label for the headline only (full policy/name go in assets[]):
// "ADA" for the ada leg, otherwise the decoded ASCII asset name when printable.
function legLabel(asset: AssetClass): string {
  if (asset.policyId === "" && asset.assetName === "") return "ADA";
  if (asset.assetName && /^[0-9a-fA-F]*$/.test(asset.assetName) && asset.assetName.length % 2 === 0) {
    const bytes = asset.assetName.match(/.{2}/g) ?? [];
    const ascii = bytes.map((b) => String.fromCharCode(parseInt(b, 16))).join("");
    if (/^[\x20-\x7e]+$/.test(ascii)) return ascii;
  }
  return "token";
}

function isAda(asset: AssetClass): boolean {
  return asset.policyId === "" && asset.assetName === "";
}

// Surface the owner Address's optional stake credential as its own row.
function ownerStakeRows(addr: PlutusAddress): DexRow[] {
  const stake = addr.stakeCredential;
  if (!stake) return [{ label: "Owner stake", value: "none" }];
  if (stake.kind === "Inline") {
    const sk = stake.credential.kind === "Script" ? "script" : "key";
    return [{ label: `Owner stake (${sk})`, value: stake.credential.hash, hash: true }];
  }
  return [
    {
      label: "Owner stake (pointer)",
      value: `slot ${stake.slotNumber}, txIdx ${stake.transactionIndex}, certIdx ${stake.certificateIndex}`,
    },
  ];
}

function valueLegRows(label: string, legs: CswapValueLeg[]): DexAssetRow[] {
  return legs.map((leg) => ({
    label,
    policyId: leg.policyId,
    assetName: leg.assetName,
    amount: leg.amount,
  }));
}

// Pick the trading pair for an order. The maker's wanted list is the price leg;
// when it names two distinct assets (e.g. ADA + a token), those ARE the pair.
// When it names a single asset, pair it with ADA (the other side of the trade).
function orderPair(order: CswapOrder): PoolPair | undefined {
  const legs = order.wanted;
  if (legs.length === 0) return undefined;
  // Find the first two distinct asset classes across the wanted legs.
  const distinct: AssetClass[] = [];
  for (const leg of legs) {
    const a: AssetClass = { policyId: leg.policyId, assetName: leg.assetName };
    if (!distinct.some((d) => d.policyId === a.policyId && d.assetName === a.assetName)) {
      distinct.push(a);
    }
    if (distinct.length === 2) break;
  }
  if (distinct.length === 2) {
    return {
      assetA: { policyId: distinct[0].policyId, assetName: distinct[0].assetName },
      assetB: { policyId: distinct[1].policyId, assetName: distinct[1].assetName },
    };
  }
  // Single distinct wanted asset: pair it with ADA (unless it IS ada).
  const only = distinct[0];
  if (isAda(only)) return undefined;
  return {
    assetA: { policyId: "", assetName: "" },
    assetB: { policyId: only.policyId, assetName: only.assetName },
  };
}

function orderToView(order: CswapOrder): DexOrderView {
  const ownerKind = order.owner.paymentCredential.kind === "Script" ? "script" : "key";
  const rows: DexRow[] = [
    { label: `Owner (${ownerKind})`, value: order.owner.paymentCredential.hash, hash: true },
    ...ownerStakeRows(order.owner),
    // flag (field3), paramA (field4), paramB (field5) are off-chain batcher
    // metadata: the on-chain validators read only fields[0] (owner) + fields[1]
    // (min-receive), never fields[2..5], and the pools charge their own fee — so
    // these carry no enforced meaning and stay neutral rather than asserted.
    // flag is an order marker (≈always Constr0, a rare Constr1), shown only when
    // it deviates.
    ...(order.flagTag !== 0 ? [{ label: "Order flag", value: `Constr ${order.flagTag}` }] : []),
    { label: "Param A", value: order.paramA.toLocaleString() },
    { label: "Param B", value: order.paramB.toLocaleString() },
  ];
  // field[1] is the ONLY enforced economic field: the validator requires, per
  // asset, `amount <= the maker's output value` — i.e. the MIN to receive on a
  // fill. field[2] (residual) is a value-leg list the validator never reads
  // (off-chain); shown when non-zero but not enforced.
  const residual = order.residual.filter((l) => l.amount !== BigInt(0));
  const assets: DexAssetRow[] = [
    ...valueLegRows("Min receive", order.wanted),
    ...valueLegRows("Residual", residual),
  ];
  return {
    protocol: "CSWAP",
    role: "order",
    kind: "Limit order",
    rows,
    assets,
    issues: validateCswapOrder(order),
    pair: orderPair(order),
  };
}

function poolToView(pool: CswapPool): DexOrderView {
  const rows: DexRow[] = [
    { label: "Balance (field 0)", value: pool.balance.toLocaleString() },
    { label: "Fee numerator", value: pool.feeNumerator.toLocaleString() },
    { label: "LP / pool token policy", value: pool.lpPolicy, hash: true },
    { label: "LP name", value: decodeLpName(pool.lpName) },
  ];
  const assets: DexAssetRow[] = [
    { label: "Reserve A", policyId: pool.assetA.policyId, assetName: pool.assetA.assetName },
    { label: "Reserve B", policyId: pool.assetB.policyId, assetName: pool.assetB.assetName },
  ];
  const kind = `Pool: ${legLabel(pool.assetA)} / ${legLabel(pool.assetB)}`;
  return {
    protocol: "CSWAP",
    role: "pool",
    kind,
    rows,
    assets,
    issues: validateCswapPool(pool),
    // Constant-product pool: the two reserve assets are the trading pair, taken
    // verbatim from the datum (never reordered). ada = ("","").
    pair: {
      assetA: { policyId: pool.assetA.policyId, assetName: pool.assetA.assetName },
      assetB: { policyId: pool.assetB.policyId, assetName: pool.assetB.assetName },
    },
  };
}

// LP name bytes are plain UTF-8 text (e.g. "C-LP: ADA x AWOO"); show it readably.
function decodeLpName(hex: string): string {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return hex;
  const bytes = hex.match(/.{2}/g) ?? [];
  const ascii = bytes.map((b) => String.fromCharCode(parseInt(b, 16))).join("");
  return /^[\x20-\x7e]*$/.test(ascii) ? ascii : hex;
}

registerDexAdapter({
  id: "cswap",
  label: "CSWAP",
  matchScriptHash: matchCswapScriptHash,
  decode: (datum: PD, role: DexRole) =>
    role === "pool" ? poolToView(parseCswapPool(datum)) : orderToView(parseCswapOrder(datum)),
  classifyRedeemer: (redeemer: PD, role: DexRole) =>
    role === "pool"
      ? classifyCswapPoolRedeemer(redeemer)
      : classifyCswapOrderRedeemer(redeemer),
});

export * from "./cswap";
export { CSWAP } from "./constants";
