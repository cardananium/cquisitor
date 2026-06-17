// Strike Finance (Perpetuals) decoder: normalized views + adapter registration.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD } from "@/utils/protocols/dex/plutusData";
import { asConstr } from "@/utils/protocols/dex/plutusData";
import {
  matchStrikeForwardsNftPolicy,
  matchStrikeForwardsScriptHash,
  matchStrikeNftPolicy,
  matchStrikeScriptHash,
} from "./constants";
import {
  parseStrikeAgreementDatum,
  parseStrikeCollateralDatum,
  parseStrikeCollateralRedeemer,
  parseStrikeForwardsDatum,
  parseStrikeForwardsMintRedeemer,
  parseStrikeForwardsRedeemer,
  type StrikeForwardsDatum,
} from "./forwards";
import {
  parseStrikeManagePositionRedeemer,
  parseStrikeOrderDatum,
  parseStrikeOrdersRedeemer,
  parseStrikePoolDatum,
  parseStrikePositionDatum,
  type StrikeOrderAction,
  type StrikeOrderDatum,
  type StrikePoolDatum,
  type StrikePositionDatum,
} from "./datums";

const USD_MULTIPLIER = 100_000;

function isAda(asset: AssetClass): boolean {
  return asset.policyId === "" && asset.assetName === "";
}

// Build a single asset-identifier DexRow using the structured `asset` field.
// The panel renders the decoded asset name (or "ADA" when both fields are "").
function assetIdRow(label: string, asset: AssetClass): DexRow {
  return { label, asset: { policyId: asset.policyId, assetName: asset.assetName } };
}

// USD prices/fees are integers scaled ×100000.
function formatUsd(scaled: bigint): string {
  const neg = scaled < BigInt(0);
  const abs = neg ? -scaled : scaled;
  const whole = abs / BigInt(USD_MULTIPLIER);
  const frac = abs % BigInt(USD_MULTIPLIER);
  const fracStr = frac.toString().padStart(5, "0").replace(/0+$/, "");
  const body = fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
  return `$${neg ? "-" : ""}${body}`;
}

function assetRow(label: string, asset: AssetClass, amount?: bigint): DexAssetRow {
  return { label, policyId: asset.policyId, assetName: asset.assetName, amount };
}

function positionRows(p: StrikePositionDatum): DexRow[] {
  return [
    { label: "Side", value: p.side },
    { label: "Owner", value: p.ownerPkh, hash: true },
    p.ownerStakeKey
      ? { label: "Owner stake key", value: p.ownerStakeKey, hash: true }
      : { label: "Owner stake key", value: "none" },
    { label: "Entered at", value: `${p.enteredPositionTime.toLocaleString()} (POSIX ms)` },
    { label: "Entry price", value: formatUsd(p.enteredAtUsdPrice) },
    {
      label: "Collateral amount",
      value: `${p.collateralAssetAmount.toLocaleString()}${isAda(p.collateralAsset) ? " ADA" : ""}`,
    },
    { label: "Position size", value: p.positionAssetAmount.toLocaleString() },
    { label: "Maintain margin", value: `${p.maintainMarginAmount}%` },
    { label: "Hourly borrow fee", value: formatUsd(p.hourlyUsdBorrowFee) },
    {
      label: "Stop loss",
      value: p.stopLossUsdPrice === BigInt(0) ? "unset" : formatUsd(p.stopLossUsdPrice),
    },
    {
      label: "Take profit",
      value: p.takeProfitUsdPrice === BigInt(0) ? "unset" : formatUsd(p.takeProfitUsdPrice),
    },
    { label: "Position policy", value: p.positionPolicyId, hash: true },
  ];
}

function positionIssues(p: StrikePositionDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (p.collateralAssetAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Position has non-positive collateral" });
  }
  if (p.positionAssetAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Position has non-positive size" });
  }
  return issues;
}

export function strikePositionToView(p: StrikePositionDatum): DexOrderView {
  return {
    protocol: "Strike Finance",
    role: "position",
    kind: `${p.side} position`,
    rows: positionRows(p),
    assets: [assetRow("Collateral", p.collateralAsset, p.collateralAssetAmount)],
    issues: positionIssues(p),
  };
}

function actionLabel(action: StrikeOrderAction): string {
  switch (action.kind) {
    case "OpenPositionOrder":
      return `Open position (${action.openPositionType === "LimitOrder" ? "limit" : "market"})`;
    case "ClosePositionOrder":
      return "Close position";
    case "LiquidatePositionOrder":
      return "Liquidate position";
    case "ProvideLiquidityOrder":
      return "Provide liquidity";
    case "WithdrawLiquidityOrder":
      return "Withdraw liquidity";
  }
}

function orderRows(action: StrikeOrderAction): DexRow[] {
  switch (action.kind) {
    case "OpenPositionOrder":
      return [
        { label: "Order type", value: action.openPositionType },
        ...positionRows(action.positionDatum),
      ];
    case "ClosePositionOrder":
      return [
        { label: "Owner", value: action.ownerPkh, hash: true },
        {
          label: "Send amount",
          value: `${action.sendAssetAmount.toLocaleString()}${isAda(action.sendAsset) ? " ADA" : ""}`,
        },
        { label: "Pool P/L", value: action.poolAssetProfitLoss.toLocaleString() },
        { label: "Borrowed amount", value: action.borrowedAmount.toLocaleString() },
        { label: "Position policy", value: action.positionPolicyId, hash: true },
      ];
    case "LiquidatePositionOrder":
      return [
        { label: "Profit", value: action.profit.toLocaleString() },
        { label: "Lended amount", value: action.lendedAmount.toLocaleString() },
        { label: "Position policy", value: action.positionPolicyId, hash: true },
      ];
    case "ProvideLiquidityOrder":
      return [
        { label: "Owner", value: action.ownerPkh, hash: true },
        assetIdRow("Liquidity asset", action.liquidityAsset),
      ];
    case "WithdrawLiquidityOrder":
      return [{ label: "Owner", value: action.ownerPkh, hash: true }];
  }
}

function orderAssets(action: StrikeOrderAction): DexAssetRow[] {
  switch (action.kind) {
    case "OpenPositionOrder":
      return [
        assetRow(
          "Collateral",
          action.positionDatum.collateralAsset,
          action.positionDatum.collateralAssetAmount,
        ),
      ];
    case "ClosePositionOrder":
      return [assetRow("Send asset", action.sendAsset, action.sendAssetAmount)];
    case "ProvideLiquidityOrder":
      return [assetRow("Liquidity asset", action.liquidityAsset)];
    default:
      return [];
  }
}

export function strikeOrderToView(datum: StrikeOrderDatum): DexOrderView {
  return {
    protocol: "Strike Finance",
    role: "position",
    kind: actionLabel(datum.action),
    rows: orderRows(datum.action),
    assets: orderAssets(datum.action),
    issues: [],
  };
}

export function strikePoolToView(pool: StrikePoolDatum): DexOrderView {
  const rows: DexRow[] = [
    assetIdRow("Underlying", pool.underlyingAsset),
    assetIdRow("LP token", pool.lpAsset),
    { label: "Total liquidity", value: pool.liquidityTotalAssetAmount.toLocaleString() },
    { label: "Total LP minted", value: pool.liquidityTotalLpMinted.toLocaleString() },
    { label: "Total lended", value: pool.totalLendedAmount.toLocaleString() },
    { label: "Batcher license", value: pool.batcherLicense, hash: true },
  ];
  return {
    protocol: "Strike Finance",
    role: "pool",
    kind: "Liquidity Pool",
    rows,
    assets: [
      assetRow("Underlying", pool.underlyingAsset, pool.liquidityTotalAssetAmount),
      assetRow("LP token", pool.lpAsset, pool.liquidityTotalLpMinted),
    ],
    issues: [],
  };
}

// A "position" UTxO can carry either a PositionDatum (active at
// manage_positions, or just-opened at orders) or an OrderDatum (pending request
// at orders). Discriminate by ctor field-shape: PositionDatum is Constr0 with
// 14 fields, OrderDatum is Constr0 with a single field (the OrderAction).
function decodePosition(datum: PD): DexOrderView {
  const c = asConstr(datum);
  if (c.tag === 0 && c.fields.length === 1) {
    return strikeOrderToView(parseStrikeOrderDatum(datum));
  }
  return strikePositionToView(parseStrikePositionDatum(datum));
}

function decode(datum: PD, role: string): DexOrderView {
  if (role === "forward-position") return decodeForwards(datum);
  if (role === "pool") return strikePoolToView(parseStrikePoolDatum(datum));
  return decodePosition(datum);
}

// Classify the position-close (manage_positions SPEND) and orders SPEND
// redeemers. The two share the "position" role; try the orders shape first since
// its bare ProcessOrders/CancelOrder ctors are unambiguous, then fall back to
// the manage_positions Close/AddCollateral/PositionUpdate redeemer.
function classifyPerpRedeemer(redeemer: PD): string | null {
  try {
    const m = parseStrikeManagePositionRedeemer(redeemer);
    switch (m.kind) {
      case "Close":
        return `Close (${m.closeType})`;
      case "AddCollateral":
        return "Add collateral";
      case "PositionUpdate":
        return "Position update";
    }
  } catch {
    // not a manage_positions redeemer — fall through.
  }
  try {
    const o = parseStrikeOrdersRedeemer(redeemer);
    switch (o.kind) {
      case "ProcessOrders":
        return "Process orders";
      case "CancelOrder":
        return "Cancel order";
      case "CloseOrderWhilePending":
        return "Close order while pending";
    }
  } catch {
    // not an orders redeemer either.
  }
  return null;
}

// --- Strike Forwards (separate contract set) -------------------------------

function forwardsRows(f: StrikeForwardsDatum): DexRow[] {
  return [
    { label: "Issuer", value: f.issuerAddressHash, hash: true },
    {
      label: "Issuer deposit amount",
      value: `${f.issuerDepositAssetAmount.toLocaleString()}${isAda(f.issuerDepositAsset) ? " ADA" : ""}`,
    },
    {
      label: "Obligee deposit amount",
      value: `${f.obligeeDepositAssetAmount.toLocaleString()}${isAda(f.obligeeDepositAsset) ? " ADA" : ""}`,
    },
    {
      label: "Collateral / party amount",
      value: `${f.eachPartyCollateralAssetAmount.toLocaleString()}${isAda(f.collateralAsset) ? " ADA" : ""}`,
    },
    ...(isAda(f.collateralAsset)
      ? []
      : [assetIdRow("Collateral asset", f.collateralAsset)]),
    {
      label: "STRIKE collateral / party",
      value: f.eachPartyStrikeCollateralAssetAmount.toLocaleString(),
    },
    { label: "Settlement date", value: `${f.exerciseContractDate.toLocaleString()} (POSIX ms)` },
    { label: "Position NFT policy", value: f.mintAssetPolicyId, hash: true },
  ];
}

function forwardsAssets(f: StrikeForwardsDatum): DexAssetRow[] {
  return [
    assetRow("Issuer deposit", f.issuerDepositAsset, f.issuerDepositAssetAmount),
    assetRow("Obligee deposit", f.obligeeDepositAsset, f.obligeeDepositAssetAmount),
  ];
}

function forwardsToView(f: StrikeForwardsDatum, kind: string, extra: DexRow[] = []): DexOrderView {
  return {
    protocol: "Strike Finance (Forwards)",
    role: "forward-position",
    kind,
    rows: [...extra, ...forwardsRows(f)],
    assets: forwardsAssets(f),
    issues: [],
  };
}

// A forward-position UTxO can carry a ForwardsDatum (Constr0, 10 fields), a
// CollateralDatum (Constr0, 4 fields: bool, bytes, bool, nested ForwardsDatum),
// or an AgreementDatum (Constr0, 2 fields: bytes, nested ForwardsDatum).
// Discriminate by field count.
function decodeForwards(datum: PD): DexOrderView {
  const c = asConstr(datum);
  if (c.tag === 0 && c.fields.length === 10) {
    return forwardsToView(parseStrikeForwardsDatum(datum), "Forward contract");
  }
  if (c.tag === 0 && c.fields.length === 4) {
    const col = parseStrikeCollateralDatum(datum);
    return forwardsToView(col.associatedForwardsDatum, "Forward collateral", [
      { label: "Issuer deposited", value: col.issuerHasDepositedAsset ? "yes" : "no" },
      { label: "Obligee", value: col.obligeeAddressHash, hash: true },
      { label: "Obligee deposited", value: col.obligeeHasDepositedAsset ? "yes" : "no" },
    ]);
  }
  if (c.tag === 0 && c.fields.length === 2) {
    const ag = parseStrikeAgreementDatum(datum);
    return forwardsToView(ag.associatedForwardsDatum, "Forward agreement", [
      { label: "UTxO owner", value: ag.utxoOwnerAddressHash, hash: true },
    ]);
  }
  throw new Error(`Strike forwards: unrecognized datum shape ctor ${c.tag}/${c.fields.length}`);
}

// Classify the forwards/collateral SPEND redeemers and the forwards MINT
// redeemer. The three share the "forward-position" role; the variant shapes do
// not overlap ambiguously, so try forwards-spend, then collateral-spend, then
// the mint redeemer.
function classifyForwardsRedeemer(redeemer: PD): string | null {
  try {
    const r = parseStrikeForwardsRedeemer(redeemer);
    switch (r.kind) {
      case "AcceptForwardsContract":
        return "Accept forwards contract";
      case "CancelForwardsContract":
        return "Cancel forwards contract";
    }
  } catch {
    // not a forwards spend redeemer.
  }
  try {
    const r = parseStrikeCollateralRedeemer(redeemer);
    switch (r.kind) {
      case "OneSideDepositAgreement":
        return `Deposit collateral (one side, ${r.party})`;
      case "BothSidesDepositAgreement":
        return `Deposit collateral (both sides, ${r.party})`;
      case "LiquidateCollateral":
        return `Liquidate collateral (${r.party})`;
      case "LiquidateBothParties":
        return "Liquidate both parties";
    }
  } catch {
    // not a collateral redeemer.
  }
  try {
    const r = parseStrikeForwardsMintRedeemer(redeemer);
    switch (r.kind) {
      case "CreateForwardMint":
        return "Create forward (mint)";
      case "EnterForwardMint":
        return "Enter forward (mint)";
      case "CancelForwardBurn":
        return "Cancel forward (burn)";
      case "LiquidateBurn":
        return "Liquidate forward (burn)";
      case "ConsumeAgreementBurn":
        return "Consume agreement (burn)";
    }
  } catch {
    // not a forwards mint redeemer either.
  }
  return null;
}

// --- Single combined Strike adapter ----------------------------------------
//
// One adapter handles BOTH the perpetuals validators ("position"/"pool" roles)
// and the forwards contract set ("forward-position" role). Each combinator
// tries the perpetuals match first, then the forwards match — the two hash/NFT
// sets are disjoint, so there is no ambiguity.

function matchScriptHash(hash: string, network?: CardanoNetwork): DexRole | null {
  return matchStrikeScriptHash(hash, network) ?? matchStrikeForwardsScriptHash(hash, network);
}

function matchNftPolicy(
  policyId: string,
  assetNames: string[],
  network?: CardanoNetwork,
): DexRole | null {
  return (
    matchStrikeNftPolicy(policyId, assetNames, network) ??
    matchStrikeForwardsNftPolicy(policyId, assetNames, network)
  );
}

function classifyRedeemer(redeemer: PD, role: DexRole): string | null {
  if (role === "forward-position") return classifyForwardsRedeemer(redeemer);
  return classifyPerpRedeemer(redeemer);
}

registerDexAdapter({
  id: "strike-finance",
  label: "Strike Finance",
  matchScriptHash,
  matchNftPolicy,
  decode,
  classifyRedeemer,
});

export * from "./datums";
export * from "./forwards";
export {
  STRIKE,
  STRIKE_FORWARDS,
  matchStrikeForwardsNftPolicy,
  matchStrikeForwardsScriptHash,
  matchStrikeNftPolicy,
  matchStrikeScriptHash,
} from "./constants";
