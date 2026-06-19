import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyMinswapOrderRedeemer,
  parseMinswapOrderDatum,
  parseMinswapPoolDatum,
} from "./v2";
import { minswapOrderToView, minswapPoolToView } from "./index";

// Compact PlutusData builders (DetailedSchema shape).
const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const FALSE = C(0);
const TRUE = C(1);

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const SCRIPT = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0";
const POLICY = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c";
const NAME = "4d5350";

// Address = Constr0 [ payment Credential, Option<stake Referenced<Credential>> ]
const vkeyAddr = (pkh: string): PD => C(0, C(0, B(pkh)), C(1)); // VKey payment, no stake

describe("parseMinswapOrderDatum — SwapExactIn", () => {
  const datum: PD = C(
    0,
    C(0, B(PKH)), // canceller: OAMSignature
    vkeyAddr(PKH), // refund_receiver
    C(0), // refund_receiver_datum: EODNoDatum
    vkeyAddr(PKH), // success_receiver
    C(0), // success_receiver_datum
    C(0, B(POLICY), B(NAME)), // lp_asset: Asset
    C(0, TRUE, C(0, I(1000)), I(950), FALSE), // step: SwapExactIn(a->b, SAOSpecificAmount 1000, minRecv 950, killable false)
    I(2_000_000), // max_batcher_fee
    C(1), // expiry_setting_opt: None
  );

  test("parses canceller, lp asset, batcher fee, expiry", () => {
    const d = parseMinswapOrderDatum(datum);
    expect(d.canceller).toEqual({ kind: "Signature", pubKeyHash: PKH });
    expect(d.lpAsset).toEqual({ policyId: POLICY, assetName: NAME });
    expect(d.maxBatcherFee).toBe(BigInt(2_000_000));
    expect(d.expirySetting).toBeNull();
    expect(d.refundReceiver.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(d.refundReceiver.stakeCredential).toBeNull();
  });

  test("parses SwapExactIn step", () => {
    const d = parseMinswapOrderDatum(datum);
    expect(d.step).toEqual({
      kind: "SwapExactIn",
      aToBDirection: true,
      swapAmountOption: { kind: "SpecificAmount", swapAmount: BigInt(1000) },
      minimumReceive: BigInt(950),
      killable: false,
    });
  });

  test("toView yields a Swap (exact in) order", () => {
    const view = minswapOrderToView(parseMinswapOrderDatum(datum));
    expect(view.protocol).toBe("Minswap V2");
    expect(view.role).toBe("order");
    expect(view.kind).toBe("Swap (exact in)");
    expect(view.rows.find((r) => r.label === "Minimum receive")?.value).toBe("950");
    expect(view.assets?.[0]).toMatchObject({ policyId: POLICY, assetName: NAME });
    expect(view.issues).toHaveLength(0);
  });

  test("toView surfaces success + refund receiver addresses", () => {
    const view = minswapOrderToView(parseMinswapOrderDatum(datum));
    const success = view.rows.find((r) => r.label === "Success receiver (key)");
    const refund = view.rows.find((r) => r.label === "Refund receiver (key)");
    expect(success?.value).toBe(PKH);
    expect(success?.hash).toBe(true);
    expect(refund?.value).toBe(PKH);
  });
});

describe("MinswapOrderDatum — receiver datum hashes + multi-routing", () => {
  const DH = "abababababababababababababababababababababababababababababababab0";
  test("EODDatumHash / EODInlineDatum receiver datums surface as rows", () => {
    const datum: PD = C(
      0,
      C(0, B(PKH)),
      vkeyAddr(PKH),
      C(1, B(DH)), // refund_receiver_datum: EODDatumHash
      vkeyAddr(PKH),
      C(2, B(DH)), // success_receiver_datum: EODInlineDatum
      C(0, B(POLICY), B(NAME)),
      C(0, TRUE, C(0, I(1000)), I(950), FALSE),
      I(2_000_000),
      C(1),
    );
    const view = minswapOrderToView(parseMinswapOrderDatum(datum));
    expect(view.rows.find((r) => r.label === "Success receiver datum (inline datum hash)")?.value).toBe(DH);
    expect(view.rows.find((r) => r.label === "Refund receiver datum (datum hash)")?.value).toBe(DH);
  });

  test("SwapMultiRouting surfaces every routing's LP asset + direction", () => {
    const NAME2 = "4d535032";
    const datum: PD = C(
      0,
      C(0, B(PKH)),
      vkeyAddr(PKH),
      C(0),
      vkeyAddr(PKH),
      C(0),
      C(0, B(POLICY), B(NAME)),
      C(
        9, // SwapMultiRouting
        L(
          C(0, C(0, B(POLICY), B(NAME)), TRUE), // routing 0: lpAsset, a->b
          C(0, C(0, B(POLICY), B(NAME2)), FALSE), // routing 1: lpAsset, b->a
        ),
        C(0, I(250_000_000)),
        I(100),
      ),
      I(2_000_000),
      C(1),
    );
    const view = minswapOrderToView(parseMinswapOrderDatum(datum));
    expect(view.rows.find((r) => r.label === "Routings")?.value).toBe("2 pool(s)");
    // Each hop's pool LP + direction is exposed via view.routings, so the panel
    // can resolve every hop to its pair and render the full route.
    expect(view.routings).toHaveLength(2);
    expect(view.routings?.[0]).toMatchObject({ poolRef: { policyId: POLICY, assetName: NAME }, aToB: true });
    expect(view.routings?.[1]).toMatchObject({ poolRef: { policyId: POLICY, assetName: NAME2 }, aToB: false });
    // No single poolRef for a multi-hop swap — the entry pool's pair would
    // mislead; the per-routing hops carry the path instead.
    expect(view.poolRef).toBeUndefined();
  });
});

describe("parseMinswapOrderDatum — Deposit + Withdraw + expiry", () => {
  test("Deposit step (ctor 4) with SpecificAmount option", () => {
    const datum: PD = C(
      0,
      C(1, B(SCRIPT)), // canceller: OAMSpendScript
      vkeyAddr(PKH),
      C(0),
      vkeyAddr(PKH),
      C(0),
      C(0, B(POLICY), B(NAME)),
      C(4, C(0, I(500), I(700)), I(123), TRUE), // Deposit(DAOSpecificAmount 500/700, minLp 123, killable true)
      I(2_500_000),
      C(0, L(I(1730000000), I(1_000_000))), // expiry Some (time, tip)
    );
    const d = parseMinswapOrderDatum(datum);
    expect(d.canceller).toEqual({ kind: "SpendScript", scriptHash: SCRIPT });
    expect(d.step).toEqual({
      kind: "Deposit",
      depositAmountOption: { kind: "SpecificAmount", depositAmountA: BigInt(500), depositAmountB: BigInt(700) },
      minimumLp: BigInt(123),
      killable: true,
    });
    expect(d.expirySetting).toEqual({ expiredTime: BigInt(1730000000), maxCancellationTip: BigInt(1_000_000) });
  });

  test("Withdraw step (ctor 5) with All option", () => {
    const datum: PD = C(
      0,
      C(0, B(PKH)),
      vkeyAddr(PKH),
      C(0),
      vkeyAddr(PKH),
      C(0),
      C(0, B(POLICY), B(NAME)),
      C(5, C(1, I(0)), I(10), I(20), FALSE), // Withdraw(WAOAll 0, minA 10, minB 20, killable false)
      I(2_000_000),
      C(1),
    );
    const d = parseMinswapOrderDatum(datum);
    expect(d.step).toEqual({
      kind: "Withdraw",
      withdrawalAmountOption: { kind: "All", deductedAmountLp: BigInt(0) },
      minimumAssetA: BigInt(10),
      minimumAssetB: BigInt(20),
      killable: false,
    });
  });
});

describe("parseMinswapPoolDatum", () => {
  const datum: PD = C(
    0,
    C(0, C(1, B(SCRIPT))), // pool_batching_stake_credential: Inline(Script)
    C(0, B(""), B("")), // asset_a: ADA
    C(0, B(POLICY), B(NAME)), // asset_b
    I(1_000_000_000), // total_liquidity
    I(500_000_000), // reserve_a
    I(250_000_000), // reserve_b
    I(30), // base_fee_a_numerator
    I(30), // base_fee_b_numerator
    C(1), // fee_sharing_numerator_opt: None
    FALSE, // allow_dynamic_fee
  );

  test("parses reserves, fees, stake credential", () => {
    const d = parseMinswapPoolDatum(datum);
    expect(d.assetA).toEqual({ policyId: "", assetName: "" });
    expect(d.assetB).toEqual({ policyId: POLICY, assetName: NAME });
    expect(d.totalLiquidity).toBe(BigInt(1_000_000_000));
    expect(d.reserveA).toBe(BigInt(500_000_000));
    expect(d.reserveB).toBe(BigInt(250_000_000));
    expect(d.baseFeeANumerator).toBe(BigInt(30));
    expect(d.feeSharingNumerator).toBeNull();
    expect(d.allowDynamicFee).toBe(false);
    expect(d.poolBatchingStakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "Script", hash: SCRIPT },
    });
  });

  test("toView yields a Liquidity Pool with two reserve assets", () => {
    const view = minswapPoolToView(parseMinswapPoolDatum(datum));
    expect(view.role).toBe("pool");
    expect(view.kind).toBe("Liquidity Pool");
    expect(view.assets).toHaveLength(2);
    expect(view.assets?.[0].amount).toBe(BigInt(500_000_000));
  });

  test("toView surfaces pool batching stake credential", () => {
    const view = minswapPoolToView(parseMinswapPoolDatum(datum));
    const cred = view.rows.find((r) => r.label === "Pool batching stake credential (script)");
    expect(cred?.value).toBe(SCRIPT);
    expect(cred?.hash).toBe(true);
  });
});

describe("classifyMinswapOrderRedeemer", () => {
  test("maps ctor tags to actions", () => {
    expect(classifyMinswapOrderRedeemer(C(0))).toBe("ApplyOrder");
    expect(classifyMinswapOrderRedeemer(C(1))).toBe("CancelOrderByOwner");
    expect(classifyMinswapOrderRedeemer(C(2))).toBe("CancelExpiredOrderByAnyone");
    expect(classifyMinswapOrderRedeemer(C(3))).toBeNull();
  });
});

describe("validation issues", () => {
  test("flags non-positive maxBatcherFee", () => {
    const datum: PD = C(
      0,
      C(0, B(PKH)),
      vkeyAddr(PKH),
      C(0),
      vkeyAddr(PKH),
      C(0),
      C(0, B(POLICY), B(NAME)),
      C(0, TRUE, C(0, I(1000)), I(950), FALSE),
      I(0), // max_batcher_fee = 0
      C(1),
    );
    const view = minswapOrderToView(parseMinswapOrderDatum(datum));
    expect(view.issues.some((i) => i.severity === "warning" && i.message.includes("maxBatcherFee"))).toBe(true);
  });
});
