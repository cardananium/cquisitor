import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  govActionName,
  parseActiveParams,
  parseCDPCredential,
  parseCDPDatum,
  parseConstraint,
  parseLeftoversDatum,
  parseMonoDatum,
  parsePolicyRedeemer,
  parseSpendAction,
  parseTreasuryKind,
  validateCDP,
} from "./butane";
import { butaneDecode } from "./index";
import { BUTANE, matchButaneNftPolicy, matchButaneScriptHash } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const VKEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const USDB = "55534462"; // "USDb"

// Asset = Constr0[policy, name]
const asset: PD = C(0, B(POLICY), B(USDB));
// CDPCredential AuthorizeWithPubKey = Constr0[pkh, vkey]
const ownerPk: PD = C(0, B(PKH), B(VKEY));

describe("parseCDPDatum (MonoDatum Constr 1)", () => {
  const cdp: PD = C(1, ownerPk, B(USDB), I(1_000_000), I(1_730_000_000_000));

  test("parses the vault/CDP fields", () => {
    const d = parseCDPDatum(cdp);
    expect(d.kind).toBe("CDP");
    expect(d.syntheticAsset).toBe(USDB);
    expect(d.syntheticAmount).toBe(BigInt(1_000_000));
    expect(d.startTime).toBe(BigInt(1_730_000_000_000));
    expect(d.owner).toEqual({ kind: "AuthorizeWithPubKey", pubKeyHash: PKH, verificationKey: VKEY });
  });

  test("parseMonoDatum routes Constr 1 to CDP", () => {
    const m = parseMonoDatum(cdp);
    expect(m.kind).toBe("CDP");
  });

  test("parseCDPDatum rejects a non-CDP MonoDatum", () => {
    // Constr 4 = CompatLockedTokens
    expect(() => parseCDPDatum(C(4))).toThrow();
  });
});

describe("parseCDPCredential / parseConstraint", () => {
  test("AuthorizeWithConstraint → MustSpendToken(AssetClass)", () => {
    const cred = parseCDPCredential(C(1, C(0, asset)));
    expect(cred.kind).toBe("AuthorizeWithConstraint");
    if (cred.kind !== "AuthorizeWithConstraint") throw new Error("expected constraint");
    expect(cred.constraint).toEqual({
      kind: "MustSpendToken",
      asset: { policyId: POLICY, assetName: USDB },
    });
  });

  test("MustWithdrawFrom → standard StakeCredential Inline(Script)", () => {
    // Inline(Constr0)[ ScriptCredential Constr1[hash] ]
    const ct = parseConstraint(C(1, C(0, C(1, B(PKH)))));
    expect(ct.kind).toBe("MustWithdrawFrom");
    if (ct.kind !== "MustWithdrawFrom") throw new Error("expected withdraw");
    expect(ct.stake).toEqual({ kind: "Inline", credential: { kind: "Script", hash: PKH } });
  });
});

describe("parseMonoDatum — ParamsWrapper (Constr 0)", () => {
  // ActiveParams = Constr0 with 11 ordered fields
  const activeParams: PD = C(
    0,
    L(asset), // collateral_assets
    L(I(1)), // weights
    I(1_000_000), // denominator
    I(100), // minimum_outstanding_synthetic
    L(L(I(1_730_000_000_000), I(5))), // interest_rates: Pair(PosixTime, Int) = List[Int, Int]
    L(I(50)), // max_proportions
    I(110), // max_liquidation_return
    I(10), // treasury_liquidation_share
    I(20), // redemption_share
    I(30), // fee_token_discount
    L(L(I(1_730_000_000_000), I(3))), // staking_interest_rates: List[Int, Int]
  );
  // Params LiveParams = Constr0[ActiveParams]; ParamsWrapper = MonoDatum Constr0[Params]
  const paramsWrapper: PD = C(0, C(0, activeParams));

  test("routes to ParamsWrapper, not vault", () => {
    const m = parseMonoDatum(paramsWrapper);
    expect(m.kind).toBe("ParamsWrapper");
    if (m.kind !== "ParamsWrapper") throw new Error("expected params");
    expect(m.params.kind).toBe("LiveParams");
  });

  test("parseActiveParams reads all 11 fields", () => {
    const p = parseActiveParams(activeParams);
    expect(p.collateralAssets).toEqual([{ policyId: POLICY, assetName: USDB }]);
    expect(p.weights).toEqual([BigInt(1)]);
    expect(p.denominator).toBe(BigInt(1_000_000));
    expect(p.maxLiquidationReturn).toBe(BigInt(110));
    expect(p.interestRates[0]).toEqual({ numerator: BigInt(1_730_000_000_000), denominator: BigInt(5) });
    expect(p.stakingInterestRates[0]).toEqual({ numerator: BigInt(1_730_000_000_000), denominator: BigInt(3) });
  });
});

describe("parseMonoDatum — StakedSynthetics (Constr 5)", () => {
  test("parses owner + asset + start_time", () => {
    const m = parseMonoDatum(C(5, ownerPk, B(USDB), I(42)));
    expect(m.kind).toBe("StakedSynthetics");
    if (m.kind !== "StakedSynthetics") throw new Error("expected staked");
    expect(m.syntheticAsset).toBe(USDB);
    expect(m.startTime).toBe(BigInt(42));
  });
});

describe("parseLeftoversDatum", () => {
  test("Constr0[owner: CDPCredential]", () => {
    const d = parseLeftoversDatum(C(0, ownerPk));
    expect(d.owner.kind).toBe("AuthorizeWithPubKey");
  });
});

describe("parsePolicyRedeemer (synthetics.validate WithdrawFrom)", () => {
  test("SyntheticsMain Constr0[spends, creates]", () => {
    // SpendAction = Constr0[SpendType, params_idx, FeeType]
    // SpendType RepayCDP = Constr3[verifier]; FeeType FeeInSynthetic = Constr0[]
    const spend: PD = C(0, C(3, C(0, C(0))), I(0), C(0));
    const r = parsePolicyRedeemer(C(0, L(spend), L(I(1))));
    expect(r.kind).toBe("SyntheticsMain");
    if (r.kind !== "SyntheticsMain") throw new Error("expected main");
    expect(r.spends).toHaveLength(1);
    expect(r.spends[0].spendType.kind).toBe("RepayCDP");
    expect(r.spends[0].feeType.kind).toBe("FeeInSynthetic");
    expect(r.creates).toEqual([BigInt(1)]);
  });

  test("PartialLiquidateCDP carries repay_amount; FeeInFeeToken carries idx", () => {
    const spend = parseSpendAction(C(0, C(1, I(500)), I(2), C(1, I(7))));
    expect(spend.spendType).toEqual({ kind: "PartialLiquidateCDP", repayAmount: BigInt(500) });
    expect(spend.paramsIdx).toBe(BigInt(2));
    expect(spend.feeType).toEqual({ kind: "FeeInFeeToken", feeTokenIdx: BigInt(7) });
  });

  test("BadDebt + Auxilliary", () => {
    expect(parsePolicyRedeemer(C(2, I(3)))).toEqual({ kind: "BadDebt", treasuryOutIdx: BigInt(3) });
    expect(parsePolicyRedeemer(C(3))).toEqual({ kind: "Auxilliary" });
  });
});

describe("parseTreasuryKind (inner TreasuryDatum, MonoDatum Constr 3)", () => {
  test("TreasuryFromFees = Constr2[]", () => {
    expect(parseTreasuryKind(C(2))).toEqual({ kind: "TreasuryFromFees" });
  });
  test("TreasuryWithDebt = Constr0[TreasuryDebt, Option<PosixTime>]", () => {
    // TreasuryDebt = Constr0[amount, assetName]; Some = Constr0[time]
    const t = parseTreasuryKind(C(0, C(0, I(123), B(USDB)), C(0, I(1_730_000_000_000))));
    expect(t.kind).toBe("TreasuryWithDebt");
    if (t.kind !== "TreasuryWithDebt") throw new Error("expected debt");
    expect(t.debt).toEqual({ amount: BigInt(123), asset: USDB });
    expect(t.creationTime).toBe(BigInt(1_730_000_000_000));
  });
  test("TreasuryWithDebt with None creation_time", () => {
    const t = parseTreasuryKind(C(0, C(0, I(5), B("")), C(1)));
    if (t.kind !== "TreasuryWithDebt") throw new Error("expected debt");
    expect(t.creationTime).toBeNull();
  });
});

describe("govActionName (inner GovAction, MonoDatum Constr 2)", () => {
  test("maps declaration-order ctor to variant name", () => {
    expect(govActionName(C(0, C(0)))).toBe("NewParamsAuth");
    expect(govActionName(C(3, B(USDB), I(1)))).toBe("TreasuryMintAuth");
    expect(govActionName(C(8, B(POLICY)))).toBe("GovNewCompat");
    expect(govActionName(C(99))).toBeNull();
  });
});

describe("butaneDecode view — surfaced fields (completeness)", () => {
  test("CDP surfaces owner verification key when non-empty", () => {
    const cdp = C(1, C(0, B(PKH), B(VKEY)), B(USDB), I(1_000_000), I(1_730_000_000_000));
    const view = butaneDecode(cdp, "vault");
    const labels = view.rows.map((r) => r.label);
    expect(labels).toContain("Owner (pubkey)");
    expect(labels.some((l) => /verification key/i.test(l))).toBe(true);
    const vkRow = view.rows.find((r) => /verification key/i.test(r.label));
    expect(vkRow?.value).toBe(VKEY);
  });

  test("CDP omits verification-key row when empty (common case)", () => {
    const cdp = C(1, C(0, B(PKH), B("")), B(USDB), I(1_000_000), I(1_730_000_000_000));
    const view = butaneDecode(cdp, "vault");
    expect(view.rows.some((r) => /verification key/i.test(r.label))).toBe(false);
  });

  test("ParamsWrapper surfaces every collateral asset (not a count) + fee components", () => {
    const asset2: PD = C(0, B(POLICY), B("4254")); // 2nd asset
    const activeParams: PD = C(
      0,
      L(asset, asset2), // collateral_assets (2)
      L(I(12), I(15)), // weights
      I(10), // denominator
      I(40_000_000), // minimum_outstanding_synthetic
      L(L(I(1_730_000_000_000), I(900))), // interest_rates
      L(I(10_000), I(5_000)), // max_proportions
      I(15_000), // max_liquidation_return
      I(4_000), // treasury_liquidation_share
      I(9_950), // redemption_share
      I(5_000), // fee_token_discount
      L(L(I(1_730_000_000_000), I(500))), // staking_interest_rates
    );
    const paramsWrapper: PD = C(0, C(0, activeParams));
    const view = butaneDecode(paramsWrapper, "vault");
    // two collateral asset rows, each rendered as an asset (not collapsed count)
    const assetRows = view.rows.filter((r) => r.asset);
    expect(assetRows).toHaveLength(2);
    expect(assetRows[0].asset).toEqual({ policyId: POLICY, assetName: USDB });
    const labels = view.rows.map((r) => r.label);
    expect(labels).toContain("Max liquidation return");
    expect(labels).toContain("Treasury liquidation share");
    expect(labels).toContain("Redemption share");
    expect(labels).toContain("Fee token (BTN) discount");
    expect(labels.some((l) => /interest rate/i.test(l))).toBe(true);
    expect(labels.some((l) => /staking interest rate/i.test(l))).toBe(true);
    // no bare "Collateral assets: N" count row
    expect(view.rows.some((r) => r.label === "Collateral assets")).toBe(false);
  });

  test("TreasuryDatum surfaces the variant discriminant", () => {
    const view = butaneDecode(C(3, C(2)), "vault");
    const t = view.rows.find((r) => r.label === "Treasury type");
    expect(t?.value).toBe("TreasuryFromFees");
  });

  test("GovDatum surfaces the gov action discriminant", () => {
    const view = butaneDecode(C(2, C(5, B("68656c6c6f"))), "vault");
    const g = view.rows.find((r) => r.label === "Gov action");
    expect(g?.value).toBe("TextProposalAuth");
  });
});

describe("validateCDP", () => {
  test("flags non-positive debt and unset start time", () => {
    const issues = validateCDP({
      kind: "CDP",
      owner: { kind: "AuthorizeWithPubKey", pubKeyHash: PKH, verificationKey: VKEY },
      syntheticAsset: USDB,
      syntheticAmount: BigInt(0),
      startTime: BigInt(0),
    });
    expect(issues.some((i) => /debt/.test(i.message))).toBe(true);
    expect(issues.some((i) => /start_time/.test(i.message))).toBe(true);
  });
});

describe("Butane matching", () => {
  test("matchScriptHash: pointers.spend → vault, leftovers → leftovers", () => {
    expect(matchButaneScriptHash(BUTANE.pointersSpendHash, "mainnet")).toBe("vault");
    expect(matchButaneScriptHash(BUTANE.leftoversCollectHash, undefined)).toBe("leftovers");
    // synthetics.validate is the logic validator, NOT an address cred → no match.
    expect(matchButaneScriptHash(BUTANE.syntheticsValidateHash, "mainnet")).toBeNull();
    expect(matchButaneScriptHash(BUTANE.pointersSpendHash, "preprod")).toBeNull();
    expect(matchButaneScriptHash(PKH, "mainnet")).toBeNull();
  });

  test("matchNftPolicy: synth mint policy → vault on mainnet only", () => {
    expect(matchButaneNftPolicy(BUTANE.pointersMintPolicy, [USDB], "mainnet")).toBe("vault");
    expect(matchButaneNftPolicy(BUTANE.pointersMintPolicy, [], undefined)).toBe("vault");
    expect(matchButaneNftPolicy(BUTANE.pointersMintPolicy, [USDB], "preview")).toBeNull();
    expect(matchButaneNftPolicy(POLICY, [USDB], "mainnet")).toBeNull();
  });
});
