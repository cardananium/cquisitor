// SundaeSwap V1 (the original 2021 AMM) datum parsers.
//
// V1 pool / escrow UTxOs reference their datum by HASH (no inline datum), so the
// caller resolves the datum from the tx witness set before parsing.

import { asBytes, asConstr, asInt, isConstr, type PD } from "./plutusData";

// SundaeSwap V1 PoolDatum (sundae-contracts ScriptTypes.PoolDatum):
//   PoolDatum = Constr0[
//     coins         = Constr0[ AssetClass coinA, AssetClass coinB ],  // AB<AssetClass>
//     poolIdent     = ByteString,
//     circulatingLP = Int,
//     swapFees      = Constr0[ Int numerator, Int denominator ] ]
// AssetClass is a nested Constr0[policy, name] (NOT the 2-element List the V3
// datum uses); ada = ("", "").
export interface V1PoolDatum {
  kind: "V1";
  identifier: string;
  assetA: { policyId: string; assetName: string };
  assetB: { policyId: string; assetName: string };
  circulatingLp: bigint;
  feeNumerator: bigint;
  feeDenominator: bigint;
}

// AssetClass encoded as a nested Constr0[policy, name] (the V1 shape).
function parseAssetClassConstr(d: PD): { policyId: string; assetName: string } {
  const c = asConstr(d);
  if (c.fields.length !== 2) throw new Error("V1 AssetClass: expected (policy, name)");
  return { policyId: asBytes(c.fields[0]), assetName: asBytes(c.fields[1]) };
}

export function parseV1PoolDatum(data: PD): V1PoolDatum {
  if (!isConstr(data)) throw new Error("V1PoolDatum: expected Constr");
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`V1PoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 4) {
    throw new Error(`V1PoolDatum: expected 4 fields, got ${c.fields.length}`);
  }
  const coins = asConstr(c.fields[0]);
  if (coins.fields.length !== 2) {
    throw new Error(`V1 pool coins: expected (assetA, assetB), got ${coins.fields.length}`);
  }
  const fees = asConstr(c.fields[3]);
  if (fees.fields.length !== 2) {
    throw new Error(`V1 swapFees: expected (numerator, denominator), got ${fees.fields.length}`);
  }
  return {
    kind: "V1",
    identifier: asBytes(c.fields[1]),
    assetA: parseAssetClassConstr(coins.fields[0]),
    assetB: parseAssetClassConstr(coins.fields[1]),
    circulatingLp: asInt(c.fields[2]),
    feeNumerator: asInt(fees.fields[0]),
    feeDenominator: asInt(fees.fields[1]),
  };
}
