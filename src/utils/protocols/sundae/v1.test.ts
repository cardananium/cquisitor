import { describe, expect, test } from "bun:test";
import type { PD } from "./plutusData";
import { parseV1PoolDatum } from "./v1";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const KOZ_POLICY = "63766427b4499dd678cb8b715dec3265dd292279ce7779447e3651e5";
const KOZ_NAME = "4b4f5a"; // "KOZ"

// V1 pool datum (pool ident a402, ADA/KOZ, swapFees 1/100):
// d8799fd8799fd8799f4040ffd8799f581c6376…51e5434b4f5affff42a40200d8799f011864ffff
const liveDatum: PD = C(
  0,
  C(0, C(0, B(""), B("")), C(0, B(KOZ_POLICY), B(KOZ_NAME))), // coins = AB[assetA, assetB]
  B("a402"), // poolIdent
  I(0), // circulatingLP
  C(0, I(1), I(100)), // swapFees = (num, denom)
);

describe("parseV1PoolDatum — live ADA/KOZ pool", () => {
  test("decodes coins, ident, LP and swap fee", () => {
    const d = parseV1PoolDatum(liveDatum);
    expect(d.kind).toBe("V1");
    expect(d.identifier).toBe("a402");
    expect(d.assetA).toEqual({ policyId: "", assetName: "" }); // ADA
    expect(d.assetB).toEqual({ policyId: KOZ_POLICY, assetName: KOZ_NAME });
    expect(d.circulatingLp).toBe(BigInt(0));
    expect(d.feeNumerator).toBe(BigInt(1));
    expect(d.feeDenominator).toBe(BigInt(100));
  });

  test("rejects wrong ctor and wrong field count", () => {
    expect(() => parseV1PoolDatum(C(1, B("")))).toThrow();
    expect(() => parseV1PoolDatum(C(0, B("")))).toThrow(); // 1 field, needs 4
    // coins must be a 2-field constr
    expect(() => parseV1PoolDatum(C(0, C(0, B("")), B("a4"), I(0), C(0, I(1), I(100))))).toThrow();
  });
});
