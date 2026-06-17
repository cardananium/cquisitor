// SaturnSwap order/escrow datum + redeemer parsers (saturn_swap validator).
//
// The order datum is a single-constructor Constr 0 with exactly 9 fields. The
// spend redeemer has two variants: Fill (Constr 0 [fillAmount, inputIndex,
// extraIndex]) and Cancel (Constr 1 []).
//
// Encoding notes:
//  - owner is the standard CIP-19 Cardano Address (payment Constr0=key/1=script,
//    stake Constr0[Inline] / Constr1[None]); reuse parsePlutusAddress.
//  - ADA legs are encoded as empty policy + empty name (#""/#""), NOT missing.
//  - expiry is Option<Int posixMs>: Constr1[] = None, Constr0[Int] = Some.
//  - nonce is (OutputReference, Int): Constr0[ Constr0[Constr0[bytes txid]], idx ].

import {
  asBytes,
  asConstr,
  asInt,
  asOptional,
  parsePlutusAddress,
  type AssetClass,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

/** The OutputReference that produced this order (nonce field[8]). */
export interface SaturnOutputReference {
  txId: string;
  outputIndex: bigint;
}

export interface SaturnOrder {
  /** Success-receiver address; the fill output must pay to this address. */
  owner: PlutusAddress;
  /** Asset locked & being sold. ADA = ("", ""). */
  offered: AssetClass;
  /** Total offered amount remaining in this order. */
  offeredAmount: bigint;
  /** Asset the maker wants to receive (the price asset). ADA = ("", ""). */
  asked: AssetClass;
  /** Total asked amount (defines the offered:asked ratio / price). */
  askedAmount: bigint;
  /** Some(deadline POSIX ms) or null (no expiry). */
  expiry: bigint | null;
  /** Uniqueness tie-breaker: the producing OutputReference. */
  nonce: SaturnOutputReference;
  /** Trailing Int paired with the OutputReference in field[8] (output index). */
  nonceIndex: bigint;
}

function parseOutputReference(d: PD): SaturnOutputReference {
  // Constr0[ Constr0[ bytes txid ], Int idx ]
  // (the TransactionId is a one-field Constr wrapping the txid bytes; NOT doubly nested).
  const c = asConstr(d);
  const inner = asConstr(c.fields[0]); // Constr0[ bytes txid ]
  return {
    txId: asBytes(inner.fields[0]),
    outputIndex: asInt(c.fields[1]),
  };
}

export function parseSaturnOrder(data: PD): SaturnOrder {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`SaturnSwap order: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 9) {
    throw new Error(`SaturnSwap order: expected 9 fields, got ${f.length}`);
  }
  const ref = parseOutputReference(f[8]);
  return {
    owner: parsePlutusAddress(f[0]),
    offered: { policyId: asBytes(f[1]), assetName: asBytes(f[2]) },
    offeredAmount: asInt(f[3]),
    asked: { policyId: asBytes(f[4]), assetName: asBytes(f[5]) },
    askedAmount: asInt(f[6]),
    expiry: asOptional(f[7], asInt),
    nonce: ref,
    nonceIndex: ref.outputIndex,
  };
}

/** Light, non-throwing validation over a parsed order. */
export function validateSaturnOrder(order: SaturnOrder): DexIssue[] {
  const issues: DexIssue[] = [];
  const pay = order.owner.paymentCredential.hash;
  if (pay.length !== 56) {
    issues.push({
      severity: "error",
      message: `owner payment hash must be 28 bytes, got ${pay.length / 2}`,
    });
  }
  if (order.owner.stakeCredential?.kind === "Inline") {
    const sh = order.owner.stakeCredential.credential.hash;
    if (sh.length !== 56) {
      issues.push({
        severity: "error",
        message: `owner stake hash must be 28 bytes, got ${sh.length / 2}`,
      });
    }
  }
  if (order.offeredAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "offeredAmount is not positive" });
  }
  if (order.askedAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "askedAmount is not positive" });
  }
  const offeredIsAda = order.offered.policyId === "" && order.offered.assetName === "";
  const askedIsAda = order.asked.policyId === "" && order.asked.assetName === "";
  if (offeredIsAda && askedIsAda) {
    issues.push({ severity: "warning", message: "both legs are ADA" });
  }
  return issues;
}

export type SaturnRedeemerKind = "Fill" | "Cancel";

export interface SaturnFillRedeemer {
  kind: "Fill";
  /** Amount of the ASKED asset the taker pays toward this order. */
  fillAmount: bigint;
  /** Index into the resolved-input list used to locate the order's own input. */
  inputIndex: bigint;
  /** Additional output/input index used during partial-fill output validation. */
  extraIndex: bigint;
}

export interface SaturnCancelRedeemer {
  kind: "Cancel";
}

export type SaturnRedeemer = SaturnFillRedeemer | SaturnCancelRedeemer;

// Fill = Constr 0 [fillAmount, inputIndex, extraIndex] (3 Ints; the validator
// only destructures the first two, but the CBOR carries 3). Cancel =
// Constr 1 [] (0 fields, owner-authorized reclaim).
export function parseSaturnRedeemer(data: PD): SaturnRedeemer | null {
  const c = asConstr(data);
  if (c.tag === 0) {
    if (c.fields.length < 1) return null;
    return {
      kind: "Fill",
      fillAmount: asInt(c.fields[0]),
      inputIndex: c.fields.length > 1 ? asInt(c.fields[1]) : BigInt(0),
      extraIndex: c.fields.length > 2 ? asInt(c.fields[2]) : BigInt(0),
    };
  }
  if (c.tag === 1 && c.fields.length === 0) {
    return { kind: "Cancel" };
  }
  return null;
}

export function classifySaturnRedeemer(data: PD): SaturnRedeemerKind | null {
  const r = parseSaturnRedeemer(data);
  return r ? r.kind : null;
}
