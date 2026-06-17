import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyVyFinanceOrderRedeemer,
  parseVyFinanceOrder,
  parseVyFinancePool,
} from "./vyfinance";
import {
  matchVyFinanceNftPolicy,
  matchVyFinanceScriptHash,
  VYFINANCE,
} from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

// ADA/USDA order datums, order addr addr1w9wghyy…
const SENDER_56 =
  "206fada7cabc3cd901a73059409015c1e36ab9811daea4d4f21ec9dbaee6166a5bc0df5fc7a09d10d6ed6c30be9817105ee625653a5684e1";
const SENDER_56_B =
  "d0de1f5308c1f0bf5fe04c63522617b22779234642edbe295a75c4909c36f26f5ecbd4fa3b774a68f276a640c7976ea52ca2253c66b4a3d3";

describe("parseVyFinanceOrder — swap actions", () => {
  test("action 3 (expect token out) — live ADA/USDA datum", () => {
    // Constr0[ bytes, Constr3[ int 11376831 ] ]
    const datum = C(0, B(SENDER_56), C(3, I(11_376_831)));
    const o = parseVyFinanceOrder(datum);
    expect(o.direction).toBe("expectToken");
    expect(o.actionTag).toBe(3);
    expect(o.minReceive).toBe(BigInt(11_376_831));
    expect(o.paymentPkh).toBe(SENDER_56.slice(0, 56));
    expect(o.stakeKeyHash).toBe(SENDER_56.slice(56, 112));
    expect(o.issues).toEqual([]);
  });

  test("action 4 (expect ADA out) — live ADA/USDA datum", () => {
    // Constr0[ bytes, Constr4[ int 56199507 ] ]
    const datum = C(0, B(SENDER_56_B), C(4, I(56_199_507)));
    const o = parseVyFinanceOrder(datum);
    expect(o.direction).toBe("expectAda");
    expect(o.actionTag).toBe(4);
    expect(o.minReceive).toBe(BigInt(56_199_507));
    expect(o.stakeKeyHash).toBe(SENDER_56_B.slice(56, 112));
  });

  test("enterprise sender (28-byte field0) → null stake key, no warning", () => {
    const pkh = SENDER_56.slice(0, 56);
    const o = parseVyFinanceOrder(C(0, B(pkh), C(3, I(1))));
    expect(o.paymentPkh).toBe(pkh);
    expect(o.stakeKeyHash).toBeNull();
    expect(o.issues).toEqual([]);
  });

  test("unconfirmed liquidity action tag (0/1/2) → liquidity direction, raw int, no issue", () => {
    const o = parseVyFinanceOrder(C(0, B(SENDER_56), C(1, I(42))));
    expect(o.direction).toBe("liquidity");
    expect(o.actionTag).toBe(1);
    expect(o.minReceive).toBe(BigInt(42));
    expect(o.issues).toEqual([]);
  });
});

describe("parseVyFinancePool", () => {
  test("3-Int pool datum — live ADA/USDA pool datum", () => {
    // Constr0[ int 371184, int 80195, int 4302136218 ]
    const datum = C(0, I(371_184), I(80_195), I(4_302_136_218));
    const p = parseVyFinancePool(datum);
    expect(p.barFeeA).toBe(BigInt(371_184));
    expect(p.barFeeB).toBe(BigInt(80_195));
    expect(p.totalLpTokens).toBe(BigInt(4_302_136_218));
    expect(p.issues).toEqual([]);
  });

  test("rejects wrong field count", () => {
    expect(() => parseVyFinancePool(C(0, I(1), I(2)))).toThrow();
  });
});

describe("classifyVyFinanceOrderRedeemer", () => {
  test("Constr1[] = Cancel (d87a80), Constr0[] = Execute", () => {
    expect(classifyVyFinanceOrderRedeemer(C(1))).toBe("Cancel");
    expect(classifyVyFinanceOrderRedeemer(C(0))).toBe("Execute");
    expect(classifyVyFinanceOrderRedeemer(C(0, I(1)))).toBeNull();
  });
});

describe("VyFinance matching", () => {
  test("order + pool by applied mainnet payment hash", () => {
    expect(matchVyFinanceScriptHash(VYFINANCE.orderValidatorHash, "mainnet")).toBe("order");
    expect(matchVyFinanceScriptHash(VYFINANCE.poolValidatorHash, undefined)).toBe("pool");
    // poolStakeKey is the stake credential, NOT a payment hash — must NOT match.
    expect(matchVyFinanceScriptHash(VYFINANCE.poolStakeKey, "mainnet")).toBeNull();
    expect(matchVyFinanceScriptHash(VYFINANCE.orderValidatorHash, "preprod")).toBeNull();
    expect(matchVyFinanceScriptHash("deadbeef", "mainnet")).toBeNull();
  });

  test("pool by mainNFT policy; operator policy does not identify a pool", () => {
    expect(matchVyFinanceNftPolicy(VYFINANCE.mainNftPolicy, [], "mainnet")).toBe("pool");
    expect(matchVyFinanceNftPolicy(VYFINANCE.operatorTokenPolicy, [], "mainnet")).toBeNull();
    expect(matchVyFinanceNftPolicy(VYFINANCE.mainNftPolicy, [], "preprod")).toBeNull();
  });
});
