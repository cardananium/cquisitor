import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  parseStrikeManagePositionRedeemer,
  parseStrikeOrderDatum,
  parseStrikeOrdersRedeemer,
  parseStrikeOrdersWithdrawRedeemer,
  parseStrikePoolDatum,
  parseStrikePositionDatum,
  parseStrikePositionMintRedeemer,
  parseStrikeSettingsDatum,
} from "./datums";
import { matchStrikeNftPolicy, matchStrikeScriptHash, STRIKE } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const STAKE = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const NAME = "5354";

const ada: PD = C(0, B(""), B("")); // Asset = Constr0[#"", #""]
const some = (inner: PD): PD => C(0, inner);
const none: PD = C(1);

// PositionDatum: Constr0, 14 fields. Long = Constr0[].
const positionDatum: PD = C(
  0,
  B(PKH), // 0 owner_pkh
  some(B(STAKE)), // 1 owner_stake_key Some
  I(0x196c27bca75), // 2 entered_position_time (ms)
  I(50_000_000), // 3 entered_at_usd_price ($500)
  B(POLICY), // 4 position_policy_id
  B(STRIKE.managePositionsHash), // 5 manage_positions_script_hash
  ada, // 6 collateral_asset (ADA)
  I(5), // 7 maintain_margin_amount (5%)
  I(100), // 8 hourly_usd_borrow_fee
  I(0), // 9 stop_loss_usd_price (unset)
  I(60_000_000), // 10 take_profit_usd_price ($600)
  I(1_000_000), // 11 collateral_asset_amount
  I(2_500_000), // 12 position_asset_amount
  C(0), // 13 side = Long
);

describe("parseStrikePositionDatum", () => {
  test("parses all 14 fields, ADA collateral, Long side", () => {
    const p = parseStrikePositionDatum(positionDatum);
    expect(p.ownerPkh).toBe(PKH);
    expect(p.ownerStakeKey).toBe(STAKE);
    expect(p.enteredPositionTime).toBe(BigInt(0x196c27bca75));
    expect(p.enteredAtUsdPrice).toBe(BigInt(50_000_000));
    expect(p.positionPolicyId).toBe(POLICY);
    expect(p.managePositionsScriptHash).toBe(STRIKE.managePositionsHash);
    expect(p.collateralAsset).toEqual({ policyId: "", assetName: "" });
    expect(p.maintainMarginAmount).toBe(BigInt(5));
    expect(p.stopLossUsdPrice).toBe(BigInt(0));
    expect(p.takeProfitUsdPrice).toBe(BigInt(60_000_000));
    expect(p.collateralAssetAmount).toBe(BigInt(1_000_000));
    expect(p.positionAssetAmount).toBe(BigInt(2_500_000));
    expect(p.side).toBe("Long");
  });

  test("Short side = Constr1[], None stake key", () => {
    const fields = (positionDatum as { fields: PD[] }).fields.slice();
    fields[1] = none;
    fields[13] = C(1);
    const p = parseStrikePositionDatum(C(0, ...fields));
    expect(p.side).toBe("Short");
    expect(p.ownerStakeKey).toBeNull();
  });
});

describe("parseStrikeOrderDatum", () => {
  test("OpenPositionOrder (idx 0) wrapping a PositionDatum, market", () => {
    const datum: PD = C(0, C(0, positionDatum, C(0)));
    const o = parseStrikeOrderDatum(datum);
    expect(o.action.kind).toBe("OpenPositionOrder");
    if (o.action.kind !== "OpenPositionOrder") throw new Error("expected open");
    expect(o.action.openPositionType).toBe("MarketOrder");
    expect(o.action.positionDatum.side).toBe("Long");
  });

  test("ClosePositionOrder (idx 1) with negative pool P/L", () => {
    const datum: PD = C(
      0,
      C(1, B(PKH), some(B(STAKE)), ada, I(900_000), I(-50_000), B(POLICY), I(700_000)),
    );
    const o = parseStrikeOrderDatum(datum);
    if (o.action.kind !== "ClosePositionOrder") throw new Error("expected close");
    expect(o.action.sendAssetAmount).toBe(BigInt(900_000));
    expect(o.action.poolAssetProfitLoss).toBe(BigInt(-50_000));
    expect(o.action.borrowedAmount).toBe(BigInt(700_000));
  });

  test("LiquidatePositionOrder (idx 2)", () => {
    const datum: PD = C(0, C(2, I(123), I(456), B(POLICY)));
    const o = parseStrikeOrderDatum(datum);
    if (o.action.kind !== "LiquidatePositionOrder") throw new Error("expected liquidate");
    expect(o.action.profit).toBe(BigInt(123));
    expect(o.action.lendedAmount).toBe(BigInt(456));
  });

  test("ProvideLiquidityOrder (idx 3) and WithdrawLiquidityOrder (idx 4)", () => {
    const provide = parseStrikeOrderDatum(C(0, C(3, B(PKH), none, C(0, B(POLICY), B(NAME)))));
    if (provide.action.kind !== "ProvideLiquidityOrder") throw new Error("expected provide");
    expect(provide.action.liquidityAsset).toEqual({ policyId: POLICY, assetName: NAME });

    const withdraw = parseStrikeOrderDatum(C(0, C(4, B(PKH), some(B(STAKE)))));
    if (withdraw.action.kind !== "WithdrawLiquidityOrder") throw new Error("expected withdraw");
    expect(withdraw.action.ownerStakeKey).toBe(STAKE);
  });
});

describe("parseStrikePoolDatum / parseStrikeSettingsDatum", () => {
  test("PoolDatum Constr0 6 fields", () => {
    const datum: PD = C(0, ada, C(0, B(POLICY), B(NAME)), I(1000), I(900), I(100), B(POLICY));
    const p = parseStrikePoolDatum(datum);
    expect(p.underlyingAsset).toEqual({ policyId: "", assetName: "" });
    expect(p.lpAsset).toEqual({ policyId: POLICY, assetName: NAME });
    expect(p.liquidityTotalAssetAmount).toBe(BigInt(1000));
    expect(p.totalLendedAmount).toBe(BigInt(100));
    expect(p.batcherLicense).toBe(POLICY);
  });

  test("SettingsDatum Constr0 5 fields", () => {
    const datum: PD = C(0, I(5), I(10), I(100000), I(10), I(5));
    const s = parseStrikeSettingsDatum(datum);
    expect(s.interestRate).toBe(BigInt(5));
    expect(s.maxLeverageFactor).toBe(BigInt(10));
    expect(s.minPositionUsdValue).toBe(BigInt(10));
  });
});

describe("redeemers", () => {
  test("ManagePositionRedeemer Close with CloseType enum", () => {
    const r = parseStrikeManagePositionRedeemer(C(0, I(55_000_000), C(1), I(2)));
    if (r.kind !== "Close") throw new Error("expected Close");
    expect(r.closePrice).toBe(BigInt(55_000_000));
    expect(r.closeType).toBe("StopLossClose");
    expect(r.outputToOrderIndex).toBe(BigInt(2));
  });

  test("ManagePositionRedeemer AddCollateral / PositionUpdate", () => {
    const add = parseStrikeManagePositionRedeemer(C(1, I(500_000), I(0)));
    if (add.kind !== "AddCollateral") throw new Error("expected AddCollateral");
    expect(add.collateralAssetAmount).toBe(BigInt(500_000));

    const upd = parseStrikeManagePositionRedeemer(C(2, I(10), I(20), I(1), I(50_000_000)));
    if (upd.kind !== "PositionUpdate") throw new Error("expected PositionUpdate");
    expect(upd.currentUsdPrice).toBe(BigInt(50_000_000));
  });

  test("OrdersRedeemer ProcessOrders / CancelOrder / CloseOrderWhilePending", () => {
    expect(parseStrikeOrdersRedeemer(C(0)).kind).toBe("ProcessOrders");
    expect(parseStrikeOrdersRedeemer(C(1)).kind).toBe("CancelOrder");
    const close = parseStrikeOrdersRedeemer(C(2, I(7)));
    if (close.kind !== "CloseOrderWhilePending") throw new Error("expected close");
    expect(close.index).toBe(BigInt(7));
  });

  test("OrdersWithdrawRedeemer Constr0 with tuple lists", () => {
    const datum: PD = C(
      0,
      I(50_000_000), // current_usd_price
      L(L(I(0), I(1)), L(I(2), I(3))), // indexer: List<(Int,Int)>
      L(I(4), I(5)), // pool_utxo_index: (Int,Int)
      I(6), // batcher_license_utxo_index
    );
    const r = parseStrikeOrdersWithdrawRedeemer(datum);
    expect(r.currentUsdPrice).toBe(BigInt(50_000_000));
    expect(r.indexer).toEqual([
      [BigInt(0), BigInt(1)],
      [BigInt(2), BigInt(3)],
    ]);
    expect(r.poolUtxoIndex).toEqual([BigInt(4), BigInt(5)]);
    expect(r.batcherLicenseUtxoIndex).toBe(BigInt(6));
  });

  test("PositionMintRedeemer OpenPosition / ClosePosition", () => {
    const open = parseStrikePositionMintRedeemer(C(0, I(50_000_000), I(1), I(2), I(3)));
    if (open.kind !== "OpenPosition") throw new Error("expected OpenPosition");
    expect(open.poolIndex).toBe(BigInt(2));
    expect(open.settingIndex).toBe(BigInt(3));

    const close = parseStrikePositionMintRedeemer(C(1, I(1)));
    if (close.kind !== "ClosePosition") throw new Error("expected ClosePosition");
    expect(close.burnAmount).toBe(BigInt(1));
  });
});

describe("Strike matching", () => {
  test("script hashes → role, mainnet only", () => {
    expect(matchStrikeScriptHash(STRIKE.managePositionsHash, "mainnet")).toBe("position");
    expect(matchStrikeScriptHash(STRIKE.ordersHash, undefined)).toBe("position");
    expect(matchStrikeScriptHash(STRIKE.poolHash, "mainnet")).toBe("pool");
    expect(matchStrikeScriptHash(STRIKE.managePositionsHash, "preprod")).toBeNull();
    expect(matchStrikeScriptHash(PKH, "mainnet")).toBeNull();
  });

  test("NFT policy: position requires STRIKE_PERP_POSITION asset name", () => {
    expect(
      matchStrikeNftPolicy(STRIKE.positionPolicy, [STRIKE.positionAssetName], "mainnet"),
    ).toBe("position");
    // policy match but wrong asset name → no match.
    expect(matchStrikeNftPolicy(STRIKE.positionPolicy, [NAME], "mainnet")).toBeNull();
    expect(
      matchStrikeNftPolicy(STRIKE.protocolAuthPolicy, [STRIKE.poolNftAssetName], "mainnet"),
    ).toBe("pool");
    expect(
      matchStrikeNftPolicy(STRIKE.positionPolicy, [STRIKE.positionAssetName], "preprod"),
    ).toBeNull();
  });
});
