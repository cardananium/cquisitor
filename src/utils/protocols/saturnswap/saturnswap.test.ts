import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifySaturnRedeemer,
  parseSaturnOrder,
  parseSaturnRedeemer,
  validateSaturnOrder,
} from "./saturnswap";
import { matchSaturnSwapScriptHash, SATURNSWAP } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const SCRIPT = SATURNSWAP.liquidityHash; // 28-byte script payment hash
const STAKE = SATURNSWAP.stakeCred;
const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const OFFERED_POLICY = "7ff33a5565393dc47b48ac47becc12d92c9952e724e8446dfb6adc66";
const OFFERED_NAME = "634d41545241"; // "cMATRA"
const TXID = "315e55bfcfd15136cfc8f382dac237ec50ef979c6032d5a8949dacc3f00ba44c";

// Address = Constr0[ Credential, Some(Inline(Credential)) ]
const scriptOwner: PD = C(0, C(1, B(SCRIPT)), C(0, C(0, C(0, B(STAKE)))));
const keyOwner: PD = C(0, C(0, B(PKH)), C(1)); // no stake
// nonce = Constr0[ Constr0[ bytes txid ], Int idx ]
const nonce: PD = C(0, C(0, B(TXID)), I(3));

// Pool-owned SELL order: offered cMATRA, asked ADA, no expiry.
const liveOrder: PD = C(
  0,
  scriptOwner, // [0] owner
  B(OFFERED_POLICY), // [1] offeredPolicy
  B(OFFERED_NAME), // [2] offeredName
  I(BigInt("839724275205")), // [3] offeredAmount
  B(""), // [4] askedPolicy (ADA)
  B(""), // [5] askedName (ADA)
  I(1_983_924_310), // [6] askedAmount (lovelace)
  C(1), // [7] expiry None
  nonce, // [8] nonce
);

describe("parseSaturnOrder — live pool order", () => {
  test("parses all 9 fields", () => {
    const o = parseSaturnOrder(liveOrder);
    expect(o.owner.paymentCredential).toEqual({ kind: "Script", hash: SCRIPT });
    expect(o.owner.stakeCredential).toEqual({ kind: "Inline", credential: { kind: "VKey", hash: STAKE } });
    expect(o.offered).toEqual({ policyId: OFFERED_POLICY, assetName: OFFERED_NAME });
    expect(o.offeredAmount).toBe(BigInt("839724275205"));
    expect(o.asked).toEqual({ policyId: "", assetName: "" });
    expect(o.askedAmount).toBe(BigInt(1_983_924_310));
    expect(o.expiry).toBeNull();
    expect(o.nonce).toEqual({ txId: TXID, outputIndex: BigInt(3) });
    expect(o.nonceIndex).toBe(BigInt(3));
  });

  test("Some(expiry) decodes the deadline", () => {
    const withExpiry = C(
      0,
      keyOwner,
      B(""), B(""), I(5_000_000), // offered ADA
      B(OFFERED_POLICY), B(OFFERED_NAME), I(10), // asked token
      C(0, I(1_730_000_000_000)), // expiry Some
      nonce,
    );
    const o = parseSaturnOrder(withExpiry);
    expect(o.expiry).toBe(BigInt(1_730_000_000_000));
    expect(o.owner.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(o.owner.stakeCredential).toBeNull();
  });

  test("rejects wrong field count and wrong ctor", () => {
    expect(() => parseSaturnOrder(C(0, B("")))).toThrow();
    expect(() => parseSaturnOrder(C(1, B("")))).toThrow();
  });
});

describe("validateSaturnOrder", () => {
  test("clean live order has no issues", () => {
    expect(validateSaturnOrder(parseSaturnOrder(liveOrder))).toEqual([]);
  });

  test("flags short owner payment hash", () => {
    const bad = C(0, C(0, C(0, B("00")), C(1)), B(""), B(""), I(1), B(""), B(""), I(1), C(1), nonce);
    const issues = validateSaturnOrder(parseSaturnOrder(bad));
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });
});

describe("parseSaturnRedeemer", () => {
  test("Fill = Constr0[fillAmount, inputIndex, extraIndex]", () => {
    const r = parseSaturnRedeemer(C(0, I(69_000_000), I(0), I(0)));
    expect(r).toEqual({ kind: "Fill", fillAmount: BigInt(69_000_000), inputIndex: BigInt(0), extraIndex: BigInt(0) });
  });

  test("Cancel = Constr1[]", () => {
    expect(parseSaturnRedeemer(C(1))).toEqual({ kind: "Cancel" });
  });

  test("classify helper", () => {
    expect(classifySaturnRedeemer(C(0, I(1), I(0), I(0)))).toBe("Fill");
    expect(classifySaturnRedeemer(C(1))).toBe("Cancel");
    expect(classifySaturnRedeemer(C(0))).toBeNull(); // Fill needs ≥1 field
    expect(classifySaturnRedeemer(C(1, I(1)))).toBeNull(); // Cancel takes no field
  });
});

describe("SaturnSwap matching", () => {
  test("order by mainnet payment hash only", () => {
    expect(matchSaturnSwapScriptHash(SATURNSWAP.orderHash, "mainnet")).toBe("order");
    expect(matchSaturnSwapScriptHash(SATURNSWAP.orderHash, undefined)).toBe("order");
    expect(matchSaturnSwapScriptHash(SATURNSWAP.orderHash, "preprod")).toBeNull();
    expect(matchSaturnSwapScriptHash(SATURNSWAP.liquidityHash, "mainnet")).toBeNull();
    expect(matchSaturnSwapScriptHash(PKH, "mainnet")).toBeNull();
  });
});
