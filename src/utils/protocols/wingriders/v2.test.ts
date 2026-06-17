import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  parseWrPoolDatum,
  parseWrRequestDatum,
  parseWrNestedPoolDatum,
  parseWrNestedRequestDatum,
} from "./v2";
import { wrPoolToView, wrRequestToView, wrNestedPoolToView, wrNestedRequestToView } from "./index";
import {
  matchWingRidersNftPolicy,
  matchWingRidersScriptHash,
  WINGRIDERS_V2,
} from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const VH = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0";
const POLICY_B = "11112222333344445555666677778888999900001111222233334444";
const NAME_B = "57696e67";

// Address = Constr0 [ Credential, Maybe<StakingCredential> ]; key payment, no stake.
const keyAddr = (pkh: string): PD => C(0, C(0, B(pkh)), C(1));

describe("parseWrRequestDatum — Swap (A→B)", () => {
  const datum: PD = C(
    0,
    I(2_000_000), // oil
    keyAddr(PKH), // beneficiary
    keyAddr(PKH), // ownerAddress
    C(0), // compensationDatum (opaque)
    C(0), // datumType: NoDatum
    I(1_730_000_000_000), // deadline
    B(""), // assetASymbol (ADA)
    B(""), // assetAToken
    B(POLICY_B), // assetBSymbol
    B(NAME_B), // assetBToken
    C(0, C(0), I(1234)), // requestAction: Swap(SwapAToB, minWanted 1234)
    I(1), // scaleA
    I(1), // scaleB
  );

  test("parses flattened assets + swap action", () => {
    const d = parseWrRequestDatum(datum);
    expect(d.assetA).toEqual({ policyId: "", assetName: "" });
    expect(d.assetB).toEqual({ policyId: POLICY_B, assetName: NAME_B });
    expect(d.action).toEqual({ kind: "Swap", direction: "AToB", minWantedTokens: BigInt(1234) });
    expect(d.deadline).toBe(BigInt(1_730_000_000_000));
    expect(d.datumType).toBe("NoDatum");
    expect(d.ownerAddress.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
  });

  test("toView yields a WingRiders Swap order", () => {
    const view = wrRequestToView(parseWrRequestDatum(datum));
    expect(view.protocol).toBe("WingRiders V2");
    expect(view.role).toBe("order");
    expect(view.kind).toBe("Swap (A → B)");
    expect(view.assets).toHaveLength(2);
    expect(view.rows.find((r) => r.label === "Min wanted tokens")?.value).toBe("1,234");
  });
});

describe("parseWrRequestDatum — other actions", () => {
  const base = (action: PD): PD =>
    C(0, I(2_000_000), keyAddr(PKH), keyAddr(PKH), C(0), C(1), I(0), B(""), B(""), B(POLICY_B), B(NAME_B), action, I(1), I(1));

  test("AddLiquidity (ctor 1)", () => {
    const d = parseWrRequestDatum(base(C(1, I(500))));
    expect(d.action).toEqual({ kind: "AddLiquidity", minWantedShares: BigInt(500) });
    expect(d.datumType).toBe("DatumHash");
  });

  test("WithdrawLiquidity (ctor 2)", () => {
    const d = parseWrRequestDatum(base(C(2, I(10), I(20))));
    expect(d.action).toEqual({ kind: "WithdrawLiquidity", minWantedA: BigInt(10), minWantedB: BigInt(20) });
  });

  test("Swap B→A", () => {
    const d = parseWrRequestDatum(base(C(0, C(1), I(99))));
    expect(d.action).toEqual({ kind: "Swap", direction: "BToA", minWantedTokens: BigInt(99) });
  });
});

describe("parseWrPoolDatum", () => {
  const poolBase = (specifics: PD): PD =>
    C(
      0,
      B(VH), // requestValidatorHash
      B(""), B(""), // asset A (ADA)
      B(POLICY_B), B(NAME_B), // asset B
      I(35), I(5), I(0), I(0), I(10000), // swap/protocol/project/reserve fees + feeBasis
      I(2_000_000), // agentFeeAda
      I(1_730_000_000_000), // lastInteraction
      I(0), I(0), I(0), I(0), I(0), I(0), // treasuries
      C(1), C(1), // project/reserve beneficiary: Nothing
      specifics,
    );

  test("constant-product pool", () => {
    const d = parseWrPoolDatum(poolBase(C(0)));
    expect(d.poolSpecifics).toEqual({ kind: "ConstantProduct" });
    expect(d.swapFeeInBasis).toBe(BigInt(35));
    expect(d.feeBasis).toBe(BigInt(10000));
    expect(d.assetA).toEqual({ policyId: "", assetName: "" });
    expect(d.assetB).toEqual({ policyId: POLICY_B, assetName: NAME_B });
    expect(d.requestValidatorHash).toBe(VH);
    expect(d.projectBeneficiary).toBeNull();
  });

  test("stableswap pool (poolSpecifics with 3 fields)", () => {
    const d = parseWrPoolDatum(poolBase(C(0, I(1000), I(1), I(1))));
    expect(d.poolSpecifics).toEqual({ kind: "Stableswap", parameterD: BigInt(1000), scaleA: BigInt(1), scaleB: BigInt(1) });
    const view = wrPoolToView(d);
    expect(view.kind).toBe("Liquidity Pool (Stableswap)");
  });

  test("rejects wrong field count", () => {
    expect(() => parseWrPoolDatum(C(0, B(VH)))).toThrow(/expected 21 fields/);
  });
});

describe("WingRiders matching (cp = V1 nested, stableswap = V2)", () => {
  test("order/request hashes map to cp vs stableswap roles", () => {
    expect(matchWingRidersScriptHash(WINGRIDERS_V2.cpRequestHash, "mainnet")).toBe("order");
    expect(matchWingRidersScriptHash(WINGRIDERS_V2.stableRequestHash, undefined)).toBe("stableswap-order");
    expect(matchWingRidersScriptHash(WINGRIDERS_V2.cpRequestHash, "preprod")).toBeNull();
    expect(matchWingRidersScriptHash(VH, "mainnet")).toBeNull();
  });

  test("pool SPEND validator hashes also map to pool roles (NFT-independent)", () => {
    expect(matchWingRidersScriptHash(WINGRIDERS_V2.cpPoolHash, "mainnet")).toBe("pool");
    expect(matchWingRidersScriptHash(WINGRIDERS_V2.stablePoolHash, undefined)).toBe("stableswap-pool");
  });

  test("pool validity NFT maps to cp vs stableswap roles", () => {
    expect(matchWingRidersNftPolicy(WINGRIDERS_V2.cpLiquidityPolicy, ["4c"], "mainnet")).toBe("pool");
    expect(matchWingRidersNftPolicy(WINGRIDERS_V2.stableLiquidityPolicy, ["4c", "abcd"], undefined)).toBe("stableswap-pool");
    // policy present but only an LP-share token (not the validity asset) → no match
    expect(matchWingRidersNftPolicy(WINGRIDERS_V2.cpLiquidityPolicy, ["abcd"], "mainnet")).toBeNull();
    expect(matchWingRidersNftPolicy(WINGRIDERS_V2.cpLiquidityPolicy, ["4c"], "preview")).toBeNull();
  });
});

// The shape actually deployed on mainnet for both the constant-product 026a18d0…
// and stableswap 980e8c56… policies.
describe("WingRiders LIVE nested layout (LiquidityPoolDatumV1 / RequestDatumV1)", () => {
  const asset = (p: string, n: string): PD => C(0, B(p), B(n));

  test("nested pool datum (Constr0[reqHash, Constr0[Constr0[a,b], lastInt, treasA, treasB]])", () => {
    const datum: PD = C(
      0,
      B(WINGRIDERS_V2.cpRequestHash),
      // lpState = Constr0[ lp:Constr0[assetA, assetB], lastInteracted, treasA, treasB ]
      C(0, C(0, asset(POLICY_B, NAME_B), asset("", "")), I(1652560283000), I(0), I(0)),
    );
    const d = parseWrNestedPoolDatum(datum);
    expect(d.requestValidatorHash).toBe(WINGRIDERS_V2.cpRequestHash);
    expect(d.assetA).toEqual({ policyId: POLICY_B, assetName: NAME_B });
    expect(d.assetB).toEqual({ policyId: "", assetName: "" });
    expect(d.lastInteraction).toBe(BigInt(1652560283000));
    expect(d.treasuryA).toBe(BigInt(0));
    // stableswap labelling flows from the matched role, not the datum
    expect(wrNestedPoolToView(d, true).protocol).toBe("WingRiders Stableswap");
    expect(wrNestedPoolToView(d, false).kind).toBe("Liquidity Pool (Constant-product)");
  });

  test("nested request datum (Constr0[metadata, action]) with Swap action", () => {
    const datum: PD = C(
      0,
      C(0, keyAddr(PKH), B(PKH), I(1730000000000), C(0, asset("", ""), asset(POLICY_B, NAME_B))),
      C(0, C(1), I(1234)), // Swap(direction BToA, minWanted 1234)
    );
    const d = parseWrNestedRequestDatum(datum);
    expect(d.owner).toBe(PKH);
    expect(d.deadline).toBe(BigInt(1730000000000));
    expect(d.action).toEqual({ kind: "Swap", direction: "BToA", minWantedTokens: BigInt(1234) });
    expect(d.assetB).toEqual({ policyId: POLICY_B, assetName: NAME_B });
    expect(wrNestedRequestToView(d, false).protocol).toBe("WingRiders");
  });

  test("nested request AddLiquidity (Constr1) + RemoveLiquidity (Constr2)", () => {
    const meta = C(0, keyAddr(PKH), B(PKH), I(0), C(0, asset("", ""), asset(POLICY_B, NAME_B)));
    const add = parseWrNestedRequestDatum(C(0, meta, C(1, I(500))));
    expect(add.action).toEqual({ kind: "AddLiquidity", minWantedShares: BigInt(500) });
    const rem = parseWrNestedRequestDatum(C(0, meta, C(2, I(10), I(20))));
    expect(rem.action).toEqual({ kind: "WithdrawLiquidity", minWantedA: BigInt(10), minWantedB: BigInt(20) });
  });
});
