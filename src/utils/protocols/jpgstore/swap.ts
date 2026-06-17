// JPG Store OffersV2 `swap` datum/redeemer parsers.
//
// Single-constructor records => Constr 0; the `Action` enum indexes by
// declaration order: Cancel | Accept.
//
// This is a SEPARATE era from the v3 `ask` validator (different role "offer",
// protocol label "JPG Store OffersV2"). It is a single combined validator
// handling both directions; a BID/OFFER escrows lovelace in the UTxO value and
// identifies the requested asset / collection-floor policy via the
// CurrencySymbol keys inside each Payout's ExpectedValue.
//
//   Swap          = Constr 0 [ ByteArray owner(PubKeyHash), List<Payout> ]
//   Payout        = Constr 0 [ SwapAddress, ExpectedValue ]
//   SwapAddress   = Constr 0 [ Credential, Maybe<StakingCredential> ]
//                   (this matches the canonical parsePlutusAddress shape)
//   ExpectedValue = Map< CurrencySymbol(ByteArray policy), Constr 0 [ Int, Map<TokenName(ByteArray), Int> ] >
//                   (Natural / WholeNumber are bare Ints)
//   Action        = Cancel = Constr 0 [] | Accept = Constr 1 []

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  isMap,
  parsePlutusAddress,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

// Local Map helper — plutusData.ts has isMap but no `asMap`/`as` accessor.
function asMapEntries(d: PD): { k: PD; v: PD }[] {
  if (!isMap(d)) throw new Error("expected Map");
  return d.map;
}

/** A single requested token under one CurrencySymbol in an ExpectedValue. */
export interface JpgSwapExpectedToken {
  /** Token name (hex). Empty string = policy-only / collection-floor match. */
  assetName: string;
  /** Whole-number quantity requested (WholeNumber newtype => bare Int). */
  quantity: bigint;
}

/** One CurrencySymbol entry of an ExpectedValue map. */
export interface JpgSwapExpectedPolicy {
  /** Currency symbol (policy id, hex). */
  policyId: string;
  /** Natural count newtype (bare Int) accompanying the token map. */
  natCount: bigint;
  /** Requested tokens under this policy. */
  tokens: JpgSwapExpectedToken[];
}

/** What a counterparty must deliver to satisfy one Payout. */
export interface JpgSwapPayout {
  /** Where this payout's value must be sent (seller / royalty / marketplace). */
  address: PlutusAddress;
  /** Expected value (policy → { natCount, tokens }) the payout must satisfy. */
  expected: JpgSwapExpectedPolicy[];
}

export interface JpgSwapDatum {
  /**
   * Offerer / bidder payment key hash (28-byte hex). Checked in signatories on
   * Cancel. NOTE: this is field0 here, OPPOSITE to the v3 ask datum where owner
   * is the last field.
   */
  owner: string;
  /** Payouts to satisfy on Accept (seller / royalty / marketplace receivers). */
  payouts: JpgSwapPayout[];
}

// ExpectedValue value side — Constr 0 [ Int natCount, Map<TokenName, Int> ].
function parseExpectedPolicy(policyId: string, v: PD): JpgSwapExpectedPolicy {
  const c = asConstr(v);
  if (c.tag !== 0) {
    throw new Error(`JPG ExpectedValue tuple: unexpected ctor ${c.tag}`);
  }
  if (c.fields.length !== 2) {
    throw new Error(
      `JPG ExpectedValue tuple: expected 2 fields, got ${c.fields.length}`,
    );
  }
  const tokens = asMapEntries(c.fields[1]).map((e) => ({
    assetName: asBytes(e.k),
    quantity: asInt(e.v),
  }));
  return { policyId, natCount: asInt(c.fields[0]), tokens };
}

// ExpectedValue — Map< CurrencySymbol, Constr 0 [ Int, Map<TokenName, Int> ] >.
function parseExpectedValue(d: PD): JpgSwapExpectedPolicy[] {
  return asMapEntries(d).map((e) => parseExpectedPolicy(asBytes(e.k), e.v));
}

// Payout — Constr 0 [ SwapAddress, ExpectedValue ].
function parseJpgSwapPayout(d: PD): JpgSwapPayout {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`JPG swap Payout: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`JPG swap Payout: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    address: parsePlutusAddress(c.fields[0]),
    expected: parseExpectedValue(c.fields[1]),
  };
}

// Swap datum — Constr 0 [ ByteArray owner, List<Payout> ].
export function parseJpgSwapDatum(d: PD): JpgSwapDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`JPG swap Datum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`JPG swap Datum: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    owner: asBytes(c.fields[0]),
    payouts: asList(c.fields[1]).map(parseJpgSwapPayout),
  };
}

// Light validation → DexIssue[]. Does not throw.
export function validateJpgSwapDatum(datum: JpgSwapDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (datum.owner.length !== 56) {
    issues.push({
      severity: "warning",
      message: `Owner key hash is ${datum.owner.length / 2} bytes, expected 28`,
    });
  }
  if (datum.payouts.length === 0) {
    issues.push({ severity: "warning", message: "Offer has no payouts" });
  }
  return issues;
}

// --- Redeemer --------------------------------------------------------------

export type JpgSwapAction =
  | { kind: "Cancel" }
  | { kind: "Accept" };

// Action enum: Cancel = Constr 0 []; Accept = Constr 1 [].
export function parseJpgSwapRedeemer(d: PD): JpgSwapAction {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "Cancel" };
  if (c.tag === 1) return { kind: "Accept" };
  throw new Error(`JPG swap Redeemer: unexpected ctor ${c.tag}`);
}

// Classify the spend redeemer to a human action label, or null if not the
// expected swap redeemer shape.
export function classifyJpgSwapRedeemer(d: PD): "Cancel" | "Accept" | null {
  const c = asConstr(d);
  if (c.tag === 0 && c.fields.length === 0) return "Cancel";
  if (c.tag === 1 && c.fields.length === 0) return "Accept";
  return null;
}
