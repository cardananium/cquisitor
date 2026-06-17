// WingRiders V2 datum parsers.
//
// Every type uses the `Constr 121+alt` tag scheme — but cquisitor-lib's
// DetailedSchema decode normalizes those to a 0-based `constructor` index, so the
// generic `asConstr` helper reads them directly.
//
// Two gotchas baked in below:
//   • AssetClass is NOT a nested Constr/list inside these datums — it is FOUR
//     flat ByteArray fields (symbol, token, symbol, token).
//   • The request action lives in the DATUM (field 10), not a spend redeemer.

import {
  asBytes,
  asConstr,
  asInt,
  parseAssetClass,
  parsePlutusAddress,
  type AssetClass,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";

export type WrSwapDirection = "AToB" | "BToA";

export type WrRequestAction =
  | { kind: "Swap"; direction: WrSwapDirection; minWantedTokens: bigint }
  | { kind: "AddLiquidity"; minWantedShares: bigint }
  | { kind: "WithdrawLiquidity"; minWantedA: bigint; minWantedB: bigint }
  | { kind: "ExtractTreasury" }
  | { kind: "AddStakingRewards" }
  | { kind: "ExtractProjectTreasury" }
  | { kind: "ExtractReserveTreasury" };

export type WrDatumType = "NoDatum" | "DatumHash" | "InlineDatum";

export interface WrRequestDatum {
  oil: bigint;
  beneficiary: PlutusAddress;
  ownerAddress: PlutusAddress;
  compensationDatum: PD;
  datumType: WrDatumType;
  deadline: bigint;
  assetA: AssetClass;
  assetB: AssetClass;
  action: WrRequestAction;
  scaleA: bigint;
  scaleB: bigint;
}

export type WrPoolSpecifics =
  | { kind: "ConstantProduct" }
  | { kind: "Stableswap"; parameterD: bigint; scaleA: bigint; scaleB: bigint };

export interface WrPoolDatum {
  requestValidatorHash: string;
  assetA: AssetClass;
  assetB: AssetClass;
  swapFeeInBasis: bigint;
  protocolFeeInBasis: bigint;
  projectFeeInBasis: bigint;
  reserveFeeInBasis: bigint;
  feeBasis: bigint;
  agentFeeAda: bigint;
  lastInteraction: bigint;
  treasuryA: bigint;
  treasuryB: bigint;
  projectTreasuryA: bigint;
  projectTreasuryB: bigint;
  reserveTreasuryA: bigint;
  reserveTreasuryB: bigint;
  projectBeneficiary: PlutusAddress | null;
  reserveBeneficiary: PlutusAddress | null;
  poolSpecifics: WrPoolSpecifics;
}

// --- Sub-parsers -----------------------------------------------------------

function parseSwapDirection(d: PD): WrSwapDirection {
  const c = asConstr(d);
  if (c.tag === 0) return "AToB";
  if (c.tag === 1) return "BToA";
  throw new Error(`SwapDirection: unexpected ctor ${c.tag}`);
}

function parseRequestAction(d: PD): WrRequestAction {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "Swap", direction: parseSwapDirection(c.fields[0]), minWantedTokens: asInt(c.fields[1]) };
    case 1:
      return { kind: "AddLiquidity", minWantedShares: asInt(c.fields[0]) };
    case 2:
      return { kind: "WithdrawLiquidity", minWantedA: asInt(c.fields[0]), minWantedB: asInt(c.fields[1]) };
    case 3:
      return { kind: "ExtractTreasury" };
    case 4:
      return { kind: "AddStakingRewards" };
    case 5:
      return { kind: "ExtractProjectTreasury" };
    case 6:
      return { kind: "ExtractReserveTreasury" };
    default:
      throw new Error(`RequestAction: unexpected ctor ${c.tag}`);
  }
}

function parseDatumType(d: PD): WrDatumType {
  const c = asConstr(d);
  if (c.tag === 0) return "NoDatum";
  if (c.tag === 1) return "DatumHash";
  if (c.tag === 2) return "InlineDatum";
  throw new Error(`DatumType: unexpected ctor ${c.tag}`);
}

// MaybeAddress: JustAddress = Constr 0 [Address], Nothing = Constr 1 [].
function parseMaybeAddress(d: PD): PlutusAddress | null {
  const c = asConstr(d);
  if (c.tag === 0) return parsePlutusAddress(c.fields[0]);
  if (c.tag === 1) return null;
  throw new Error(`MaybeAddress: unexpected ctor ${c.tag}`);
}

function parsePoolSpecifics(d: PD): WrPoolSpecifics {
  const c = asConstr(d);
  // Both variants are Constr 0; disambiguate by field count.
  if (c.fields.length === 0) return { kind: "ConstantProduct" };
  if (c.fields.length === 3) {
    return {
      kind: "Stableswap",
      parameterD: asInt(c.fields[0]),
      scaleA: asInt(c.fields[1]),
      scaleB: asInt(c.fields[2]),
    };
  }
  throw new Error(`PoolSpecifics: unexpected field count ${c.fields.length}`);
}

// --- Top-level parsers -----------------------------------------------------

export function parseWrRequestDatum(data: PD): WrRequestDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`WrRequestDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 13) {
    throw new Error(`WrRequestDatum: expected 13 fields, got ${c.fields.length}`);
  }
  return {
    oil: asInt(c.fields[0]),
    beneficiary: parsePlutusAddress(c.fields[1]),
    ownerAddress: parsePlutusAddress(c.fields[2]),
    compensationDatum: c.fields[3],
    datumType: parseDatumType(c.fields[4]),
    deadline: asInt(c.fields[5]),
    assetA: { policyId: asBytes(c.fields[6]), assetName: asBytes(c.fields[7]) },
    assetB: { policyId: asBytes(c.fields[8]), assetName: asBytes(c.fields[9]) },
    action: parseRequestAction(c.fields[10]),
    scaleA: asInt(c.fields[11]),
    scaleB: asInt(c.fields[12]),
  };
}

export function parseWrPoolDatum(data: PD): WrPoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`WrPoolDatum: unexpected ctor ${c.tag}`);
  // Current mainnet layout is the canonical 21-field record.
  if (c.fields.length !== 21) {
    throw new Error(`WrPoolDatum: expected 21 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    requestValidatorHash: asBytes(f[0]),
    assetA: { policyId: asBytes(f[1]), assetName: asBytes(f[2]) },
    assetB: { policyId: asBytes(f[3]), assetName: asBytes(f[4]) },
    swapFeeInBasis: asInt(f[5]),
    protocolFeeInBasis: asInt(f[6]),
    projectFeeInBasis: asInt(f[7]),
    reserveFeeInBasis: asInt(f[8]),
    feeBasis: asInt(f[9]),
    agentFeeAda: asInt(f[10]),
    lastInteraction: asInt(f[11]),
    treasuryA: asInt(f[12]),
    treasuryB: asInt(f[13]),
    projectTreasuryA: asInt(f[14]),
    projectTreasuryB: asInt(f[15]),
    reserveTreasuryA: asInt(f[16]),
    reserveTreasuryB: asInt(f[17]),
    projectBeneficiary: parseMaybeAddress(f[18]),
    reserveBeneficiary: parseMaybeAddress(f[19]),
    poolSpecifics: parsePoolSpecifics(f[20]),
  };
}

// --- LIVE mainnet nested layout (LiquidityPoolDatumV1 / RequestDatumV1) -----
//
// IMPORTANT: the flat 21-/13-field shape parsed above is NOT what is deployed.
// For BOTH the constant-product policy (026a18d0…) and the stableswap policy
// (980e8c56…), every WingRiders pool and request UTxO uses the NESTED *V1*
// layout (LiquidityPoolDatumV1 / RequestDatumV1). AssetClass here is a nested
// Constr0[policy, name], NOT four flat fields. We dispatch by field count
// (2 = nested, 13/21 = flat) in the adapter.

export interface WrNestedPoolDatum {
  /** Hash of the request validator this pool batches against (datum field 0). */
  requestValidatorHash: string;
  assetA: AssetClass;
  assetB: AssetClass;
  lastInteraction: bigint;
  treasuryA: bigint;
  treasuryB: bigint;
}

// LiquidityPoolDatumV1 = Constr0[ requestScriptHash:ByteArray,
//   lpState:Constr0[ lp:Constr0[assetA:AssetClass, assetB:AssetClass],
//     lastInteracted:Int, treasuryA:Int, treasuryB:Int ] ]
export function parseWrNestedPoolDatum(data: PD): WrNestedPoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0 || c.fields.length !== 2) {
    throw new Error(`WrNestedPoolDatum: expected ctor 0 with 2 fields, got ${c.fields.length}`);
  }
  const state = asConstr(c.fields[1]);
  if (state.fields.length < 4) {
    throw new Error(`WrNestedPoolDatum: lpState expected ≥4 fields, got ${state.fields.length}`);
  }
  const lp = asConstr(state.fields[0]);
  return {
    requestValidatorHash: asBytes(c.fields[0]),
    assetA: parseAssetClass(lp.fields[0]),
    assetB: parseAssetClass(lp.fields[1]),
    lastInteraction: asInt(state.fields[1]),
    treasuryA: asInt(state.fields[2]),
    treasuryB: asInt(state.fields[3]),
  };
}

export interface WrNestedRequestDatum {
  beneficiary: PlutusAddress;
  /** Owner pubkey hash (a bare ByteArray, not an Address). */
  owner: string;
  deadline: bigint;
  assetA: AssetClass;
  assetB: AssetClass;
  action: WrRequestAction;
}

// RequestDatumV1 = Constr0[ metadata, action ] where
//   metadata = Constr0[ beneficiary:Address, owner:ByteArray(PKH), deadline:Int,
//     lp:Constr0[assetA:AssetClass, assetB:AssetClass] ]
//   action = SwapAction(Constr0[direction, minWanted]) (direction AToB=Constr0/BToA=Constr1)
//          | AddLiquidityAction(Constr1[minWantedShares])
//          | RemoveLiquidityAction(Constr2[minWantedA, minWantedB])
function parseNestedAction(d: PD): WrRequestAction {
  const c = asConstr(d);
  if (c.tag === 0) {
    const dir = asConstr(c.fields[0]);
    return {
      kind: "Swap",
      direction: dir.tag === 1 ? "BToA" : "AToB",
      minWantedTokens: asInt(c.fields[1]),
    };
  }
  if (c.tag === 1) return { kind: "AddLiquidity", minWantedShares: asInt(c.fields[0]) };
  if (c.tag === 2) {
    return { kind: "WithdrawLiquidity", minWantedA: asInt(c.fields[0]), minWantedB: asInt(c.fields[1]) };
  }
  // Treasury / staking actions carry no fields (same arms as the flat
  // parseRequestAction).
  if (c.tag === 3) return { kind: "ExtractTreasury" };
  if (c.tag === 4) return { kind: "AddStakingRewards" };
  if (c.tag === 5) return { kind: "ExtractProjectTreasury" };
  if (c.tag === 6) return { kind: "ExtractReserveTreasury" };
  throw new Error(`WrNestedRequest action: unexpected ctor ${c.tag}`);
}

export function parseWrNestedRequestDatum(data: PD): WrNestedRequestDatum {
  const c = asConstr(data);
  if (c.tag !== 0 || c.fields.length !== 2) {
    throw new Error(`WrNestedRequestDatum: expected ctor 0 with 2 fields, got ${c.fields.length}`);
  }
  const meta = asConstr(c.fields[0]);
  if (meta.fields.length !== 4) {
    throw new Error(`WrNestedRequestDatum: metadata expected 4 fields, got ${meta.fields.length}`);
  }
  const lp = asConstr(meta.fields[3]);
  return {
    beneficiary: parsePlutusAddress(meta.fields[0]),
    owner: asBytes(meta.fields[1]),
    deadline: asInt(meta.fields[2]),
    assetA: parseAssetClass(lp.fields[0]),
    assetB: parseAssetClass(lp.fields[1]),
    action: parseNestedAction(c.fields[1]),
  };
}
