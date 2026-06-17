import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyJpgSwapRedeemer,
  parseJpgSwapDatum,
  parseJpgSwapRedeemer,
  validateJpgSwapDatum,
} from "./swap";
import { JPGSTORE, matchJpgStoreScriptHash } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });
const M = (...entries: { k: PD; v: PD }[]): PD => ({ map: entries });

const OWNER = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const SELLER = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const STAKE = "11112222333344445555666677778888999900001111222233334444";
const POLICY = "9abcdef09abcdef09abcdef09abcdef09abcdef09abcdef09abcdef0";
const TOKEN = "4d794e4654303031"; // "MyNFT001"

// SwapAddress = Constr0[ Credential, Maybe<StakingCredential> ] (parsePlutusAddress shape).
const sellerAddr: PD = C(0, C(0, B(SELLER)), C(0, C(0, C(0, B(STAKE)))));

// ExpectedValue value side = Constr0[ Int natCount, Map<TokenName, Int> ].
const singleAssetExpected: PD = C(0, I(1), M({ k: B(TOKEN), v: I(1) }));
// ExpectedValue = Map<CurrencySymbol, tuple>.
const expectedValue: PD = M({ k: B(POLICY), v: singleAssetExpected });

// Payout = Constr0[ SwapAddress, ExpectedValue ].
const payout: PD = C(0, sellerAddr, expectedValue);

describe("parseJpgSwapDatum", () => {
  // Swap = Constr0[ ByteArray owner, List<Payout> ] — owner is field0 here.
  const datum: PD = C(0, B(OWNER), L(payout));

  test("parses owner (field0) + payouts + expected value", () => {
    const d = parseJpgSwapDatum(datum);
    expect(d.owner).toBe(OWNER);
    expect(d.payouts.length).toBe(1);
    const p = d.payouts[0];
    expect(p.address.paymentCredential).toEqual({ kind: "VKey", hash: SELLER });
    expect(p.address.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: STAKE },
    });
    expect(p.expected.length).toBe(1);
    expect(p.expected[0].policyId).toBe(POLICY);
    expect(p.expected[0].natCount).toBe(BigInt(1));
    expect(p.expected[0].tokens).toEqual([{ assetName: TOKEN, quantity: BigInt(1) }]);
  });

  test("collection-floor offer: policy-only entry (empty token map)", () => {
    const floorExpected: PD = C(0, I(1), M());
    const floorPayout: PD = C(0, sellerAddr, M({ k: B(POLICY), v: floorExpected }));
    const d = parseJpgSwapDatum(C(0, B(OWNER), L(floorPayout)));
    expect(d.payouts[0].expected[0].tokens).toEqual([]);
    expect(d.payouts[0].expected[0].policyId).toBe(POLICY);
  });

  test("rejects wrong datum ctor", () => {
    expect(() => parseJpgSwapDatum(C(1, B(OWNER), L()))).toThrow();
  });

  test("rejects wrong field count", () => {
    expect(() => parseJpgSwapDatum(C(0, B(OWNER)))).toThrow();
  });

  test("rejects wrong ExpectedValue tuple ctor", () => {
    const badExpected: PD = M({ k: B(POLICY), v: C(1, I(1), M()) });
    expect(() =>
      parseJpgSwapDatum(C(0, B(OWNER), L(C(0, sellerAddr, badExpected)))),
    ).toThrow();
  });
});

describe("validateJpgSwapDatum", () => {
  test("clean datum has no issues", () => {
    const d = parseJpgSwapDatum(C(0, B(OWNER), L(payout)));
    expect(validateJpgSwapDatum(d)).toEqual([]);
  });

  test("flags bad owner length and empty payouts", () => {
    const d = parseJpgSwapDatum(C(0, B("abcd"), L()));
    const issues = validateJpgSwapDatum(d);
    expect(issues.some((i) => i.message.includes("28"))).toBe(true);
    expect(issues.some((i) => i.message.includes("no payouts"))).toBe(true);
  });
});

describe("parseJpgSwapRedeemer / classifyJpgSwapRedeemer", () => {
  test("Cancel = Constr0[]", () => {
    expect(parseJpgSwapRedeemer(C(0)).kind).toBe("Cancel");
    expect(classifyJpgSwapRedeemer(C(0))).toBe("Cancel");
  });

  test("Accept = Constr1[]", () => {
    expect(parseJpgSwapRedeemer(C(1)).kind).toBe("Accept");
    expect(classifyJpgSwapRedeemer(C(1))).toBe("Accept");
  });

  test("unexpected shapes", () => {
    expect(() => parseJpgSwapRedeemer(C(2))).toThrow();
    expect(classifyJpgSwapRedeemer(C(0, I(1)))).toBeNull();
    expect(classifyJpgSwapRedeemer(C(2))).toBeNull();
  });
});

describe("JPG Store OffersV2 matching", () => {
  test("offersV2 swap hash → offer on mainnet only", () => {
    expect(matchJpgStoreScriptHash(JPGSTORE.offersV2SwapHash, "mainnet")).toBe("offer");
    expect(matchJpgStoreScriptHash(JPGSTORE.offersV2SwapHash, undefined)).toBe("offer");
    expect(matchJpgStoreScriptHash(JPGSTORE.offersV2SwapHash, "preprod")).toBeNull();
  });

  test("offer hash is distinct from ask listing hash", () => {
    expect(matchJpgStoreScriptHash(JPGSTORE.askListingHash, "mainnet")).toBe("listing");
    expect(JPGSTORE.offersV2SwapHash).not.toBe(JPGSTORE.askListingHash);
  });
});
