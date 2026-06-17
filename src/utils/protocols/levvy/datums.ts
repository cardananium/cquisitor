// Levvy Finance datum + redeemer parsers.
//
// DATUM is a 3-constructor enum; each constructor wraps EXACTLY ONE field which
// is itself a `Constr 0` record (the payload).
//   Constr 0 → OFFER          (inner Constr0 with 5 fields)
//   Constr 1 → ACTIVE LOAN    (inner Constr0 with 8 fields)
//   Constr 2 → SETTLEMENT      (inner Constr0 with 4 fields)
//
// Address uses the standard Cardano shape; policyId/assetName
// are raw bytes; amounts are lovelace ints; times are POSIX MILLISECONDS.
//
// REDEEMER is an enum of 5 NULLARY constructors (no fields):
//   0 Lend/TakeOffer · 1 Repay · 2 Claim · 3 Foreclose · 4 Cancel offer.

import {
  asConstr,
  asInt,
  asBytes,
  parsePlutusAddress,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";

export type LevvyRoleKind = "offer" | "loan";

// A consumed-UTxO reference: Constr0[ Constr0[txIdBytes32], outputIndexInt ].
export interface LevvyOutRef {
  txId: string;
  outputIndex: bigint;
}

function parseOutRef(d: PD): LevvyOutRef {
  const c = asConstr(d);
  if (c.fields.length !== 2) {
    throw new Error(`Levvy OutRef: expected 2 fields, got ${c.fields.length}`);
  }
  const inner = asConstr(c.fields[0]);
  if (inner.fields.length !== 1) {
    throw new Error(`Levvy OutRef txId: expected 1 field, got ${inner.fields.length}`);
  }
  return { txId: asBytes(inner.fields[0]), outputIndex: asInt(c.fields[1]) };
}

// --- Constr 0: OFFER (5-field inner record) --------------------------------

export interface LevvyOffer {
  variant: "offer";
  /** Lender = loan recipient on default/repay. */
  lenderAddress: PlutusAddress;
  /** 28-byte minting policy of the collateral collection / token. */
  collateralPolicyId: string;
  /** Lovelace the lender will lend. */
  principal: bigint;
  /** Lovelace interest the borrower repays on top. */
  interest: bigint;
  /** Loan term length in milliseconds. */
  loanDurationMs: bigint;
}

function parseOffer(fields: PD[]): LevvyOffer {
  if (fields.length !== 5) {
    throw new Error(`Levvy Offer: expected 5 inner fields, got ${fields.length}`);
  }
  return {
    variant: "offer",
    lenderAddress: parsePlutusAddress(fields[0]),
    collateralPolicyId: asBytes(fields[1]),
    principal: asInt(fields[2]),
    interest: asInt(fields[3]),
    loanDurationMs: asInt(fields[4]),
  };
}

// --- Constr 1: ACTIVE LOAN (8-field inner record) --------------------------

export interface LevvyLoan {
  variant: "loan";
  lenderAddress: PlutusAddress;
  borrowerAddress: PlutusAddress;
  collateralPolicyId: string;
  /** The specific asset name now pinned (NFT name, or token name for fungibles). */
  collateralAssetName: string;
  principal: bigint;
  interest: bigint;
  /** Foreclosure deadline, POSIX ms = takeOffer txValidFrom + offer.loanDurationMs. */
  deadline: bigint;
  /** The offer UTxO consumed to create this loan; used as a unique loan id. */
  outRef: LevvyOutRef;
}

function parseLoan(fields: PD[]): LevvyLoan {
  if (fields.length !== 8) {
    throw new Error(`Levvy Loan: expected 8 inner fields, got ${fields.length}`);
  }
  return {
    variant: "loan",
    lenderAddress: parsePlutusAddress(fields[0]),
    borrowerAddress: parsePlutusAddress(fields[1]),
    collateralPolicyId: asBytes(fields[2]),
    collateralAssetName: asBytes(fields[3]),
    principal: asInt(fields[4]),
    interest: asInt(fields[5]),
    deadline: asInt(fields[6]),
    outRef: parseOutRef(fields[7]),
  };
}

// --- Constr 2: SETTLEMENT / CLAIM (4-field inner record) -------------------

export interface LevvySettlement {
  variant: "settlement";
  /** Claimant (the original lender, or borrower on repay). */
  lenderAddress: PlutusAddress;
  payoutPrincipal: bigint;
  payoutInterest: bigint;
  /** Links back to the loan being settled. */
  outRef: LevvyOutRef;
}

function parseSettlement(fields: PD[]): LevvySettlement {
  if (fields.length !== 4) {
    throw new Error(`Levvy Settlement: expected 4 inner fields, got ${fields.length}`);
  }
  return {
    variant: "settlement",
    lenderAddress: parsePlutusAddress(fields[0]),
    payoutPrincipal: asInt(fields[1]),
    payoutInterest: asInt(fields[2]),
    outRef: parseOutRef(fields[3]),
  };
}

export type LevvyDatum = LevvyOffer | LevvyLoan | LevvySettlement;

// Top constructor selects the role; each wraps a single inner `Constr 0` record.
export function parseLevvyDatum(data: PD): LevvyDatum {
  const top = asConstr(data);
  if (top.fields.length !== 1) {
    throw new Error(
      `Levvy datum: expected 1 wrapper field, got ${top.fields.length} (ctor ${top.tag})`,
    );
  }
  const inner = asConstr(top.fields[0]);
  if (inner.tag !== 0) {
    throw new Error(`Levvy datum: inner payload expected Constr 0, got ${inner.tag}`);
  }
  switch (top.tag) {
    case 0:
      return parseOffer(inner.fields);
    case 1:
      return parseLoan(inner.fields);
    case 2:
      return parseSettlement(inner.fields);
    default:
      throw new Error(`Levvy datum: unexpected top ctor ${top.tag}`);
  }
}

// --- Redeemer --------------------------------------------------------------

// 5 nullary constructors. Labels for 2/3/4 are inferred from branch behaviour
// (indices are exact); see the spec's open questions.
export type LevvyAction = "Lend" | "Repay" | "Claim" | "Foreclose" | "Cancel";

const LEVVY_ACTIONS: readonly LevvyAction[] = [
  "Lend", // 0 — take an offer, create an active loan
  "Repay", // 1 — borrower repays principal + interest
  "Claim", // 2 — collect a settlement UTxO
  "Foreclose", // 3 — term expired, lender seizes collateral
  "Cancel", // 4 — lender reclaims an unmatched offer
];

export function classifyLevvyRedeemer(data: PD): LevvyAction | null {
  const c = asConstr(data);
  // All 5 actions are nullary; a field-bearing constructor is not a Levvy action.
  if (c.fields.length !== 0) return null;
  return LEVVY_ACTIONS[c.tag] ?? null;
}
