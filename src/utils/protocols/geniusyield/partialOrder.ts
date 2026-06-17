// Genius Yield V1 (PartialOrder) datum + redeemer parsers.
//
// The datum & nested contained-fee record use PlutusTx `unstableMakeIsData`
// (Constr 0, fields in declaration order), and the spend redeemer uses
// `makeIsDataIndexed ''PartialOrderAction [(PartialCancel,0),
// (PartialFill,1),(CompleteFill,2)]`.
//
//   AssetClass        = Constr0[policy:Bytes, name:Bytes]   ("" / "" for ada)
//   Rational          = Constr0[num:Int, den:Int]
//   Maybe POSIXTime   = Constr0[Int(ms)] (Just) | Constr1[] (Nothing)
//   Address           = standard Cardano shape (parsePlutusAddress)

import {
  asConstr,
  asInt,
  asBytes,
  asOptional,
  parseAssetClass,
  parsePlutusAddress,
  parseRational,
  type AssetClass,
  type PD,
  type PlutusAddress,
  type Rational,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

// --- Nested: PartialOrderContainedFee — Constr 0, 3 ordered fields ----------

export interface PartialOrderContainedFee {
  /** pocfLovelaces — fees in lovelace (maker+taker flat). */
  lovelaces: bigint;
  /** pocfOfferedTokens — maker % fee in offered tokens. */
  offeredTokens: bigint;
  /** pocfAskedTokens — taker % fee in asked tokens. */
  askedTokens: bigint;
}

export function parsePartialOrderContainedFee(d: PD): PartialOrderContainedFee {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PartialOrderContainedFee: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 3) {
    throw new Error(`PartialOrderContainedFee: expected 3 fields, got ${c.fields.length}`);
  }
  return {
    lovelaces: asInt(c.fields[0]),
    offeredTokens: asInt(c.fields[1]),
    askedTokens: asInt(c.fields[2]),
  };
}

// --- Datum: PartialOrderDatum — Constr 0, 15 ordered fields -----------------

export interface PartialOrderDatum {
  /** podOwnerKey — PubKeyHash (28-byte hex). */
  ownerKey: string;
  /** podOwnerAddr. */
  ownerAddr: PlutusAddress;
  /** podOfferedAsset. */
  offeredAsset: AssetClass;
  /** podOfferedOriginalAmount. */
  offeredOriginalAmount: bigint;
  /** podOfferedAmount — amount still on offer (remaining). */
  offeredAmount: bigint;
  /** podAskedAsset. */
  askedAsset: AssetClass;
  /** podPrice — asked per offered. */
  price: Rational;
  /** podNFT — TokenName of the order-identifying NFT (hex). */
  nft: string;
  /** podStart — Maybe POSIXTime (ms), null = Nothing. */
  start: bigint | null;
  /** podEnd — Maybe POSIXTime (ms), null = Nothing. */
  end: bigint | null;
  /** podPartialFills — number of partial fills so far. */
  partialFills: bigint;
  /** podMakerLovelaceFlatFee. */
  makerLovelaceFlatFee: bigint;
  /** podTakerLovelaceFlatFee. */
  takerLovelaceFlatFee: bigint;
  /** podContainedFee. */
  containedFee: PartialOrderContainedFee;
  /** podContainedPayment. */
  containedPayment: bigint;
}

export function parsePartialOrderDatum(d: PD): PartialOrderDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PartialOrderDatum: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 15) {
    throw new Error(`PartialOrderDatum: expected 15 fields, got ${f.length}`);
  }
  return {
    ownerKey: asBytes(f[0]),
    ownerAddr: parsePlutusAddress(f[1]),
    offeredAsset: parseAssetClass(f[2]),
    offeredOriginalAmount: asInt(f[3]),
    offeredAmount: asInt(f[4]),
    askedAsset: parseAssetClass(f[5]),
    price: parseRational(f[6]),
    nft: asBytes(f[7]),
    start: asOptional(f[8], asInt),
    end: asOptional(f[9], asInt),
    partialFills: asInt(f[10]),
    makerLovelaceFlatFee: asInt(f[11]),
    takerLovelaceFlatFee: asInt(f[12]),
    containedFee: parsePartialOrderContainedFee(f[13]),
    containedPayment: asInt(f[14]),
  };
}

// Light validation → DexIssue[].
export function validatePartialOrderDatum(o: PartialOrderDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (o.price.denominator === BigInt(0)) {
    issues.push({ severity: "error", message: "Price has a zero denominator" });
  }
  if (o.offeredAmount > o.offeredOriginalAmount) {
    issues.push({
      severity: "warning",
      message: "Remaining offered amount exceeds the original offered amount",
    });
  }
  if (o.offeredAmount < BigInt(0)) {
    issues.push({ severity: "error", message: "Remaining offered amount is negative" });
  }
  if (o.start != null && o.end != null && o.start > o.end) {
    issues.push({ severity: "warning", message: "Order start time is after its end time" });
  }
  if (
    o.offeredAsset.policyId === o.askedAsset.policyId &&
    o.offeredAsset.assetName === o.askedAsset.assetName
  ) {
    issues.push({ severity: "warning", message: "Offered and asked assets are identical" });
  }
  return issues;
}

// --- Spend Redeemer: PartialOrderAction — makeIsDataIndexed 0/1/2 -----------

export type PartialOrderAction =
  | { kind: "PartialCancel" }
  | { kind: "PartialFill"; amount: bigint }
  | { kind: "CompleteFill" };

export function parsePartialOrderAction(d: PD): PartialOrderAction {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "PartialCancel" };
    case 1:
      // PartialFill carries a single bare Int — the offered amount taken.
      if (c.fields.length !== 1) {
        throw new Error(`PartialFill: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "PartialFill", amount: asInt(c.fields[0]) };
    case 2:
      return { kind: "CompleteFill" };
    default:
      throw new Error(`PartialOrderAction: unexpected ctor ${c.tag}`);
  }
}

export function classifyPartialOrderRedeemer(d: PD): string | null {
  try {
    const a = parsePartialOrderAction(d);
    switch (a.kind) {
      case "PartialCancel":
        return "Cancel";
      case "PartialFill":
        return "Partial fill";
      case "CompleteFill":
        return "Complete fill";
    }
  } catch {
    return null;
  }
}
