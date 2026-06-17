// Butane Synthetics — typed datum/redeemer parsers (Plutus V3).
//
// All Constr alternative tags below are DECLARATION-order indices (0-based),
// which is exactly what cquisitor-lib's DetailedSchema decode normalizes the
// `121+i` CBOR constructor tag to — so `asConstr().tag` reads them directly.
//
// Encoding notes baked in below:
//   • Pair(a,b) / 2-tuple  = Constr 0 [a, b]
//   • Option<T>            = Some Constr0[x] / None Constr1[]   (asOptional)
//   • Bool                 = False Constr0[] / True Constr1[]   (asBool)
//   • AssetClass           = Constr 0 [policy(28), name]  → parseAssetClass
//   • StakeCredential      = standard Cardano Inline/Pointer  → parseStakeCredential
//
// The "vault" role keys on MonoDatum Constr 1 (CDP). Per-synth params live in a
// separate ParamsWrapper UTxO (Constr 0) referenced by params_idx in the spend
// redeemer, so a CDP datum alone cannot compute a collateral ratio — we surface
// the raw CDP fields and leave correlation to a higher layer.

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  asBool,
  parseAssetClass,
  parseStakeCredential,
  type AssetClass,
  type PD,
  type Rational,
  type StakeCredential,
} from "@/utils/protocols/dex/plutusData";

// --- shared sub-types ------------------------------------------------------

// AssetClass in Butane is a FLATTENED 2-field Constr0[policy, name],
// which is exactly the shared parseAssetClass shape. Re-export for clarity.
export type { AssetClass } from "@/utils/protocols/dex/plutusData";

// Constraint
export type ButaneConstraint =
  | { kind: "MustSpendToken"; asset: AssetClass }
  | { kind: "MustWithdrawFrom"; stake: StakeCredential };

export function parseConstraint(d: PD): ButaneConstraint {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "MustSpendToken", asset: parseAssetClass(c.fields[0]) };
  if (c.tag === 1) return { kind: "MustWithdrawFrom", stake: parseStakeCredential(c.fields[0]) };
  throw new Error(`Butane Constraint: unexpected ctor ${c.tag}`);
}

// CDPCredential — the `owner` field
export type CDPCredential =
  | { kind: "AuthorizeWithPubKey"; pubKeyHash: string; verificationKey: string }
  | { kind: "AuthorizeWithConstraint"; constraint: ButaneConstraint };

export function parseCDPCredential(d: PD): CDPCredential {
  const c = asConstr(d);
  if (c.tag === 0) {
    return {
      kind: "AuthorizeWithPubKey",
      pubKeyHash: asBytes(c.fields[0]),
      verificationKey: asBytes(c.fields[1]),
    };
  }
  if (c.tag === 1) {
    return { kind: "AuthorizeWithConstraint", constraint: parseConstraint(c.fields[0]) };
  }
  throw new Error(`Butane CDPCredential: unexpected ctor ${c.tag}`);
}

// Pair(PosixTime, Int) — on-chain this is a 2-element List [Int, Int], NOT a
// Constr. `Pair<a, b>` is encoded as a CBOR array (List), distinct from a
// 2-tuple Constr.
export function parseIntPair(d: PD): Rational {
  const items = asList(d);
  if (items.length !== 2) throw new Error("Butane Pair: expected 2 list items");
  return { numerator: asInt(items[0]), denominator: asInt(items[1]) };
}

// TreasuryDebt = Constr0[amount, asset(name)]
export interface TreasuryDebt {
  amount: bigint;
  asset: string;
}
export function parseTreasuryDebt(d: PD): TreasuryDebt {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`Butane TreasuryDebt: unexpected ctor ${c.tag}`);
  return { amount: asInt(c.fields[0]), asset: asBytes(c.fields[1]) };
}

// --- ActiveParams — Constr0, 11 ordered fields -----------

export interface ActiveParams {
  collateralAssets: AssetClass[];
  weights: bigint[];
  denominator: bigint;
  minimumOutstandingSynthetic: bigint;
  interestRates: Rational[]; // Pair(PosixTime, Int)
  maxProportions: bigint[];
  maxLiquidationReturn: bigint;
  treasuryLiquidationShare: bigint;
  redemptionShare: bigint;
  feeTokenDiscount: bigint;
  stakingInterestRates: Rational[]; // Pair(PosixTime, Int)
}

export function parseActiveParams(d: PD): ActiveParams {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`Butane ActiveParams: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 11) throw new Error(`Butane ActiveParams: expected 11 fields, got ${f.length}`);
  return {
    collateralAssets: asList(f[0]).map(parseAssetClass),
    weights: asList(f[1]).map(asInt),
    denominator: asInt(f[2]),
    minimumOutstandingSynthetic: asInt(f[3]),
    interestRates: asList(f[4]).map(parseIntPair),
    maxProportions: asList(f[5]).map(asInt),
    maxLiquidationReturn: asInt(f[6]),
    treasuryLiquidationShare: asInt(f[7]),
    redemptionShare: asInt(f[8]),
    feeTokenDiscount: asInt(f[9]),
    stakingInterestRates: asList(f[10]).map(parseIntPair),
  };
}

// Params
export type ButaneParams =
  | { kind: "LiveParams"; params: ActiveParams }
  | { kind: "VoidedParams" };

export function parseParams(d: PD): ButaneParams {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "LiveParams", params: parseActiveParams(c.fields[0]) };
  if (c.tag === 1) return { kind: "VoidedParams" };
  throw new Error(`Butane Params: unexpected ctor ${c.tag}`);
}

// --- MonoDatum ------------------------------------------
// One datum at the pointers.spend script for ALL protocol UTxOs; discriminate by
// constructor index. We fully type the CDP (Constr 1, the vault) and ParamsWrapper
// (Constr 0); the remaining kinds are surfaced as raw passthroughs (their inner
// payloads — GovAction / TreasuryDatum — are large and only relevant outside the
// vault role).

export interface CDPDatum {
  kind: "CDP";
  owner: CDPCredential;
  syntheticAsset: string; // bare asset-name bytes (USDb/USDs/MIDAS) under synth policy
  syntheticAmount: bigint; // debt minted
  startTime: bigint; // CDP open time, PosixTime ms
}

export type MonoDatum =
  | { kind: "ParamsWrapper"; params: ButaneParams }
  | CDPDatum
  | { kind: "GovDatum"; raw: PD }
  | { kind: "TreasuryDatum"; raw: PD }
  | { kind: "CompatLockedTokens" }
  | {
      kind: "StakedSynthetics";
      owner: CDPCredential;
      syntheticAsset: string;
      startTime: bigint;
    };

export function parseMonoDatum(d: PD): MonoDatum {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "ParamsWrapper", params: parseParams(c.fields[0]) };
    case 1:
      return parseCDP(c.fields);
    case 2:
      // GovDatum [ gov: GovAction ] — surfaced raw (see parseGovAction below).
      return { kind: "GovDatum", raw: c.fields[0] };
    case 3:
      // TreasuryDatum [ treas: TreasuryDatum ] — surfaced raw.
      return { kind: "TreasuryDatum", raw: c.fields[0] };
    case 4:
      return { kind: "CompatLockedTokens" };
    case 5:
      return {
        kind: "StakedSynthetics",
        owner: parseCDPCredential(c.fields[0]),
        syntheticAsset: asBytes(c.fields[1]),
        startTime: asInt(c.fields[2]),
      };
    default:
      throw new Error(`Butane MonoDatum: unexpected ctor ${c.tag}`);
  }
}

function parseCDP(fields: PD[]): CDPDatum {
  if (fields.length !== 4) {
    throw new Error(`Butane CDP: expected 4 fields, got ${fields.length}`);
  }
  return {
    kind: "CDP",
    owner: parseCDPCredential(fields[0]),
    syntheticAsset: asBytes(fields[1]),
    syntheticAmount: asInt(fields[2]),
    startTime: asInt(fields[3]),
  };
}

// Parse strictly the vault/CDP datum; throws on any other MonoDatum kind.
export function parseCDPDatum(d: PD): CDPDatum {
  const m = parseMonoDatum(d);
  if (m.kind !== "CDP") {
    throw new Error(`Butane: expected CDP (MonoDatum Constr 1), got ${m.kind}`);
  }
  return m;
}

// LeftoversDatum — datum at leftovers.collect
export interface LeftoversDatum {
  owner: CDPCredential;
}
export function parseLeftoversDatum(d: PD): LeftoversDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`Butane LeftoversDatum: unexpected ctor ${c.tag}`);
  return { owner: parseCDPCredential(c.fields[0]) };
}

// --- Redeemers -------------------------------------------------------------

// SpendType
export type SpendType =
  | { kind: "LiquidateCDP" }
  | { kind: "PartialLiquidateCDP"; repayAmount: bigint }
  | { kind: "LeftoversLiquidateCDP" }
  | { kind: "RepayCDP"; verifier: PD } // CDPCredentialVerifier surfaced raw
  | { kind: "RedeemCDP" };

export function parseSpendType(d: PD): SpendType {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "LiquidateCDP" };
    case 1:
      return { kind: "PartialLiquidateCDP", repayAmount: asInt(c.fields[0]) };
    case 2:
      return { kind: "LeftoversLiquidateCDP" };
    case 3:
      return { kind: "RepayCDP", verifier: c.fields[0] };
    case 4:
      return { kind: "RedeemCDP" };
    default:
      throw new Error(`Butane SpendType: unexpected ctor ${c.tag}`);
  }
}

// FeeType
export type FeeType =
  | { kind: "FeeInSynthetic" }
  | { kind: "FeeInFeeToken"; feeTokenIdx: bigint };

export function parseFeeType(d: PD): FeeType {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "FeeInSynthetic" };
  if (c.tag === 1) return { kind: "FeeInFeeToken", feeTokenIdx: asInt(c.fields[0]) };
  throw new Error(`Butane FeeType: unexpected ctor ${c.tag}`);
}

// SpendAction — Constr0, 3 ordered fields
export interface SpendAction {
  spendType: SpendType;
  paramsIdx: bigint;
  feeType: FeeType;
}

export function parseSpendAction(d: PD): SpendAction {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`Butane SpendAction: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 3) {
    throw new Error(`Butane SpendAction: expected 3 fields, got ${c.fields.length}`);
  }
  return {
    spendType: parseSpendType(c.fields[0]),
    paramsIdx: asInt(c.fields[1]),
    feeType: parseFeeType(c.fields[2]),
  };
}

// PolicyRedeemer — the synthetics.validate WithdrawFrom redeemer
export type PolicyRedeemer =
  | { kind: "SyntheticsMain"; spends: SpendAction[]; creates: bigint[] }
  | { kind: "CollectVoidedCDP"; verifier: PD } // CDPCredentialVerifier surfaced raw
  | { kind: "BadDebt"; treasuryOutIdx: bigint }
  | { kind: "Auxilliary" };

export function parsePolicyRedeemer(d: PD): PolicyRedeemer {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return {
        kind: "SyntheticsMain",
        spends: asList(c.fields[0]).map(parseSpendAction),
        creates: asList(c.fields[1]).map(asInt),
      };
    case 1:
      return { kind: "CollectVoidedCDP", verifier: c.fields[0] };
    case 2:
      return { kind: "BadDebt", treasuryOutIdx: asInt(c.fields[0]) };
    case 3:
      return { kind: "Auxilliary" };
    default:
      throw new Error(`Butane PolicyRedeemer: unexpected ctor ${c.tag}`);
  }
}

// ControlAction — upgradeable.control_state mint/withdraw redeemer
export type ControlAction = { kind: "InitMint" } | { kind: "Upgrade" };
export function parseControlAction(d: PD): ControlAction {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "InitMint" };
  if (c.tag === 1) return { kind: "Upgrade" };
  throw new Error(`Butane ControlAction: unexpected ctor ${c.tag}`);
}

// PriceFeed — inner of each Feed in price_feed.check_feed
export interface PriceFeed {
  collateralPrices: bigint[];
  synthetic: string; // asset name
  denominator: bigint;
  validity: PD; // ValidityRange surfaced raw
}
export function parsePriceFeed(d: PD): PriceFeed {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`Butane PriceFeed: unexpected ctor ${c.tag}`);
  return {
    collateralPrices: asList(c.fields[0]).map(asInt),
    synthetic: asBytes(c.fields[1]),
    denominator: asInt(c.fields[2]),
    validity: c.fields[3],
  };
}

// --- light validation ------------------------------------------------------

import type { DexIssue } from "@/utils/protocols/dex/registry";

export function validateCDP(cdp: CDPDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (cdp.syntheticAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "CDP synthetic debt amount is not positive" });
  }
  if (cdp.startTime <= BigInt(0)) {
    issues.push({ severity: "warning", message: "CDP start_time is not set" });
  }
  if (cdp.syntheticAsset === "") {
    issues.push({
      severity: "info",
      message: "CDP synthetic_asset is empty — confirm against the synth policy",
    });
  }
  return issues;
}

// asBool re-exported so consumers needing Bool decoding don't import the barrel.
export { asBool };
