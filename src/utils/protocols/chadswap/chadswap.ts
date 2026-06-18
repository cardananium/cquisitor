// ChadSwap OTC order (escrow) datum + redeemer parsers. PlutusV3.
//
// ChadSwap publishes no CIP-57 blueprint, so validator-enforced fields get
// behaviour-derived names and the rest get neutral labels — NO invented names.
//
// === ORDER datum (escrow validator 2f201c28…) ===
//   Constr 0 [
//     [0] params : Constr 0 [
//        [0] maker        : Address  (Constr0[ Credential, Option<Inline<Cred>> ])
//        [1] sellToken    : Bool     (Constr0=False=SELL token→ADA / Constr1=True=BUY token with ADA)
//        [2] tokenPolicy  : Bytes    (the non-ADA side of the pair; ada-leg is implicit)
//        [3] tokenName    : Bytes
//        [4] price        : Int      (lovelace per 1 token base-unit; total*price = lovelace leg)
//        [5] flag         : Constr 0 [ Int ]   (observed Constr0[1]; a version/scale marker)
//        [6] optA         : Maybe    (observed None)
//        [7] deadline     : Maybe<Int>  (POSIX ms; validator compares to tx valid range. None = no expiry)
//     ]
//     [1] amounts : Constr 0 [ Int total, Int filled ]   (token quantity total + amount already filled)
//     [2] optB    : Maybe    (observed None)
//     [3] optC    : Maybe    (observed None)
//   ]
//
// The validator reads params.fields[4] (price), amounts.fields[0..1]
// (total/filled) and params.fields[7] (deadline vs tx.valid_range) directly,
// confirming those positions. The OFFERED asset is the order UTxO's own value
// (the token for a SELL, ADA for a BUY) — not a datum field; the datum names
// only the token + price, and `sellToken` fixes the direction.

import {
  asBytes,
  asConstr,
  asInt,
  asOptional,
  isConstr,
  parsePlutusAddress,
  type AssetClass,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

/** ADA leg sentinel, ("", ""). */
export const ADA: AssetClass = { policyId: "", assetName: "" };

export interface ChadswapOrder {
  /** The maker; a fill output must pay it, and cancel/update need its signature. */
  maker: PlutusAddress;
  /**
   * Trade direction.
   *  - `true`  (datum Bool=False / Constr0): maker SELLS the token for ADA
   *    → offered = token, asked = ADA.
   *  - `false` (datum Bool=True  / Constr1): maker BUYS the token with ADA
   *    → offered = ADA, asked = token.
   */
  sellToken: boolean;
  /** The non-ADA side of the pair (policy + name). The other leg is always ADA. */
  token: AssetClass;
  /** Per-unit price: lovelace per 1 token base-unit (total * price = lovelace leg). */
  price: bigint;
  /** Total token quantity of the order (the token leg amount). */
  total: bigint;
  /** Token quantity already filled (partial fills). */
  filled: bigint;
  /** Optional expiry deadline (POSIX ms) the validator checks; null = none. */
  deadline: bigint | null;
  /** params.fields[5] inner Int (observed 1; a version/scale marker). Surfaced verbatim. */
  flag: bigint;
}

// Bool here is the standard PlutusData encoding: Constr0 = False, Constr1 = True.
// In ChadSwap, datum Bool=False (Constr0) marks a SELL-token order and Bool=True
// (Constr1) a BUY-token order, so `sellToken` is the logical negation.
function parseSellToken(d: PD): boolean {
  const c = asConstr(d);
  if (c.tag === 0) return true; // False → SELL token
  if (c.tag === 1) return false; // True → BUY token
  throw new Error(`ChadSwap direction: unexpected ctor ${c.tag}`);
}

export function parseChadswapOrder(data: PD): ChadswapOrder {
  const outer = asConstr(data);
  if (outer.tag !== 0) throw new Error(`ChadSwap order: unexpected ctor ${outer.tag}`);
  if (outer.fields.length !== 4) {
    throw new Error(`ChadSwap order: expected 4 outer fields, got ${outer.fields.length}`);
  }
  const params = asConstr(outer.fields[0]);
  if (params.tag !== 0) throw new Error(`ChadSwap params: unexpected ctor ${params.tag}`);
  if (params.fields.length !== 8) {
    throw new Error(`ChadSwap params: expected 8 fields, got ${params.fields.length}`);
  }
  const amounts = asConstr(outer.fields[1]);
  if (amounts.fields.length !== 2) {
    throw new Error(`ChadSwap amounts: expected [total, filled], got ${amounts.fields.length}`);
  }
  const flagInner = asConstr(params.fields[5]);

  return {
    maker: parsePlutusAddress(params.fields[0]),
    sellToken: parseSellToken(params.fields[1]),
    token: { policyId: asBytes(params.fields[2]), assetName: asBytes(params.fields[3]) },
    price: asInt(params.fields[4]),
    flag: flagInner.fields.length >= 1 ? asInt(flagInner.fields[0]) : BigInt(0),
    deadline: asOptional(params.fields[7], asInt),
    total: asInt(amounts.fields[0]),
    filled: asInt(amounts.fields[1]),
  };
}

/** The offered asset = the order UTxO's value side: token for a SELL, ADA for a BUY. */
export function offeredAsset(order: ChadswapOrder): AssetClass {
  return order.sellToken ? order.token : ADA;
}

/** The asked asset = the counter side: ADA for a SELL, token for a BUY. */
export function askedAsset(order: ChadswapOrder): AssetClass {
  return order.sellToken ? ADA : order.token;
}

/** Offered amount (token quantity for a SELL; lovelace = total*price for a BUY). */
export function offeredAmount(order: ChadswapOrder): bigint {
  return order.sellToken ? order.total : order.total * order.price;
}

/** Asked amount (lovelace = total*price for a SELL; token quantity for a BUY). */
export function askedAmount(order: ChadswapOrder): bigint {
  return order.sellToken ? order.total * order.price : order.total;
}

/** Light, non-throwing validation over a parsed order. */
export function validateChadswapOrder(order: ChadswapOrder): DexIssue[] {
  const issues: DexIssue[] = [];
  const pay = order.maker.paymentCredential.hash;
  if (pay.length !== 56) {
    issues.push({
      severity: "error",
      message: `maker payment hash must be 28 bytes, got ${pay.length / 2}`,
    });
  }
  if (order.token.policyId === "") {
    issues.push({
      severity: "warning",
      message: "token leg has an empty policy id (the pair would be ADA/ADA)",
    });
  }
  if (order.total <= BigInt(0)) {
    issues.push({ severity: "warning", message: "order total quantity is not positive" });
  }
  if (order.price < BigInt(0)) {
    issues.push({ severity: "warning", message: "price is negative" });
  }
  if (order.filled < BigInt(0) || order.filled > order.total) {
    issues.push({ severity: "warning", message: "filled amount is outside [0, total]" });
  }
  return issues;
}

// --- Redeemer -------------------------------------------------------------
//
// The escrow validator takes a single redeemer constructor that
// carries an output index used by the TAKE/fill branch; cancel/update are gated
// by the maker's signature on the tx (no distinct redeemer constructor). So we
// only recognize the canonical `Constr 0 [Int]` action redeemer; the
// new/take/cancel/update lifecycle is distinguished off-chain (674 metadata),
// not by the redeemer shape.
export type ChadswapRedeemerKind = "Action";

export function classifyChadswapRedeemer(data: PD): ChadswapRedeemerKind | null {
  if (!isConstr(data)) return null;
  const c = asConstr(data);
  if (c.tag === 0 && c.fields.length >= 1) return "Action";
  return null;
}
