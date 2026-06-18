import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifySnekFunRedeemer,
  parseSnekFunCurve,
  parseSnekFunRedeemer,
  validateSnekFunCurve,
} from "./snekfun";
import { matchSnekFunNftPolicy, matchSnekFunScriptHash, SNEKFUN } from "./constants";
import { getDexAdapter } from "@/utils/protocols/dex/registry";
import "./index"; // registers the snekfun adapter (decode path)

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

// Real on-chain curve UTxO (tx 738d…0c1f output#0): launched token VOID.
const NFT_NAME = "1a550387bb354e27f5c2eea79692eb15ad8b21499fafdb2ae768d23c15402e8d";
const TOKEN_POLICY = "2c7d2fa167bb46b1dcd7c61be74200f001315ebdb93dffd5122a9d94";
const TOKEN_NAME = "564f4944"; // "VOID"
const OWNER = "e865941988edcca559268b57b7ee939974fd42fd26c7e1acd7a50678";
const ADMIN_WD = "68be6aa2e9e116cdb94ab101ae84817e3ccccb37475cf6db9cfd00d4";

// Constr0[ curveNft, base(ADA), token, A, B, owner, target, tradeWd, adminWd ]
const liveCurve: PD = C(
  0,
  C(0, B(SNEKFUN.curveNftPolicy), B(NFT_NAME)), // [0] curve NFT
  C(0, B(""), B("")), // [1] base = ADA
  C(0, B(TOKEN_POLICY), B(TOKEN_NAME)), // [2] launched token VOID
  I(BigInt("122525779519")), // [3] coeffA
  I(2_545_182), // [4] coeffB
  B(OWNER), // [5] owner pkh
  I(18_191_400_000), // [6] target lovelace
  B(SNEKFUN.tradeWithdrawal), // [7] trade withdrawal
  B(ADMIN_WD), // [8] admin withdrawal
);

describe("parseSnekFunCurve — live VOID curve", () => {
  test("parses all 9 fields", () => {
    const o = parseSnekFunCurve(liveCurve);
    expect(o.curveNft).toEqual({ policyId: SNEKFUN.curveNftPolicy, assetName: NFT_NAME });
    expect(o.base).toEqual({ policyId: "", assetName: "" });
    expect(o.token).toEqual({ policyId: TOKEN_POLICY, assetName: TOKEN_NAME });
    expect(o.coeffA).toBe(BigInt("122525779519"));
    expect(o.coeffB).toBe(BigInt(2_545_182));
    expect(o.owner).toBe(OWNER);
    expect(o.targetLovelace).toBe(BigInt(18_191_400_000));
    expect(o.tradeWithdrawal).toBe(SNEKFUN.tradeWithdrawal);
    expect(o.adminWithdrawal).toBe(ADMIN_WD);
  });

  test("rejects wrong field count and wrong ctor", () => {
    expect(() => parseSnekFunCurve(C(0, B("")))).toThrow();
    expect(() => parseSnekFunCurve(C(1, B("")))).toThrow();
  });
});

describe("validateSnekFunCurve", () => {
  test("clean live curve has no issues", () => {
    expect(validateSnekFunCurve(parseSnekFunCurve(liveCurve))).toEqual([]);
  });

  test("flags short owner hash", () => {
    const bad = C(
      0,
      C(0, B(SNEKFUN.curveNftPolicy), B(NFT_NAME)),
      C(0, B(""), B("")),
      C(0, B(TOKEN_POLICY), B(TOKEN_NAME)),
      I(1), I(1),
      B("00"), // short owner
      I(1),
      B(SNEKFUN.tradeWithdrawal),
      B(ADMIN_WD),
    );
    const issues = validateSnekFunCurve(parseSnekFunCurve(bad));
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });
});

describe("parseSnekFunRedeemer", () => {
  test("Buy = Constr0[inputIndex, outputIndex, Constr0[]]", () => {
    const r = parseSnekFunRedeemer(C(0, I(0), I(0), C(0)));
    expect(r).toEqual({ kind: "Buy", inputIndex: BigInt(0), outputIndex: BigInt(0) });
  });

  test("Sell = Constr0[i, o, Constr1[]]", () => {
    const r = parseSnekFunRedeemer(C(0, I(2), I(2), C(1)));
    expect(r).toEqual({ kind: "Sell", inputIndex: BigInt(2), outputIndex: BigInt(2) });
  });

  test("classify helper", () => {
    expect(classifySnekFunRedeemer(C(0, I(0), I(0), C(0)))).toBe("Buy");
    expect(classifySnekFunRedeemer(C(0, I(1), I(1), C(1)))).toBe("Sell");
    expect(classifySnekFunRedeemer(C(0, I(0), I(0), C(2)))).toBe("Other");
    expect(classifySnekFunRedeemer(C(0, I(0)))).toBeNull(); // needs 3 fields
  });
});

describe("curveToView — pair + rows", () => {
  const decode = getDexAdapter("snekfun")!.decode!;

  test("pair = launched token / base (exact datum legs, ada = '','')", () => {
    const view = decode(liveCurve, "curve");
    expect(view.pair).toEqual({
      assetA: { policyId: TOKEN_POLICY, assetName: TOKEN_NAME },
      assetB: { policyId: "", assetName: "" }, // base = ADA
    });
  });

  test("headline names the launched token vs ADA", () => {
    const view = decode(liveCurve, "curve");
    expect(view.protocol).toBe("SnekFun");
    expect(view.role).toBe("curve");
    expect(view.kind).toBe("Curve: VOID / ADA");
  });

  test("owner + withdrawal hashes surface as full-value rows", () => {
    const view = decode(liveCurve, "curve");
    expect(view.rows.find((r) => r.label === "Owner (key)")?.value).toBe(OWNER);
    expect(view.rows.find((r) => r.label === "Trade withdrawal")?.value).toBe(
      SNEKFUN.tradeWithdrawal,
    );
    expect(view.rows.find((r) => r.label === "Admin withdrawal")?.value).toBe(ADMIN_WD);
  });
});

describe("SnekFun matching", () => {
  test("curve by mainnet payment hash only", () => {
    expect(matchSnekFunScriptHash(SNEKFUN.curveHash, "mainnet")).toBe("curve");
    expect(matchSnekFunScriptHash(SNEKFUN.curveHash, undefined)).toBe("curve");
    expect(matchSnekFunScriptHash(SNEKFUN.curveHash, "preprod")).toBeNull();
    expect(matchSnekFunScriptHash(OWNER, "mainnet")).toBeNull();
  });

  test("curve by NFT policy", () => {
    expect(matchSnekFunNftPolicy(SNEKFUN.curveNftPolicy, ["abc"], "mainnet")).toBe("curve");
    expect(matchSnekFunNftPolicy(SNEKFUN.curveNftPolicy, [], "preprod")).toBeNull();
    expect(matchSnekFunNftPolicy(TOKEN_POLICY, [], "mainnet")).toBeNull();
  });
});
