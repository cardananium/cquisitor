import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyPartialOrderRedeemer,
  parsePartialOrderAction,
  parsePartialOrderContainedFee,
  parsePartialOrderDatum,
  validatePartialOrderDatum,
} from "./partialOrder";
import {
  GENIUS_YIELD_V1,
  matchGeniusYieldNftPolicy,
  matchGeniusYieldScriptHash,
} from "./constants";
import { partialOrderToView } from "./index";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const STAKE = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const OFFERED_NAME = "474f4c44"; // "GOLD"
const NFT_NAME = "abcdef0123456789";

const ada: PD = C(0, B(""), B(""));
const offered: PD = C(0, B(POLICY), B(OFFERED_NAME));
// Address = Constr0[ Credential, Some(Inline(Credential)) ]
const ownerAddr: PD = C(0, C(0, B(PKH)), C(0, C(0, C(0, B(STAKE)))));
// PartialOrderContainedFee = Constr0[lovelaces, offeredTokens, askedTokens]
const containedFee: PD = C(0, I(2_000_000), I(10), I(20));

// Full 15-field PartialOrderDatum with Just start / Nothing end.
const datum: PD = C(
  0,
  B(PKH), // 0 podOwnerKey
  ownerAddr, // 1 podOwnerAddr
  offered, // 2 podOfferedAsset
  I(1_000_000), // 3 podOfferedOriginalAmount
  I(750_000), // 4 podOfferedAmount
  ada, // 5 podAskedAsset
  C(0, I(3), I(2)), // 6 podPrice 3/2
  B(NFT_NAME), // 7 podNFT
  C(0, I(1_730_000_000_000)), // 8 podStart = Just t
  C(1), // 9 podEnd = Nothing
  I(2), // 10 podPartialFills
  I(1_000_000), // 11 podMakerLovelaceFlatFee
  I(1_000_000), // 12 podTakerLovelaceFlatFee
  containedFee, // 13 podContainedFee
  I(1_500_000), // 14 podContainedPayment
);

describe("parsePartialOrderDatum", () => {
  test("parses all 15 ordered fields", () => {
    const o = parsePartialOrderDatum(datum);
    expect(o.ownerKey).toBe(PKH);
    expect(o.ownerAddr.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(o.ownerAddr.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: STAKE },
    });
    expect(o.offeredAsset).toEqual({ policyId: POLICY, assetName: OFFERED_NAME });
    expect(o.offeredOriginalAmount).toBe(BigInt(1_000_000));
    expect(o.offeredAmount).toBe(BigInt(750_000));
    expect(o.askedAsset).toEqual({ policyId: "", assetName: "" });
    expect(o.price).toEqual({ numerator: BigInt(3), denominator: BigInt(2) });
    expect(o.nft).toBe(NFT_NAME);
    expect(o.start).toBe(BigInt(1_730_000_000_000));
    expect(o.end).toBeNull();
    expect(o.partialFills).toBe(BigInt(2));
    expect(o.makerLovelaceFlatFee).toBe(BigInt(1_000_000));
    expect(o.takerLovelaceFlatFee).toBe(BigInt(1_000_000));
    expect(o.containedFee).toEqual({
      lovelaces: BigInt(2_000_000),
      offeredTokens: BigInt(10),
      askedTokens: BigInt(20),
    });
    expect(o.containedPayment).toBe(BigInt(1_500_000));
  });

  test("rejects wrong field count", () => {
    expect(() => parsePartialOrderDatum(C(0, B(PKH)))).toThrow();
  });

  test("rejects wrong ctor tag", () => {
    expect(() => parsePartialOrderDatum(C(1))).toThrow();
  });
});

describe("parsePartialOrderContainedFee", () => {
  test("parses 3 ordered fields", () => {
    expect(parsePartialOrderContainedFee(containedFee)).toEqual({
      lovelaces: BigInt(2_000_000),
      offeredTokens: BigInt(10),
      askedTokens: BigInt(20),
    });
  });
});

describe("validatePartialOrderDatum", () => {
  test("clean datum yields no issues", () => {
    expect(validatePartialOrderDatum(parsePartialOrderDatum(datum))).toEqual([]);
  });

  test("flags zero denominator and over-original remaining", () => {
    const bad: PD = C(
      0,
      B(PKH),
      ownerAddr,
      offered,
      I(100),
      I(200), // remaining > original
      ada,
      C(0, I(1), I(0)), // zero denominator
      B(NFT_NAME),
      C(1),
      C(1),
      I(0),
      I(0),
      I(0),
      containedFee,
      I(0),
    );
    const issues = validatePartialOrderDatum(parsePartialOrderDatum(bad));
    expect(issues.some((i) => i.severity === "error")).toBe(true);
    expect(issues.some((i) => i.message.includes("exceeds"))).toBe(true);
  });
});

describe("parsePartialOrderAction (redeemer, indexed 0/1/2)", () => {
  test("PartialCancel = Constr0[]", () => {
    expect(parsePartialOrderAction(C(0))).toEqual({ kind: "PartialCancel" });
    expect(classifyPartialOrderRedeemer(C(0))).toBe("Cancel");
  });

  test("PartialFill = Constr1[bare Int]", () => {
    expect(parsePartialOrderAction(C(1, I(250_000)))).toEqual({
      kind: "PartialFill",
      amount: BigInt(250_000),
    });
    expect(classifyPartialOrderRedeemer(C(1, I(250_000)))).toBe("Partial fill");
  });

  test("CompleteFill = Constr2[]", () => {
    expect(parsePartialOrderAction(C(2))).toEqual({ kind: "CompleteFill" });
    expect(classifyPartialOrderRedeemer(C(2))).toBe("Complete fill");
  });

  test("unknown ctor → throws / null", () => {
    expect(() => parsePartialOrderAction(C(3))).toThrow();
    expect(classifyPartialOrderRedeemer(C(3))).toBeNull();
  });
});

// --- Real PartialOrder datum --------------
// A V1 partial-order datum holding an order NFT under policy 22f6999d…f585.
const LIVE_OWNER = "8a2bc6aa1e8934dec5f557b918c614c7bdddeb1e5e55b6fa46223d0d";
const LIVE_STAKE = "43047865bc9cae1fb42b16d5ce97de24b5fd3abb474f9a38ed38bd0e";
const LIVE_NFT = "d0b49e182d6ac2ed5e7f67c0b9087d0b90b13d57427fbc821bd640946e03962d";
const liveOrderDatum: PD = C(
  0,
  B(LIVE_OWNER), // 0 podOwnerKey
  C(0, C(0, B(LIVE_OWNER)), C(0, C(0, C(0, B(LIVE_STAKE))))), // 1 podOwnerAddr
  C(0, B(""), B("")), // 2 podOfferedAsset = ada
  I(1), // 3 podOfferedOriginalAmount
  I(1), // 4 podOfferedAmount
  C(0, B("c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e"), B("7447454e53")), // 5 asked
  C(0, I(1), I(1)), // 6 podPrice 1/1
  B(LIVE_NFT), // 7 podNFT
  C(1), // 8 podStart = Nothing
  C(1), // 9 podEnd = Nothing
  I(0), // 10 podPartialFills
  I(1_000_000), // 11 podMakerLovelaceFlatFee
  I(1_000_000), // 12 podTakerLovelaceFlatFee
  C(0, I(1_000_000), I(1), I(0)), // 13 podContainedFee
  I(0), // 14 podContainedPayment
);

describe("parsePartialOrderDatum (real mainnet 15-field datum)", () => {
  test("decodes a live order without throwing and yields no issues", () => {
    const o = parsePartialOrderDatum(liveOrderDatum);
    expect(o.ownerKey).toBe(LIVE_OWNER);
    expect(o.offeredAsset).toEqual({ policyId: "", assetName: "" });
    expect(o.askedAsset.assetName).toBe("7447454e53");
    expect(o.offeredAmount).toBe(BigInt(1));
    expect(o.start).toBeNull();
    expect(o.end).toBeNull();
    expect(o.nft).toBe(LIVE_NFT);
    expect(o.containedFee).toEqual({
      lovelaces: BigInt(1_000_000),
      offeredTokens: BigInt(1),
      askedTokens: BigInt(0),
    });
    expect(validatePartialOrderDatum(o)).toEqual([]);
  });
});

describe("Genius Yield matching", () => {
  // The V1 CONFIG/PORef NFT policy (config datum's pocdNftSymbol identifies
  // 15-field PartialOrder UTxOs; this CONFIG policy holds the config datums).
  const CONFIG_POLICY = "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af2";

  test("parameterized validator → no script-hash match", () => {
    expect(matchGeniusYieldScriptHash()).toBeNull();
  });

  test("V1 order policy is the order NFT policy, not the config/PORef policy", () => {
    expect(GENIUS_YIELD_V1.nftPolicyV1).toBe(
      "22f6999d4effc0ade05f6e1a70b702c65d6b3cdf0e301e4a8267f585",
    );
    expect(GENIUS_YIELD_V1.nftPolicyV1).not.toBe(CONFIG_POLICY);
  });

  test("does NOT match the config/PORef NFT policy (which holds config datums)", () => {
    expect(matchGeniusYieldNftPolicy(CONFIG_POLICY, [NFT_NAME], "mainnet")).toBeNull();
  });

  test("matches order by V1 NFT policy on mainnet", () => {
    expect(matchGeniusYieldNftPolicy(GENIUS_YIELD_V1.nftPolicyV1, [NFT_NAME], "mainnet")).toBe(
      "order",
    );
    expect(matchGeniusYieldNftPolicy(GENIUS_YIELD_V1.nftPolicyV1, [], undefined)).toBe("order");
  });

  test("checks asset name when expected order NFT supplied", () => {
    expect(
      matchGeniusYieldNftPolicy(GENIUS_YIELD_V1.nftPolicyV1, [NFT_NAME], "mainnet", NFT_NAME),
    ).toBe("order");
    expect(
      matchGeniusYieldNftPolicy(GENIUS_YIELD_V1.nftPolicyV1, ["dead"], "mainnet", NFT_NAME),
    ).toBeNull();
  });

  test("rejects wrong policy and non-mainnet networks", () => {
    expect(matchGeniusYieldNftPolicy(POLICY, [NFT_NAME], "mainnet")).toBeNull();
    expect(matchGeniusYieldNftPolicy(GENIUS_YIELD_V1.nftPolicyV1, [NFT_NAME], "preprod")).toBeNull();
  });
});

describe("partialOrderToView trading pair", () => {
  test("pair = offered / asked (the two traded AssetClasses)", () => {
    const view = partialOrderToView(parsePartialOrderDatum(datum));
    expect(view.pair).toEqual({
      assetA: { policyId: POLICY, assetName: OFFERED_NAME },
      assetB: { policyId: "", assetName: "" },
    });
  });
});
