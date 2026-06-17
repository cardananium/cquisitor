// Optim Finance (OADA / sOADA liquid staking) datum + redeemer parsers.
//
// Shared encodings:
//   AssetClass / Id / Nft  = Constr 0 [Bytes policy, Bytes name]
//   Address                = the standard Cardano shape (parsePlutusAddress)
//   Option<X>              = Constr 0 [x] (Some) | Constr 1 [] (None)
//   OutputReference        = Constr 0 [ Constr0[Bytes tx_id], Int output_index ]
//
// The "bond" (Liquidity Bonds) product is NOT implemented here. decodeBond
// surfaces the raw datum as an opaque passthrough.

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  parseAssetClass,
  parsePlutusAddress,
  type AssetClass,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

// re-export the issue type from registry for the views; plutusData has none.
export type { DexIssue } from "@/utils/protocols/dex/registry";

// --------------------------------------------------------------------------
// ROLE "position" → BatchStakeDatum  (user stake/unstake order escrow)
// Constr 0 [ Bytes owner, <Address> ]
// --------------------------------------------------------------------------

export interface BatchStakeDatum {
  kind: "BatchStake";
  /** Blake2b-224 VKey/KeyHash (28 bytes hex) of the order owner. */
  owner: string;
  /** Where filled funds are returned. */
  returnAddress: PlutusAddress;
}

export function parseBatchStakeDatum(data: PD): BatchStakeDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`BatchStakeDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`BatchStakeDatum: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    kind: "BatchStake",
    owner: asBytes(c.fields[0]),
    returnAddress: parsePlutusAddress(c.fields[1]),
  };
}

// SPEND REDEEMER: BatchStakeRedeemer
//   tag 0  CancelStake                     -> Constr 0 []
//   tag 1  DigestStake(Int, Option<Int>)   -> Constr 1 [ Int, Option<Int> ]
export type BatchStakeRedeemer =
  | { kind: "CancelStake" }
  | { kind: "DigestStake"; returnIndex: bigint; continuingOrderIndex: bigint | null };

export function parseBatchStakeRedeemer(data: PD): BatchStakeRedeemer {
  const c = asConstr(data);
  if (c.tag === 0) {
    if (c.fields.length !== 0) {
      throw new Error(`CancelStake: expected 0 fields, got ${c.fields.length}`);
    }
    return { kind: "CancelStake" };
  }
  if (c.tag === 1) {
    if (c.fields.length !== 2) {
      throw new Error(`DigestStake: expected 2 fields, got ${c.fields.length}`);
    }
    return {
      kind: "DigestStake",
      returnIndex: asInt(c.fields[0]),
      continuingOrderIndex: asOptional(c.fields[1], asInt),
    };
  }
  throw new Error(`BatchStakeRedeemer: unexpected ctor ${c.tag}`);
}

// --------------------------------------------------------------------------
// ROLE "position" (pool / AMO singleton state datums)
// --------------------------------------------------------------------------

// StakingAmoDatum — Constr 0, 8 fields. The sOADA<->OADA rate state.
export interface StakingAmoDatum {
  kind: "StakingAmo";
  sotoken: string; // sOADA minting policy id (28 bytes hex) == soadaPolicyId
  sotokenAmount: bigint;
  sotokenBacking: bigint; // rate = sotokenAmount / sotokenBacking
  sotokenLimit: bigint;
  odaoFee: bigint;
  odaoSotoken: bigint;
  feeClaimer: AssetClass;
  feeClaimRule: string; // ScriptHash (28 bytes hex)
}

export function parseStakingAmoDatum(data: PD): StakingAmoDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`StakingAmoDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 8) {
    throw new Error(`StakingAmoDatum: expected 8 fields, got ${c.fields.length}`);
  }
  return {
    kind: "StakingAmo",
    sotoken: asBytes(c.fields[0]),
    sotokenAmount: asInt(c.fields[1]),
    sotokenBacking: asInt(c.fields[2]),
    sotokenLimit: asInt(c.fields[3]),
    odaoFee: asInt(c.fields[4]),
    odaoSotoken: asInt(c.fields[5]),
    feeClaimer: parseAssetClass(c.fields[6]),
    feeClaimRule: asBytes(c.fields[7]),
  };
}

// CollateralAmoDatum — Constr 0, 3 fields.
export interface CollateralAmoDatum {
  kind: "CollateralAmo";
  baseProfitUncommitted: bigint;
  stakingAmo: AssetClass; // Id
  childStrategies: AssetClass[];
}

export function parseCollateralAmoDatum(data: PD): CollateralAmoDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`CollateralAmoDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 3) {
    throw new Error(`CollateralAmoDatum: expected 3 fields, got ${c.fields.length}`);
  }
  return {
    kind: "CollateralAmo",
    baseProfitUncommitted: asInt(c.fields[0]),
    stakingAmo: parseAssetClass(c.fields[1]),
    childStrategies: asList(c.fields[2]).map(parseAssetClass),
  };
}

// StrategyDatum — Constr 0, 2 fields. strategy_data is opaque (raw Data).
export interface StrategyDatum {
  kind: "Strategy";
  baseProfit: bigint;
  strategyData: PD; // opaque
}

export function parseStrategyDatum(data: PD): StrategyDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`StrategyDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`StrategyDatum: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    kind: "Strategy",
    baseProfit: asInt(c.fields[0]),
    strategyData: c.fields[1],
  };
}

export type OptimDatum =
  | BatchStakeDatum
  | StakingAmoDatum
  | CollateralAmoDatum
  | StrategyDatum
  | { kind: "Unknown"; raw: PD };

// Best-effort discrimination among the position-role datums by field count/shape.
// BatchStakeDatum (2: Bytes, Address) vs StakingAmo (8) vs CollateralAmo (3) vs
// Strategy (2: Int, Data). All are Constr 0, so we sniff the fields.
export function parseOptimPositionDatum(data: PD): OptimDatum {
  const c = asConstr(data);
  if (c.tag !== 0) return { kind: "Unknown", raw: data };
  const n = c.fields.length;
  try {
    if (n === 8) return parseStakingAmoDatum(data);
    if (n === 3) return parseCollateralAmoDatum(data);
    if (n === 2) {
      // BatchStake = [Bytes owner, Address(Constr 0 [...])];
      // Strategy   = [Int base_profit, Data].
      const f0IsBytes = isBytesLike(c.fields[0]);
      const f1IsAddr = isAddressLike(c.fields[1]);
      if (f0IsBytes && f1IsAddr) return parseBatchStakeDatum(data);
      return parseStrategyDatum(data);
    }
  } catch {
    /* fall through to Unknown */
  }
  return { kind: "Unknown", raw: data };
}

function isBytesLike(d: PD): boolean {
  return typeof d === "object" && d !== null && "bytes" in d;
}

// An Address is Constr 0 with 2 fields (payment credential + Option stake).
function isAddressLike(d: PD): boolean {
  try {
    const c = asConstr(d);
    return c.tag === 0 && c.fields.length === 2 && !isBytesLike(c.fields[0]);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// REDEEMERS (OADA system)
// --------------------------------------------------------------------------

// sOADA / sotoken Mint redeemer — tuple (Int, Int) = Constr 0 [Int, Int].
// The OADA<->sOADA exchange rate at mint/burn time. THIS is the highest-value
// semantic redeemer: it labels a stake/unstake settlement and its rate.
export interface SotokenMintRedeemer {
  kind: "SotokenMint";
  sotokenBacking: bigint;
  sotokenAmount: bigint;
}

export function parseSotokenMintRedeemer(data: PD): SotokenMintRedeemer {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`SotokenMint: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`SotokenMint: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    kind: "SotokenMint",
    sotokenBacking: asInt(c.fields[0]),
    sotokenAmount: asInt(c.fields[1]),
  };
}

// CollateralAmoRedeemer (6 ctors).
export type CollateralAmoRedeemer =
  | { kind: "UpdateStakingAmo" }
  | { kind: "SpawnStrategy"; scriptHash: string; outRef: OutputReference }
  | { kind: "DespawnStrategy"; id: AssetClass }
  | { kind: "SyncStrategy"; id: AssetClass }
  | { kind: "MergeStakingRate" }
  | { kind: "MergeNewDeposits" };

export interface OutputReference {
  transactionId: string;
  outputIndex: bigint;
}

// OutputReference = Constr 0 [ Constr0[Bytes tx_id], Int output_index ]
export function parseOutputReference(data: PD): OutputReference {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`OutputReference: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`OutputReference: expected 2 fields, got ${c.fields.length}`);
  }
  const idC = asConstr(c.fields[0]);
  return {
    transactionId: asBytes(idC.fields[0]),
    outputIndex: asInt(c.fields[1]),
  };
}

export function parseCollateralAmoRedeemer(data: PD): CollateralAmoRedeemer {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      return { kind: "UpdateStakingAmo" };
    case 1:
      return {
        kind: "SpawnStrategy",
        scriptHash: asBytes(c.fields[0]),
        outRef: parseOutputReference(c.fields[1]),
      };
    case 2:
      return { kind: "DespawnStrategy", id: parseAssetClass(c.fields[0]) };
    case 3:
      return { kind: "SyncStrategy", id: parseAssetClass(c.fields[0]) };
    case 4:
      return { kind: "MergeStakingRate" };
    case 5:
      return { kind: "MergeNewDeposits" };
    default:
      throw new Error(`CollateralAmoRedeemer: unexpected ctor ${c.tag}`);
  }
}

// IdMintRedeemer (NFT id mint/burn).
//   0 MintId{out_ref}  -> Constr 0 [ OutputReference ]
//   1 BurnId           -> Constr 1 []
export type IdMintRedeemer =
  | { kind: "MintId"; outRef: OutputReference }
  | { kind: "BurnId" };

export function parseIdMintRedeemer(data: PD): IdMintRedeemer {
  const c = asConstr(data);
  if (c.tag === 0) return { kind: "MintId", outRef: parseOutputReference(c.fields[0]) };
  if (c.tag === 1) return { kind: "BurnId" };
  throw new Error(`IdMintRedeemer: unexpected ctor ${c.tag}`);
}

// --------------------------------------------------------------------------
// ROLE "bond" → datum layout not decoded.
// We do NOT fabricate a datum layout; surface the raw datum as an opaque
// passthrough so the UI can still show *something* without claiming false
// field semantics.
// --------------------------------------------------------------------------

export interface OptimBondDatum {
  kind: "BondUnsupported";
  raw: PD;
}

export function parseOptimBondDatum(data: PD): OptimBondDatum {
  return { kind: "BondUnsupported", raw: data };
}

// --------------------------------------------------------------------------
// Light validation helpers (DexIssue[]).
// --------------------------------------------------------------------------

const HEX28 = /^[0-9a-f]{56}$/;

export function validateBatchStake(d: BatchStakeDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (!HEX28.test(d.owner.toLowerCase())) {
    issues.push({
      severity: "warning",
      message: `owner is not a 28-byte key hash (got ${d.owner.length / 2} bytes)`,
    });
  }
  return issues;
}

export function validateStakingAmo(d: StakingAmoDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (d.sotokenBacking <= BigInt(0)) {
    issues.push({ severity: "warning", message: "sotoken_backing is non-positive; rate undefined" });
  }
  if (d.sotokenAmount < BigInt(0) || d.sotokenBacking < BigInt(0)) {
    issues.push({ severity: "warning", message: "negative sotoken amount/backing" });
  }
  return issues;
}
