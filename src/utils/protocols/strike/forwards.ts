// Strike Finance (Forwards) datum + redeemer parsers.
//
// Strike's forwards product is a SEPARATE contract set from the perpetuals
// validators in ./constants + ./datums. A forward agreement is a bilateral
// contract between an `issuer` and an `obligee`; each side posts a deposit plus
// matching collateral, and the contract settles ("exercises") on a fixed date.
//
// The spend datum is a 10-field Constr0; the mint redeemer is a 5-variant enum —
// see ./constants STRIKE_FORWARDS for the hashes.
//
// Conventions (identical to ./datums):
//   • AssetClass = Constr0[policyId, assetName] (parseAssetClass). ADA = Constr0[#"",#""].
//   • Bool: False = Constr0[], True = Constr1[].
//   • Times are POSIX MILLISECONDS.

import {
  asBytes,
  asConstr,
  asInt,
  parseAssetClass,
  type AssetClass,
  type PD,
} from "@/utils/protocols/dex/plutusData";

// --- ForwardsDatum ----------------------------------------------------------

// ForwardsDatum is Constr0 with 10 ordered fields.
export interface StrikeForwardsDatum {
  issuerAddressHash: string;
  issuerDepositAsset: AssetClass;
  issuerDepositAssetAmount: bigint;
  obligeeDepositAsset: AssetClass;
  obligeeDepositAssetAmount: bigint;
  collateralAsset: AssetClass;
  eachPartyCollateralAssetAmount: bigint;
  eachPartyStrikeCollateralAssetAmount: bigint;
  exerciseContractDate: bigint; // POSIX milliseconds (the settlement date)
  mintAssetPolicyId: string; // PolicyId of the forward-position NFT
}

export function parseStrikeForwardsFields(fields: PD[]): StrikeForwardsDatum {
  if (fields.length !== 10) {
    throw new Error(`Strike ForwardsDatum: expected 10 fields, got ${fields.length}`);
  }
  return {
    issuerAddressHash: asBytes(fields[0]),
    issuerDepositAsset: parseAssetClass(fields[1]),
    issuerDepositAssetAmount: asInt(fields[2]),
    obligeeDepositAsset: parseAssetClass(fields[3]),
    obligeeDepositAssetAmount: asInt(fields[4]),
    collateralAsset: parseAssetClass(fields[5]),
    eachPartyCollateralAssetAmount: asInt(fields[6]),
    eachPartyStrikeCollateralAssetAmount: asInt(fields[7]),
    exerciseContractDate: asInt(fields[8]),
    mintAssetPolicyId: asBytes(fields[9]),
  };
}

export function parseStrikeForwardsDatum(data: PD): StrikeForwardsDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Strike ForwardsDatum: unexpected ctor ${c.tag}`);
  return parseStrikeForwardsFields(c.fields);
}

// --- CollateralDatum --------------------------------------------------------

// Bool: False = Constr0[], True = Constr1[].
function parseBool(d: PD): boolean {
  const c = asConstr(d);
  if (c.tag === 0) return false;
  if (c.tag === 1) return true;
  throw new Error(`Bool: unexpected ctor ${c.tag}`);
}

// CollateralDatum is Constr0 with 4 ordered fields, the last being a nested
// ForwardsDatum.
export interface StrikeCollateralDatum {
  issuerHasDepositedAsset: boolean;
  obligeeAddressHash: string;
  obligeeHasDepositedAsset: boolean;
  associatedForwardsDatum: StrikeForwardsDatum;
}

export function parseStrikeCollateralDatum(data: PD): StrikeCollateralDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Strike CollateralDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 4) {
    throw new Error(`Strike CollateralDatum: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    issuerHasDepositedAsset: parseBool(c.fields[0]),
    obligeeAddressHash: asBytes(c.fields[1]),
    obligeeHasDepositedAsset: parseBool(c.fields[2]),
    associatedForwardsDatum: parseStrikeForwardsDatum(c.fields[3]),
  };
}

// --- AgreementDatum ---------------------------------------------------------

// AgreementDatum is Constr0 with 2 ordered fields.
export interface StrikeAgreementDatum {
  utxoOwnerAddressHash: string;
  associatedForwardsDatum: StrikeForwardsDatum;
}

export function parseStrikeAgreementDatum(data: PD): StrikeAgreementDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Strike AgreementDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`Strike AgreementDatum: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    utxoOwnerAddressHash: asBytes(c.fields[0]),
    associatedForwardsDatum: parseStrikeForwardsDatum(c.fields[1]),
  };
}

// --- Redeemers --------------------------------------------------------------

// Party: Issuer = Constr0[], Obligee = Constr1[].
export type StrikeParty = "Issuer" | "Obligee";
function parseParty(d: PD): StrikeParty {
  const c = asConstr(d);
  if (c.tag === 0) return "Issuer";
  if (c.tag === 1) return "Obligee";
  throw new Error(`Party: unexpected ctor ${c.tag}`);
}

// forwards SPEND redeemer — ForwardsRedeemer.
export type StrikeForwardsRedeemer =
  | { kind: "AcceptForwardsContract"; counterpartyHash: string; index: bigint }
  | { kind: "CancelForwardsContract" };

export function parseStrikeForwardsRedeemer(data: PD): StrikeForwardsRedeemer {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      if (c.fields.length !== 2) {
        throw new Error(`AcceptForwardsContract: expected 2 fields, got ${c.fields.length}`);
      }
      return {
        kind: "AcceptForwardsContract",
        counterpartyHash: asBytes(c.fields[0]),
        index: asInt(c.fields[1]),
      };
    case 1:
      return { kind: "CancelForwardsContract" };
    default:
      throw new Error(`Strike ForwardsRedeemer: unexpected ctor ${c.tag}`);
  }
}

// collateral SPEND redeemer — CollateralRedeemerAction.
export type StrikeCollateralRedeemer =
  | { kind: "OneSideDepositAgreement"; party: StrikeParty; index: bigint }
  | { kind: "BothSidesDepositAgreement"; party: StrikeParty }
  | { kind: "LiquidateCollateral"; party: StrikeParty }
  | { kind: "LiquidateBothParties"; index: bigint };

export function parseStrikeCollateralRedeemer(data: PD): StrikeCollateralRedeemer {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      if (c.fields.length !== 2) {
        throw new Error(`OneSideDepositAgreement: expected 2 fields, got ${c.fields.length}`);
      }
      return {
        kind: "OneSideDepositAgreement",
        party: parseParty(c.fields[0]),
        index: asInt(c.fields[1]),
      };
    case 1:
      if (c.fields.length !== 1) {
        throw new Error(`BothSidesDepositAgreement: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "BothSidesDepositAgreement", party: parseParty(c.fields[0]) };
    case 2:
      if (c.fields.length !== 1) {
        throw new Error(`LiquidateCollateral: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "LiquidateCollateral", party: parseParty(c.fields[0]) };
    case 3:
      if (c.fields.length !== 1) {
        throw new Error(`LiquidateBothParties: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "LiquidateBothParties", index: asInt(c.fields[0]) };
    default:
      throw new Error(`Strike CollateralRedeemer: unexpected ctor ${c.tag}`);
  }
}

// forwards MINT redeemer — MintRedeemer. The forwards validator
// is a multivalidator: this policy id == the forwards spend hash.
export type StrikeForwardsMintRedeemer =
  | { kind: "CreateForwardMint"; index: bigint }
  | { kind: "EnterForwardMint"; counterpartyHash: string; index: bigint }
  | { kind: "CancelForwardBurn"; ownerHash: string }
  | { kind: "LiquidateBurn"; issuerHash: string; obligeeHash: string }
  | { kind: "ConsumeAgreementBurn"; ownerHash: string };

export function parseStrikeForwardsMintRedeemer(data: PD): StrikeForwardsMintRedeemer {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      if (c.fields.length !== 1) {
        throw new Error(`CreateForwardMint: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "CreateForwardMint", index: asInt(c.fields[0]) };
    case 1:
      if (c.fields.length !== 2) {
        throw new Error(`EnterForwardMint: expected 2 fields, got ${c.fields.length}`);
      }
      return {
        kind: "EnterForwardMint",
        counterpartyHash: asBytes(c.fields[0]),
        index: asInt(c.fields[1]),
      };
    case 2:
      if (c.fields.length !== 1) {
        throw new Error(`CancelForwardBurn: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "CancelForwardBurn", ownerHash: asBytes(c.fields[0]) };
    case 3:
      if (c.fields.length !== 2) {
        throw new Error(`LiquidateBurn: expected 2 fields, got ${c.fields.length}`);
      }
      return {
        kind: "LiquidateBurn",
        issuerHash: asBytes(c.fields[0]),
        obligeeHash: asBytes(c.fields[1]),
      };
    case 4:
      if (c.fields.length !== 1) {
        throw new Error(`ConsumeAgreementBurn: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "ConsumeAgreementBurn", ownerHash: asBytes(c.fields[0]) };
    default:
      throw new Error(`Strike ForwardsMintRedeemer: unexpected ctor ${c.tag}`);
  }
}
