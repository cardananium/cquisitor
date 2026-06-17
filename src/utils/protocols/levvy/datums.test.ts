import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyLevvyRedeemer,
  parseLevvyDatum,
  type LevvyLoan,
  type LevvyOffer,
  type LevvySettlement,
} from "./datums";
import { matchLevvyScriptHash, LEVVY } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const LENDER_PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const LENDER_STAKE = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const BORROWER_PKH = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba98";
const POLICY = "40fa2aa67258b4ce7b5782f74831d46a84c59a0ff0c28262fab21728"; // ClayNation
const ASSET_NAME = "436c61794e6174696f6e39303834"; // "ClayNation9084"
const TXID = "e2b428e82769f88691007dc62b513872832f5a5a1bf9a41171026db58f464ab7";

// Address = Constr0[ Credential, Some(Inline(Credential)) ]
const lenderAddr: PD = C(0, C(0, B(LENDER_PKH)), C(0, C(0, C(0, B(LENDER_STAKE)))));
const borrowerAddr: PD = C(0, C(0, B(BORROWER_PKH)), C(1)); // None stake

// outRef = Constr0[ Constr0[txId], outputIndex ]
const outRef: PD = C(0, C(0, B(TXID)), I(0));

describe("parseLevvyDatum — OFFER (Constr 0)", () => {
  // top Constr0 wraps inner Constr0 with 5 fields
  const datum: PD = C(
    0,
    C(0, lenderAddr, B(POLICY), I(100_000_000), I(5_000_000), I(1_209_600_000)),
  );

  test("parses all offer fields", () => {
    const d = parseLevvyDatum(datum) as LevvyOffer;
    expect(d.variant).toBe("offer");
    expect(d.collateralPolicyId).toBe(POLICY);
    expect(d.principal).toBe(BigInt(100_000_000));
    expect(d.interest).toBe(BigInt(5_000_000));
    expect(d.loanDurationMs).toBe(BigInt(1_209_600_000));
    expect(d.lenderAddress.paymentCredential).toEqual({ kind: "VKey", hash: LENDER_PKH });
    expect(d.lenderAddress.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: LENDER_STAKE },
    });
  });
});

describe("parseLevvyDatum — ACTIVE LOAN (Constr 1)", () => {
  const datum: PD = C(
    1,
    C(
      0,
      lenderAddr,
      borrowerAddr,
      B(POLICY),
      B(ASSET_NAME),
      I(100_000_000),
      I(5_000_000),
      I(1_730_000_000_000),
      outRef,
    ),
  );

  test("parses all loan fields", () => {
    const d = parseLevvyDatum(datum) as LevvyLoan;
    expect(d.variant).toBe("loan");
    expect(d.collateralPolicyId).toBe(POLICY);
    expect(d.collateralAssetName).toBe(ASSET_NAME);
    expect(d.principal).toBe(BigInt(100_000_000));
    expect(d.interest).toBe(BigInt(5_000_000));
    expect(d.deadline).toBe(BigInt(1_730_000_000_000));
    expect(d.borrowerAddress.paymentCredential).toEqual({ kind: "VKey", hash: BORROWER_PKH });
    expect(d.borrowerAddress.stakeCredential).toBeNull();
    expect(d.outRef).toEqual({ txId: TXID, outputIndex: BigInt(0) });
  });
});

describe("parseLevvyDatum — SETTLEMENT (Constr 2)", () => {
  const datum: PD = C(
    2,
    C(0, lenderAddr, I(111_000_000), I(4_799_751), outRef),
  );

  test("parses settlement payout + ref", () => {
    const d = parseLevvyDatum(datum) as LevvySettlement;
    expect(d.variant).toBe("settlement");
    expect(d.payoutPrincipal).toBe(BigInt(111_000_000));
    expect(d.payoutInterest).toBe(BigInt(4_799_751));
    expect(d.outRef).toEqual({ txId: TXID, outputIndex: BigInt(0) });
  });
});

describe("parseLevvyDatum — error cases", () => {
  test("rejects unknown top ctor", () => {
    expect(() => parseLevvyDatum(C(3, C(0)))).toThrow();
  });
  test("rejects wrong inner field count", () => {
    expect(() => parseLevvyDatum(C(0, C(0, lenderAddr)))).toThrow();
  });
  test("rejects non-Constr-0 inner payload", () => {
    expect(() => parseLevvyDatum(C(0, C(1, lenderAddr)))).toThrow();
  });
});

describe("classifyLevvyRedeemer — 5 nullary actions", () => {
  test("maps each ctor index to its action label", () => {
    expect(classifyLevvyRedeemer(C(0))).toBe("Lend");
    expect(classifyLevvyRedeemer(C(1))).toBe("Repay");
    expect(classifyLevvyRedeemer(C(2))).toBe("Claim");
    expect(classifyLevvyRedeemer(C(3))).toBe("Foreclose");
    expect(classifyLevvyRedeemer(C(4))).toBe("Cancel");
  });
  test("out-of-range ctor → null", () => {
    expect(classifyLevvyRedeemer(C(5))).toBeNull();
  });
  test("field-bearing constructor is not a Levvy action", () => {
    expect(classifyLevvyRedeemer(C(0, I(1)))).toBeNull();
  });
});

describe("Levvy matching", () => {
  test("matches the mainnet validator payment hash → loan", () => {
    expect(matchLevvyScriptHash(LEVVY.validatorHash, "mainnet")).toBe("loan");
    expect(matchLevvyScriptHash(LEVVY.validatorHash.toUpperCase(), undefined)).toBe("loan");
  });
  test("rejects non-mainnet and unrelated hashes", () => {
    expect(matchLevvyScriptHash(LEVVY.validatorHash, "preprod")).toBeNull();
    expect(matchLevvyScriptHash(LENDER_PKH, "mainnet")).toBeNull();
  });
});
