// JPG Store v3 (Wayup) `ask.spend` datum/redeemer parsers.
//
// Single-constructor records => Constr index 0; enums => Constr index = 0-based
// declaration order.
//
//   Datum  = Constr 0 [ List<Payout>, ByteArray(28) ]
//   Payout = Constr 0 [ Address, Int ]            (amount_lovelace)
//   Address = the canonical credential Address (parsePlutusAddress).
//   Redeemer:  Buy = Constr 0 [ Int offset ]   |   WithdrawOrUpdate = Constr 1 []

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  parsePlutusAddress,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

export interface JpgPayout {
  /** Standard credential Address of this payee (seller / royalty). */
  address: PlutusAddress;
  /** Lovelace owed to this payee. */
  amountLovelace: bigint;
}

export interface JpgAskDatum {
  /**
   * Seller + royalty payouts. Does NOT include the ~2% marketplace fee output
   * (that is a separate tx output, not in the datum).
   */
  payouts: JpgPayout[];
  /** Seller's payment key hash (28-byte hex); checked in extra_signatories. */
  owner: string;
}

// Payout — Constr 0 [ Address, Int ].
function parseJpgPayout(d: PD): JpgPayout {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`JPG Payout: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`JPG Payout: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    address: parsePlutusAddress(c.fields[0]),
    amountLovelace: asInt(c.fields[1]),
  };
}

// Datum — Constr 0 [ List<Payout>, ByteArray(28) ].
export function parseJpgAskDatum(d: PD): JpgAskDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`JPG ask Datum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`JPG ask Datum: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    payouts: asList(c.fields[0]).map(parseJpgPayout),
    owner: asBytes(c.fields[1]),
  };
}

// Sum of all payouts in the datum (seller + royalties), in lovelace.
export function jpgPayoutsSum(datum: JpgAskDatum): bigint {
  return datum.payouts.reduce((acc, p) => acc + p.amountLovelace, BigInt(0));
}

// Light validation → DexIssue[]. Does not throw; surfaces likely-bad listings.
export function validateJpgAskDatum(datum: JpgAskDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (datum.payouts.length === 0) {
    issues.push({ severity: "warning", message: "Listing has no payouts" });
  }
  if (datum.owner.length !== 56) {
    issues.push({
      severity: "warning",
      message: `Owner key hash is ${datum.owner.length / 2} bytes, expected 28`,
    });
  }
  for (const p of datum.payouts) {
    if (p.amountLovelace <= BigInt(0)) {
      issues.push({ severity: "warning", message: "Payout amount is not positive" });
    }
  }
  return issues;
}

// --- Redeemer --------------------------------------------------------------

export type JpgAskRedeemer =
  | { kind: "Buy"; payoutOutputsOffset: bigint }
  | { kind: "WithdrawOrUpdate" };

// Redeemer enum: Buy = Constr 0 [ Int ]; WithdrawOrUpdate = Constr 1 [].
export function parseJpgAskRedeemer(d: PD): JpgAskRedeemer {
  const c = asConstr(d);
  if (c.tag === 0) {
    if (c.fields.length !== 1) {
      throw new Error(`JPG Buy redeemer: expected 1 field, got ${c.fields.length}`);
    }
    return { kind: "Buy", payoutOutputsOffset: asInt(c.fields[0]) };
  }
  if (c.tag === 1) {
    return { kind: "WithdrawOrUpdate" };
  }
  throw new Error(`JPG ask Redeemer: unexpected ctor ${c.tag}`);
}

// Classify the spend redeemer to a human action label, or null if not the
// expected ask redeemer shape.
export function classifyJpgAskRedeemer(d: PD): "Buy" | "Withdraw or update" | null {
  const c = asConstr(d);
  if (c.tag === 0 && c.fields.length === 1) return "Buy";
  if (c.tag === 1 && c.fields.length === 0) return "Withdraw or update";
  return null;
}
