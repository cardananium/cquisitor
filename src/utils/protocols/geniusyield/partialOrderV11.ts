// Genius Yield V1.1 (PartialOrder) datum parser.
//
// The V1.1 order NFT minting policy is 55c9ddbe…b8be. This V1.1 family uses a
// DIFFERENT, larger 12-field Constr0 layout than V1's 15-field
// `PartialOrderDatum` — it is NOT the same on-chain type, so it gets its own
// parser. Ambiguous fields are modeled faithfully (exact ctor/types) without
// over-claiming meaning.
//
// 12-field Constr0 layout:
//   f0  signers   Constr0[ List<PubKeyHash(28)>, List<…>(empty) ]
//   f1  ownerAddr Address (Constr0[ Credential, Option<Referenced<Cred>> ])
//   f2  podNFT    Bytes(29)            — order-identifying NFT token name
//   f3  offered   Constr0[ AssetClass, Int ]
//   f4  asked     Constr0[ AssetClass, Int ]
//   f5  record    sum type, two observed constructors:
//                   Constr0[ Rational, Maybe<Rational> ]
//                   Constr1[ Bytes(32), Constr0[Rational,Rational],
//                            Constr0[ Constr0[Rational,Rational] ] ]
//   f6  start     Maybe POSIXTime (Constr0[Int]=Just | Constr1[]=Nothing)
//   f7  end       Maybe POSIXTime
//   f8  Int
//   f9  Rational  Constr0[Int,Int]
//   f10 Rational  Constr0[Int,Int]
//   f11 Int

import {
  asConstr,
  asInt,
  asBytes,
  asList,
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

/** An (AssetClass, amount) pair as carried by V1.1 offered/asked fields. */
export interface AssetWithAmount {
  asset: AssetClass;
  amount: bigint;
}

function parseAssetWithAmount(d: PD): AssetWithAmount {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`V1.1 (AssetClass, Int): unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`V1.1 (AssetClass, Int): expected 2 fields, got ${c.fields.length}`);
  }
  return { asset: parseAssetClass(c.fields[0]), amount: asInt(c.fields[1]) };
}

/**
 * f5 is a tagged union observed in two shapes on-chain:
 *   - "plain": Constr0[ price:Rational, extra:Maybe<Rational> ]
 *   - "record": Constr1[ nft:Bytes(32), Constr0[price:Rational, price2:Rational],
 *                        Constr0[ Constr0[nested:Rational, nested2:Rational] ] ]
 *     i.e. the leading Rational of each pair (price / nested) plus the trailing
 *     Rational of each pair (price2 / nested2). All four are captured so none
 *     is silently dropped; the view surfaces them.
 */
export type PartialOrderV11Record =
  | { kind: "plain"; price: Rational; extra: Rational | null }
  | {
      kind: "record";
      nft: string;
      price: Rational;
      price2: Rational;
      nested: Rational;
      nested2: Rational;
    };

function parsePartialOrderV11Record(d: PD): PartialOrderV11Record {
  const c = asConstr(d);
  if (c.tag === 0) {
    if (c.fields.length !== 2) {
      throw new Error(`V1.1 record(0): expected 2 fields, got ${c.fields.length}`);
    }
    return {
      kind: "plain",
      price: parseRational(c.fields[0]),
      extra: asOptional(c.fields[1], parseRational),
    };
  }
  if (c.tag === 1) {
    if (c.fields.length !== 3) {
      throw new Error(`V1.1 record(1): expected 3 fields, got ${c.fields.length}`);
    }
    // f5.1 = Constr0[Rational, Rational] — leading Rational is the price.
    const inner = asConstr(c.fields[1]);
    if (inner.tag !== 0 || inner.fields.length !== 2) {
      throw new Error("V1.1 record(1): expected Constr0[Rational, Rational]");
    }
    // f5.2 = Constr0[ Constr0[Rational, Rational] ].
    const wrap = asConstr(c.fields[2]);
    if (wrap.tag !== 0 || wrap.fields.length !== 1) {
      throw new Error("V1.1 record(1): expected Constr0[ Constr0[Rational, Rational] ]");
    }
    const nestedPair = asConstr(wrap.fields[0]);
    if (nestedPair.tag !== 0 || nestedPair.fields.length !== 2) {
      throw new Error("V1.1 record(1): expected nested Constr0[Rational, Rational]");
    }
    return {
      kind: "record",
      nft: asBytes(c.fields[0]),
      price: parseRational(inner.fields[0]),
      price2: parseRational(inner.fields[1]),
      nested: parseRational(nestedPair.fields[0]),
      nested2: parseRational(nestedPair.fields[1]),
    };
  }
  throw new Error(`V1.1 record: unexpected ctor ${c.tag}`);
}

// --- Datum: PartialOrderV11Datum — Constr 0, 12 ordered fields --------------

export interface PartialOrderV11Datum {
  /** f0 — signatory PubKeyHashes (28-byte hex) authorizing the order. */
  signatories: string[];
  /** f1 — owner address. */
  ownerAddr: PlutusAddress;
  /** f2 — order-identifying NFT token name (29-byte hex). */
  nft: string;
  /** f3 — offered asset + amount. */
  offered: AssetWithAmount;
  /** f4 — asked asset + amount. */
  asked: AssetWithAmount;
  /** f5 — price/record tagged union. */
  record: PartialOrderV11Record;
  /** f6 — Maybe POSIXTime (ms), null = Nothing. */
  start: bigint | null;
  /** f7 — Maybe POSIXTime (ms), null = Nothing. */
  end: bigint | null;
  /** f8 — integer (partial fills / counter). */
  counter: bigint;
  /** f9 — Rational. */
  rational1: Rational;
  /** f10 — Rational. */
  rational2: Rational;
  /** f11 — integer. */
  trailingInt: bigint;
}

export function parsePartialOrderV11Datum(d: PD): PartialOrderV11Datum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PartialOrderV11Datum: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 12) {
    throw new Error(`PartialOrderV11Datum: expected 12 fields, got ${f.length}`);
  }
  // f0 = Constr0[ List<PubKeyHash>, List<…> ].
  const signersCtor = asConstr(f[0]);
  if (signersCtor.tag !== 0 || signersCtor.fields.length !== 2) {
    throw new Error("PartialOrderV11Datum: f0 must be Constr0[List, List]");
  }
  const signatories = asList(signersCtor.fields[0]).map(asBytes);
  return {
    signatories,
    ownerAddr: parsePlutusAddress(f[1]),
    nft: asBytes(f[2]),
    offered: parseAssetWithAmount(f[3]),
    asked: parseAssetWithAmount(f[4]),
    record: parsePartialOrderV11Record(f[5]),
    start: asOptional(f[6], asInt),
    end: asOptional(f[7], asInt),
    counter: asInt(f[8]),
    rational1: parseRational(f[9]),
    rational2: parseRational(f[10]),
    trailingInt: asInt(f[11]),
  };
}

/** The effective price (asked-per-offered) carried by f5, either shape. */
export function partialOrderV11Price(o: PartialOrderV11Datum): Rational {
  return o.record.price;
}

// Light validation → DexIssue[].
export function validatePartialOrderV11Datum(o: PartialOrderV11Datum): DexIssue[] {
  const issues: DexIssue[] = [];
  const price = partialOrderV11Price(o);
  if (price.denominator === BigInt(0)) {
    issues.push({ severity: "error", message: "Price has a zero denominator" });
  }
  if (o.offered.amount < BigInt(0)) {
    issues.push({ severity: "error", message: "Offered amount is negative" });
  }
  if (o.start != null && o.end != null && o.start > o.end) {
    issues.push({ severity: "warning", message: "Order start time is after its end time" });
  }
  if (
    o.offered.asset.policyId === o.asked.asset.policyId &&
    o.offered.asset.assetName === o.asked.asset.assetName
  ) {
    issues.push({ severity: "warning", message: "Offered and asked assets are identical" });
  }
  return issues;
}
