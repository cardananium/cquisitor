// Lenfi (Aada Finance V2) decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD } from "@/utils/protocols/dex/plutusData";
import { matchLenfiNftPolicy, matchLenfiScriptHash } from "./constants";
import {
  parseCollateralRedeemer,
  parsePoolConfig,
  parsePoolRedeemer,
  parseLenfiDatum,
  validateCollateralDatum,
  validatePoolDatum,
  type CollateralAction,
  type CollateralDatum,
  type PoolConfig,
  type PoolContinuingAction,
  type PoolDatum,
} from "./lenfi";

const PROTOCOL = "Lenfi (Aada V2)";

function assetRow(label: string, asset: AssetClass): DexRow {
  return {
    label,
    asset: { policyId: asset.policyId, assetName: asset.assetName },
  };
}

function poolToView(p: PoolDatum): DexOrderView {
  const issues: DexIssue[] = validatePoolDatum(p);
  const utilization =
    p.balance + p.lentOut > BigInt(0)
      ? `${p.lentOut.toLocaleString()} / ${(p.balance + p.lentOut).toLocaleString()}`
      : "0";
  const rows: DexRow[] = [
    { label: "Balance", value: p.balance.toLocaleString() },
    { label: "Lent out", value: p.lentOut.toLocaleString() },
    { label: "Total LP tokens", value: p.totalLpTokens.toLocaleString() },
    { label: "Utilization (lent / total)", value: utilization },
    assetRow("Loan asset", p.params.loanCs),
    assetRow("Collateral asset", p.params.collateralCs),
    assetRow("LP token", p.params.lpToken),
    { label: "Pool NFT name", value: p.params.poolNftName, hash: true },
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Loan asset",
      policyId: p.params.loanCs.policyId,
      assetName: p.params.loanCs.assetName,
    },
    {
      label: "Collateral asset",
      policyId: p.params.collateralCs.policyId,
      assetName: p.params.collateralCs.assetName,
    },
  ];
  return { protocol: PROTOCOL, role: "pool", kind: "Lending pool", rows, assets, issues };
}

function loanToView(c: CollateralDatum): DexOrderView {
  const issues: DexIssue[] = validateCollateralDatum(c);
  const rows: DexRow[] = [
    { label: "Loan amount (principal)", value: c.loanAmount.toLocaleString() },
    { label: "Collateral amount", value: c.collateralAmount.toLocaleString() },
    { label: "Interest rate", value: c.interestRate.toLocaleString() },
    { label: "Deposit time", value: `${c.depositTime.toLocaleString()} (POSIX ms)` },
    { label: "Borrower NFT name", value: c.borrowerTn, hash: true },
    { label: "Pool NFT name", value: c.poolNftName, hash: true },
    {
      label: "Liquidation threshold",
      value: c.poolConfig.liquidationThreshold.toLocaleString(),
    },
    c.tag
      ? {
          label: "Tag (delayed-merge oref)",
          value: `${c.tag.transactionId}#${c.tag.outputIndex}`,
          hash: true,
        }
      : { label: "Tag (delayed-merge oref)", value: "none" },
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Loan asset",
      policyId: c.loanCs.policyId,
      assetName: c.loanCs.assetName,
      amount: c.loanAmount,
    },
    {
      label: "Collateral asset",
      policyId: c.collateralCs.policyId,
      assetName: c.collateralCs.assetName,
      amount: c.collateralAmount,
    },
  ];
  return { protocol: PROTOCOL, role: "loan", kind: "Loan position", rows, assets, issues };
}

function configToView(cfg: PoolConfig): DexOrderView {
  const rows: DexRow[] = [
    { label: "Liquidation threshold", value: cfg.liquidationThreshold.toLocaleString() },
    { label: "Initial collateral ratio", value: cfg.initialCollateralRatio.toLocaleString() },
    { label: "Pool fee", value: cfg.poolFee.toLocaleString() },
    { label: "Min loan", value: cfg.minLoan.toLocaleString() },
    { label: "Min fee", value: cfg.minFee.toLocaleString() },
    { label: "Min liquidation fee", value: cfg.minLiquidationFee.toLocaleString() },
    { label: "Merge action fee", value: cfg.mergeActionFee.toLocaleString() },
    { label: "Liquidation fee", value: cfg.loanFeeDetails.liquidationFee.toLocaleString() },
    { label: "Optimal utilization", value: cfg.interestParams.optimalUtilization.toLocaleString() },
    { label: "Base interest rate", value: cfg.interestParams.baseInterestRate.toLocaleString() },
  ];
  return { protocol: PROTOCOL, role: "config", kind: "Pool config", rows, issues: [] };
}

// Benign view for matched roles whose datum we intentionally don't field-decode:
// `order` (request datums) and `feed` (oracle UTxOs that carry only an empty
// datum, with the price supplied via the spend redeemer). The raw datum tree is
// still surfaced by the detector, so this replaces a parseError with context.
function noteView(role: string, kind: string, note: string): DexOrderView {
  return { protocol: PROTOCOL, role, kind, rows: [{ label: "Note", value: note }], issues: [] };
}

export function lenfiToView(datum: PD, role: string): DexOrderView {
  if (role === "config") {
    try {
      return configToView(parsePoolConfig(datum));
    } catch {
      return noteView("config", "Pool config", "Lenfi PoolConfig UTxO; datum shown raw below.");
    }
  }
  if (role === "order") {
    return noteView("order", "Order request", "Lenfi order/request UTxO; request datum shown raw below.");
  }
  if (role === "feed") {
    return noteView("feed", "Oracle reference", "Lenfi oracle feed UTxO (price supplied via redeemer); datum shown raw below.");
  }
  try {
    const parsed = parseLenfiDatum(datum, role);
    return parsed.kind === "pool" ? poolToView(parsed.datum) : loanToView(parsed.datum);
  } catch {
    // A UTxO matched the pool/loan hash but carries a different/empty datum
    // (e.g. an oracle or auxiliary reference UTxO sharing the address). Show a
    // benign view with the raw datum rather than a hard parse error.
    return noteView(role, role === "pool" ? "Pool" : "Loan", `Lenfi ${role} UTxO with an unexpected datum shape; datum shown raw below.`);
  }
}

// --- Redeemer classification -----------------------------------------------

function continuingActionLabel(a: PoolContinuingAction): string {
  switch (a.kind) {
    case "LpAdjust":
      return "LP adjust";
    case "Borrow":
      return "Borrow";
    case "CloseLoan":
      return "Close loan";
    case "PayFee":
      return "Pay fee";
  }
}

function collateralActionLabel(a: CollateralAction): string {
  return a.kind === "Repay" ? "Repay" : "Liquidate";
}

export function classifyLenfiRedeemer(redeemer: PD, role: string): string | null {
  try {
    if (role === "pool") {
      const r = parsePoolRedeemer(redeemer);
      if (r === null) return "Bad script context";
      if (r.action.kind === "Destroy") return "Destroy pool";
      return continuingActionLabel(r.action.action);
    }
    if (role === "loan") {
      const r = parseCollateralRedeemer(redeemer);
      return collateralActionLabel(r.action);
    }
  } catch {
    return null;
  }
  return null;
}

registerDexAdapter({
  id: "lenfi-v2",
  label: "Lenfi (Aada V2)",
  matchScriptHash: matchLenfiScriptHash,
  matchNftPolicy: matchLenfiNftPolicy,
  decode: (datum: PD, role) => lenfiToView(datum, role),
  classifyRedeemer: (redeemer: PD, role) => classifyLenfiRedeemer(redeemer, role),
});

export * from "./lenfi";
export { LENFI_V2, matchLenfiScriptHash, matchLenfiNftPolicy } from "./constants";
