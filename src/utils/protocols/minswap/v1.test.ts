import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyMinswapV1OrderRedeemer,
  classifyMinswapStableswapPoolRedeemer,
  parseMinswapV1OrderDatum,
  parseMinswapV1PoolDatum,
  parseMinswapStableswapOrderDatum,
  parseMinswapStableswapPoolDatum,
} from "./v1";
import {
  minswapV1OrderToView,
  minswapV1PoolToView,
  minswapStableswapOrderToView,
  minswapStableswapPoolToView,
} from "./index";
import { matchMinswapV1ScriptHash, matchMinswapStableswapScriptHash, MINSWAP_V1, MINSWAP_STABLESWAP } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const NAME = "4d494e";
const ada: PD = C(0, B(""), B(""));
const token: PD = C(0, B(POLICY), B(NAME));
const keyAddr: PD = C(0, C(0, B(PKH)), C(1)); // key payment, no stake

describe("Minswap V1 order datum", () => {
  const datum: PD = C(0, keyAddr, keyAddr, C(1), C(0, token, I(950)), I(2_000_000), I(2_000_000));
  test("parses SwapExactIn (6 fields)", () => {
    const d = parseMinswapV1OrderDatum(datum);
    expect(d.step).toEqual({ kind: "SwapExactIn", desiredAsset: { policyId: POLICY, assetName: NAME }, minimumReceived: BigInt(950) });
    expect(d.batcherFee).toBe(BigInt(2_000_000));
    expect(d.receiverDatumHash).toBeNull();
  });
  test("view is labeled Minswap V1", () => {
    const v = minswapV1OrderToView(parseMinswapV1OrderDatum(datum));
    expect(v.protocol).toBe("Minswap V1");
    expect(v.role).toBe("v1-order");
    expect(v.kind).toBe("Swap (exact in)");
  });
});

describe("Minswap V1 pool datum", () => {
  const datum: PD = C(0, ada, token, I(1_000_000), I(42), C(1));
  test("parses 5 fields", () => {
    const d = parseMinswapV1PoolDatum(datum);
    expect(d.assetA).toEqual({ policyId: "", assetName: "" });
    expect(d.totalLiquidity).toBe(BigInt(1_000_000));
    expect(d.rootKLast).toBe(BigInt(42));
    expect(d.feeSharing).toBeNull();
  });
  test("view labeled Minswap V1 pool", () => {
    expect(minswapV1PoolToView(parseMinswapV1PoolDatum(datum)).role).toBe("v1-pool");
  });
  test("redeemer classify", () => {
    expect(classifyMinswapV1OrderRedeemer(C(0))).toBe("ApplyOrder");
    expect(classifyMinswapV1OrderRedeemer(C(1))).toBe("CancelOrder");
  });
});

describe("Minswap Stableswap", () => {
  const orderDatum: PD = C(0, keyAddr, keyAddr, C(1), C(0, I(0), I(1), I(99)), I(1_000_000), I(2_000_000));
  const poolDatum: PD = C(0, L(I(500), I(700)), I(1_200), I(100), B(PKH));
  test("order: Swap step with asset indices", () => {
    const d = parseMinswapStableswapOrderDatum(orderDatum);
    expect(d.step).toEqual({ kind: "Swap", assetInIndex: BigInt(0), assetOutIndex: BigInt(1), minimumAssetOut: BigInt(99) });
    expect(minswapStableswapOrderToView(d).protocol).toBe("Minswap Stableswap");
  });
  test("pool: balances + amp + orderHash", () => {
    const d = parseMinswapStableswapPoolDatum(poolDatum);
    expect(d.balances).toEqual([BigInt(500), BigInt(700)]);
    expect(d.amplificationCoefficient).toBe(BigInt(100));
    expect(d.orderHash).toBe(PKH);
    const v = minswapStableswapPoolToView(d);
    expect(v.role).toBe("stableswap-pool");
    expect(v.kind).toBe("Stable Pool");
  });
  test("pool redeemer classify", () => {
    expect(classifyMinswapStableswapPoolRedeemer(C(0))).toBe("ApplyPool");
    expect(classifyMinswapStableswapPoolRedeemer(C(2))).toBe("UpdateAmpOrStakeCredential");
  });
});

describe("Minswap V1 + Stableswap matching", () => {
  test("v1 order/pool hashes map to v1 roles", () => {
    expect(matchMinswapV1ScriptHash(MINSWAP_V1.orderScriptHash, "mainnet")).toBe("v1-order");
    expect(matchMinswapV1ScriptHash(MINSWAP_V1.poolScriptHash, undefined)).toBe("v1-pool");
    expect(matchMinswapV1ScriptHash(MINSWAP_V1.orderScriptHash, "preprod")).toBeNull();
  });
  test("stableswap pool hashes map to stableswap roles", () => {
    expect(matchMinswapStableswapScriptHash(MINSWAP_STABLESWAP.orderScriptHashes[0], "mainnet")).toBe("stableswap-order");
    expect(matchMinswapStableswapScriptHash(MINSWAP_STABLESWAP.poolScriptHashes[0], "mainnet")).toBe("stableswap-pool");
  });
});
