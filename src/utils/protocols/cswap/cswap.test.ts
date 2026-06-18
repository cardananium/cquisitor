import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyCswapOrderRedeemer,
  classifyCswapPoolRedeemer,
  parseCswapOrder,
  parseCswapPool,
  validateCswapOrder,
  validateCswapPool,
} from "./cswap";
import { matchCswapScriptHash, CSWAP } from "./constants";
import { getDexAdapter } from "@/utils/protocols/dex/registry";
import "./index"; // registers the cswap adapter (decode path)

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

// --- REAL values observed on mainnet -------------------------------------
// Order: tx a0ef6acf…3abf #0 (orderbook script da5b47ae…6d4e).
const ORDER_OWNER_PKH = "c5a771e2f142775d101dfd0528dc3f39783cadd3893091ab08d09db4";
const ORDER_OWNER_STAKE = "cbb80a04218386e6aee12c6aba6082df09ba95d7626c8a1531fdb9d3";
const ANGELS_POLICY = "285b65ae63d4fad36321384ec61edfd5187b8194fff89b5abe9876da";
const ANGELS_NAME = "414e47454c53"; // "ANGELS"

// Address = Constr0[ Constr0[PKH], Some(Inline(VKey)) ]
//   Some = Constr0[x]; Inline = Constr0[cred]; VKey cred = Constr0[bytes].
const orderOwner: PD = C(0, C(0, B(ORDER_OWNER_PKH)), C(0, C(0, C(0, B(ORDER_OWNER_STAKE)))));

// The real captured order: holds ADA, wants 2 ADA + 3,038,976 ANGELS.
const liveOrder: PD = C(
  0,
  orderOwner, // [0] owner
  L(
    L(B(""), B(""), I(2_000_000)), // [1] wanted: 2 ADA
    L(B(ANGELS_POLICY), B(ANGELS_NAME), I(3_038_976)), // + 3,038,976 ANGELS
  ),
  L(L(B(""), B(""), I(0))), // [2] residual: ADA x0
  C(0), // [3] order-type marker
  I(500), // [4] paramA
  I(15), // [5] paramB
);

describe("parseCswapOrder — live orderbook order", () => {
  test("parses all 6 fields with real values", () => {
    const o = parseCswapOrder(liveOrder);
    expect(o.owner.paymentCredential).toEqual({ kind: "VKey", hash: ORDER_OWNER_PKH });
    expect(o.owner.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: ORDER_OWNER_STAKE },
    });
    expect(o.wanted).toEqual([
      { policyId: "", assetName: "", amount: BigInt(2_000_000) },
      { policyId: ANGELS_POLICY, assetName: ANGELS_NAME, amount: BigInt(3_038_976) },
    ]);
    expect(o.residual).toEqual([{ policyId: "", assetName: "", amount: BigInt(0) }]);
    expect(o.flagTag).toBe(0);
    expect(o.paramA).toBe(BigInt(500));
    expect(o.paramB).toBe(BigInt(15));
  });

  test("rejects wrong field count and wrong ctor", () => {
    expect(() => parseCswapOrder(C(0, orderOwner))).toThrow();
    expect(() => parseCswapOrder(C(1, orderOwner, L(), L(), C(0), I(1), I(1)))).toThrow();
  });

  test("clean live order has no issues", () => {
    expect(validateCswapOrder(parseCswapOrder(liveOrder))).toEqual([]);
  });
});

describe("orderToView — pair + rows", () => {
  const decode = getDexAdapter("cswap")!.decode!;

  test("pair = the two distinct wanted assets (ADA / ANGELS)", () => {
    const view = decode(liveOrder, "order");
    expect(view.role).toBe("order");
    expect(view.pair).toEqual({
      assetA: { policyId: "", assetName: "" },
      assetB: { policyId: ANGELS_POLICY, assetName: ANGELS_NAME },
    });
  });

  test("owner stake credential is surfaced as its own row", () => {
    const view = decode(liveOrder, "order");
    expect(view.rows.find((r) => r.label === "Owner (key)")?.value).toBe(ORDER_OWNER_PKH);
    expect(view.rows.find((r) => r.label === "Owner stake (key)")?.value).toBe(ORDER_OWNER_STAKE);
  });

  test("single distinct wanted asset pairs against ADA", () => {
    const sellForToken: PD = C(
      0,
      orderOwner,
      L(L(B(ANGELS_POLICY), B(ANGELS_NAME), I(162_434_702))), // wants only ANGELS
      L(L(B(""), B(""), I(0))),
      C(0),
      I(200),
      I(15),
    );
    const view = decode(sellForToken, "order");
    expect(view.pair).toEqual({
      assetA: { policyId: "", assetName: "" },
      assetB: { policyId: ANGELS_POLICY, assetName: ANGELS_NAME },
    });
  });
});

// --- POOL -----------------------------------------------------------------
// Pool: tx 0fa4b1ce…508e #1 (pool script ed97e0a1…7f6f), ADA / "Cardano Maxi".
const MAXI_POLICY = "017afeedd107263a72ec6f9d1441e7fc42278b4739df1598dea416e2";
const MAXI_NAME = "43617264616e6f204d617869"; // "Cardano Maxi"
const MAXI_LP_POLICY = "1f82c2bdfa2e02acf2d24773c8648fa4a4e0d2b186c5e280526bfc69";
const MAXI_LP_NAME = "432d4c503a2041444120782043617264616e6f204d617869"; // "C-LP: ADA x Cardano Maxi"

const livePool: PD = C(
  0,
  I(7_318_972), // [0] balance
  I(85), // [1] feeNumerator
  B(""), // [2] assetA policy (ADA)
  B(""), // [3] assetA name (ADA)
  B(MAXI_POLICY), // [4] assetB policy
  B(MAXI_NAME), // [5] assetB name
  B(MAXI_LP_POLICY), // [6] lp policy
  B(MAXI_LP_NAME), // [7] lp name
);

describe("parseCswapPool — live AMM pool", () => {
  test("parses all 8 fields with real values", () => {
    const p = parseCswapPool(livePool);
    expect(p.balance).toBe(BigInt(7_318_972));
    expect(p.feeNumerator).toBe(BigInt(85));
    expect(p.assetA).toEqual({ policyId: "", assetName: "" });
    expect(p.assetB).toEqual({ policyId: MAXI_POLICY, assetName: MAXI_NAME });
    expect(p.lpPolicy).toBe(MAXI_LP_POLICY);
    expect(p.lpName).toBe(MAXI_LP_NAME);
  });

  test("clean pool has no issues", () => {
    expect(validateCswapPool(parseCswapPool(livePool))).toEqual([]);
  });

  test("rejects wrong field count", () => {
    expect(() => parseCswapPool(C(0, I(0), I(0)))).toThrow();
  });
});

describe("poolToView — reserves become the pair", () => {
  const decode = getDexAdapter("cswap")!.decode!;

  test("pair = reserve A / reserve B (ADA / Cardano Maxi)", () => {
    const view = decode(livePool, "pool");
    expect(view.role).toBe("pool");
    expect(view.pair).toEqual({
      assetA: { policyId: "", assetName: "" },
      assetB: { policyId: MAXI_POLICY, assetName: MAXI_NAME },
    });
    expect(view.kind).toBe("Pool: ADA / Cardano Maxi");
  });

  test("LP name + policy rows are surfaced", () => {
    const view = decode(livePool, "pool");
    expect(view.rows.find((r) => r.label === "LP name")?.value).toBe("C-LP: ADA x Cardano Maxi");
    expect(view.rows.find((r) => r.label === "LP / pool token policy")?.value).toBe(MAXI_LP_POLICY);
  });
});

describe("redeemers", () => {
  test("order: Cancel / Disabled / Fill", () => {
    expect(classifyCswapOrderRedeemer(C(0))).toBe("Cancel");
    expect(classifyCswapOrderRedeemer(C(1))).toBe("Disabled");
    expect(classifyCswapOrderRedeemer(C(2, I(0), I(0), I(0)))).toBe("Fill");
  });

  test("pool: coarse action labels", () => {
    expect(classifyCswapPoolRedeemer(C(0, I(0), I(0)))).toBe("PoolAction0");
    expect(classifyCswapPoolRedeemer(C(1, I(0), I(0), I(0)))).toBe("PoolAction1");
    expect(classifyCswapPoolRedeemer(C(2))).toBe("PoolAction2");
  });
});

describe("CSWAP matching", () => {
  test("mainnet payment-hash matching → role", () => {
    expect(matchCswapScriptHash(CSWAP.orderHash, "mainnet")).toBe("order");
    expect(matchCswapScriptHash(CSWAP.poolHash, "mainnet")).toBe("pool");
    expect(matchCswapScriptHash(CSWAP.orderHash, undefined)).toBe("order");
    // staking validator is intentionally NOT a DEX role
    expect(matchCswapScriptHash(CSWAP.stakingHash, "mainnet")).toBeNull();
    // mainnet-only
    expect(matchCswapScriptHash(CSWAP.orderHash, "preprod")).toBeNull();
    expect(matchCswapScriptHash(ORDER_OWNER_PKH, "mainnet")).toBeNull();
  });
});
