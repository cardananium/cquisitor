import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  askedAmount,
  askedAsset,
  classifyChadswapRedeemer,
  offeredAmount,
  offeredAsset,
  parseChadswapOrder,
  validateChadswapOrder,
} from "./chadswap";
import { matchChadswapScriptHash, CHADSWAP } from "./constants";
import { getDexAdapter } from "@/utils/protocols/dex/registry";
import "./index"; // registers the chadswap adapter (decode path)

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const SNEK_POLICY = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f";
const SNEK_NAME = "534e454b"; // "SNEK"
const MAKER_PAY = "022835b77a25d6bf00f8cbf7e4744e0065ec77383500221ed4f32514";
const MAKER_STAKE = "3cc6ea3784eecc03bc736d90e368abb40f873c48d1fc74133afae5a5";

// Address = Constr0[ Constr0[paymentKeyHash], Some(Inline(VKey stakeHash)) ]
const maker: PD = C(0, C(0, B(MAKER_PAY)), C(0, C(0, C(0, B(MAKER_STAKE)))));

// params = Constr0[ maker, dirBool, policy, name, price, Constr0[1], None, deadline ]
const params = (dirTag: number, price: number, deadline: PD): PD =>
  C(0, maker, C(dirTag), B(SNEK_POLICY), B(SNEK_NAME), I(price), C(0, I(1)), C(1), deadline);

// Real BUY order (datum f5ccdcec…): dir Bool=True (Constr1) → BUY, price 4000,
// total 500000, no expiry.  maker locks ADA, wants 500000 SNEK.
const buyOrder: PD = C(0, params(1, 4000, C(1)), C(0, I(500000), I(0)), C(1), C(1));

// Real SELL order (datum 0f2254e8…): dir Bool=False (Constr0) → SELL, price 4249,
// total 1178660. maker locks 1178660 SNEK, wants ADA.
const sellOrder: PD = C(0, params(0, 4249, C(1)), C(0, I(1178660), I(0)), C(1), C(1));

describe("parseChadswapOrder — real BUY order (ADA → SNEK)", () => {
  test("decodes maker, direction, token, price, amounts", () => {
    const o = parseChadswapOrder(buyOrder);
    expect(o.maker.paymentCredential).toEqual({ kind: "VKey", hash: MAKER_PAY });
    expect(o.maker.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: MAKER_STAKE },
    });
    expect(o.sellToken).toBe(false); // BUY token with ADA
    expect(o.token).toEqual({ policyId: SNEK_POLICY, assetName: SNEK_NAME });
    expect(o.price).toBe(BigInt(4000));
    expect(o.total).toBe(BigInt(500000));
    expect(o.filled).toBe(BigInt(0));
    expect(o.deadline).toBeNull();
    expect(o.flag).toBe(BigInt(1));
  });

  test("offered = ADA (total*price lovelace), asked = SNEK (total)", () => {
    const o = parseChadswapOrder(buyOrder);
    expect(offeredAsset(o)).toEqual({ policyId: "", assetName: "" });
    expect(askedAsset(o)).toEqual({ policyId: SNEK_POLICY, assetName: SNEK_NAME });
    expect(offeredAmount(o)).toBe(BigInt(500000) * BigInt(4000)); // 2,000,000,000 lovelace
    expect(askedAmount(o)).toBe(BigInt(500000));
  });
});

describe("parseChadswapOrder — real SELL order (SNEK → ADA)", () => {
  test("offered = SNEK (total), asked = ADA (total*price)", () => {
    const o = parseChadswapOrder(sellOrder);
    expect(o.sellToken).toBe(true); // SELL token for ADA
    expect(offeredAsset(o)).toEqual({ policyId: SNEK_POLICY, assetName: SNEK_NAME });
    expect(askedAsset(o)).toEqual({ policyId: "", assetName: "" });
    expect(offeredAmount(o)).toBe(BigInt(1178660));
    expect(askedAmount(o)).toBe(BigInt(1178660) * BigInt(4249));
  });

  test("Some(deadline) decodes the expiry", () => {
    const withExpiry: PD = C(
      0,
      params(0, 4249, C(0, I(1_730_000_000_000))),
      C(0, I(1178660), I(0)),
      C(1),
      C(1),
    );
    expect(parseChadswapOrder(withExpiry).deadline).toBe(BigInt(1_730_000_000_000));
  });

  test("rejects wrong outer ctor / field counts", () => {
    expect(() => parseChadswapOrder(C(1, params(0, 1, C(1)), C(0, I(1), I(0)), C(1), C(1)))).toThrow();
    expect(() => parseChadswapOrder(C(0, params(0, 1, C(1))))).toThrow(); // too few outer fields
  });
});

describe("validateChadswapOrder", () => {
  test("clean order has no issues", () => {
    expect(validateChadswapOrder(parseChadswapOrder(buyOrder))).toEqual([]);
    expect(validateChadswapOrder(parseChadswapOrder(sellOrder))).toEqual([]);
  });

  test("flags short maker payment hash", () => {
    // maker payment hash is only 1 byte; params still has all 8 fields.
    const badMaker: PD = C(0, C(0, B("00")), C(1)); // Address with 1-byte key cred, no stake
    const bad: PD = C(
      0,
      C(0, badMaker, C(0), B(SNEK_POLICY), B(SNEK_NAME), I(1), C(0, I(1)), C(1), C(1)),
      C(0, I(1), I(0)),
      C(1),
      C(1),
    );
    const issues = validateChadswapOrder(parseChadswapOrder(bad));
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  test("flags filled outside [0, total]", () => {
    const over: PD = C(0, params(0, 4249, C(1)), C(0, I(100), I(200)), C(1), C(1));
    const issues = validateChadswapOrder(parseChadswapOrder(over));
    expect(issues.some((i) => i.message.includes("filled"))).toBe(true);
  });
});

describe("classifyChadswapRedeemer", () => {
  test("Constr0[Int] = Action; anything else = null", () => {
    expect(classifyChadswapRedeemer(C(0, I(0)))).toBe("Action");
    expect(classifyChadswapRedeemer(C(0, I(2)))).toBe("Action");
    expect(classifyChadswapRedeemer(C(0))).toBeNull(); // no index
    expect(classifyChadswapRedeemer(C(1, I(0)))).toBeNull();
    expect(classifyChadswapRedeemer(B("00"))).toBeNull();
  });
});

describe("orderToView — adapter decode path", () => {
  const decode = getDexAdapter("chadswap")!.decode!;

  test("BUY order: pair = token / ADA, direction + maker stake rows", () => {
    const view = decode(buyOrder, "order");
    expect(view.protocol).toBe("ChadSwap");
    expect(view.role).toBe("order");
    expect(view.kind).toBe("Order: buy ADA → SNEK");
    // offered → asked legs: offered = ADA, asked = SNEK
    expect(view.pair).toEqual({
      assetA: { policyId: "", assetName: "" },
      assetB: { policyId: SNEK_POLICY, assetName: SNEK_NAME },
    });
    const maker = view.rows.find((r) => r.label === "Maker (key)");
    expect(maker?.value).toBe(MAKER_PAY);
    const stake = view.rows.find((r) => r.label === "Maker stake (key)");
    expect(stake?.value).toBe(MAKER_STAKE);
    const dir = view.rows.find((r) => r.label === "Direction");
    expect(dir?.value).toBe("BUY token with ADA");
  });

  test("SELL order: pair = SNEK / ADA, sell headline", () => {
    const view = decode(sellOrder, "order");
    expect(view.kind).toBe("Order: sell SNEK → ADA");
    expect(view.pair).toEqual({
      assetA: { policyId: SNEK_POLICY, assetName: SNEK_NAME },
      assetB: { policyId: "", assetName: "" },
    });
  });
});

describe("ChadSwap matching", () => {
  test("order by mainnet payment hash only", () => {
    expect(matchChadswapScriptHash(CHADSWAP.orderHash, "mainnet")).toBe("order");
    expect(matchChadswapScriptHash(CHADSWAP.orderHash, undefined)).toBe("order");
    expect(matchChadswapScriptHash(CHADSWAP.orderHash, "preprod")).toBeNull();
    expect(matchChadswapScriptHash(CHADSWAP.orderHash.toUpperCase(), "mainnet")).toBe("order");
    expect(matchChadswapScriptHash(MAKER_PAY, "mainnet")).toBeNull();
  });
});
