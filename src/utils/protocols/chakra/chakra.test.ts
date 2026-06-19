import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyChakraRedeemer,
  isChakraSwapOrder,
  parseChakraPool,
  parseChakraSwapOrder,
  validateChakraPool,
} from "./chakra";
import { matchChakraNftPolicy, matchChakraScriptHash, CHAKRA } from "./constants";
import { getDexAdapter } from "@/utils/protocols/dex/registry";
import "./index"; // registers the chakra adapter (decode path)

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

// --- REAL values observed on mainnet (live pool UTxO, GETA pool) -------------
const SCRIPT = CHAKRA.scriptHash; // 4938414d…760341
const OPERATOR = CHAKRA.operatorKey; // 85a56d4d…f06890
const POOL_NFT_NAME = "c681c8c32e230333649575adb473c12900f6062091e2adc50b63dc94";
const INDY_POLICY = "533bb94a8850ee3ccbe483106489399112b74c905342cb1792a797a0";
const INDY_NAME = "494e4459"; // "INDY"
const GETA_POLICY = "24df2821cf1405f0bd45479555b7d523984e6bfad7bd28899bf76209";
const GETA_NAME = "0014df1047455441"; // CIP-68 (0014df10) + "GETA"

// Inner 12-field record, then wrapped in Constr0[ <record> ].
const getaRecord: PD = C(
  0,
  C(0, B(SCRIPT), B(POOL_NFT_NAME)), // [0] poolNft
  C(0, B(INDY_POLICY), B(INDY_NAME)), // [1] currency (INDY)
  C(0, B(GETA_POLICY), B(GETA_NAME)), // [2] token (GETA)
  I(2_640_046), // [3] tokensSold
  I(731_709_000), // [4] targetSupply
  C(0, I(375), I(100)), // [5] curveA
  C(0, I(75), I(1)), // [6] curveB
  I(500_000), // [7] baseFee
  C(0, I(1), I(100)), // [8] feeFraction
  I(0), // [9] accFee
  I(99_010), // [10] accCurrency
  B(OPERATOR), // [11] operatorKey
);
const getaPool: PD = C(0, getaRecord);

describe("parseChakraPool — live GETA pool", () => {
  test("parses all 12 inner fields", () => {
    const p = parseChakraPool(getaPool);
    expect(p.poolNft).toEqual({ policyId: SCRIPT, assetName: POOL_NFT_NAME });
    expect(p.currency).toEqual({ policyId: INDY_POLICY, assetName: INDY_NAME });
    expect(p.token).toEqual({ policyId: GETA_POLICY, assetName: GETA_NAME });
    expect(p.tokensSold).toBe(BigInt(2_640_046));
    expect(p.targetSupply).toBe(BigInt(731_709_000));
    expect(p.curveA).toEqual({ numerator: BigInt(375), denominator: BigInt(100) });
    expect(p.curveB).toEqual({ numerator: BigInt(75), denominator: BigInt(1) });
    expect(p.baseFee).toBe(BigInt(500_000));
    expect(p.feeFraction).toEqual({ numerator: BigInt(1), denominator: BigInt(100) });
    expect(p.accFee).toBe(BigInt(0));
    expect(p.accCurrency).toBe(BigInt(99_010));
    expect(p.operatorKey).toBe(OPERATOR);
  });

  test("clean live pool has no issues", () => {
    expect(validateChakraPool(parseChakraPool(getaPool))).toEqual([]);
  });

  test("rejects wrong wrapper / field count", () => {
    expect(() => parseChakraPool(C(0, C(0, B("00"))))).toThrow(); // 1 inner field
    expect(() => parseChakraPool(C(0))).toThrow(); // no wrapper field
  });
});

describe("parseChakraSwapOrder — live INDY swap action (Constr1)", () => {
  // Real ctor=1 datum: Constr1[ Constr0[ poolNft, ownerPkh, currency,
  // Constr0[66,0], returnAddr, Constr0[] ] ]
  const OWNER = "69884af0dc99065a6ae881fd2e4593ecc279742106e0d13f8d154888";
  const STAKE = "94be5f3971f93469c500a918ea76a1849bd1e63f0a87e19e2b787c99";
  const POOL_NFT2 = "f4c3abef16ff6a20741ec6207fad622b32ade63a54ff777a5917f953";
  const returnAddr: PD = C(0, C(0, B(OWNER)), C(0, C(0, C(0, B(STAKE)))));
  const swap: PD = C(
    1,
    C(
      0,
      C(0, B(SCRIPT), B(POOL_NFT2)), // poolNft
      B(OWNER), // ownerPkh (bare bytes)
      C(0, B(INDY_POLICY), B(INDY_NAME)), // currency INDY
      C(0, I(66), I(0)), // amount tuple
      returnAddr, // CIP-19 address
      C(0), // extra
    ),
  );

  test("isChakraSwapOrder distinguishes ctor1 from ctor0", () => {
    expect(isChakraSwapOrder(swap)).toBe(true);
    expect(isChakraSwapOrder(getaPool)).toBe(false);
  });

  test("parses owner, currency, amount, return address", () => {
    const o = parseChakraSwapOrder(swap);
    expect(o.poolNft).toEqual({ policyId: SCRIPT, assetName: POOL_NFT2 });
    expect(o.owner).toBe(OWNER);
    expect(o.currency).toEqual({ policyId: INDY_POLICY, assetName: INDY_NAME });
    expect(o.amount).toBe(BigInt(66));
    expect(o.returnAddress.paymentCredential).toEqual({ kind: "VKey", hash: OWNER });
    expect(o.returnAddress.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: STAKE },
    });
  });
});

describe("classifyChakraRedeemer", () => {
  test("Constr0 = Swap (batch apply), others = neutral actions", () => {
    expect(classifyChakraRedeemer(C(0, I(0), { list: [] }, I(0)))).toBe("Swap");
    expect(classifyChakraRedeemer(C(1))).toBe("Action1");
    expect(classifyChakraRedeemer(C(2))).toBe("Action2");
    expect(classifyChakraRedeemer(C(3, I(1), I(2)))).toBe("Action3");
    expect(classifyChakraRedeemer(C(4))).toBe("Action4");
    expect(classifyChakraRedeemer(I(1))).toBeNull();
  });
});

describe("decode via registered adapter — pool view + pair", () => {
  const decode = getDexAdapter("chakra")!.decode!;

  test("pool view exposes curve rows + trading pair = token / currency", () => {
    const view = decode(getaPool, "pool");
    expect(view.protocol).toBe("Chakra");
    expect(view.role).toBe("pool");
    expect(view.kind).toContain("Pool:");
    expect(view.rows.find((r) => r.label === "Target supply (curve cap)")?.value).toBe(
      "731,709,000",
    );
    expect(view.rows.find((r) => r.label === "Operator (batcher key)")?.value).toBe(OPERATOR);
    // Pair: launched token (GETA) vs currency (INDY).
    expect(view.pair).toEqual({
      assetA: { policyId: GETA_POLICY, assetName: GETA_NAME },
      assetB: { policyId: INDY_POLICY, assetName: INDY_NAME },
    });
  });
});

describe("Chakra matching", () => {
  test("matches the shared script hash as 'pool' on mainnet only", () => {
    expect(matchChakraScriptHash(CHAKRA.scriptHash, "mainnet")).toBe("pool");
    expect(matchChakraScriptHash(CHAKRA.scriptHash, undefined)).toBe("pool");
    expect(matchChakraScriptHash(CHAKRA.scriptHash, "preprod")).toBeNull();
    expect(matchChakraScriptHash(INDY_POLICY, "mainnet")).toBeNull();
  });

  test("pool NFT policy (== script hash) matches as 'pool'", () => {
    expect(matchChakraNftPolicy(CHAKRA.scriptHash, ["abcd"], "mainnet")).toBe("pool");
    expect(matchChakraNftPolicy(INDY_POLICY, ["abcd"], "mainnet")).toBeNull();
    expect(matchChakraNftPolicy(CHAKRA.scriptHash, ["abcd"], "preview")).toBeNull();
  });
});
