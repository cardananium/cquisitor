import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifySplashGridOrderRedeemer,
  classifySplashOrderRedeemer,
  classifySplashPoolRedeemer,
  classifySplashProxyOrderRedeemer,
  classifySplashRoyaltyPoolRedeemer,
  classifySplashStablePoolRedeemer,
  parseSplashBalancePool,
  parseSplashGridOrder,
  parseSplashOrder,
  parseSplashPool,
  parseSplashProxyDeposit,
  parseSplashProxyRedeem,
  parseSplashProxySwap,
  parseSplashRoyaltyPool,
  parseSplashStablePool,
} from "./datums";
import { matchSplashScriptHash, SPLASH } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const STAKE = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const NAME = "53504c";
const BEACON = "cafebabecafebabecafebabecafebabecafebabecafebabecafebabe";

const ada: PD = C(0, B(""), B(""));
const token: PD = C(0, B(POLICY), B(NAME));
// Address = Constr0[ Credential, Some(Inline(Credential)) ]
const addr: PD = C(0, C(0, B(PKH)), C(0, C(0, C(0, B(STAKE)))));

describe("parseSplashOrder — LimitOrder", () => {
  const datum: PD = C(
    0,
    B("00"), // tag (limit)
    B(BEACON), // beacon
    ada, // input
    I(1_000_000), // tradable_input
    I(1000), // cost_per_ex_step
    I(50), // min_marginal_output
    token, // output
    C(0, I(3), I(2)), // base_price 3/2
    I(500_000), // fee
    addr, // redeemer_address
    B(PKH), // cancellation_pkh
    L(B(PKH)), // permitted_executors
  );

  test("parses all limit-order fields", () => {
    const o = parseSplashOrder(datum);
    expect(o.kind).toBe("Limit");
    if (o.kind !== "Limit") throw new Error("expected Limit");
    expect(o.tag).toBe("00");
    expect(o.input).toEqual({ policyId: "", assetName: "" });
    expect(o.output).toEqual({ policyId: POLICY, assetName: NAME });
    expect(o.tradableInput).toBe(BigInt(1_000_000));
    expect(o.basePrice).toEqual({ numerator: BigInt(3), denominator: BigInt(2) });
    expect(o.cancellationPkh).toBe(PKH);
    expect(o.permittedExecutors).toEqual([PKH]);
    expect(o.redeemerAddress.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(o.redeemerAddress.stakeCredential).toEqual({ kind: "Inline", credential: { kind: "VKey", hash: STAKE } });
  });
});

describe("parseSplashOrder — InstantOrder", () => {
  const datum: PD = C(
    0,
    B("01"), // tag (instant)
    addr, // redeemer_address
    ada, // input
    token, // output
    C(0, I(5), I(4)), // base_price
    I(400_000), // fee
    I(2_000_000), // min_lovelace
    B(PKH), // permitted_executor (single VKH)
    I(1_730_000_000_000), // cancellation_after
    B(PKH), // cancellation_pkh
  );

  test("discriminates instant by tag byte", () => {
    const o = parseSplashOrder(datum);
    expect(o.kind).toBe("Instant");
    if (o.kind !== "Instant") throw new Error("expected Instant");
    expect(o.minLovelace).toBe(BigInt(2_000_000));
    expect(o.permittedExecutor).toBe(PKH);
    expect(o.cancellationAfter).toBe(BigInt(1_730_000_000_000));
  });
});

describe("parseSplashPool", () => {
  const poolNft: PD = C(0, B(POLICY), B("706f6f6c"));

  test("classic const-product (DAOPolicy list at idx 5, lqBound at 6)", () => {
    const datum: PD = C(0, poolNft, ada, token, token, I(997), L(), I(10));
    const p = parseSplashPool(datum);
    expect(p.feeSwitch).toBe(false);
    expect(p.feeNum).toBe(BigInt(997));
    expect(p.lqBound).toBe(BigInt(10));
    expect(p.treasuryFee).toBeNull();
    expect(p.assetX).toEqual({ policyId: "", assetName: "" });
  });

  test("fee-switch (treasuryFee Int at idx 5)", () => {
    const datum: PD = C(0, poolNft, ada, token, token, I(99000), I(100), I(0), I(0), L(), I(5), B(PKH), I(1));
    const p = parseSplashPool(datum);
    expect(p.feeSwitch).toBe(true);
    expect(p.treasuryFee).toBe(BigInt(100));
    expect(p.lqBound).toBe(BigInt(5));
  });
});

describe("classifySplashOrderRedeemer", () => {
  test("bare Bool: Constr1 = Execute, Constr0 = Cancel", () => {
    expect(classifySplashOrderRedeemer(C(1))).toBe("Execute");
    expect(classifySplashOrderRedeemer(C(0))).toBe("Cancel");
    expect(classifySplashOrderRedeemer(C(0, I(1)))).toBeNull(); // has a field → not the bare Bool
  });
});

describe("classifySplashPoolRedeemer", () => {
  test("const-product/balance pool spend = Constr0[in_ix, out_ix] (real live shape)", () => {
    expect(classifySplashPoolRedeemer(C(0, I(1), I(1)))).toBe("Pool batch");
    expect(classifySplashPoolRedeemer(C(0, I(0), I(0)))).toBe("Pool batch");
    expect(classifySplashPoolRedeemer(C(0))).toBeNull(); // bare = not a pool redeemer
  });
});

describe("parseSplashStablePool", () => {
  const poolNft: PD = C(0, B(POLICY), B("706f6f6c"));
  // Deployed stableFnPoolT2t = Constr0 with 15 FLAT fields.
  const datum: PD = C(
    0,
    poolNft, // f0 pool_nft
    I(3200), // f1 ampl_coeff
    ada, // f2 tradable_asset[0]
    token, // f3 tradable_asset[1]
    I(1), // f4 multiplier[0]
    I(1), // f5 multiplier[1]
    token, // f6 lp_token
    C(0), // f7 lp_fee_is_editable = False
    C(0), // f8 extra Bool flag
    I(100), // f9 lp_fee_num
    I(100), // f10 protocol_fee_num
    B(PKH), // f11 dao_stable_proxy_witness
    B(PKH), // f12 treasury_address
    I(30994), // f13 protocol_fees[0]
    I(1506), // f14 protocol_fees[1]
  );

  test("parses the real 15-field flat stable-pool layout", () => {
    const p = parseSplashStablePool(datum);
    expect(p.amplCoeff).toBe(BigInt(3200));
    expect(p.tradableAssets).toEqual([
      { policyId: "", assetName: "" },
      { policyId: POLICY, assetName: NAME },
    ]);
    expect(p.tradableTokensMultipliers).toEqual([BigInt(1), BigInt(1)]);
    expect(p.lpFeeIsEditable).toBe(false);
    expect(p.lpFeeNum).toBe(BigInt(100));
    expect(p.protocolFeeNum).toBe(BigInt(100));
    expect(p.daoStableProxyWitness).toBe(PKH);
    expect(p.treasuryAddress).toBe(PKH);
    expect(p.protocolFees).toEqual([BigInt(30994), BigInt(1506)]);
  });

  test("redeemer: AMMAction (Constr0) vs PDAOAction (Constr1)", () => {
    expect(classifySplashStablePoolRedeemer(C(0, I(0), I(1), C(0, I(0), I(1))))).toBe("AMM");
    expect(classifySplashStablePoolRedeemer(C(0, I(0), I(1), C(1)))).toBe("DAOAction");
    expect(classifySplashStablePoolRedeemer(C(0, I(0)))).toBeNull();
  });
});

describe("parseSplashBalancePool", () => {
  const poolNft: PD = C(0, B(POLICY), B("706f6f6c"));
  // BalancePoolConfig Constr0, 10 fields.
  const datum: PD = C(
    0,
    poolNft, ada, token, token, // pool_nft, x, y, lq
    I(99700), // poolFeeNum
    I(100), // treasuryFee
    I(5), I(7), // treasuryX, treasuryY
    L(), // daoPolicy
    B(PKH), // treasuryAddress
  );

  test("parses idx 0-7 + treasury address at idx 9", () => {
    const p = parseSplashBalancePool(datum);
    expect(p.feeNum).toBe(BigInt(99700));
    expect(p.treasuryFee).toBe(BigInt(100));
    expect(p.treasuryX).toBe(BigInt(5));
    expect(p.treasuryY).toBe(BigInt(7));
    expect(p.treasuryAddress).toBe(PKH);
    expect(p.assetX).toEqual({ policyId: "", assetName: "" });
  });
});

describe("parseSplashProxy orders", () => {
  test("SwapConfig (10 fields, Some stakePkh)", () => {
    const datum: PD = C(
      0,
      ada, token, // base, quote
      C(0, B(POLICY), B("706f6f6c")), // poolNft
      I(997), // feeNum
      I(1), I(100), // exFeePerTokenNum/Den
      B(PKH), // rewardPkh
      C(0, B(STAKE)), // stakePkh = Some
      I(1_000_000), // baseAmount
      I(950_000), // minQuoteAmount
    );
    const o = parseSplashProxySwap(datum);
    expect(o.kind).toBe("Swap");
    expect(o.feeNum).toBe(BigInt(997));
    expect(o.rewardPkh).toBe(PKH);
    expect(o.stakePkh).toBe(STAKE);
    expect(o.baseAmount).toBe(BigInt(1_000_000));
    expect(o.minQuoteAmount).toBe(BigInt(950_000));
  });

  test("DepositConfig (8 fields, None stakePkh)", () => {
    const datum: PD = C(
      0,
      C(0, B(POLICY), B("706f6f6c")), // poolNft
      ada, token, token, // tokenA, tokenB, tokenLp
      I(2_000_000), // exFee
      B(PKH), // rewardPkh
      C(1), // stakePkh = None
      I(2_000_000), // collateralAda
    );
    const o = parseSplashProxyDeposit(datum);
    expect(o.kind).toBe("Deposit");
    expect(o.exFee).toBe(BigInt(2_000_000));
    expect(o.stakePkh).toBeNull();
    expect(o.collateralAda).toBe(BigInt(2_000_000));
  });

  test("RedeemConfig (7 fields)", () => {
    const datum: PD = C(
      0,
      C(0, B(POLICY), B("706f6f6c")), // poolNft
      ada, token, token, // poolX, poolY, poolLp
      I(1_500_000), // exFee
      B(PKH), // rewardPkh
      C(0, B(STAKE)), // stakePkh = Some
    );
    const o = parseSplashProxyRedeem(datum);
    expect(o.kind).toBe("Redeem");
    expect(o.exFee).toBe(BigInt(1_500_000));
    expect(o.stakePkh).toBe(STAKE);
  });

  test("redeemer OrderRedeemer: bare Int action Apply=0 / Refund=1", () => {
    expect(classifySplashProxyOrderRedeemer(C(0, I(0), I(1), I(2), I(0)))).toBe("Apply");
    expect(classifySplashProxyOrderRedeemer(C(0, I(0), I(1), I(2), I(1)))).toBe("Refund");
    expect(classifySplashProxyOrderRedeemer(C(0, I(0), I(1), I(2), C(0)))).toBeNull(); // action not a bare Int
  });
});

describe("Splash matching", () => {
  test("orders + pools by applied mainnet hash", () => {
    expect(matchSplashScriptHash(SPLASH.limitOrderHash, "mainnet")).toBe("order");
    expect(matchSplashScriptHash(SPLASH.instantOrderHash, undefined)).toBe("order");
    expect(matchSplashScriptHash(SPLASH.constProductPoolHashes[0], "mainnet")).toBe("pool");
    expect(matchSplashScriptHash(SPLASH.limitOrderHash, "preprod")).toBeNull();
    expect(matchSplashScriptHash(PKH, "mainnet")).toBeNull();
  });

  test("new variants by applied mainnet hash", () => {
    expect(matchSplashScriptHash(SPLASH.stablePoolHash, "mainnet")).toBe("stable-pool");
    expect(matchSplashScriptHash(SPLASH.balancePoolHashes[0], "mainnet")).toBe("balance-pool");
    expect(matchSplashScriptHash(SPLASH.balancePoolHashes[1], undefined)).toBe("balance-pool");
    expect(matchSplashScriptHash(SPLASH.proxySwapHash, "mainnet")).toBe("proxy-swap-order");
    expect(matchSplashScriptHash(SPLASH.proxyDepositHash, "mainnet")).toBe("proxy-deposit-order");
    expect(matchSplashScriptHash(SPLASH.proxyRedeemHash, "mainnet")).toBe("proxy-redeem-order");
    expect(matchSplashScriptHash(SPLASH.stablePoolHash, "preprod")).toBeNull();
  });

  test("grid order + royalty pool by applied mainnet hash", () => {
    expect(matchSplashScriptHash(SPLASH.gridOrderHash, "mainnet")).toBe("grid-order");
    expect(matchSplashScriptHash(SPLASH.gridOrderHash, undefined)).toBe("grid-order");
    expect(matchSplashScriptHash(SPLASH.royaltyPoolHash, "mainnet")).toBe("royalty-pool");
    expect(matchSplashScriptHash(SPLASH.gridOrderHash, "preprod")).toBeNull();
    expect(matchSplashScriptHash(SPLASH.royaltyPoolHash, "preprod")).toBeNull();
  });
});

describe("parseSplashGridOrder", () => {
  // GridStateNative Constr0 with 13 ordered fields.
  const datum: PD = C(
    0,
    B(BEACON), // [0] beacon
    token, // [1] token
    C(0, I(101), I(100)), // [2] buy_shift_factor 101/100
    C(0, I(99), I(100)), // [3] sell_shift_factor 99/100
    I(10_000_000), // [4] max_lovelace_offer
    I(4_000_000), // [5] lovelace_offer
    C(0, I(3), I(2)), // [6] price 3/2
    C(1), // [7] side = Bid (True)
    I(500_000), // [8] budget_per_transaction
    I(10), // [9] min_marginal_output_lovelace
    I(20), // [10] min_marginal_output_token
    addr, // [11] redeemer_address
    B(PKH), // [12] cancellation_pkh
  );

  test("parses all 13 grid-order fields", () => {
    const o = parseSplashGridOrder(datum);
    expect(o.beacon).toBe(BEACON);
    expect(o.token).toEqual({ policyId: POLICY, assetName: NAME });
    expect(o.buyShiftFactor).toEqual({ numerator: BigInt(101), denominator: BigInt(100) });
    expect(o.sellShiftFactor).toEqual({ numerator: BigInt(99), denominator: BigInt(100) });
    expect(o.maxLovelaceOffer).toBe(BigInt(10_000_000));
    expect(o.lovelaceOffer).toBe(BigInt(4_000_000));
    expect(o.price).toEqual({ numerator: BigInt(3), denominator: BigInt(2) });
    expect(o.side).toBe(true);
    expect(o.budgetPerTransaction).toBe(BigInt(500_000));
    expect(o.minMarginalOutputLovelace).toBe(BigInt(10));
    expect(o.minMarginalOutputToken).toBe(BigInt(20));
    expect(o.redeemerAddress.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(o.cancellationPkh).toBe(PKH);
  });

  test("side False = Ask", () => {
    const ask: PD = C(0, ...[
      B(BEACON), token, C(0, I(1), I(1)), C(0, I(1), I(1)), I(0), I(0),
      C(0, I(1), I(1)), C(0), I(0), I(0), I(0), addr, B(PKH),
    ]);
    expect(parseSplashGridOrder(ask).side).toBe(false);
  });

  test("redeemer Action: Execute = Constr0[Int], Close = Constr1[]", () => {
    expect(classifySplashGridOrderRedeemer(C(0, I(2)))).toBe("Execute");
    expect(classifySplashGridOrderRedeemer(C(1))).toBe("Close");
    expect(classifySplashGridOrderRedeemer(C(0))).toBeNull(); // Execute needs the index field
    expect(classifySplashGridOrderRedeemer(C(2))).toBeNull();
  });
});

describe("parseSplashRoyaltyPool", () => {
  const poolNft: PD = C(0, B(POLICY), B("706f6f6c"));
  // RoyaltyPoolConfig Constr0 with 15 ordered fields.
  // DAOPolicy = List<StakingCredential = Constr0[Credential]>.
  const daoScript: PD = C(0, C(1, B(PKH))); // StakingCredential[ ScriptCredential ]
  const datum: PD = C(
    0,
    poolNft, // [0] poolNft
    ada, // [1] poolX = ADA
    token, // [2] poolY
    token, // [3] poolLq
    I(99100), // [4] feeNum
    I(50), // [5] treasuryFee
    I(50), // [6] royaltyFee
    I(0), // [7] treasuryX
    I(0), // [8] treasuryY
    I(0), // [9] royaltyX
    I(0), // [10] royaltyY
    L(daoScript), // [11] DAOPolicy
    B(PKH), // [12] treasuryAddress
    B(STAKE), // [13] royaltyPubKey
    I(0), // [14] nonce
  );

  test("parses all 15 royalty-pool fields", () => {
    const p = parseSplashRoyaltyPool(datum);
    expect(p.poolX).toEqual({ policyId: "", assetName: "" });
    expect(p.poolY).toEqual({ policyId: POLICY, assetName: NAME });
    expect(p.feeNum).toBe(BigInt(99100));
    expect(p.treasuryFee).toBe(BigInt(50));
    expect(p.royaltyFee).toBe(BigInt(50));
    expect(p.daoPolicy).toEqual([{ kind: "Script", hash: PKH }]);
    expect(p.treasuryAddress).toBe(PKH);
    expect(p.royaltyPubKey).toBe(STAKE);
    expect(p.nonce).toBe(BigInt(0));
  });

  test("redeemer PoolRedeemer = Constr0[action: bare Int, selfIx]", () => {
    expect(classifySplashRoyaltyPoolRedeemer(C(0, I(0), I(1)))).toBe("Deposit");
    expect(classifySplashRoyaltyPoolRedeemer(C(0, I(1), I(1)))).toBe("Redeem");
    expect(classifySplashRoyaltyPoolRedeemer(C(0, I(2), I(1)))).toBe("Swap");
    expect(classifySplashRoyaltyPoolRedeemer(C(0, I(3), I(1)))).toBe("DAOAction");
    expect(classifySplashRoyaltyPoolRedeemer(C(0, I(4), I(1)))).toBe("WithdrawRoyalty");
    expect(classifySplashRoyaltyPoolRedeemer(C(0, I(5), I(1)))).toBeNull();
    expect(classifySplashRoyaltyPoolRedeemer(C(0, C(0), I(1)))).toBeNull(); // action not a bare Int
  });
});
