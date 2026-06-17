// FluidTokens Loans V3 (P2P lending) decoder: normalized views + adapter
// registration. Single implemented role: "loan" (with request/pool/active-loan
// datum sub-kinds, distinguished by the datum itself).

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD, PlutusAddress } from "@/utils/protocols/dex/plutusData";
import { matchFluidTokensNftPolicy, matchFluidTokensScriptHash } from "./constants";
import {
  parseFtDatum,
  parseLoanWithdrawRedeemer,
  parsePoolWithdrawRedeemer,
  parseRequestWithdrawRedeemer,
  type FtAuthorizationMethod,
  type FtCollateralAsset,
  type FtCommonData,
  type FtDatum,
  type FtLiquidationMode,
  type FtLoanDatum,
  type FtPoolDatum,
  type FtRepaymentMode,
  type FtRequestDatum,
} from "./loans";

const PROTOCOL = "FluidTokens Loans V3";

// Build a principal-asset DexRow: structured asset field. The panel renders the
// decoded asset name + full policy id (hover/copy); ada (("","")) shows "ADA".
function assetRow(label: string, asset: AssetClass): DexRow {
  return { label, asset: { policyId: asset.policyId, assetName: asset.assetName } };
}

// Address payment-credential row: descriptor (key/script) goes in the LABEL,
// the FULL credential hash is the value (hash:true).
function credentialRow(label: string, addr: PlutusAddress): DexRow {
  const c = addr.paymentCredential;
  const kind = c.kind === "Script" ? "script" : "key";
  return { label: `${label} (${kind})`, value: c.hash, hash: true };
}

// AuthorizationMethod row: the auth kind (CardanoSignature, CardanoSpendScript,
// etc.) goes in the LABEL, the FULL hash is the value (hash:true).
function authRow(label: string, auth: FtAuthorizationMethod): DexRow {
  return { label: `${label} (${auth.kind})`, value: auth.hash, hash: true };
}

function describeLiquidation(m: FtLiquidationMode): string {
  switch (m.kind) {
    case "NoLiquidationFullCollateralClaim":
      return "No liquidation (full collateral claim)";
    case "NoLiquidationDutchAuctionClaim":
      return "No liquidation (Dutch auction claim)";
    case "Liquidation":
      return `Liquidation (LTV ${m.lTV}/${m.lTVDivider}, penalty ${m.partialLiquidationPenaltyPerMille}‰)`;
  }
}

function describeRepayment(m: FtRepaymentMode): string {
  switch (m.kind) {
    case "InterestOnRemainingPrincipal":
      return `Interest on remaining principal (max recasts ${m.maxPossibleRecasts})`;
    case "PrincipalAndInterestOnInstallments":
      return "Principal + interest on installments";
    case "PerpetualLoan":
      return `Perpetual (coef ${m.apyIncreaseLinearCoefficient}, max recasts ${m.maxPossibleRecasts})`;
  }
}

function collateralAssets(label: string, c: FtCollateralAsset): DexAssetRow[] {
  return [
    {
      label,
      policyId: c.policyId,
      assetName: c.maybeAssetName ?? "",
    },
  ];
}

function commonRows(cd: FtCommonData): DexRow[] {
  return [
    assetRow("Principal asset", cd.principalAsset),
    { label: "Interest rate", value: `${cd.interestRate} / 10000` },
    { label: "Installment period (h)", value: cd.installmentPeriod.toLocaleString() },
    { label: "Total installments", value: cd.totalInstallments.toLocaleString() },
    { label: "Initial grace period (h)", value: cd.initialGracePeriod.toLocaleString() },
    { label: "Liquidation mode", value: describeLiquidation(cd.liquidationMode) },
    { label: "Repayment mode", value: describeRepayment(cd.repaymentMode) },
    { label: "Repayment window (h)", value: cd.repaymentTimeWindow.toLocaleString() },
    { label: "Late repayment penalty", value: cd.penaltyFeeForLateRepayment.toLocaleString() },
    { label: "Repayment receipts", value: cd.repaymentReceipts ? "yes" : "no" },
  ];
}

export function requestToView(datum: FtRequestDatum): DexOrderView {
  const issues: DexIssue[] = [];
  if (datum.requestExpiration <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Request has no expiration set" });
  }
  if (datum.maxPrincipal < datum.minPrincipal) {
    issues.push({ severity: "warning", message: "maxPrincipal is below minPrincipal" });
  }
  const permissionless = datum.permissionedConditionScriptHash === "4e4f4e45"; // "NONE"
  const rows: DexRow[] = [
    permissionless
      ? { label: "Permissioning", value: "permissionless" }
      : { label: "Permissioning (condition script)", value: datum.permissionedConditionScriptHash, hash: true },
    credentialRow("Borrower", datum.borrowerAddress),
    authRow("Borrower auth", datum.borrowerAuth),
    { label: "Min principal", value: `${datum.minPrincipal.toLocaleString()} / ${datum.minPrincipalDivider.toLocaleString()}` },
    { label: "Max principal", value: datum.maxPrincipal.toLocaleString() },
    { label: "Dynamic collateral price", value: datum.dynamicCollateralPrice ? "yes" : "no" },
    { label: "Request expiration", value: `${datum.requestExpiration.toLocaleString()} (POSIX ms)` },
    { label: "Expiration penalty", value: `${datum.requestExpirationPenalty.toLocaleString()} lovelace` },
    ...commonRows(datum.commonData),
  ];
  return {
    protocol: PROTOCOL,
    role: "loan",
    kind: "Loan request (borrower offer)",
    rows,
    assets: collateralAssets("Collateral", datum.collateral),
    issues,
  };
}

export function poolToView(datum: FtPoolDatum): DexOrderView {
  const issues: DexIssue[] = [];
  if (
    datum.collateralOptions.length !== datum.minCollateral.length ||
    datum.collateralOptions.length !== datum.minCollateralDivider.length
  ) {
    issues.push({
      severity: "warning",
      message: "collateralOptions / minCollateral / minCollateralDivider length mismatch",
    });
  }
  const permissionless = datum.permissionedConditionScriptHash === "4e4f4e45"; // "NONE"
  const rows: DexRow[] = [
    permissionless
      ? { label: "Permissioning", value: "permissionless" }
      : { label: "Permissioning (condition script)", value: datum.permissionedConditionScriptHash, hash: true },
    credentialRow("Lender bond address", datum.lenderBondAddress),
    authRow("Lender auth", datum.lenderAuth),
    { label: "Lender bond datum hash", value: datum.lenderBondInlineDatumHash, hash: true },
    { label: "Collateral options", value: datum.collateralOptions.length.toLocaleString() },
    { label: "Dynamic collateral price", value: datum.dynamicCollateralPrice ? "yes" : "no" },
    ...commonRows(datum.commonData),
  ];
  const assets: DexAssetRow[] = datum.collateralOptions.flatMap((c, i) =>
    collateralAssets(`Collateral option #${i + 1}`, c),
  );
  return {
    protocol: PROTOCOL,
    role: "loan",
    kind: "Lending pool",
    rows,
    assets,
    issues,
  };
}

export function loanToView(datum: FtLoanDatum): DexOrderView {
  const rows: DexRow[] = [
    { label: "Principal amount", value: datum.principalAmount.toLocaleString() },
    assetRow("Principal asset", datum.principalAsset),
    { label: "Lend date", value: `${datum.lendDate.toLocaleString()} (POSIX ms)` },
    { label: "Interest rate", value: `${datum.interestRate} / 10000` },
    { label: "Installments repaid", value: `${datum.repaidInstallments.toLocaleString()} / ${datum.totalInstallments.toLocaleString()}` },
    { label: "Done recasts", value: datum.doneRecasts.toLocaleString() },
    { label: "Installment period (h)", value: datum.installmentPeriod.toLocaleString() },
    { label: "Initial grace period (h)", value: datum.initialGracePeriod.toLocaleString() },
    { label: "Liquidation mode", value: describeLiquidation(datum.liquidationMode) },
    { label: "Repayment mode", value: describeRepayment(datum.repaymentMode) },
    { label: "Repayment window (h)", value: datum.repaymentTimeWindow.toLocaleString() },
    { label: "Late repayment penalty", value: datum.penaltyFeeForLateRepayment.toLocaleString() },
    { label: "Repayment receipts", value: datum.repaymentReceipts ? "yes" : "no" },
    { label: "Origin id", value: datum.originId, hash: true },
  ];
  return {
    protocol: PROTOCOL,
    role: "loan",
    kind: "Active loan position",
    rows,
    assets: collateralAssets("Collateral", datum.collateral),
    issues: [],
  };
}

export function ftDatumToView(datum: FtDatum): DexOrderView {
  switch (datum.kind) {
    case "request":
      return requestToView(datum);
    case "pool":
      return poolToView(datum);
    case "loan":
      return loanToView(datum);
  }
}

// Classify the REAL action from a withdrawal redeemer. The role string carries
// which withdraw script matched: "loan" (default) reads the loan dispatcher;
// callers can pass "loan:request" / "loan:pool" / "loan:loan" to pick the side.
// NOTE: the spend redeemer of the consumed UTxO is dummy `Data` and is NOT the
// action — do not pass it here.
export function classifyFtWithdrawRedeemer(redeemer: PD, role: string): string | null {
  try {
    if (role === "loan:request") {
      const r = parseRequestWithdrawRedeemer(redeemer);
      const kinds = Array.from(new Set(r.actionsForEachInput.map((a) => a.kind)));
      return kinds.length ? kinds.join(", ") : "Request action";
    }
    if (role === "loan:pool") {
      return parsePoolWithdrawRedeemer(redeemer).actionType;
    }
    // default / "loan" / "loan:loan": loan-side dispatcher.
    return parseLoanWithdrawRedeemer(redeemer).actionType;
  } catch {
    return null;
  }
}

registerDexAdapter({
  id: "fluidtokens-loans-v3",
  label: "FluidTokens Loans V3",
  matchScriptHash: matchFluidTokensScriptHash,
  matchNftPolicy: matchFluidTokensNftPolicy,
  // A FluidTokens UTxO is typed by its datum field-count (request=12, pool=10,
  // loan=17) — the matched NFT policy tells which it is, but parseFtDatum is
  // self-discriminating, so we decode straight from the datum.
  decode: (datum: PD) => ftDatumToView(parseFtDatum(datum)),
  // The consumed-UTxO spend redeemer is dummy Data; the real action lives in the
  // tx withdrawal redeemers (see classifyFtWithdrawRedeemer), which the generic
  // spend-redeemer classifier cannot reach. So no classifyRedeemer here.
});

export * from "./loans";
export {
  FLUIDTOKENS,
  fluidTokensSubRoleForPolicy,
  matchFluidTokensNftPolicy,
  matchFluidTokensScriptHash,
} from "./constants";
