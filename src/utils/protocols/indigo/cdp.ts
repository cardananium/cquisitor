// Indigo Protocol — CDP validator datum & redeemer parsers (V2 / deployed).
//
// `Data` encoding conventions used below:
//   Object({...})  → Constr 0 [fields in declared order]
//   Enum([A,B,..]) → variant by index (A=Constr0, B=Constr1, ...); each arm
//                    here is a single-key object, so the arm's inner
//                    object fields become that Constr's field list.
//   Nullable(x)    → Just = Constr 0 [x], Nothing = Constr 1 []
//   Boolean()      → False = Constr 0 [], True = Constr 1 []   (== asBool)
//   AssetClass     → Constr 0 [ ByteArray policyId, ByteArray tokenName ]
//   OnChainDecimal → Constr 0 [ Int ]   (fixed-point, scale 1e6)
//   OracleAssetNft → Constr 0 [ Constr 0 [ Constr 0 [ AssetClass ] ] ]

import {
  asBool,
  asBytes,
  asConstr,
  asInt,
  asOptional,
  isBytes,
  isConstr,
  parseAssetClass,
  parseRational,
  type AssetClass,
  type PD,
  type Rational,
} from "@/utils/protocols/dex/plutusData";

// --- shared Indigo combinators ---------------------------------------------

/** OnChainDecimal = Constr 0 [ Int getOnChainInt ] — fixed-point, scale 1e6. */
export function parseOnChainDecimal(d: PD): bigint {
  const c = asConstr(d);
  if (c.tag !== 0 || c.fields.length !== 1) {
    throw new Error(`OnChainDecimal: expected Constr0[Int], got ctor ${c.tag}/${c.fields.length}`);
  }
  return asInt(c.fields[0]);
}

/** Format an OnChainDecimal (1e6 fixed-point) as a decimal string. */
export function formatOnChainDecimal(v: bigint): string {
  const neg = v < BigInt(0);
  const abs = neg ? -v : v;
  const scale = BigInt(1_000_000);
  const whole = abs / scale;
  const frac = abs % scale;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  const body = fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
  return neg ? `-${body}` : body;
}

/**
 * OracleAssetNft = Constr 0 [ Constr 0 [ Constr 0 [ AssetClass ] ] ]
 * i.e. { oracleNft: { asset: AssetClass } } — three nested Constr0 wrappers
 * ending in the 2-field AssetClass.
 */
export function parseOracleAssetNft(d: PD): AssetClass {
  let inner = d;
  for (let i = 0; i < 3; i++) {
    const c = asConstr(inner);
    if (c.tag !== 0 || c.fields.length !== 1) {
      throw new Error(`OracleAssetNft: expected nested Constr0[_] at depth ${i}, got ctor ${c.tag}`);
    }
    inner = c.fields[0];
  }
  return parseAssetClass(inner);
}

// --- CDP position datum (CDPDatum Constr 0 → CDPContent) --------------------

export type CDPFees =
  | { kind: "ActiveInterestTracking"; lastSettled: bigint; unitaryInterestSnapshot: bigint }
  | { kind: "FrozenAccumulatedFees"; lovelacesTreasury: bigint; lovelacesIndyStakers: bigint };

export interface CDPPosition {
  role: "cdp";
  /** Just(pkh) = owned; null (Nothing) = FROZEN / liquidatable. */
  cdpOwner: string | null;
  /** True when cdpOwner is Nothing — the CDP is frozen. */
  frozen: boolean;
  /** iAsset token name (hex), e.g. "iUSD"/"iBTC" as hex. */
  iasset: string;
  /** Collateral AssetClass locked against this CDP (ADA = ("","") on chain). */
  collateral: AssetClass;
  /** Amount of iAsset debt minted from this position. */
  mintedAmt: bigint;
  cdpFees: CDPFees;
}

function parseCDPFees(d: PD): CDPFees {
  const c = asConstr(d);
  if (c.tag === 0) {
    if (c.fields.length !== 2) throw new Error("ActiveCDPInterestTracking: expected 2 fields");
    return {
      kind: "ActiveInterestTracking",
      lastSettled: asInt(c.fields[0]),
      unitaryInterestSnapshot: asInt(c.fields[1]),
    };
  }
  if (c.tag === 1) {
    if (c.fields.length !== 2) throw new Error("FrozenCDPAccumulatedFees: expected 2 fields");
    return {
      kind: "FrozenAccumulatedFees",
      lovelacesTreasury: asInt(c.fields[0]),
      lovelacesIndyStakers: asInt(c.fields[1]),
    };
  }
  throw new Error(`CDPFees: unexpected ctor ${c.tag}`);
}

function parseCDPContent(content: PD): CDPPosition {
  const c = asConstr(content);
  if (c.tag !== 0) throw new Error(`CDPContent: expected Constr0, got ${c.tag}`);
  // Layout (Constr 0, 5 fields):
  //   [0] Nullable owner, [1] iAsset name, [2] collateral AssetClass,
  //   [3] minted debt amount, [4] CDPFees.
  if (c.fields.length !== 5) throw new Error(`CDPContent: expected 5 fields, got ${c.fields.length}`);
  const cdpOwner = asOptional(c.fields[0], asBytes);
  return {
    role: "cdp",
    cdpOwner,
    frozen: cdpOwner === null,
    iasset: asBytes(c.fields[1]),
    collateral: parseAssetClass(c.fields[2]),
    mintedAmt: asInt(c.fields[3]),
    cdpFees: parseCDPFees(c.fields[4]),
  };
}

// --- IAsset config datum (IAssetContent) ------------------------------------
//
// On-chain layout is a top-level Constr 0 wrapping a Constr 0 with 9 fields:
//   [0] ByteArray   iAsset token name (e.g. "iUSD"/"iBTC"/"iSOL")
//   [1] Int         price-source index (small enum-like int)
//   [2] Rational    Constr0[num, den] — collateral / minting ratio #1
//   [3] Rational    Constr0[num, den] — collateral / minting ratio #2
//   [4] Rational    Constr0[num, den] — collateral / minting ratio #3
//   [5] Rational    Constr0[num, den] — fee ratio #1
//   [6] Rational    Constr0[num, den] — fee ratio #2
//   [7] Bool        Constr0[]=False / Constr1[]=True (e.g. firstIAsset flag)
//   [8] Nullable    Just(nextIAsset name) / Nothing — linked-list pointer
//
// The five Rationals are surfaced positionally and kept as raw (num, den) pairs
// rather than asserting a fixed semantic meaning.

/**
 * Extra fields carried by the NEWER (Constr1-wrapped) v2 iAsset layout that are
 * absent from the v1 (Constr0, 9-field) record. Surfaced separately so the v1
 * view stays unchanged. Every field here is structurally derived from the live
 * on-chain datum (see parseIAssetContentV2) and is optional/nullable so the
 * tolerant parser never has to assert a fixed presence.
 */
export interface IAssetV2Extras {
  /**
   * Quote/denomination AssetClass the iAsset is priced against (field [1]).
   * ("","") = ADA; e.g. (1f3aec…, "USDCx") for the iAsset/USDCx market,
   * (0691b2…, "NIGHT") for the iAsset/NIGHT market.
   */
  pricePairAsset: AssetClass | null;
  /**
   * Price-oracle reference (field [3]) — a Constr enum whose live arm is ctor 2
   * carrying a single 28-byte hash (the oracle NFT policy / oracle script hash).
   * V1's iaPrice was `Either OnChainDecimal OracleAssetNFT`; v2 widened it.
   */
  priceOracle: { ctor: number; hash: string | null } | null;
  /**
   * Interest-oracle AssetClass (field [4]) — policy + token name ending
   * "_INTEREST" / "_INTEREST_ORACLE" (e.g. "iSOL_INTEREST").
   */
  interestOracleAsset: AssetClass | null;
  /** Bare Int parameter in field [8] (1e7 / 1e8 fixed-point fee/limit param). */
  param: bigint | null;
  /** Boolean flag in field [9] (Constr0=False / Constr1=True). */
  flag9: boolean | null;
  /**
   * Field [10] is an Option<AssetClass>: Just(assetClass) = Constr0[Constr0[AC]],
   * Nothing = Constr1[]. When present the AssetClass matches the v2 price-pair
   * asset family (e.g. (…,"USDCx")). null here means absent/unparseable.
   */
  optAsset10: { present: boolean; asset: AssetClass | null };
}

export interface IAssetConfig {
  role: "iasset";
  /** "v1" = Constr0/9-field record; "v2" = Constr1/11-field record. */
  layout: "v1" | "v2";
  assetName: string;
  /** Price-source index carried as a plain Int in field [1]. */
  priceSource: bigint;
  /** Five positional Rational (num/den) parameters: ratios + fee fractions. */
  ratios: Rational[];
  /** Boolean flag in field [7]. */
  flag: boolean;
  /** Linked-list pointer to the next iAsset name (hex), or null (Nothing). */
  nextIAsset: string | null;
  /** Extra v2-only fields; null on the v1 layout. */
  v2: IAssetV2Extras | null;
}

function parseIAssetContent(content: PD): IAssetConfig {
  const c = asConstr(content);
  if (c.tag !== 0) throw new Error(`IAssetContent: expected Constr0, got ${c.tag}`);
  if (c.fields.length !== 9) {
    throw new Error(`IAssetContent: expected 9 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    role: "iasset",
    layout: "v1",
    assetName: asBytes(f[0]),
    priceSource: asInt(f[1]),
    ratios: [
      parseRational(f[2]),
      parseRational(f[3]),
      parseRational(f[4]),
      parseRational(f[5]),
      parseRational(f[6]),
    ],
    flag: asBool(f[7]),
    nextIAsset: asOptional(f[8], asBytes),
    v2: null,
  };
}

// iAsset config "v2" — the NEWER on-chain layout, wrapped in a top-level
// Constr 1 (the v1 layout above is Constr 0). Live mainnet shape (verified
// across the full iAsset set — iETH/iBTC/iEUR/iJPY/iSOL/iUSD, all 11 fields):
//
//   Constr0[
//     [0]  ByteArray   iAsset name (e.g. "iETH")
//     [1]  AssetClass  quote/denomination asset the iAsset is priced AGAINST
//                      (("","")=ADA; (…,"USDCx"); (…,"NIGHT")) — the market pair
//     [2]  Int         small price-source kind/flag (always 0 observed)
//     [3]  Constr<n>[ByteArray]  price oracle ref; live arm is Constr2[hash28]
//                      (V1's iaPrice = Either OnChainDecimal OracleAssetNFT,
//                       widened to a 3-arm enum here — the hash is the oracle
//                       NFT policy / oracle script hash)
//     [4]  AssetClass  interest-oracle token (name ends "_INTEREST" /
//                      "_INTEREST_ORACLE", e.g. "iSOL_INTEREST")
//     [5]  Rational    collateral / maintenance ratio (e.g. 1.5 = 150%)
//     [6]  Rational    second ratio (≈1.15 — liquidation ratio)
//     [7]  Rational    third ratio (≈1.10 — redemption ratio)
//     [8]  Int         fixed-point fee/limit parameter (1e7 / 1e8)
//     [9]  Bool         flag (Constr0=False / Constr1=True)
//     [10] Option<AssetClass>  Just=Constr0[Constr0[AC]] / Nothing=Constr1[]
//                      (live: Just(…,"USDCx") or Nothing)
//   ]
//
// The layout above is now stable on chain, but to stay robust against any
// future revision this parser remains TOLERANT: it reads each field
// positionally, never throws, and leaves a slot null when its shape does not
// match — so the UI always renders a useful view plus the raw datum.
function v2Bool(d: PD | undefined): boolean | null {
  if (d === undefined) return null;
  try {
    return asBool(d);
  } catch {
    return null;
  }
}

function v2AssetClass(d: PD | undefined): AssetClass | null {
  if (d === undefined) return null;
  try {
    return parseAssetClass(d);
  } catch {
    return null;
  }
}

function parseIAssetContentV2(content: PD): IAssetConfig {
  const c = asConstr(content);
  const f = c.fields;
  const assetName = (() => {
    try {
      return f[0] !== undefined && isBytes(f[0]) ? asBytes(f[0]) : "";
    } catch {
      return "";
    }
  })();
  // Collect every Rational (Constr0[Int, Int]). An AssetClass is also
  // Constr0[_,_] but with byte fields, so parseRational rejects it.
  const ratios: Rational[] = [];
  for (const x of f) {
    try {
      ratios.push(parseRational(x));
    } catch {
      // not a Rational
    }
  }
  // priceSource = the first bare Int (field [2] in the live layout).
  let priceSource = BigInt(0);
  for (const x of f) {
    try {
      priceSource = asInt(x);
      break;
    } catch {
      // not a bare Int
    }
  }
  // Positional v2-only fields (see layout comment above).
  const pricePairAsset = v2AssetClass(f[1]);
  let priceOracle: { ctor: number; hash: string | null } | null = null;
  if (f[3] !== undefined && isConstr(f[3])) {
    const oc = asConstr(f[3]);
    let hash: string | null = null;
    if (oc.fields[0] !== undefined && isBytes(oc.fields[0])) {
      try {
        hash = asBytes(oc.fields[0]);
      } catch {
        hash = null;
      }
    }
    priceOracle = { ctor: oc.tag, hash };
  }
  const interestOracleAsset = v2AssetClass(f[4]);
  // The trailing bare-Int parameter (field [8]) — distinct from priceSource:
  // take the LAST bare Int in the record so we don't re-grab field [2].
  let param: bigint | null = null;
  for (let i = f.length - 1; i >= 0; i--) {
    if (f[i] !== undefined && (f[i] as { int?: unknown }).int !== undefined) {
      try {
        param = asInt(f[i]);
        break;
      } catch {
        // keep scanning
      }
    }
  }
  // Field [10] is an Option<AssetClass>: Just = Constr0[AssetClass], Nothing =
  // Constr1[]. Decode both presence and the wrapped AssetClass (if any).
  let optAsset10: { present: boolean; asset: AssetClass | null } = { present: false, asset: null };
  if (f[10] !== undefined && isConstr(f[10])) {
    const oc = asConstr(f[10]);
    if (oc.tag === 0) {
      optAsset10 = { present: true, asset: oc.fields[0] !== undefined ? v2AssetClass(oc.fields[0]) : null };
    } else {
      optAsset10 = { present: false, asset: null };
    }
  }
  return {
    role: "iasset",
    layout: "v2",
    assetName,
    priceSource,
    ratios,
    flag: false,
    nextIAsset: null,
    v2: {
      pricePairAsset,
      priceOracle,
      interestOracleAsset,
      param,
      flag9: v2Bool(f[9]),
      optAsset10,
    },
  };
}

// --- top-level CDPDatum (enum / variant by constructor) ---------------------

export type CDPDatum = CDPPosition | IAssetConfig;

export type IndigoRole = "cdp" | "iasset";

/**
 * Parse a top-level Indigo datum. The on-chain shapes are:
 *   Constr0[ content(5 fields) ]  → CDP position
 *   Constr0[ content(9 fields) ]  → iAsset config v1
 *   Constr1[ content(11 fields) ] → iAsset config v2
 * so the variant is decided by the top-level constructor + inner field count,
 * NOT by the matched-address role (a Constr1 iAsset datum can even appear at the
 * CDP validator). The `role` hint is only a tie-breaker for unexpected shapes.
 */
export function parseCDPDatum(d: PD, role: IndigoRole = "cdp"): CDPDatum {
  const c = asConstr(d);
  if (c.fields.length !== 1) {
    throw new Error(`Indigo datum: expected 1 content field, got ${c.fields.length}`);
  }
  if (c.tag === 1) return parseIAssetContentV2(c.fields[0]);
  if (c.tag !== 0) throw new Error(`Indigo datum: unexpected top-level ctor ${c.tag}`);
  // Constr0: discriminate CDP (5 fields) vs iAsset v1 (9 fields) by inner arity.
  let inner: number | null = null;
  try {
    inner = asConstr(c.fields[0]).fields.length;
  } catch {
    inner = null;
  }
  if (inner === 5) return parseCDPContent(c.fields[0]);
  if (inner === 9) return parseIAssetContent(c.fields[0]);
  return role === "iasset" ? parseIAssetContent(c.fields[0]) : parseCDPContent(c.fields[0]);
}

// --- CDP spending validator redeemer (CDPRedeemer) -------------------------
//
// The CDP spending validator (ff0b10bf…) constructor table is:
//
//   ctor 3 → AdjustCDP   [ Int posixDeadlineMs, Constr0[ Int ] ]
//            field[0] is a POSIX-ms validity/oracle deadline (~1.78e12);
//            field[1] is a nested Constr0[Int] (mint/collateral delta).
//   ctor 4 → MergeCDPs        []
//   ctor 5 → MergeAuxiliary
//   ctor 6 → Liquidate        []
//   ctor 7 → Upgrade (governance iAsset param rewrite)
//   ctor 8 → Upgrade [ Int ]  (collateral-asset NFT / version migration; the
//            single Int is a small selector, 0..3)
//   ctor 0,1,2 → rare (likely open-time adjust / CloseCDP / Freeze). Labelled
//            conservatively, NOT guessed.

export type CDPRedeemer =
  | { kind: "AdjustCDP"; deadlineMs: bigint; inner: bigint | null; fields: PD[] }
  | { kind: "MergeCDPs"; fields: PD[] }
  | { kind: "MergeAuxiliary"; fields: PD[] }
  | { kind: "Liquidate"; fields: PD[] }
  | { kind: "UpgradeAsset"; fields: PD[] }
  | { kind: "UpgradeVersion"; selector: bigint | null; fields: PD[] }
  | { kind: "Unknown"; tag: number; label: string | null; fields: PD[] };

// Conservative labels for the rare/unobserved low arms — these are NOT asserted
// shapes, just human-readable hints so the UI never shows a bare ctor number.
const RARE_ARM_LABELS: Record<number, string> = {
  0: "CDP action 0",
  1: "CDP action 1",
  2: "CDP action 2",
};

/** Try to read an Int from a PD that may be a bare Int or a Constr0[Int]. */
function intOrNull(d: PD | undefined): bigint | null {
  if (d === undefined) return null;
  try {
    return asInt(d);
  } catch {
    try {
      const c = asConstr(d);
      if (c.fields.length >= 1) return asInt(c.fields[0]);
    } catch {
      // fall through
    }
    return null;
  }
}

export function parseCDPRedeemer(d: PD): CDPRedeemer {
  const c = asConstr(d);
  switch (c.tag) {
    case 3:
      // AdjustCDP [ Int posixDeadlineMs, Constr0[Int] ].
      return {
        kind: "AdjustCDP",
        deadlineMs: c.fields.length >= 1 ? asInt(c.fields[0]) : BigInt(0),
        inner: intOrNull(c.fields[1]),
        fields: c.fields,
      };
    case 4:
      return { kind: "MergeCDPs", fields: c.fields };
    case 5:
      return { kind: "MergeAuxiliary", fields: c.fields };
    case 6:
      return { kind: "Liquidate", fields: c.fields };
    case 7:
      return { kind: "UpgradeAsset", fields: c.fields };
    case 8:
      // Upgrade / version migration [ Int selector ] (0..3).
      return {
        kind: "UpgradeVersion",
        selector: intOrNull(c.fields[0]),
        fields: c.fields,
      };
    default:
      return {
        kind: "Unknown",
        tag: c.tag,
        label: RARE_ARM_LABELS[c.tag] ?? null,
        fields: c.fields,
      };
  }
}

// --- CDPCreator validator redeemer (separate helper script address) --------
//
// NOTE: the CDPCreator validator is a DIFFERENT address from the CDP role; this
// parser is exported for completeness (e.g. decoding a CreateCDP redeemer seen
// in the same tx) but is not wired into matchScriptHash.
// CDPCreatorRedeemer is an Enum.

export type CDPCreatorRedeemer =
  | { kind: "CreateCDP"; cdpOwner: string; minted: bigint; collateral: bigint; currentTime: bigint }
  | { kind: "UpgradeCreatorVersion" }
  | { kind: "Unknown"; tag: number; fields: PD[] };

export function parseCDPCreatorRedeemer(d: PD): CDPCreatorRedeemer {
  const c = asConstr(d);
  if (c.tag === 0 && c.fields.length === 4) {
    return {
      kind: "CreateCDP",
      cdpOwner: asBytes(c.fields[0]),
      minted: asInt(c.fields[1]),
      collateral: asInt(c.fields[2]),
      currentTime: asInt(c.fields[3]),
    };
  }
  if (c.tag === 1 && c.fields.length === 0) return { kind: "UpgradeCreatorVersion" };
  return { kind: "Unknown", tag: c.tag, fields: c.fields };
}

// --- light validation -------------------------------------------------------

import type { DexIssue } from "@/utils/protocols/dex/registry";

export function validateCDPDatum(datum: CDPDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (datum.role === "cdp") {
    if (datum.frozen) {
      issues.push({
        severity: "warning",
        message: "CDP owner is Nothing — position is FROZEN / liquidatable",
      });
    }
    if (datum.mintedAmt < BigInt(0)) {
      issues.push({ severity: "error", message: "mintedAmt (debt) is negative" });
    }
    if (datum.frozen && datum.cdpFees.kind === "ActiveInterestTracking") {
      issues.push({
        severity: "info",
        message: "Frozen CDP still carries active-interest fees (expected FrozenCDPAccumulatedFees)",
      });
    }
  } else {
    for (const r of datum.ratios) {
      if (r.denominator === BigInt(0)) {
        issues.push({ severity: "error", message: "iAsset ratio has zero denominator" });
        break;
      }
    }
  }
  return issues;
}
