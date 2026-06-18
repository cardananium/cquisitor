// Chakra pool-state + swap-order datum parsers, and redeemer classifier.
//
// The shared Chakra validator carries TWO datum shapes:
//
//   POOL state   = Constr 0 [ Constr 0 [ 12 fields ] ]   (an outer 1-tuple
//                  wrapping the inner record)
//   SWAP order   = Constr 1 [ Constr 0 [ poolNft, owner, currency, amount,
//                  returnAddr, extra ] ]
//
// The inner POOL record (12 fields), with semantics taken from the validator's
// own field usage (field index -> on-chain constraint):
//   [0]  poolNft        AssetClass(policy = Chakra script hash, name)  (the
//                       pool-identifying NFT minted by the validator).
//   [1]  currency       AssetClass — the quote/base asset the pool is priced
//                       against (INDY for 25/27 pools, YNI for 2).
//   [2]  token          AssetClass — the launched CIP-68 token (name 0014df10…).
//   [3]  tokensSold     Int — units of `token` sold so far off the curve;
//                       validator enforces [3] < [4] and tracks 1e9 - [3] as
//                       the remaining reserve.
//   [4]  targetSupply   Int — bonding-curve cap / graduation target; validator
//                       enforces 100_000_000 < [4] < 1_000_000_000.
//   [5]  curveA         Rational(num,den) — bonding-curve price coefficient.
//   [6]  curveB         Rational(num,den) — bonding-curve price coefficient.
//   [7]  baseFee        Int — flat fee / min-ada constant (500000 = 0.5 ADA).
//   [8]  feeFraction    Rational(num,den) — proportional fee (1/100 = 1%).
//   [9]  accFee         Int — accumulated currency-side fee counter.
//   [10] accCurrency    Int — accumulated currency reserve counter (subtracted
//                       from the held currency to derive tradable balance).
//   [11] operatorKey    bytes(28) — operator/batcher pkh required as a tx
//                       signatory (constant across all pools).
//
// NO field is given an invented name: each label above is justified by the
// validator's actual arithmetic / signatory / NFT-mint logic. Where the precise
// human name from an (unpublished) Chakra SDK is unknown, the label stays
// descriptive and the raw value is always rendered.

import {
  asBytes,
  asConstr,
  asInt,
  parseAssetClass,
  parsePlutusAddress,
  type AssetClass,
  type PD,
  type PlutusAddress,
  type Rational,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

export interface ChakraPool {
  /** Pool-identifying NFT; policy id == the Chakra validator hash. */
  poolNft: AssetClass;
  /** Quote/base asset the pool is denominated in (e.g. INDY). ada = ("",""). */
  currency: AssetClass;
  /** The launched token being bought/sold off the curve. */
  token: AssetClass;
  /** Units of `token` sold off the curve so far. */
  tokensSold: bigint;
  /** Bonding-curve cap / graduation target (100M < x < 1B). */
  targetSupply: bigint;
  /** Bonding-curve price coefficient A. */
  curveA: Rational;
  /** Bonding-curve price coefficient B. */
  curveB: Rational;
  /** Flat base fee / min-ada constant (lovelace). */
  baseFee: bigint;
  /** Proportional fee fraction (e.g. 1/100). */
  feeFraction: Rational;
  /** Accumulated fee counter (currency side). */
  accFee: bigint;
  /** Accumulated currency-reserve counter. */
  accCurrency: bigint;
  /** Operator / batcher signatory pkh (28 bytes). */
  operatorKey: string;
}

function parseRationalCtor(d: PD): Rational {
  const c = asConstr(d);
  if (c.fields.length !== 2) throw new Error("Chakra: expected Rational(num, den)");
  return { numerator: asInt(c.fields[0]), denominator: asInt(c.fields[1]) };
}

/** Parse the inner 12-field pool record (the body of Constr0[ <record> ]). */
function parsePoolRecord(record: PD): ChakraPool {
  const r = asConstr(record);
  if (r.fields.length !== 12) {
    throw new Error(`Chakra pool: expected 12 fields, got ${r.fields.length}`);
  }
  const f = r.fields;
  return {
    poolNft: parseAssetClass(f[0]),
    currency: parseAssetClass(f[1]),
    token: parseAssetClass(f[2]),
    tokensSold: asInt(f[3]),
    targetSupply: asInt(f[4]),
    curveA: parseRationalCtor(f[5]),
    curveB: parseRationalCtor(f[6]),
    baseFee: asInt(f[7]),
    feeFraction: parseRationalCtor(f[8]),
    accFee: asInt(f[9]),
    accCurrency: asInt(f[10]),
    operatorKey: asBytes(f[11]),
  };
}

/**
 * Parse a Chakra POOL-state datum: Constr0[ Constr0[ 12 fields ] ]. Pool UTxOs
 * carry it inline; swap-order requests reference the same record by datum hash.
 */
export function parseChakraPool(data: PD): ChakraPool {
  const outer = asConstr(data);
  if (outer.tag !== 0) {
    throw new Error(`Chakra pool: unexpected outer ctor ${outer.tag}`);
  }
  if (outer.fields.length !== 1) {
    throw new Error(`Chakra pool: expected 1 wrapper field, got ${outer.fields.length}`);
  }
  return parsePoolRecord(outer.fields[0]);
}

export interface ChakraSwapOrder {
  /** The pool this order targets, by its pool NFT. */
  poolNft: AssetClass;
  /** Owner / beneficiary key hash (28 bytes). */
  owner: string;
  /** The currency (quote) asset of the targeted pool. */
  currency: AssetClass;
  /** Order amount (field[0] of the inner Constr0[amount, _] tuple). */
  amount: bigint;
  /** Trailing Int paired with `amount` in the amount tuple. */
  amountAux: bigint;
  /** Address the swap result must be paid back to (CIP-19). */
  returnAddress: PlutusAddress;
}

/**
 * Parse a Chakra SWAP-ORDER datum: Constr1[ Constr0[ poolNft, ownerPkh,
 * currency, Constr0[amount, aux], returnAddress, Constr0[] ] ]. Observed shape
 * (Unknown_S_2_0 = 6 logical fields after the bare-bytes owner).
 */
export function parseChakraSwapOrder(data: PD): ChakraSwapOrder {
  const outer = asConstr(data);
  if (outer.tag !== 1) {
    throw new Error(`Chakra swap order: unexpected outer ctor ${outer.tag}`);
  }
  const body = asConstr(outer.fields[0]);
  const f = body.fields;
  if (f.length < 5) {
    throw new Error(`Chakra swap order: expected >=5 fields, got ${f.length}`);
  }
  const amt = asConstr(f[3]);
  return {
    poolNft: parseAssetClass(f[0]),
    owner: asBytes(f[1]),
    currency: parseAssetClass(f[2]),
    amount: asInt(amt.fields[0]),
    amountAux: amt.fields.length > 1 ? asInt(amt.fields[1]) : BigInt(0),
    returnAddress: parsePlutusAddress(f[4]),
  };
}

/** Whether a datum is a swap order (Constr1) vs a pool record (Constr0). */
export function isChakraSwapOrder(data: PD): boolean {
  try {
    return asConstr(data).tag === 1;
  } catch {
    return false;
  }
}

/** Light, non-throwing validation over a parsed pool. */
export function validateChakraPool(pool: ChakraPool): DexIssue[] {
  const issues: DexIssue[] = [];
  if (pool.poolNft.policyId !== "4938414d1dbe0a7e46867cfc05ee9b9149dc18b6952c8bc76e760341") {
    issues.push({
      severity: "warning",
      message: "pool NFT policy is not the Chakra script hash",
    });
  }
  if (pool.operatorKey.length !== 56) {
    issues.push({
      severity: "error",
      message: `operator key must be 28 bytes, got ${pool.operatorKey.length / 2}`,
    });
  }
  if (pool.targetSupply <= BigInt(0)) {
    issues.push({ severity: "warning", message: "targetSupply is not positive" });
  }
  if (pool.tokensSold > pool.targetSupply) {
    issues.push({
      severity: "warning",
      message: "tokensSold exceeds targetSupply (pool may have graduated)",
    });
  }
  return issues;
}

export type ChakraRedeemerKind =
  | "Swap" // Constr0[ poolInputIdx, orderInputIdxs, orderCount ] — batch apply
  | "Action1" // Constr1[]
  | "Action2" // Constr2[]
  | "Action3" // Constr3[a, b]
  | "Action4"; // Constr4[]

// Spend/mint redeemer enum (5 variants), recovered from the validator. Only the
// first (the batch swap-apply) carries fields; the validator's main swap path
// destructures Constr0[ poolInputIdx, [orderInputIdxs], orderCount ]. The other
// four are bare/short admin variants whose exact names are not published — they
// keep neutral labels.
export function classifyChakraRedeemer(data: PD): ChakraRedeemerKind | null {
  let c: { tag: number; fields: PD[] };
  try {
    c = asConstr(data);
  } catch {
    return null;
  }
  switch (c.tag) {
    case 0:
      return "Swap";
    case 1:
      return "Action1";
    case 2:
      return "Action2";
    case 3:
      return "Action3";
    case 4:
      return "Action4";
    default:
      return null;
  }
}
