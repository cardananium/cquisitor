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

// Address rows: descriptor (key/script) goes in the LABEL, the FULL credential
// hash is the value (hash:true). The optional stake credential (often present
// on these addresses) is surfaced as its own row so it is never dropped.
function addressRows(label: string, addr: PlutusAddress): DexRow[] {
  const c = addr.paymentCredential;
  const kind = c.kind === "Script" ? "script" : "key";
  const rows: DexRow[] = [{ label: `${label} (${kind})`, value: c.hash, hash: true }];
  const stake = addr.stakeCredential;
  if (stake) {
    if (stake.kind === "Inline") {
      const sk = stake.credential.kind === "Script" ? "script" : "key";
      rows.push({ label: `${label} stake (${sk})`, value: stake.credential.hash, hash: true });
    } else {
      rows.push({
        label: `${label} stake (pointer)`,
        value: `slot ${stake.slotNumber}, txIdx ${stake.transactionIndex}, certIdx ${stake.certificateIndex}`,
      });
    }
  }
  return rows;
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
    case "Liquidation": {
      // equityInPrincipalCurrency: true -> equity computed in principal currency,
      // false -> in collateral currency (per the on-chain LiquidationMode comment).
      const equity = m.equityInPrincipalCurrency ? "principal" : "collateral";
      return `Liquidation (LTV ${m.lTV}/${m.lTVDivider}, penalty ${m.partialLiquidationPenaltyPerMille}‰, equity in ${equity} currency)`;
    }
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

// The oracle "dummy" sentinel (= no oracle) is ascii "NONE"/"NONE".
const ORACLE_NONE = "4e4f4e45"; // ascii "NONE"

function isDummyOracle(a: AssetClass): boolean {
  return a.policyId === ORACLE_NONE && a.assetName === ORACLE_NONE;
}

function collateralAssets(label: string, c: FtCollateralAsset): DexAssetRow[] {
  const rows: DexAssetRow[] = [
    {
      label,
      policyId: c.policyId,
      assetName: c.maybeAssetName ?? "",
    },
  ];
  // CollateralAsset.oracleTokenAsset: the oracle NFT used to price this
  // collateral (dummy ("NONE","NONE") when no oracle is used). Surface the real
  // oracle token; skip the dummy sentinel.
  if (!isDummyOracle(c.oracleTokenAsset)) {
    rows.push({
      label: `${label} oracle token`,
      policyId: c.oracleTokenAsset.policyId,
      assetName: c.oracleTokenAsset.assetName,
    });
  }
  return rows;
}

// A real (non-dummy, non-empty) oracle AssetClass carries pricing data worth
// surfacing; ("","") (ADA / no oracle) and the "NONE"/"NONE" dummy do not.
function isRealOracle(a: AssetClass): boolean {
  if (isDummyOracle(a)) return false;
  return a.policyId !== "" || a.assetName !== "";
}

// extraData is an opaque `Data` extension field (used by permissioned pools and
// parsed per use-case). It is empty (Constr0[]) on standard orders; surface a
// neutral presence row only when it actually carries content, so the meaning is
// never silently dropped without inventing a name for arbitrary data.
function extraDataRows(d: PD): DexRow[] {
  const empty =
    typeof d === "object" &&
    d !== null &&
    "constructor" in d &&
    "fields" in d &&
    (d as { fields: PD[] }).fields.length === 0;
  if (empty) return [];
  return [{ label: "Extra data (opaque)", value: "present", mono: true }];
}

function commonRows(cd: FtCommonData): DexRow[] {
  return [
    assetRow("Principal asset", cd.principalAsset),
    // principalOracleAsset: oracle NFT for the principal (used by dynamic-priced
    // pools and partial liquidations). Surfaced only when a real oracle is set.
    ...(isRealOracle(cd.principalOracleAsset)
      ? [assetRow("Principal oracle token", cd.principalOracleAsset)]
      : []),
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
    ...addressRows("Borrower", datum.borrowerAddress),
    authRow("Borrower auth", datum.borrowerAuth),
    { label: "Min principal", value: `${datum.minPrincipal.toLocaleString()} / ${datum.minPrincipalDivider.toLocaleString()}` },
    { label: "Max principal", value: datum.maxPrincipal.toLocaleString() },
    { label: "Dynamic collateral price", value: datum.dynamicCollateralPrice ? "yes" : "no" },
    { label: "Request expiration", value: `${datum.requestExpiration.toLocaleString()} (POSIX ms)` },
    { label: "Expiration penalty", value: `${datum.requestExpirationPenalty.toLocaleString()} lovelace` },
    ...extraDataRows(datum.extraData),
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
  // Per-option borrow ratio: minCollateral[i] / minCollateralDivider[i] is the
  // LTV (oracle pools) or collateral-per-principal unit (no-oracle pools) for
  // collateral option #(i+1). Surface each one so these lists are not collapsed
  // to a bare count.
  const ratioRows: DexRow[] = datum.collateralOptions.map((_, i) => {
    const num = datum.minCollateral[i];
    const div = datum.minCollateralDivider[i];
    const ratio =
      num !== undefined && div !== undefined
        ? `${num.toLocaleString()} / ${div.toLocaleString()}`
        : "—";
    return { label: `Min collateral ratio #${i + 1}`, value: ratio };
  });
  const rows: DexRow[] = [
    permissionless
      ? { label: "Permissioning", value: "permissionless" }
      : { label: "Permissioning (condition script)", value: datum.permissionedConditionScriptHash, hash: true },
    ...addressRows("Lender bond address", datum.lenderBondAddress),
    authRow("Lender auth", datum.lenderAuth),
    { label: "Lender bond datum hash", value: datum.lenderBondInlineDatumHash, hash: true },
    { label: "Collateral options", value: datum.collateralOptions.length.toLocaleString() },
    ...ratioRows,
    { label: "Dynamic collateral price", value: datum.dynamicCollateralPrice ? "yes" : "no" },
    ...extraDataRows(datum.extraData),
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
    // principalOracleAsset (loan field 7): oracle NFT for the principal.
    ...(isRealOracle(datum.principalOracleAsset)
      ? [assetRow("Principal oracle token", datum.principalOracleAsset)]
      : []),
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
