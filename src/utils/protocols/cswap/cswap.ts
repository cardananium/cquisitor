// CSWAP DEX (cswap.fi) datum + redeemer parsers for the order-book and AMM pool
// validators. PlutusV3.
//
// CSWAP publishes no CIP-57 blueprint / named schema, so the validator-enforced
// fields get behaviour-derived names and the remainder get neutral labels — NO
// invented names.
//
// === ORDER datum (order-book validator da5b47ae…6d4e) ===
//   Constr 0 [
//     [0] owner            : Address  (Constr0[ Credential, Option<Inline<Cred>> ])
//     [1] wanted           : List< [policy, name, amount] >  (SingletonValue triples)
//     [2] residual         : List< [policy, name, amount] >  (give/fill accumulator)
//     [3] flag             : Constr 0 []                      (order-type marker)
//     [4] paramA           : Int                              (observed 500 / 200)
//     [5] paramB           : Int                              (observed 15)
//   ]
// The spend validator's fill branch requires that an output paying the owner
// holds >= the amount of every entry in `wanted` (field[1]) — that is the price
// leg the maker receives. The assets the maker GIVES are simply the order UTxO's
// own value (minus protocol/min-ada), not a datum field. The cancel branch only
// checks the owner payment key (field[0].fields[0].fields[0]) is a signatory.
//
// === POOL datum (AMM pool validator ed97e0a1…7f6f) ===
//   Constr 0 [
//     [0] balance          : Int        (cumulative reserve/marker used in swap math)
//     [1] feeNumerator      : Int        (observed 85 / 200 / 500)
//     [2] assetAPolicy      : Bytes      (ada = "")
//     [3] assetAName        : Bytes      (ada = "")
//     [4] assetBPolicy      : Bytes
//     [5] assetBName        : Bytes
//     [6] lpPolicy          : Bytes      (pool/LP token policy, looked up in tx mint)
//     [7] lpName            : Bytes      (LP display name, e.g. "C-LP: ADA x AWOO")
//   ]
// The pool validator reads assetA/assetB (fields 2-5) and the LP policy (field 6)
// directly — confirming those positions.

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  isConstr,
  type AssetClass,
  type PD,
  type PlutusAddress,
  parsePlutusAddress,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

// --- Order ----------------------------------------------------------------

export interface CswapValueLeg extends AssetClass {
  amount: bigint;
}

export interface CswapOrder {
  /** The maker; a fill output must pay it. Cancel needs its signature. */
  owner: PlutusAddress;
  /** Assets the maker WANTS to receive (the price leg). ada = ("","", n). */
  wanted: CswapValueLeg[];
  /** Secondary value list (residual / fill accumulator). Surfaced verbatim. */
  residual: CswapValueLeg[];
  /** Constructor tag of the order-type marker field[3] (observed 0). */
  flagTag: number;
  /** First trailing Int parameter field[4] (observed 500 / 200). */
  paramA: bigint;
  /** Second trailing Int parameter field[5] (observed 15). */
  paramB: bigint;
}

// A SingletonValue is a 3-element List [policy, name, amount]. ada = ("","", n).
function parseValueLeg(d: PD): CswapValueLeg {
  const list = asList(d);
  if (list.length !== 3) {
    throw new Error(`CSWAP value leg: expected [policy, name, amount], got ${list.length}`);
  }
  return {
    policyId: asBytes(list[0]),
    assetName: asBytes(list[1]),
    amount: asInt(list[2]),
  };
}

export function parseCswapOrder(data: PD): CswapOrder {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`CSWAP order: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 6) {
    throw new Error(`CSWAP order: expected 6 fields, got ${f.length}`);
  }
  const flag = asConstr(f[3]);
  return {
    owner: parsePlutusAddress(f[0]),
    wanted: asList(f[1]).map(parseValueLeg),
    residual: asList(f[2]).map(parseValueLeg),
    flagTag: flag.tag,
    paramA: asInt(f[4]),
    paramB: asInt(f[5]),
  };
}

/** Light, non-throwing validation over a parsed order. */
export function validateCswapOrder(order: CswapOrder): DexIssue[] {
  const issues: DexIssue[] = [];
  const pay = order.owner.paymentCredential.hash;
  if (pay.length !== 56) {
    issues.push({
      severity: "error",
      message: `owner payment hash must be 28 bytes, got ${pay.length / 2}`,
    });
  }
  if (order.wanted.length === 0) {
    issues.push({ severity: "warning", message: "order requests no assets (empty wanted list)" });
  }
  for (const leg of order.wanted) {
    if (leg.amount < BigInt(0)) {
      issues.push({ severity: "warning", message: "a wanted amount is negative" });
    }
  }
  return issues;
}

// --- Pool -----------------------------------------------------------------

export interface CswapPool {
  /** Cumulative reserve/marker used in the swap math (field[0]). */
  balance: bigint;
  /** Fee numerator (field[1]); observed 85 / 200 / 500. */
  feeNumerator: bigint;
  /** First reserve asset. ada = ("",""). */
  assetA: AssetClass;
  /** Second reserve asset. */
  assetB: AssetClass;
  /** Pool / LP token policy id (field[6]); minted/looked up by the validator. */
  lpPolicy: string;
  /** LP display name bytes (field[7]), e.g. "C-LP: ADA x AWOO". */
  lpName: string;
}

export function parseCswapPool(data: PD): CswapPool {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`CSWAP pool: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 8) {
    throw new Error(`CSWAP pool: expected 8 fields, got ${f.length}`);
  }
  return {
    balance: asInt(f[0]),
    feeNumerator: asInt(f[1]),
    assetA: { policyId: asBytes(f[2]), assetName: asBytes(f[3]) },
    assetB: { policyId: asBytes(f[4]), assetName: asBytes(f[5]) },
    lpPolicy: asBytes(f[6]),
    lpName: asBytes(f[7]),
  };
}

export function validateCswapPool(pool: CswapPool): DexIssue[] {
  const issues: DexIssue[] = [];
  if (pool.lpPolicy.length !== 56) {
    issues.push({
      severity: "error",
      message: `LP policy must be 28 bytes, got ${pool.lpPolicy.length / 2}`,
    });
  }
  const aIsAda = pool.assetA.policyId === "" && pool.assetA.assetName === "";
  const bIsAda = pool.assetB.policyId === "" && pool.assetB.assetName === "";
  if (aIsAda && bIsAda) {
    issues.push({ severity: "warning", message: "both reserve assets are ADA" });
  }
  if (pool.feeNumerator < BigInt(0)) {
    issues.push({ severity: "warning", message: "fee numerator is negative" });
  }
  return issues;
}

// --- Redeemers ------------------------------------------------------------
//
// ORDER redeemer: Constr 0 [] = Cancel (owner-signature reclaim);
// Constr 1 [] = a disabled/no-op variant; any other constructor = Fill, carrying
// [Int fillIndex, Int inputIndex, Int extraIndex].
export type CswapOrderRedeemerKind = "Cancel" | "Fill" | "Disabled";

export function classifyCswapOrderRedeemer(data: PD): CswapOrderRedeemerKind | null {
  if (!isConstr(data)) return null;
  const c = asConstr(data);
  if (c.tag === 0 && c.fields.length === 0) return "Cancel";
  if (c.tag === 1 && c.fields.length === 0) return "Disabled";
  if (c.fields.length >= 1) return "Fill";
  return null;
}

// POOL redeemer: Constr 0 [a, b] and Constr 1 [a, b, c] are the
// swap / liquidity actions; Constr 2 [] is a no-arg variant. We surface a coarse
// label only — the exact action mapping is not published.
export type CswapPoolRedeemerKind = "PoolAction0" | "PoolAction1" | "PoolAction2";

export function classifyCswapPoolRedeemer(data: PD): CswapPoolRedeemerKind | null {
  if (!isConstr(data)) return null;
  const c = asConstr(data);
  if (c.tag === 0) return "PoolAction0";
  if (c.tag === 1) return "PoolAction1";
  if (c.tag === 2) return "PoolAction2";
  return null;
}
