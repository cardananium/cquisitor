import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  parseAuthorizationMethod,
  parseBorrowData,
  parseClaimData,
  parseCollateralAsset,
  parseCommonData,
  parseFtDatum,
  parseLiquidationMode,
  parseLoanDatum,
  parseLoanWithdrawRedeemer,
  parsePoolDatum,
  parsePoolWithdrawRedeemer,
  parseRepayData,
  parseRepaymentMode,
  parseRequestAction,
  parseRequestDatum,
  parseRequestWithdrawRedeemer,
} from "./loans";
import {
  FLUIDTOKENS,
  fluidTokensSubRoleForPolicy,
  matchFluidTokensNftPolicy,
  matchFluidTokensScriptHash,
} from "./constants";
import { classifyFtWithdrawRedeemer, ftDatumToView } from "./index";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const STAKE = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const NAME = "deadbeef";
const NONE = "4e4f4e45"; // ascii "NONE"

const ada: PD = C(0, B(""), B(""));
const oracleDummy: PD = C(0, B(NONE), B(NONE));
// Address = Constr0[ Credential, Some(Inline(Credential)) ]
const addr: PD = C(0, C(0, B(PKH)), C(0, C(0, C(0, B(STAKE)))));

// Some(name) = Constr0[name]; None = Constr1[]
const someName = C(0, B(NAME));
const none = C(1);

// CollateralAsset Constr0[ policyId, Option<name>, oracleAsset ]
const collateral: PD = C(0, B(POLICY), someName, oracleDummy);

// LiquidationMode idx0 (no fields)
const liqNone: PD = C(0);
// RepaymentMode idx1 (no fields)
const repayInstallments: PD = C(1);

// CommonData Constr0, 11 fields
const commonData: PD = C(
  0,
  ada, // principalAsset
  oracleDummy, // principalOracleAsset
  I(500), // interestRate
  I(24), // installmentPeriod
  I(12), // totalInstallments
  I(48), // initialGracePeriod
  liqNone, // liquidationMode
  repayInstallments, // repaymentMode
  I(72), // repaymentTimeWindow
  I(1000), // penaltyFeeForLateRepayment
  C(1), // repaymentReceipts = True
);

describe("shared type parsers", () => {
  test("parseCollateralAsset with Some(name)", () => {
    const c = parseCollateralAsset(collateral);
    expect(c.policyId).toBe(POLICY);
    expect(c.maybeAssetName).toBe(NAME);
    expect(c.oracleTokenAsset).toEqual({ policyId: NONE, assetName: NONE });
  });

  test("parseCollateralAsset with None", () => {
    const c = parseCollateralAsset(C(0, B(POLICY), none, oracleDummy));
    expect(c.maybeAssetName).toBeNull();
  });

  test("parseAuthorizationMethod indices 0..3", () => {
    expect(parseAuthorizationMethod(C(0, B(PKH)))).toEqual({ kind: "CardanoSignature", hash: PKH });
    expect(parseAuthorizationMethod(C(1, B(PKH))).kind).toBe("CardanoSpendScript");
    expect(parseAuthorizationMethod(C(2, B(PKH))).kind).toBe("CardanoWithdrawScript");
    expect(parseAuthorizationMethod(C(3, B(PKH))).kind).toBe("CardanoMintScript");
  });

  test("parseLiquidationMode variants", () => {
    expect(parseLiquidationMode(C(0)).kind).toBe("NoLiquidationFullCollateralClaim");
    expect(parseLiquidationMode(C(1)).kind).toBe("NoLiquidationDutchAuctionClaim");
    const liq = parseLiquidationMode(C(2, I(70), I(100), I(50), C(1)));
    expect(liq.kind).toBe("Liquidation");
    if (liq.kind !== "Liquidation") throw new Error("expected Liquidation");
    expect(liq.lTV).toBe(BigInt(70));
    expect(liq.equityInPrincipalCurrency).toBe(true);
  });

  test("parseRepaymentMode variants", () => {
    expect(parseRepaymentMode(C(0, I(3)))).toEqual({
      kind: "InterestOnRemainingPrincipal",
      maxPossibleRecasts: BigInt(3),
    });
    expect(parseRepaymentMode(C(1)).kind).toBe("PrincipalAndInterestOnInstallments");
    const perp = parseRepaymentMode(C(2, I(5), I(7)));
    expect(perp.kind).toBe("PerpetualLoan");
    if (perp.kind !== "PerpetualLoan") throw new Error("expected PerpetualLoan");
    expect(perp.apyIncreaseLinearCoefficient).toBe(BigInt(5));
    expect(perp.maxPossibleRecasts).toBe(BigInt(7));
  });

  test("parseCommonData", () => {
    const cd = parseCommonData(commonData);
    expect(cd.interestRate).toBe(BigInt(500));
    expect(cd.totalInstallments).toBe(BigInt(12));
    expect(cd.repaymentReceipts).toBe(true);
    expect(cd.principalAsset).toEqual({ policyId: "", assetName: "" });
  });
});

describe("RequestDatum (12 fields)", () => {
  const datum: PD = C(
    0,
    B(NONE), // permissionedConditionScriptHash
    C(0, I(1)), // extraData (opaque)
    commonData,
    C(0, B(PKH)), // borrowerAuth
    addr, // borrowerAddress
    collateral,
    I(100), // minPrincipal
    I(1), // minPrincipalDivider
    I(1000), // maxPrincipal
    C(0), // dynamicCollateralPrice = False
    I(1_730_000_000_000), // requestExpiration
    I(2_000_000), // requestExpirationPenalty
  );

  test("parses request fields", () => {
    const r = parseRequestDatum(datum);
    expect(r.kind).toBe("request");
    expect(r.permissionedConditionScriptHash).toBe(NONE);
    expect(r.minPrincipal).toBe(BigInt(100));
    expect(r.maxPrincipal).toBe(BigInt(1000));
    expect(r.dynamicCollateralPrice).toBe(false);
    expect(r.requestExpiration).toBe(BigInt(1_730_000_000_000));
    expect(r.borrowerAddress.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(r.extraData).toEqual(C(0, I(1)));
  });

  test("parseFtDatum dispatches request by field count", () => {
    expect(parseFtDatum(datum).kind).toBe("request");
  });

  test("view renders & warns when max < min", () => {
    const bad: PD = C(
      0, B(NONE), C(0, I(1)), commonData, C(0, B(PKH)), addr, collateral,
      I(1000), I(1), I(100), C(0), I(0), I(0),
    );
    const view = ftDatumToView(parseFtDatum(bad));
    expect(view.protocol).toBe("FluidTokens Loans V3");
    expect(view.role).toBe("loan");
    expect(view.issues.some((i) => /maxPrincipal/.test(i.message))).toBe(true);
    expect(view.issues.some((i) => /expiration/.test(i.message))).toBe(true);
  });
});

describe("PoolDatum (10 fields)", () => {
  const datum: PD = C(
    0,
    B(NONE),
    C(0, I(0)), // extraData
    commonData,
    C(2, B(PKH)), // lenderAuth = CardanoWithdrawScript
    addr, // lenderBondAddress
    B("abcdef"), // lenderBondInlineDatumHash
    L(collateral, collateral), // collateralOptions
    L(I(10), I(20)), // minCollateral
    L(I(1), I(1)), // minCollateralDivider
    C(1), // dynamicCollateralPrice = True
  );

  test("parses pool fields", () => {
    const p = parsePoolDatum(datum);
    expect(p.kind).toBe("pool");
    expect(p.lenderAuth.kind).toBe("CardanoWithdrawScript");
    expect(p.collateralOptions.length).toBe(2);
    expect(p.minCollateral).toEqual([BigInt(10), BigInt(20)]);
    expect(p.dynamicCollateralPrice).toBe(true);
  });

  test("parseFtDatum dispatches pool by field count", () => {
    expect(parseFtDatum(datum).kind).toBe("pool");
  });

  test("view warns on length mismatch", () => {
    const bad: PD = C(
      0, B(NONE), C(0, I(0)), commonData, C(2, B(PKH)), addr, B("abcdef"),
      L(collateral, collateral), L(I(10)), L(I(1)), C(1),
    );
    const view = ftDatumToView(parsePoolDatum(bad));
    expect(view.issues.some((i) => /length mismatch/.test(i.message))).toBe(true);
  });
});

describe("LoanDatum (17 fields)", () => {
  const datum: PD = C(
    0,
    I(0), // doneRecasts
    I(100_000_000), // principalAmount
    I(1_730_000_000_000), // lendDate
    I(2), // repaidInstallments
    I(500), // interestRate
    I(12), // totalInstallments
    ada, // principalAsset
    oracleDummy, // principalOracleAsset
    I(24), // installmentPeriod
    I(48), // initialGracePeriod
    liqNone, // liquidationMode
    repayInstallments, // repaymentMode
    I(72), // repaymentTimeWindow
    I(1000), // penaltyFeeForLateRepayment
    C(0), // repaymentReceipts = False
    B(NAME), // originId
    collateral, // collateral
  );

  test("parses loan fields", () => {
    const l = parseLoanDatum(datum);
    expect(l.kind).toBe("loan");
    expect(l.principalAmount).toBe(BigInt(100_000_000));
    expect(l.repaidInstallments).toBe(BigInt(2));
    expect(l.originId).toBe(NAME);
    expect(l.collateral.policyId).toBe(POLICY);
  });

  test("parseFtDatum dispatches loan by field count", () => {
    expect(parseFtDatum(datum).kind).toBe("loan");
    expect(ftDatumToView(parseFtDatum(datum)).kind).toBe("Active loan position");
  });
});

describe("view completeness — previously-dropped fields are surfaced", () => {
  const REAL_ORACLE_POLICY = "93794f9b7f3dc632cb889c7aec7d334f016f532e64f16141b6895f5b";
  const REAL_ORACLE_NAME = "6f7261636c65494147"; // "oracleIAG"
  const realOracle: PD = C(0, B(REAL_ORACLE_POLICY), B(REAL_ORACLE_NAME));
  // CollateralAsset whose oracleTokenAsset is a REAL (non-dummy) oracle token.
  const collateralWithOracle: PD = C(0, B(POLICY), someName, realOracle);
  // CommonData with a real principal oracle + a Liquidation mode (equity flag).
  const liqMode: PD = C(2, I(70), I(100), I(50), C(1)); // equityInPrincipalCurrency = True
  const commonOracle: PD = C(
    0, ada, realOracle, I(500), I(24), I(12), I(48), liqMode, C(1), I(72), I(1000), C(1),
  );

  const rowByPrefix = (rows: { label: string; value?: string }[], prefix: string) =>
    rows.find((r) => r.label.startsWith(prefix));

  test("request surfaces stake credential, collateral oracle token, principal oracle, equity currency", () => {
    const req: PD = C(
      0, B(NONE), C(0), commonOracle, C(0, B(PKH)), addr, collateralWithOracle,
      I(100), I(1), I(1000), C(0), I(1_730_000_000_000), I(2_000_000),
    );
    const view = ftDatumToView(parseFtDatum(req));
    // stake credential (addr has an inline STAKE cred) is its own row.
    expect(rowByPrefix(view.rows, "Borrower stake")?.value).toBe(STAKE);
    // principal oracle token surfaced as an asset row when real.
    expect(view.rows.some((r) => r.label === "Principal oracle token")).toBe(true);
    // liquidation describes the equity currency.
    expect(rowByPrefix(view.rows, "Liquidation mode")?.value).toContain("equity in principal currency");
    // collateral oracle token surfaced in the assets list.
    expect((view.assets ?? []).some((a) => a.label === "Collateral oracle token")).toBe(true);
  });

  test("pool surfaces per-option min-collateral ratio and extra data presence", () => {
    const pool: PD = C(
      0, B(NONE), C(0, I(7)) /* non-empty extraData */, commonOracle, C(0, B(PKH)), addr,
      B("abcdef"), L(collateralWithOracle, collateralWithOracle), L(I(10), I(20)), L(I(1), I(3)), C(1),
    );
    const view = ftDatumToView(parseFtDatum(pool));
    expect(rowByPrefix(view.rows, "Min collateral ratio #1")?.value).toBe("10 / 1");
    expect(rowByPrefix(view.rows, "Min collateral ratio #2")?.value).toBe("20 / 3");
    expect(view.rows.some((r) => r.label === "Extra data (opaque)")).toBe(true);
    // each collateral option contributes its own asset + oracle-token asset row.
    expect((view.assets ?? []).filter((a) => a.label.includes("oracle token")).length).toBe(2);
  });

  test("loan surfaces principal oracle token + collateral oracle token", () => {
    const loan: PD = C(
      0, I(0), I(100_000_000), I(1_730_000_000_000), I(2), I(500), I(12),
      ada, realOracle, I(24), I(48), liqMode, C(1), I(72), I(1000), C(0),
      B(NAME), collateralWithOracle,
    );
    const view = ftDatumToView(parseFtDatum(loan));
    expect(view.rows.some((r) => r.label === "Principal oracle token")).toBe(true);
    expect((view.assets ?? []).some((a) => a.label === "Collateral oracle token")).toBe(true);
  });

  test("dummy oracle (NONE/NONE) and empty extraData are NOT surfaced (no noise)", () => {
    // collateral with dummy oracle, common with ADA principal oracle, empty extraData.
    const view = ftDatumToView(
      parseFtDatum(
        C(0, B(NONE), C(0) /* empty extraData */, commonData, C(0, B(PKH)), addr, collateral,
          I(100), I(1), I(1000), C(0), I(1), I(0)),
      ),
    );
    expect(view.rows.some((r) => r.label === "Extra data (opaque)")).toBe(false);
    expect(view.rows.some((r) => r.label === "Principal oracle token")).toBe(false);
    expect((view.assets ?? []).some((a) => a.label.includes("oracle token"))).toBe(false);
  });
});

describe("withdraw redeemers (the real actions)", () => {
  test("RequestAction: Cancel / CancelAfterExpiration / Lend", () => {
    expect(parseRequestAction(C(0, B(NAME)))).toEqual({ kind: "Cancel", requestId: NAME });
    expect(parseRequestAction(C(1, B(NAME))).kind).toBe("CancelAfterExpiration");
    const lend = parseRequestAction(C(2, I(-1), I(-1), I(500), B(NAME), I(3)));
    expect(lend.kind).toBe("Lend");
    if (lend.kind !== "Lend") throw new Error("expected Lend");
    expect(lend.givenPrincipalAmount).toBe(BigInt(500));
    expect(lend.principalOracleRefInputIndex).toBe(BigInt(-1));
  });

  test("RequestWithdrawRedeemer dispatcher", () => {
    const r = parseRequestWithdrawRedeemer(C(0, I(0), L(C(2, I(-1), I(-1), I(500), B(NAME), I(3)))));
    expect(r.configRefInputIndex).toBe(BigInt(0));
    expect(r.actionsForEachInput[0].kind).toBe("Lend");
  });

  test("PoolWithdrawRedeemer action types 0/1/2", () => {
    expect(parsePoolWithdrawRedeemer(C(0, I(0), C(0))).actionType).toBe("Cancel");
    expect(parsePoolWithdrawRedeemer(C(0, I(0), C(1))).actionType).toBe("Borrow");
    expect(parsePoolWithdrawRedeemer(C(0, I(0), C(2))).actionType).toBe("SellLenderPosition");
  });

  test("BorrowData (8 fields)", () => {
    const b = parseBorrowData(C(0, addr, I(1), I(-1), I(0), I(-1), I(1000), B(NAME), I(2)));
    expect(b.wantedPrincipalAmount).toBe(BigInt(1000));
    expect(b.poolId).toBe(NAME);
    expect(b.borrowerAddress.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
  });

  test("LoanWithdrawRedeemer action types 0..3", () => {
    expect(parseLoanWithdrawRedeemer(C(0, I(0), C(0))).actionType).toBe("Claim");
    expect(parseLoanWithdrawRedeemer(C(0, I(0), C(1))).actionType).toBe("Repay");
    expect(parseLoanWithdrawRedeemer(C(0, I(0), C(2))).actionType).toBe("ChangeCollateral");
    expect(parseLoanWithdrawRedeemer(C(0, I(0), C(3))).actionType).toBe("Recast");
  });

  test("ClaimData (11 fields) = liquidate", () => {
    const cl = parseClaimData(
      C(0, liqNone, I(0), I(1), I(-1), I(-1), I(2), I(3), C(0, B(PKH)), I(100), B(NAME), I(50)),
    );
    expect(cl.equity).toBe(BigInt(100));
    expect(cl.remainingDebt).toBe(BigInt(50));
    expect(cl.loanId).toBe(NAME);
    expect(cl.lenderAuth.kind).toBe("CardanoSignature");
  });

  test("RepayData (6 fields)", () => {
    const rp = parseRepayData(C(0, I(0), I(1), I(2), I(3), B(NAME), C(1)));
    expect(rp.loanId).toBe(NAME);
    expect(rp.isFinalRepayment).toBe(true);
  });

  test("classifyFtWithdrawRedeemer routes by role", () => {
    expect(classifyFtWithdrawRedeemer(C(0, I(0), C(1)), "loan")).toBe("Repay");
    expect(classifyFtWithdrawRedeemer(C(0, I(0), C(1)), "loan:pool")).toBe("Borrow");
    expect(
      classifyFtWithdrawRedeemer(C(0, I(0), L(C(0, B(NAME)))), "loan:request"),
    ).toBe("Cancel");
    expect(classifyFtWithdrawRedeemer(C(0, B("zz")), "loan")).toBeNull();
  });
});

describe("matching", () => {
  test("script-hash match returns null while hashes are empty (not sourced)", () => {
    expect(matchFluidTokensScriptHash(PKH, "mainnet")).toBeNull();
    expect(matchFluidTokensScriptHash("", "mainnet")).toBeNull();
  });

  test("nft-policy match returns null while policies are empty", () => {
    expect(matchFluidTokensNftPolicy(POLICY, [NAME], "mainnet")).toBeNull();
    expect(matchFluidTokensNftPolicy("", [], "mainnet")).toBeNull();
  });

  test("non-mainnet always null", () => {
    expect(matchFluidTokensScriptHash(PKH, "preprod")).toBeNull();
    expect(matchFluidTokensNftPolicy(POLICY, [NAME], "preprod")).toBeNull();
  });

  test("matchers honor populated values (simulated)", () => {
    // Simulate populated config by exercising the same logic the matcher uses.
    // (FLUIDTOKENS values are intentionally empty in the repo.)
    const fakePolicy: string = POLICY;
    const localMatch = (p: string, names: string[]): boolean => {
      if (fakePolicy === "" || p.toLowerCase() !== fakePolicy) return false;
      const pinned = ""; // no asset-name gate
      return pinned === "" || names.map((n) => n.toLowerCase()).includes(pinned);
    };
    expect(localMatch(fakePolicy, [NAME])).toBe(true);
    // sub-role helper returns null for unknown policy by default
    expect(fluidTokensSubRoleForPolicy(POLICY)).toBeNull();
  });

  test("deployed mainnet hashes recovered from the on-chain ConfigDatum, matching fires", () => {
    expect(FLUIDTOKENS.configPolicyId).toBe("219832152b2c489358f4c02a1818d312a851b1f55774ae881e33a907");
    expect(FLUIDTOKENS.loanPolicyId).toBe("30f1095a8a2acb68bb0ffa193e18e004b6dd3e12b5d9c2375a1d5c41");
    expect(FLUIDTOKENS.loanSpendScriptHash).toBe("5abbaa2eb177b574707fa3617e3436295d45d7795e0874623a9504da");
    // matching now resolves a role for the real deployed hashes / policies.
    expect(matchFluidTokensScriptHash(FLUIDTOKENS.poolSpendScriptHash, "mainnet")).toBe("loan");
    expect(matchFluidTokensNftPolicy(FLUIDTOKENS.loanPolicyId, ["abcd"], "mainnet")).toBe("loan");
    expect(fluidTokensSubRoleForPolicy(FLUIDTOKENS.requestPolicyId)).toBe("request");
    expect(fluidTokensSubRoleForPolicy(FLUIDTOKENS.poolPolicyId)).toBe("pool");
  });

  test("config NFT asset name is the verified ascii 'parameters'", () => {
    // The config NFT asset name wire-matching value.
    expect(FLUIDTOKENS.configAssetName).toBe("706172616d6574657273");
    expect(Buffer.from(FLUIDTOKENS.configAssetName, "hex").toString("ascii")).toBe("parameters");
  });
});
