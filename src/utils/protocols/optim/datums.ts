// Optim Finance (OADA / sOADA liquid staking + Epoch Stake Auction) datum +
// redeemer parsers.
//
// Shared encodings:
//   AssetClass / Id / Nft  = Constr 0 [Bytes policy, Bytes name]
//   Credential             = VerificationKey(hash) (ctor 0) | Script(hash) (ctor 1)
//   Address                = the standard Cardano shape (parsePlutusAddress)
//   Option<X>              = Constr 0 [x] (Some) | Constr 1 [] (None)
//   OutputReference        = Constr 0 [ Constr0[Bytes tx_id], Int output_index ]
//
// FIELD SCHEMAS — SOURCES:
//   * `optim/types/oada.ak`, `batch_stake.ak`, `staking_amo.ak`, `types.ak` in
//     OptimFinance/clean-code (public, Anastasia-Labs–audited) give the OADA
//     names (sotoken / sotoken_amount / sotoken_backing / odao_fee /
//     fee_claimer / fee_claim_rule, BatchStakeDatum{owner, return_address}).
//   * The DEPLOYED mainnet validators are the GENERALISED "otoken framework"
//     (no public repo at this version). The 15-field staking AMO is the
//     generalised StakingAmoDatum (the 8-field clean-code form plus base-asset /
//     otoken / extra-flag fields); several int fields have no authoritative name
//     and are surfaced by their role only.
//   * The Epoch-Stake-Auction bid datum's APY field matches the off-chain
//     formula `amount * 1000 * 73 / apy`
//     (OptimFinance/oada-ui  src/oada/actions.ts  bidAmountToRequestedSize).

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  isBytes,
  parseAssetClass,
  parseCredential,
  parsePlutusAddress,
  type AssetClass,
  type Credential,
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

// StakingAmoDatum — the DEPLOYED (generalised "otoken framework") staking-AMO
// state: Constr 0 with 15 fields. This is a superset of the 8-field clean-code
// `StakingAmoDatum` (which is the OADA-specialised form). Field layout:
//   [0]  soulToken     Nft/Id      — the AMO singleton id NFT (held 1x in UTxO)
//   [1]  field1        Int         — config int (soul-gated invariant; e.g. 3200)
//   [2]  baseAsset     AssetClass  — the base asset (ADA = ("",""))
//   [3]  otoken        AssetClass  — the OTOKEN (OADA) asset class
//   [4]  field4        Int         — soul-gated parameter (e.g. 1)
//   [5]  field5        Int         — soul-gated parameter (e.g. 1)
//   [6]  sotoken       AssetClass  — the sOTOKEN asset class (held in the UTxO)
//   [7]  flag7         Bool        — soul-gated boolean flag (ctor 0/1)
//   [8]  flag8         Bool        — soul-gated boolean flag (ctor 0/1)
//   [9]  odaoFee       Int         — oDAO fee component (used in 100000-f9-f10)
//   [10] feeComponent2 Int         — second fee component
//   [11] feeClaimRule  ScriptHash  — withdraw-0 fee-claim rule (28 bytes)
//   [12] scriptHash12  ScriptHash  — soul-gated 28-byte hash parameter
//   [13] sotokenAmount Int         — circulating-sOTOKEN accounting snapshot
//   [14] sotokenBacking Int        — backing accounting snapshot (rate basis)
// NOTE: only the asset-class / hash / clearly-named fields are authoritative;
// the bare int fields [1],[4],[5] have no public name and are surfaced as-is.
export interface StakingAmoDatum {
  kind: "StakingAmo";
  soulToken: AssetClass; // [0] AMO singleton NFT id
  field1: bigint; // [1]
  baseAsset: AssetClass; // [2]
  otoken: AssetClass; // [3]
  field4: bigint; // [4]
  field5: bigint; // [5]
  sotoken: AssetClass; // [6]
  flag7: boolean; // [7]
  flag8: boolean; // [8]
  odaoFee: bigint; // [9]
  feeComponent2: bigint; // [10]
  feeClaimRule: string; // [11] ScriptHash (28 bytes hex)
  scriptHash12: string; // [12] ScriptHash (28 bytes hex)
  sotokenAmount: bigint; // [13]
  sotokenBacking: bigint; // [14] rate = sotokenAmount / sotokenBacking
}

// Constr 0/1 with no fields => Bool (Constr0 False, Constr1 True). Optim uses
// such flags positionally inside the AMO datum.
function asFlag(d: PD): boolean {
  const c = asConstr(d);
  return c.tag !== 0;
}

export function parseStakingAmoDatum(data: PD): StakingAmoDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`StakingAmoDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 15) {
    throw new Error(`StakingAmoDatum: expected 15 fields, got ${c.fields.length}`);
  }
  return {
    kind: "StakingAmo",
    soulToken: parseAssetClass(c.fields[0]),
    field1: asInt(c.fields[1]),
    baseAsset: parseAssetClass(c.fields[2]),
    otoken: parseAssetClass(c.fields[3]),
    field4: asInt(c.fields[4]),
    field5: asInt(c.fields[5]),
    sotoken: parseAssetClass(c.fields[6]),
    flag7: asFlag(c.fields[7]),
    flag8: asFlag(c.fields[8]),
    odaoFee: asInt(c.fields[9]),
    feeComponent2: asInt(c.fields[10]),
    feeClaimRule: asBytes(c.fields[11]),
    scriptHash12: asBytes(c.fields[12]),
    sotokenAmount: asInt(c.fields[13]),
    sotokenBacking: asInt(c.fields[14]),
  };
}

// --------------------------------------------------------------------------
// ROLE "position" → StakeAuctionBidDatum (Epoch Stake Auction / ESA bid escrow,
// the validator the constants call `stakeOrderHash`). Two on-chain variants:
//
//   FULL  = Constr 0, 5 fields:
//     [0] owner        KeyHash         — bidder payment key hash (28 bytes)
//     [1] stakeCred    Credential      — bidder stake credential (Constr0[hash])
//     [2] apy          Int             — bid APY/APR (off-chain divides by 10 for
//                                        display; on-chain rate basis, see below)
//     [3] bidType      Bool            — Constr0 = Partial, Constr1 = Full
//     [4] bidRef       Option<OutputReference> — parent/continuing bid reference
//
//   CONT  = Constr 1, 1 field: [ apy: Int ]  — a continuation/partial-fill bid
//     carrying only the APY (same value as the full bid it descends from).
//
// SOURCE: the APY field is pinned by the on-chain `value * 73 * 1000 / apy`
// term, which is byte-for-byte the off-chain
// `bidAmountToRequestedSize = amount * 1000 * 73 / apy`
// (OptimFinance/oada-ui src/oada/actions.ts). The validator also derives an
// epoch index `(posix_ms - 1647899091000) / 432000000`, confirming the Epoch
// Stake Auction semantics. owner/stake/bidType match the off-chain
// StakeAuctionBidView { ownerPkh, stakeAddressBech32, bidType, apy }.
export type StakeAuctionBidDatum =
  | {
      kind: "StakeAuctionBid";
      owner: string;
      stakeCredential: Credential | null;
      apy: bigint;
      bidType: "Partial" | "Full";
      bidRef: OutputReference | null;
    }
  | { kind: "StakeAuctionBidCont"; apy: bigint };

export function parseStakeAuctionBidDatum(data: PD): StakeAuctionBidDatum {
  const c = asConstr(data);
  // Continuation variant: Constr 1 [ apy ].
  if (c.tag === 1) {
    if (c.fields.length !== 1) {
      throw new Error(`StakeAuctionBidCont: expected 1 field, got ${c.fields.length}`);
    }
    return { kind: "StakeAuctionBidCont", apy: asInt(c.fields[0]) };
  }
  if (c.tag !== 0) throw new Error(`StakeAuctionBid: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 5) {
    throw new Error(`StakeAuctionBid: expected 5 fields, got ${c.fields.length}`);
  }
  return {
    kind: "StakeAuctionBid",
    owner: asBytes(c.fields[0]),
    // stake credential is Constr0[hash] (VKey) / Constr1[hash] (Script).
    stakeCredential: parseBidStakeCredential(c.fields[1]),
    apy: asInt(c.fields[2]),
    bidType: asConstr(c.fields[3]).tag === 0 ? "Partial" : "Full",
    bidRef: asOptional(c.fields[4], parseOutputReference),
  };
}

// Field [1] is a bare Credential (Constr0[hash]/Constr1[hash]). Tolerate either
// a raw Credential or an Option-wrapped one without throwing.
function parseBidStakeCredential(d: PD): Credential | null {
  try {
    const c = asConstr(d);
    if ((c.tag === 0 || c.tag === 1) && c.fields.length === 1 && isBytes(c.fields[0])) {
      return parseCredential(d);
    }
  } catch {
    /* fall through */
  }
  return null;
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
  | StakeAuctionBidDatum
  | CollateralAmoDatum
  | StrategyDatum
  | { kind: "Unknown"; raw: PD };

// Discriminate the position-role datums by ctor + field count/shape:
//   Constr 0, 15 fields -> StakingAmoDatum (deployed generalised staking AMO)
//   Constr 0,  5 fields -> StakeAuctionBidDatum (full ESA bid)
//   Constr 1,  1 field  -> StakeAuctionBidDatum (continuation/partial bid)
//   Constr 0,  3 fields -> CollateralAmoDatum (clean-code)
//   Constr 0,  2 fields -> BatchStakeDatum [Bytes, Address] | StrategyDatum [Int, Data]
export function parseOptimPositionDatum(data: PD): OptimDatum {
  const c = asConstr(data);
  // Continuation bid (the only Constr-1 position datum we know).
  if (c.tag === 1 && c.fields.length === 1) {
    try {
      return parseStakeAuctionBidDatum(data);
    } catch {
      return { kind: "Unknown", raw: data };
    }
  }
  if (c.tag !== 0) return { kind: "Unknown", raw: data };
  const n = c.fields.length;
  try {
    if (n === 15) return parseStakingAmoDatum(data);
    if (n === 5) return parseStakeAuctionBidDatum(data);
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
  // The accounting snapshots are legitimately 0 when the AMO derives circulating
  // sOTOKEN from the held value, so only flag clearly-invalid negatives.
  if (d.sotokenAmount < BigInt(0) || d.sotokenBacking < BigInt(0)) {
    issues.push({ severity: "warning", message: "negative sotoken amount/backing" });
  }
  return issues;
}

const APY_DISPLAY_DIVISOR = BigInt(10); // off-chain divides the raw APY by 10 for %

export function formatBidApy(rawApy: bigint): string {
  // off-chain: apy / 10 (so 308 -> 30.8%). Keep one decimal place.
  const whole = rawApy / APY_DISPLAY_DIVISOR;
  const frac = rawApy % APY_DISPLAY_DIVISOR;
  return `${whole}.${frac.toString().padStart(1, "0")}%`;
}

export function validateStakeAuctionBid(d: StakeAuctionBidDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (d.apy <= BigInt(0)) {
    issues.push({ severity: "warning", message: "bid APY is non-positive" });
  }
  if (d.kind === "StakeAuctionBid" && !HEX28.test(d.owner.toLowerCase())) {
    issues.push({
      severity: "warning",
      message: `owner is not a 28-byte key hash (got ${d.owner.length / 2} bytes)`,
    });
  }
  return issues;
}
