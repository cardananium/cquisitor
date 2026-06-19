import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { parseRapidPoolDatum, parseRapidPoolRedeemer } from "./rapidDex";
import { rapidPoolToView } from "./index";
import {
  matchWingRidersRapidNftPolicy,
  matchWingRidersRapidScriptHash,
  WINGRIDERS_RAPID_DEX,
} from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const POLICY_B = "11112222333344445555666677778888999900001111222233334444";
const NAME_B = "57696e67";
const AUTH_POLICY = "aaaa2222333344445555666677778888999900001111222233334444";
const SHARES = "abcdef";
const OTHER_HASH = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0";

// PoolDatum = Constr0 with 15 ordered fields; assetA = ADA, assetB = a token.
const poolDatum = (feeFrom: PD): PD =>
  C(
    0,
    B(""), B(""), // asset A (ADA): policy, name
    B(POLICY_B), B(NAME_B), // asset B: policy, name
    I(100), I(200), // treasuryA, treasuryB
    feeFrom, // fee_from
    B(AUTH_POLICY), B(NAME_B), // treasury authority NFT policy/name
    I(3), I(4), // treasury fee points a→b / b→a
    I(30), I(35), // swap fee points a→b / b→a
    I(10000), // fee_basis
    B(SHARES), // shares_asset_name
  );

describe("parseRapidPoolDatum", () => {
  test("parses 15 flat fields with InputToken fee_from", () => {
    const d = parseRapidPoolDatum(poolDatum(C(0)));
    expect(d.assetA).toEqual({ policyId: "", assetName: "" });
    expect(d.assetB).toEqual({ policyId: POLICY_B, assetName: NAME_B });
    expect(d.treasuryA).toBe(BigInt(100));
    expect(d.treasuryB).toBe(BigInt(200));
    expect(d.feeFrom).toBe("InputToken");
    expect(d.swapFeePointsAToB).toBe(BigInt(30));
    expect(d.swapFeePointsBToA).toBe(BigInt(35));
    expect(d.feeBasis).toBe(BigInt(10000));
    expect(d.sharesAssetName).toBe(SHARES);
    expect(d.treasuryAuthorityPolicyId).toBe(AUTH_POLICY);
  });

  test("fee_from enum disambiguated by ctor index (no fields)", () => {
    expect(parseRapidPoolDatum(poolDatum(C(1))).feeFrom).toBe("OutputToken");
    expect(parseRapidPoolDatum(poolDatum(C(2))).feeFrom).toBe("TokenA");
    expect(parseRapidPoolDatum(poolDatum(C(3))).feeFrom).toBe("TokenB");
  });

  test("rejects wrong field count", () => {
    expect(() => parseRapidPoolDatum(C(0, B("")))).toThrow(/expected 15 fields/);
  });

  test("rejects wrong ctor tag", () => {
    expect(() => parseRapidPoolDatum(C(1))).toThrow(/unexpected ctor 1/);
  });

  test("toView yields a rapid-dex pool", () => {
    const view = rapidPoolToView(parseRapidPoolDatum(poolDatum(C(0))));
    expect(view.protocol).toBe("WingRiders rapid-dex");
    expect(view.role).toBe("rapid-pool");
    expect(view.kind).toBe("Liquidity Pool (rapid-dex)");
    expect(view.assets).toHaveLength(2);
  });

  test("toView surfaces the reserve pair (Asset A / Asset B)", () => {
    const view = rapidPoolToView(parseRapidPoolDatum(poolDatum(C(0))));
    expect(view.pair).toEqual({
      assetA: { policyId: "", assetName: "" },
      assetB: { policyId: POLICY_B, assetName: NAME_B },
    });
  });
});

describe("parseRapidPoolRedeemer", () => {
  test("Swap (ctor 0) with Bool swap_a_to_b", () => {
    expect(parseRapidPoolRedeemer(C(0, C(1), I(500)))).toEqual({
      kind: "Swap",
      swapAToB: true,
      provided: BigInt(500),
    });
    expect(parseRapidPoolRedeemer(C(0, C(0), I(7)))).toEqual({
      kind: "Swap",
      swapAToB: false,
      provided: BigInt(7),
    });
  });

  test("AddLiquidity (ctor 1)", () => {
    expect(parseRapidPoolRedeemer(C(1, I(10), I(20), I(0)))).toEqual({
      kind: "AddLiquidity",
      aAdd: BigInt(10),
      bAdd: BigInt(20),
      xSwap: BigInt(0),
    });
  });

  test("WithdrawLiquidity (ctor 2) with withdraw_type enum", () => {
    expect(parseRapidPoolRedeemer(C(2, I(50), C(0)))).toEqual({
      kind: "WithdrawLiquidity",
      sharesAdd: BigInt(50),
      withdrawType: "ToBoth",
    });
    const toA = parseRapidPoolRedeemer(C(2, I(50), C(1)));
    expect(toA.kind === "WithdrawLiquidity" && toA.withdrawType).toBe("ToA");
    const toB = parseRapidPoolRedeemer(C(2, I(50), C(2)));
    expect(toB.kind === "WithdrawLiquidity" && toB.withdrawType).toBe("ToB");
  });

  test("WithdrawTreasury (ctor 3) and Donate (ctor 4) have no fields", () => {
    expect(parseRapidPoolRedeemer(C(3))).toEqual({ kind: "WithdrawTreasury" });
    expect(parseRapidPoolRedeemer(C(4))).toEqual({ kind: "Donate" });
  });

  test("rejects unknown ctor", () => {
    expect(() => parseRapidPoolRedeemer(C(5))).toThrow(/unexpected ctor 5/);
  });
});

describe("WingRiders rapid-dex matching", () => {
  test("rapid-pool matches pool script hash (mainnet only)", () => {
    expect(matchWingRidersRapidScriptHash(WINGRIDERS_RAPID_DEX.poolHash, "mainnet")).toBe("rapid-pool");
    expect(matchWingRidersRapidScriptHash(WINGRIDERS_RAPID_DEX.poolHash, undefined)).toBe("rapid-pool");
    expect(matchWingRidersRapidScriptHash(WINGRIDERS_RAPID_DEX.poolHash, "preprod")).toBeNull();
    expect(matchWingRidersRapidScriptHash(OTHER_HASH, "mainnet")).toBeNull();
  });

  test("rapid-pool matches validity NFT (policy == hash + asset name 50)", () => {
    expect(matchWingRidersRapidNftPolicy(WINGRIDERS_RAPID_DEX.poolHash, ["50"], "mainnet")).toBe("rapid-pool");
    expect(matchWingRidersRapidNftPolicy(WINGRIDERS_RAPID_DEX.poolHash, ["50", "abcd"], undefined)).toBe("rapid-pool");
    // policy present but only an LP-share token (not the "50" validity asset) → no match
    expect(matchWingRidersRapidNftPolicy(WINGRIDERS_RAPID_DEX.poolHash, ["abcd"], "mainnet")).toBeNull();
    // V2's validity asset name "4c" must NOT match rapid-dex
    expect(matchWingRidersRapidNftPolicy(WINGRIDERS_RAPID_DEX.poolHash, ["4c"], "mainnet")).toBeNull();
    expect(matchWingRidersRapidNftPolicy(WINGRIDERS_RAPID_DEX.poolHash, ["50"], "preview")).toBeNull();
  });
});
