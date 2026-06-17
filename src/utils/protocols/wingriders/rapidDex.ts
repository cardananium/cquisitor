// WingRiders rapid-dex datum + redeemer parsers.
//
// PoolDatum + PoolRedeemer (validator hash
// 723bee63d06fb5c4ce5536f6ea53977128b3bf9011c9e53cc1b745b3).
//
// Constr tags use the native CBOR 121+alt scheme, but cquisitor-lib's
// DetailedSchema decode normalizes those to a 0-based `constructor` index — so
// the generic `asConstr` helper reads them directly (same as v2.ts).
//
// Gotchas baked in below:
//   • AssetClass is NOT a nested Constr — it is FLAT ByteArray pairs
//     (policy, name) inline in the datum (same flattened style as v2.ts).
//   • `fee_from` / `withdraw_type` are no-field enum Constrs — disambiguate by
//     ctor index, NOT field count.
//   • `swap_a_to_b` is a Bool, which encodes as a Constr (False=0 / True=1).
//   • PoolDatum has EXACTLY 15 fields; reject any other count.

import {
  asBytes,
  asConstr,
  asInt,
  type AssetClass,
  type PD,
} from "@/utils/protocols/dex/plutusData";

// FeeFrom enum (no fields), ctor index by declaration order.
export type RapidFeeFrom = "InputToken" | "OutputToken" | "TokenA" | "TokenB";

export interface RapidPoolDatum {
  assetA: AssetClass;
  assetB: AssetClass;
  treasuryA: bigint;
  treasuryB: bigint;
  feeFrom: RapidFeeFrom;
  treasuryAuthorityPolicyId: string;
  treasuryAuthorityAssetName: string;
  treasuryFeePointsAToB: bigint;
  treasuryFeePointsBToA: bigint;
  swapFeePointsAToB: bigint;
  swapFeePointsBToA: bigint;
  feeBasis: bigint;
  sharesAssetName: string;
}

// WithdrawType enum (no fields), ctor index by declaration order.
export type RapidWithdrawType = "ToBoth" | "ToA" | "ToB";

export type RapidPoolRedeemer =
  | { kind: "Swap"; swapAToB: boolean; provided: bigint }
  | { kind: "AddLiquidity"; aAdd: bigint; bAdd: bigint; xSwap: bigint }
  | { kind: "WithdrawLiquidity"; sharesAdd: bigint; withdrawType: RapidWithdrawType }
  | { kind: "WithdrawTreasury" }
  | { kind: "Donate" };

// --- Sub-parsers -----------------------------------------------------------

function parseFeeFrom(d: PD): RapidFeeFrom {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return "InputToken";
    case 1:
      return "OutputToken";
    case 2:
      return "TokenA";
    case 3:
      return "TokenB";
    default:
      throw new Error(`FeeFrom: unexpected ctor ${c.tag}`);
  }
}

function parseWithdrawType(d: PD): RapidWithdrawType {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return "ToBoth";
    case 1:
      return "ToA";
    case 2:
      return "ToB";
    default:
      throw new Error(`WithdrawType: unexpected ctor ${c.tag}`);
  }
}

// Bool encodes as a Constr (False=0 / True=1) in PlutusData.
function parseBool(d: PD): boolean {
  const c = asConstr(d);
  if (c.tag === 0) return false;
  if (c.tag === 1) return true;
  throw new Error(`Bool: unexpected ctor ${c.tag}`);
}

// --- Top-level parsers -----------------------------------------------------

export function parseRapidPoolDatum(data: PD): RapidPoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`RapidPoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 15) {
    throw new Error(`RapidPoolDatum: expected 15 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    assetA: { policyId: asBytes(f[0]), assetName: asBytes(f[1]) },
    assetB: { policyId: asBytes(f[2]), assetName: asBytes(f[3]) },
    treasuryA: asInt(f[4]),
    treasuryB: asInt(f[5]),
    feeFrom: parseFeeFrom(f[6]),
    treasuryAuthorityPolicyId: asBytes(f[7]),
    treasuryAuthorityAssetName: asBytes(f[8]),
    treasuryFeePointsAToB: asInt(f[9]),
    treasuryFeePointsBToA: asInt(f[10]),
    swapFeePointsAToB: asInt(f[11]),
    swapFeePointsBToA: asInt(f[12]),
    feeBasis: asInt(f[13]),
    sharesAssetName: asBytes(f[14]),
  };
}

export function parseRapidPoolRedeemer(data: PD): RapidPoolRedeemer {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      return { kind: "Swap", swapAToB: parseBool(c.fields[0]), provided: asInt(c.fields[1]) };
    case 1:
      return {
        kind: "AddLiquidity",
        aAdd: asInt(c.fields[0]),
        bAdd: asInt(c.fields[1]),
        xSwap: asInt(c.fields[2]),
      };
    case 2:
      return {
        kind: "WithdrawLiquidity",
        sharesAdd: asInt(c.fields[0]),
        withdrawType: parseWithdrawType(c.fields[1]),
      };
    case 3:
      return { kind: "WithdrawTreasury" };
    case 4:
      return { kind: "Donate" };
    default:
      throw new Error(`RapidPoolRedeemer: unexpected ctor ${c.tag}`);
  }
}
