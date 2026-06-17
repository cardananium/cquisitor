import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyJpgAskRedeemer,
  jpgPayoutsSum,
  parseJpgAskDatum,
  parseJpgAskRedeemer,
  validateJpgAskDatum,
} from "./ask";
import { JPGSTORE, matchJpgStoreNftPolicy, matchJpgStoreScriptHash } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const SELLER = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const ROYALTY = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const STAKE = "11112222333344445555666677778888999900001111222233334444";

// Address = Constr0[ Credential, Option<Referenced<Credential>> ].
// Seller payment cred (VKey) with inline stake cred.
const sellerAddr: PD = C(0, C(0, B(SELLER)), C(0, C(0, C(0, B(STAKE)))));
// Royalty payment cred (VKey) with no stake (None).
const royaltyAddr: PD = C(0, C(0, B(ROYALTY)), C(1));

// Payout = Constr0[ Address, Int(amount_lovelace) ].
const sellerPayout: PD = C(0, sellerAddr, I(98_000_000));
const royaltyPayout: PD = C(0, royaltyAddr, I(2_000_000));

describe("parseJpgAskDatum", () => {
  const datum: PD = C(0, L(sellerPayout, royaltyPayout), B(SELLER));

  test("parses payouts + owner", () => {
    const d = parseJpgAskDatum(datum);
    expect(d.owner).toBe(SELLER);
    expect(d.payouts.length).toBe(2);
    expect(d.payouts[0].amountLovelace).toBe(BigInt(98_000_000));
    expect(d.payouts[0].address.paymentCredential).toEqual({ kind: "VKey", hash: SELLER });
    expect(d.payouts[0].address.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: STAKE },
    });
    expect(d.payouts[1].amountLovelace).toBe(BigInt(2_000_000));
    expect(d.payouts[1].address.stakeCredential).toBeNull();
  });

  test("jpgPayoutsSum sums all payouts", () => {
    const d = parseJpgAskDatum(datum);
    expect(jpgPayoutsSum(d)).toBe(BigInt(100_000_000));
  });

  test("rejects wrong datum ctor", () => {
    expect(() => parseJpgAskDatum(C(1, L(), B(SELLER)))).toThrow();
  });

  test("rejects wrong field count", () => {
    expect(() => parseJpgAskDatum(C(0, L()))).toThrow();
  });
});

describe("validateJpgAskDatum", () => {
  test("clean datum has no issues", () => {
    const d = parseJpgAskDatum(C(0, L(sellerPayout), B(SELLER)));
    expect(validateJpgAskDatum(d)).toEqual([]);
  });

  test("flags empty payouts, bad owner length, non-positive amount", () => {
    const badOwner = "abcd";
    const zeroPayout: PD = C(0, sellerAddr, I(0));
    const d = parseJpgAskDatum(C(0, L(zeroPayout), B(badOwner)));
    const issues = validateJpgAskDatum(d);
    expect(issues.some((i) => i.message.includes("28"))).toBe(true);
    expect(issues.some((i) => i.message.includes("positive"))).toBe(true);
  });
});

describe("parseJpgAskRedeemer / classifyJpgAskRedeemer", () => {
  test("Buy = Constr0[Int]", () => {
    const r = parseJpgAskRedeemer(C(0, I(3)));
    expect(r.kind).toBe("Buy");
    if (r.kind !== "Buy") throw new Error("expected Buy");
    expect(r.payoutOutputsOffset).toBe(BigInt(3));
    expect(classifyJpgAskRedeemer(C(0, I(3)))).toBe("Buy");
  });

  test("WithdrawOrUpdate = Constr1[]", () => {
    const r = parseJpgAskRedeemer(C(1));
    expect(r.kind).toBe("WithdrawOrUpdate");
    expect(classifyJpgAskRedeemer(C(1))).toBe("Withdraw or update");
  });

  test("unexpected shapes", () => {
    expect(() => parseJpgAskRedeemer(C(2))).toThrow();
    expect(classifyJpgAskRedeemer(C(0))).toBeNull(); // Buy must carry the offset
    expect(classifyJpgAskRedeemer(C(1, I(1)))).toBeNull();
  });
});

describe("JPG Store matching", () => {
  test("ask listing hash → listing on mainnet only", () => {
    expect(matchJpgStoreScriptHash(JPGSTORE.askListingHash, "mainnet")).toBe("listing");
    expect(matchJpgStoreScriptHash(JPGSTORE.askListingHash, undefined)).toBe("listing");
    expect(matchJpgStoreScriptHash(JPGSTORE.askListingHash, "preprod")).toBeNull();
  });

  test("marketplace fee hash is NOT the listing UTxO", () => {
    expect(matchJpgStoreScriptHash(JPGSTORE.marketplaceFeeHash, "mainnet")).toBeNull();
  });

  test("unrelated hash and nft policy do not match", () => {
    expect(matchJpgStoreScriptHash(SELLER, "mainnet")).toBeNull();
    expect(matchJpgStoreNftPolicy(SELLER, ["4c"], "mainnet")).toBeNull();
  });
});
