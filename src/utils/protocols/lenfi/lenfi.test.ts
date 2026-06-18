import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import {
  parseCollateralDatum,
  parseCollateralRedeemer,
  parseLeftoversDatum,
  parseOrderDatum,
  parsePoolDatum,
  parsePoolRedeemer,
  parseLenfiDatum,
} from "./lenfi";
import { matchLenfiNftPolicy, matchLenfiScriptHash, LENFI_V2 } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const STAKE = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const NAME = "4c454e4649"; // "LENFI"
const TXID = "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe";
const POOL_NFT_NAME = "fa0a035e313e3a5861dad43f58b25d7675e1443966fa0a46d01ac9e1";
const BORROWER_TN = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef0";

// AssetClass = Constr 0 [ policy, name ].
const ada: PD = C(0, B(""), B(""));
const token: PD = C(0, B(POLICY), B(NAME));
// Address = Constr 0 [ Credential, Some(Inline(Credential)) ].
const addr: PD = C(0, C(1, B(PKH)), C(0, C(0, C(1, B(STAKE)))));
// OutputReference = Constr 0 [ Constr 0 [ txid ], idx ].
const oref = (idx: number): PD => C(0, C(0, B(TXID)), I(idx));

// pool.InterestParams = Constr 0 [ optimal, base, rslope1, rslope2 ].
const interestParams: PD = C(0, I(450000), I(30000), I(75000), I(2500000));
// pool.PlatformFeeDetails = Constr 0 [ 6 tier ints, liquidation_fee, address ].
const platformFee: PD = C(0, I(1), I(2), I(3), I(4), I(5), I(6), I(20000), addr);
// pool.Config = Constr 0 [ 9 ints around loan_fee_details + interest_params ].
const poolConfig: PD = C(
  0,
  I(600000), // liquidation_threshold
  I(700000), // initial_collateral_ratio
  I(2000), // pool_fee
  platformFee, // loan_fee_details
  I(1000000), // merge_action_fee
  I(5000000), // min_transition
  I(10000000), // min_loan
  I(100000), // min_fee
  I(500000), // min_liquidation_fee
  interestParams,
);

describe("parsePoolDatum", () => {
  // pool.Constants = Constr 0 [ collateral_address, loan_cs, collateral_cs,
  // oracle_collateral, oracle_loan, lp_token, pool_nft_name, pool_config_name ].
  const constants: PD = C(
    0,
    addr,
    token, // loan_cs
    ada, // collateral_cs
    token, // oracle_collateral_asset
    token, // oracle_loan_asset
    token, // lp_token
    B(POOL_NFT_NAME),
    B(NAME),
  );
  // pool.Datum = Constr 0 [ params, balance, lent_out, total_lp_tokens ].
  const datum: PD = C(0, constants, I(1_000_000_000), I(400_000_000), I(950_000_000));

  test("parses pool datum fields", () => {
    const p = parsePoolDatum(datum);
    expect(p.balance).toBe(BigInt(1_000_000_000));
    expect(p.lentOut).toBe(BigInt(400_000_000));
    expect(p.totalLpTokens).toBe(BigInt(950_000_000));
    expect(p.params.loanCs).toEqual({ policyId: POLICY, assetName: NAME });
    expect(p.params.collateralCs).toEqual({ policyId: "", assetName: "" });
    expect(p.params.poolNftName).toBe(POOL_NFT_NAME);
    expect(p.params.collateralAddress.paymentCredential).toEqual({ kind: "Script", hash: PKH });
  });

  test("parseLenfiDatum routes role 'pool'", () => {
    const r = parseLenfiDatum(datum, "pool");
    expect(r.kind).toBe("pool");
  });
});

describe("parseCollateralDatum", () => {
  // CollateralDatum = Constr 0 [ 14 fields ], tag = Some(oref).
  const datum: PD = C(
    0,
    B(POOL_NFT_NAME), // pool_nft_name
    token, // loan_cs
    I(50_000_000), // loan_amount
    poolConfig, // pool_config
    ada, // collateral_cs
    I(120_000_000), // collateral_amount
    I(35000), // interest_rate
    I(400_000_000), // lent_out
    I(1_000_000_000), // balance
    I(1_730_000_000_000), // deposit_time
    B(BORROWER_TN), // borrower_tn
    token, // oracle_collateral_asset
    token, // oracle_loan_asset
    C(0, oref(2)), // tag = Some(oref)
  );

  test("parses collateral datum fields", () => {
    const c = parseCollateralDatum(datum);
    expect(c.poolNftName).toBe(POOL_NFT_NAME);
    expect(c.loanAmount).toBe(BigInt(50_000_000));
    expect(c.collateralAmount).toBe(BigInt(120_000_000));
    expect(c.interestRate).toBe(BigInt(35000));
    expect(c.borrowerTn).toBe(BORROWER_TN);
    expect(c.collateralCs).toEqual({ policyId: "", assetName: "" });
    expect(c.poolConfig.liquidationThreshold).toBe(BigInt(600000));
    expect(c.poolConfig.interestParams.rslope2).toBe(BigInt(2500000));
    expect(c.poolConfig.loanFeeDetails.liquidationFee).toBe(BigInt(20000));
    expect(c.tag).toEqual({ transactionId: TXID, outputIndex: BigInt(2) });
  });

  test("None tag decodes to null", () => {
    const d2: PD = C(
      0,
      B(POOL_NFT_NAME), token, I(1), poolConfig, ada, I(1), I(1), I(1), I(1), I(1),
      B(BORROWER_TN), token, token, C(1), // tag = None
    );
    expect(parseCollateralDatum(d2).tag).toBeNull();
  });
});

describe("parsePoolRedeemer (wrapped)", () => {
  test("Wrapped Borrow continuing action", () => {
    // WrappedRedeemer Constr1 [ pool.Redeemer Constr0 [ action, config_ref, order ] ].
    // action = Continuing(Borrow) = Constr0 [ Constr1 [ loan, coll, tn, rate, out ] ].
    const inner: PD = C(
      0,
      C(0, C(1, I(50_000_000), I(120_000_000), B(BORROWER_TN), I(35000), I(1))),
      oref(0), // config_ref
      C(0, oref(3)), // order = Some
    );
    const wrapped: PD = C(1, inner);
    const r = parsePoolRedeemer(wrapped);
    expect(r).not.toBeNull();
    if (!r) throw new Error("expected redeemer");
    expect(r.action.kind).toBe("Continuing");
    if (r.action.kind !== "Continuing") throw new Error("expected Continuing");
    expect(r.action.action.kind).toBe("Borrow");
    if (r.action.action.kind !== "Borrow") throw new Error("expected Borrow");
    expect(r.action.action.loanAmount).toBe(BigInt(50_000_000));
    expect(r.action.action.borrowerTn).toBe(BORROWER_TN);
    expect(r.configRef).toEqual({ transactionId: TXID, outputIndex: BigInt(0) });
    expect(r.order).toEqual({ transactionId: TXID, outputIndex: BigInt(3) });
  });

  test("Wrapped Destroy action", () => {
    const inner: PD = C(0, C(1), oref(0), C(1));
    const r = parsePoolRedeemer(C(1, inner));
    if (!r) throw new Error("expected redeemer");
    expect(r.action.kind).toBe("Destroy");
    expect(r.order).toBeNull();
  });

  test("BadScriptContext (Constr0) -> null", () => {
    expect(parsePoolRedeemer(C(0))).toBeNull();
  });
});

describe("parseCollateralRedeemer", () => {
  test("Repay + ImmediateWithPool", () => {
    const red: PD = C(0, C(0), I(1234), C(0, oref(5)));
    const r = parseCollateralRedeemer(red);
    expect(r.action.kind).toBe("Repay");
    expect(r.interest).toBe(BigInt(1234));
    expect(r.mergeType.kind).toBe("ImmediateWithPool");
    if (r.mergeType.kind !== "ImmediateWithPool") throw new Error("expected immediate");
    expect(r.mergeType.outputReference.outputIndex).toBe(BigInt(5));
  });

  test("Liquidate + DelayedIntoPool", () => {
    const red: PD = C(0, C(1, I(7)), I(0), C(1, C(0, I(3), I(40_000_000))));
    const r = parseCollateralRedeemer(red);
    expect(r.action.kind).toBe("Liquidate");
    if (r.action.kind !== "Liquidate") throw new Error("expected liquidate");
    expect(r.action.liquidationOutputRefIndex).toBe(BigInt(7));
    expect(r.mergeType.kind).toBe("DelayedIntoPool");
    if (r.mergeType.kind !== "DelayedIntoPool") throw new Error("expected delayed");
    expect(r.mergeType.outputIndex).toBe(BigInt(3));
    expect(r.mergeType.amountRepaying).toBe(BigInt(40_000_000));
  });
});

describe("parseLeftoversDatum", () => {
  test("LeftoversDatum = AssetClass (pool NFT)", () => {
    // leftovers.LeftoversDatum = AssetClass = Constr 0 [ policy, name ].
    const l = parseLeftoversDatum(C(0, B(POLICY), B(POOL_NFT_NAME)));
    expect(l.poolNft).toEqual({ policyId: POLICY, assetName: POOL_NFT_NAME });
  });

  test("parseLenfiDatum routes a 2-field loan datum to leftovers", () => {
    const r = parseLenfiDatum(C(0, B(POLICY), B(POOL_NFT_NAME)), "loan");
    expect(r.kind).toBe("leftovers");
  });
});

describe("parseOrderDatum", () => {
  // order.Datum<a> = Constr 0 [ control_credential, pool_nft_cs, batcher_fee, order ].
  // Header sub-fields shared by every request kind.
  const control: PD = C(0, B(PKH)); // VKey credential
  const poolNftCs: PD = C(0, B(POLICY), B(POOL_NFT_NAME));
  // Minimal stand-ins for the embedded Output / PartialOutput structures, which
  // we deliberately don't expand (the redeemer re-validates them).
  const outputStub: PD = C(0, addr, C(0), C(0), C(1));
  const partialStub: PD = C(0, addr, C(0), C(0));
  const order = (req: PD): PD => C(0, control, poolNftCs, I(2_000_000), req);

  test("BorrowRequest (7 fields)", () => {
    const req: PD = C(
      0,
      outputStub, // expected_output
      partialStub, // partial_output
      B(LENFI_V2.collateralHash), // borrower_nft_policy
      I(70_000_000), // min_collateral_amount
      I(1_717_743_538_000), // min_deposit_time
      I(37_866), // max_interest_rate
      addr, // collateral_address
    );
    const d = parseOrderDatum(order(req));
    expect(d.controlCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(d.poolNftCs).toEqual({ policyId: POLICY, assetName: POOL_NFT_NAME });
    expect(d.batcherFeeAda).toBe(BigInt(2_000_000));
    expect(d.request.kind).toBe("Borrow");
    if (d.request.kind !== "Borrow") throw new Error("expected Borrow");
    expect(d.request.borrowerNftPolicy).toBe(LENFI_V2.collateralHash);
    expect(d.request.minCollateralAmount).toBe(BigInt(70_000_000));
    expect(d.request.minDepositTime).toBe(BigInt(1_717_743_538_000));
    expect(d.request.maxInterestRate).toBe(BigInt(37_866));
    expect(d.request.collateralAddress.paymentCredential).toEqual({ kind: "Script", hash: PKH });
    // expected_output.address — the borrower's loan/NFT destination address.
    expect(d.request.destinationAddress?.paymentCredential).toEqual({ kind: "Script", hash: PKH });
    expect(d.request.destinationAddress?.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "Script", hash: STAKE },
    });
  });

  test("DepositRequest (3 fields, Int first)", () => {
    const req: PD = C(0, I(56_500_000), partialStub, token); // amount, partial, lp_asset
    const d = parseOrderDatum(order(req));
    expect(d.request.kind).toBe("Deposit");
    if (d.request.kind !== "Deposit") throw new Error("expected Deposit");
    expect(d.request.depositAmount).toBe(BigInt(56_500_000));
    expect(d.request.lpAsset).toEqual({ policyId: POLICY, assetName: NAME });
    // partial_output.address — where the minted LP tokens are returned.
    expect(d.request.destinationAddress?.paymentCredential).toEqual({ kind: "Script", hash: PKH });
  });

  test("RepayRequest (3 fields, Output first)", () => {
    // expected_output, order: OutputReference, burn_asset.
    const req: PD = C(0, outputStub, oref(4), token);
    const d = parseOrderDatum(order(req));
    expect(d.request.kind).toBe("Repay");
    if (d.request.kind !== "Repay") throw new Error("expected Repay");
    expect(d.request.order).toEqual({ transactionId: TXID, outputIndex: BigInt(4) });
    expect(d.request.burnAsset).toEqual({ policyId: POLICY, assetName: NAME });
    // expected_output.address — where the freed collateral is returned.
    expect(d.request.destinationAddress?.paymentCredential).toEqual({ kind: "Script", hash: PKH });
  });

  test("WithdrawRequest (4 fields)", () => {
    const req: PD = C(0, I(1_000), partialStub, ada, token); // burn, partial, receive, lp
    const d = parseOrderDatum(order(req));
    expect(d.request.kind).toBe("Withdraw");
    if (d.request.kind !== "Withdraw") throw new Error("expected Withdraw");
    expect(d.request.lpTokensBurn).toBe(BigInt(1_000));
    expect(d.request.receiveAsset).toEqual({ policyId: "", assetName: "" });
    expect(d.request.lpAsset).toEqual({ policyId: POLICY, assetName: NAME });
    // partial_output.address — where the withdrawn assets are returned.
    expect(d.request.destinationAddress?.paymentCredential).toEqual({ kind: "Script", hash: PKH });
  });

  test("LiquidateRequest (1 field)", () => {
    const d = parseOrderDatum(order(C(0, outputStub)));
    expect(d.request.kind).toBe("Liquidate");
    if (d.request.kind !== "Liquidate") throw new Error("expected Liquidate");
    // expected_output.address — where the liquidation proceeds go.
    expect(d.request.destinationAddress?.paymentCredential).toEqual({ kind: "Script", hash: PKH });
  });

  test("parseLenfiDatum routes role 'order'", () => {
    const d = parseLenfiDatum(order(C(0, outputStub)), "order");
    expect(d.kind).toBe("order");
  });

  // Real on-chain borrow order datum (order_borrow validator 70512aa1…).
  const LIVE_ORDER_DATUM = convertSerdeNumbers(
    JSON.parse(
      '{"fields":[{"fields":[{"bytes":"a1ba8a133da3e6690e38291345fe05005c10060b872f1181f736775e"}],"constructor":0},{"fields":[{"bytes":"32e8c0ae314ef4be452c16a999867f66d1a1791fc972cb2f7c74e38d"},{"bytes":"1c492d6bc445ddcb9ab75ad9c921947a86633682b951f187e11aff40"}],"constructor":0},{"int":2000000},{"fields":[{"fields":[{"fields":[{"fields":[{"bytes":"a1ba8a133da3e6690e38291345fe05005c10060b872f1181f736775e"}],"constructor":0},{"fields":[{"fields":[{"fields":[{"bytes":"62e25f96dae4d0f9558d5a560e49f2c82cd5c772ea5cff1dcfd9b7c5"}],"constructor":0}],"constructor":0}],"constructor":0}],"constructor":0},{"map":[{"k":{"bytes":""},"v":{"map":[{"k":{"bytes":""},"v":{"int":2000000}}]}},{"k":{"bytes":"5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8aef064415d114"},"v":{"map":[{"k":{"bytes":"494147"},"v":{"int":180000000}}]}}]},{"fields":[],"constructor":0},{"fields":[],"constructor":1}],"constructor":0},{"fields":[{"fields":[{"fields":[{"bytes":"a1ba8a133da3e6690e38291345fe05005c10060b872f1181f736775e"}],"constructor":0},{"fields":[{"fields":[{"fields":[{"bytes":"62e25f96dae4d0f9558d5a560e49f2c82cd5c772ea5cff1dcfd9b7c5"}],"constructor":0}],"constructor":0}],"constructor":0}],"constructor":0},{"map":[{"k":{"bytes":""},"v":{"map":[{"k":{"bytes":""},"v":{"int":2000000}}]}}]},{"fields":[],"constructor":0}],"constructor":0},{"bytes":"8021830afedd85fda1253da2be75b66c0e65c482148eb8ca690903cb"},{"int":70000000},{"int":1717743538000},{"int":37866},{"fields":[{"fields":[{"bytes":"8021830afedd85fda1253da2be75b66c0e65c482148eb8ca690903cb"}],"constructor":1},{"fields":[{"fields":[{"fields":[{"bytes":"1c492d6bc445ddcb9ab75ad9c921947a86633682b951f187e11aff40"}],"constructor":1}],"constructor":0}],"constructor":0}],"constructor":0}],"constructor":0}],"constructor":0}',
    ),
  ) as PD;

  test("decodes real borrow order datum", () => {
    const d = parseOrderDatum(LIVE_ORDER_DATUM);
    expect(d.batcherFeeAda).toBe(BigInt(2_000_000));
    expect(d.poolNftCs.policyId).toBe("32e8c0ae314ef4be452c16a999867f66d1a1791fc972cb2f7c74e38d");
    expect(d.request.kind).toBe("Borrow");
    if (d.request.kind !== "Borrow") throw new Error("expected Borrow");
    expect(d.request.borrowerNftPolicy).toBe(
      "8021830afedd85fda1253da2be75b66c0e65c482148eb8ca690903cb",
    );
    expect(d.request.minCollateralAmount).toBe(BigInt(70_000_000));
    expect(d.request.minDepositTime).toBe(BigInt(1_717_743_538_000));
    expect(d.request.maxInterestRate).toBe(BigInt(37_866));
    expect(d.request.collateralAddress.paymentCredential).toEqual({
      kind: "Script",
      hash: "8021830afedd85fda1253da2be75b66c0e65c482148eb8ca690903cb",
    });
    // expected_output.address — the borrower's own address (loan + borrower NFT
    // destination), previously dropped by the decoder.
    expect(d.request.destinationAddress?.paymentCredential).toEqual({
      kind: "VKey",
      hash: "a1ba8a133da3e6690e38291345fe05005c10060b872f1181f736775e",
    });
    expect(d.request.destinationAddress?.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: "62e25f96dae4d0f9558d5a560e49f2c82cd5c772ea5cff1dcfd9b7c5" },
    });
  });
});

// Mainnet datums in the serde number wrapper. These lock the parsers to the
// on-chain shapes.
// Pool: addr1xyew3s9… (pool NFT 7876ebac…).
// Loan: collateral UTxO (borrower NFT e927cac0…).
const LIVE_POOL_DATUM = convertSerdeNumbers(
  JSON.parse(
    '{"fields":[{"fields":[{"fields":[{"fields":[{"bytes":"8021830afedd85fda1253da2be75b66c0e65c482148eb8ca690903cb"}],"constructor":1},{"fields":[{"fields":[{"fields":[{"bytes":"7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86"}],"constructor":1}],"constructor":0}],"constructor":0}],"constructor":0},{"fields":[{"bytes":""},{"bytes":""}],"constructor":0},{"fields":[{"bytes":"8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f69587"},{"bytes":"41414441"}],"constructor":0},{"fields":[{"bytes":"13dfcd07acf9c62ae28f7578e637210dddd7f77b393d0983b89c2707"},{"bytes":"2f426424960c554bf256c1e7f2ee74013271613fd6cffdbe1b2f337600ed774c"}],"constructor":0},{"fields":[{"bytes":"13dfcd07acf9c62ae28f7578e637210dddd7f77b393d0983b89c2707"},{"bytes":"2f426424960c554bf256c1e7f2ee74013271613fd6cffdbe1b2f337600ed774c"}],"constructor":0},{"fields":[{"bytes":"873ab9c3e84cbb861b20f5cea4173226ab2a098e5267e384d0722c5a"},{"bytes":"7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86"}],"constructor":0},{"bytes":"7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86"},{"bytes":"1175ee981b6b88cd45d2cbfdf93ef48f968fa842588bde3027f2e4495f156c65"}],"constructor":0},{"int":3500000},{"int":0},{"int":76372081344}],"constructor":0}',
  ),
) as PD;

const LIVE_COLLATERAL_DATUM = convertSerdeNumbers(
  JSON.parse(
    '{"fields":[{"bytes":"21e45442265dad540322fe30cd4bdbe1322652dd5b95a8a5f6159d46"},{"fields":[{"bytes":"8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f69587"},{"bytes":"41414441"}],"constructor":0},{"int":9600000},{"fields":[{"int":1300000},{"int":1500000},{"int":210378},{"fields":[{"int":10000},{"int":0},{"int":15000},{"int":150000},{"int":20000},{"int":450000},{"int":25000},{"fields":[{"fields":[{"bytes":"0c8b9cc1657e5139be7a331036c5499f0c2dc09fd8680e9773e4a01a"}],"constructor":0},{"fields":[{"fields":[{"fields":[{"bytes":"6e0defd3cf3a4307652e956b3ca65789ca5b7836ae5494ebc546ad8a"}],"constructor":0}],"constructor":0}],"constructor":0}],"constructor":0}],"constructor":0},{"int":280504},{"int":7012622},{"int":7012622},{"int":420756},{"int":5000000},{"fields":[{"int":450000},{"int":30000},{"int":75000},{"int":3000000}],"constructor":0}],"constructor":0},{"fields":[{"bytes":""},{"bytes":""}],"constructor":0},{"int":100000000},{"int":30115},{"int":647100000},{"int":424995696637},{"int":1708874744000},{"bytes":"e927cac0fa6e2e911875a176c0bff221c11ef116da4f64629cb97bbabc8d2125"},{"fields":[{"bytes":"13dfcd07acf9c62ae28f7578e637210dddd7f77b393d0983b89c2707"},{"bytes":"2f426424960c554bf256c1e7f2ee74013271613fd6cffdbe1b2f337600ed774c"}],"constructor":0},{"fields":[{"bytes":"13dfcd07acf9c62ae28f7578e637210dddd7f77b393d0983b89c2707"},{"bytes":"2f426424960c554bf256c1e7f2ee74013271613fd6cffdbe1b2f337600ed774c"}],"constructor":0},{"fields":[],"constructor":1}],"constructor":0}',
  ),
) as PD;

describe("Lenfi datums", () => {
  test("decodes real pool datum", () => {
    const p = parsePoolDatum(LIVE_POOL_DATUM);
    expect(p.balance).toBe(BigInt(3_500_000));
    expect(p.lentOut).toBe(BigInt(0));
    expect(p.totalLpTokens).toBe(BigInt(76_372_081_344));
    expect(p.params.loanCs).toEqual({ policyId: "", assetName: "" });
    expect(p.params.collateralCs).toEqual({
      policyId: "8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f69587",
      assetName: "41414441",
    });
    expect(p.params.poolNftName).toBe("7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86");
  });

  test("decodes real collateral datum (None tag)", () => {
    const c = parseCollateralDatum(LIVE_COLLATERAL_DATUM);
    expect(c.loanAmount).toBe(BigInt(9_600_000));
    expect(c.collateralAmount).toBe(BigInt(100_000_000));
    expect(c.interestRate).toBe(BigInt(30_115));
    expect(c.depositTime).toBe(BigInt(1_708_874_744_000));
    expect(c.borrowerTn).toBe(
      "e927cac0fa6e2e911875a176c0bff221c11ef116da4f64629cb97bbabc8d2125",
    );
    expect(c.collateralCs).toEqual({ policyId: "", assetName: "" });
    expect(c.poolConfig.liquidationThreshold).toBe(BigInt(1_300_000));
    expect(c.poolConfig.interestParams.rslope2).toBe(BigInt(3_000_000));
    expect(c.poolConfig.loanFeeDetails.liquidationFee).toBe(BigInt(25_000));
    expect(c.tag).toBeNull();
  });
});

describe("Lenfi matching", () => {
  // Hashes below are the mainnet deployment.
  test("real deployed pool/collateral hashes", () => {
    expect(LENFI_V2.poolHash).toBe("32e8c0ae314ef4be452c16a999867f66d1a1791fc972cb2f7c74e38d");
    expect(LENFI_V2.collateralHash).toBe(
      "8021830afedd85fda1253da2be75b66c0e65c482148eb8ca690903cb",
    );
  });

  test("matchScriptHash returns roles per spec, mainnet only", () => {
    expect(matchLenfiScriptHash(LENFI_V2.poolHash, "mainnet")).toBe("pool");
    expect(matchLenfiScriptHash(LENFI_V2.collateralHash, undefined)).toBe("loan");
    expect(matchLenfiScriptHash(LENFI_V2.leftoverHash, "mainnet")).toBe("loan");
    expect(matchLenfiScriptHash(LENFI_V2.orderBorrowHash, "mainnet")).toBe("order");
    expect(matchLenfiScriptHash(LENFI_V2.orderDepositHash, "mainnet")).toBe("order");
    expect(matchLenfiScriptHash(LENFI_V2.orderRepayHash, "mainnet")).toBe("order");
    expect(matchLenfiScriptHash(LENFI_V2.orderWithdrawHash, "mainnet")).toBe("order");
    expect(matchLenfiScriptHash(LENFI_V2.oracleHash, "mainnet")).toBe("feed");
    expect(matchLenfiScriptHash(LENFI_V2.poolConfigHash, "mainnet")).toBe("config");
    expect(matchLenfiScriptHash(LENFI_V2.poolHash, "preprod")).toBeNull();
    expect(matchLenfiScriptHash(PKH, "mainnet")).toBeNull();
  });

  test("matchNftPolicy maps pool/collateral policies to roles", () => {
    expect(matchLenfiNftPolicy(LENFI_V2.poolHash, [POOL_NFT_NAME], "mainnet")).toBe("pool");
    expect(matchLenfiNftPolicy(LENFI_V2.collateralHash, [BORROWER_TN], undefined)).toBe("loan");
    expect(matchLenfiNftPolicy(POLICY, [NAME], "mainnet")).toBeNull();
    expect(matchLenfiNftPolicy(LENFI_V2.poolHash, [POOL_NFT_NAME], "preview")).toBeNull();
  });
});
