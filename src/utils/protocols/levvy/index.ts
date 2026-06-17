// Levvy Finance decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { PD, PlutusAddress } from "@/utils/protocols/dex/plutusData";
import { matchLevvyScriptHash } from "./constants";
import {
  classifyLevvyRedeemer,
  parseLevvyDatum,
  type LevvyDatum,
  type LevvyLoan,
  type LevvyOffer,
  type LevvyOutRef,
  type LevvySettlement,
} from "./datums";

// Build a full-value DexRow for an address' payment credential. The shared hash
// component truncates + copies the full hash; script-ness goes into the label.
function addressRow(label: string, addr: PlutusAddress): DexRow {
  const pay = addr.paymentCredential;
  const isScript = pay.kind === "Script";
  return {
    label: isScript ? `${label} (script)` : label,
    value: pay.hash,
    hash: true,
  };
}

// Build a full-value DexRow for a consumed-UTxO reference: txId#index. The hash
// component truncates + copies the full composite string.
function outRefRow(label: string, ref: LevvyOutRef): DexRow {
  return {
    label,
    value: `${ref.txId}#${ref.outputIndex.toString()}`,
    hash: true,
  };
}

// lovelace → ADA, kept lossless-ish for display only.
function formatAda(lovelace: bigint): string {
  return `${lovelace.toLocaleString()} lovelace`;
}

function formatMsDuration(ms: bigint): string {
  const days = Number(ms) / 86_400_000;
  return `${ms.toLocaleString()} ms (~${days.toFixed(2)} days)`;
}

function offerToView(o: LevvyOffer): DexOrderView {
  const issues: DexIssue[] = [];
  if (o.principal <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Offer principal is not positive." });
  }
  if (o.collateralPolicyId.length !== 56) {
    issues.push({
      severity: "info",
      message: `Collateral policyId is ${o.collateralPolicyId.length / 2} bytes (expected 28).`,
    });
  }
  const rows: DexRow[] = [
    addressRow("Lender", o.lenderAddress),
    { label: "Principal", value: formatAda(o.principal) },
    { label: "Interest", value: formatAda(o.interest) },
    { label: "Loan duration", value: formatMsDuration(o.loanDurationMs) },
  ];
  const assets: DexAssetRow[] = [
    { label: "Collateral collection", policyId: o.collateralPolicyId, assetName: "" },
  ];
  return { protocol: "Levvy", role: "offer", kind: "Lend offer", rows, assets, issues };
}

function loanToView(l: LevvyLoan): DexOrderView {
  const issues: DexIssue[] = [];
  if (l.collateralPolicyId.length !== 56) {
    issues.push({
      severity: "info",
      message: `Collateral policyId is ${l.collateralPolicyId.length / 2} bytes (expected 28).`,
    });
  }
  const rows: DexRow[] = [
    addressRow("Lender", l.lenderAddress),
    addressRow("Borrower", l.borrowerAddress),
    { label: "Principal", value: formatAda(l.principal) },
    { label: "Interest", value: formatAda(l.interest) },
    { label: "Repayment due", value: `${l.deadline.toLocaleString()} (POSIX ms)` },
    outRefRow("Offer ref", l.outRef),
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Collateral",
      policyId: l.collateralPolicyId,
      assetName: l.collateralAssetName,
    },
  ];
  return { protocol: "Levvy", role: "loan", kind: "Active loan", rows, assets, issues };
}

function settlementToView(s: LevvySettlement): DexOrderView {
  const rows: DexRow[] = [
    addressRow("Claimant", s.lenderAddress),
    { label: "Payout principal", value: formatAda(s.payoutPrincipal) },
    { label: "Payout interest", value: formatAda(s.payoutInterest) },
    outRefRow("Loan ref", s.outRef),
  ];
  return {
    protocol: "Levvy",
    role: "loan",
    kind: "Settlement / claim",
    rows,
    assets: [],
    issues: [],
  };
}

function toView(datum: LevvyDatum): DexOrderView {
  switch (datum.variant) {
    case "offer":
      return offerToView(datum);
    case "loan":
      return loanToView(datum);
    case "settlement":
      return settlementToView(datum);
  }
}

registerDexAdapter({
  id: "levvy",
  label: "Levvy",
  matchScriptHash: matchLevvyScriptHash,
  // The validator serves all roles; the concrete role/kind comes from the
  // datum's top constructor, so we ignore the coarse `role` arg here.
  decode: (datum: PD) => toView(parseLevvyDatum(datum)),
  classifyRedeemer: (redeemer: PD) => classifyLevvyRedeemer(redeemer),
});

export * from "./datums";
export { LEVVY, matchLevvyScriptHash } from "./constants";
