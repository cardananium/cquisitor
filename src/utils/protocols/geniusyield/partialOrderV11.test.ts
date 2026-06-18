import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  parsePartialOrderV11Datum,
  partialOrderV11Price,
  validatePartialOrderV11Datum,
} from "./partialOrderV11";
import {
  GENIUS_YIELD_V1_1,
  GENIUS_YIELD_V1_1_ROLE,
  matchGeniusYieldV11NftPolicy,
} from "./constants";
import { partialOrderV11ToView } from "./index";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

// --- Real V1.1 order datum (record variant, f5 ctor 1) --------------
// A V1.1 order datum holding an order NFT under policy 55c9ddbe…b8be
// (token name 0194272c…009de).
const REC_OWNER = "094e91765b415961018016c74539ec113183003c057ae7faee1599a4";
const REC_STAKE = "f2f231ddd7a74693b8890b6b48998bbc1de2c327f334f4f923245415";
const REC_NFT = "0194272c8b6d9e3e90853e60cc6719326449d76687cf030c008a8009de";
const REC_F5_NFT = "24207cde7ca2dc27431ff87b5324ab5b0d8c113f608f5143ff50a6bae60373c0";
const REC_ASKED_POLICY = "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb";
const REC_ASKED_NAME = "0014df1047454e53";

const liveRecordDatum: PD = C(
  0,
  C(0, L(B(REC_OWNER)), L()), // f0 signers
  C(0, C(0, B(REC_OWNER)), C(0, C(0, C(0, B(REC_STAKE))))), // f1 ownerAddr
  B(REC_NFT), // f2 podNFT (29 bytes)
  C(0, C(0, B(""), B("")), I(10_207_713)), // f3 offered (ada, amount)
  C(0, C(0, B(REC_ASKED_POLICY), B(REC_ASKED_NAME)), I(0)), // f4 asked
  C(
    1, // f5 record variant
    B(REC_F5_NFT),
    C(0, C(0, I(0), I(1)), C(0, I(1), I(50))),
    C(0, C(0, C(0, I(0), I(1)), C(0, I(1), I(50)))),
  ),
  C(1), // f6 start = Nothing
  C(1), // f7 end = Nothing
  I(0), // f8
  C(0, I(0), I(1)), // f9 rational
  C(0, I(0), I(1)), // f10 rational
  I(120), // f11
);

// --- Real V1.1 order datum (plain variant, f5 ctor 0) ---------------
const PLAIN_NFT = "01ef08590b215c976da3a8761ab5be39a32944e754c9d2832fd4bce1d2";
const livePlainDatum: PD = C(
  0,
  C(0, L(B(REC_OWNER)), L()),
  C(0, C(0, B(REC_OWNER)), C(0, C(0, C(0, B(REC_STAKE))))),
  B(PLAIN_NFT),
  C(0, C(0, B(""), B("")), I(5_000_000)), // f3 offered = 5 ada
  C(0, C(0, B(REC_ASKED_POLICY), B(REC_ASKED_NAME)), I(0)), // f4 asked
  C(0, C(0, I(911_743_253), I(5_000_000)), C(1)), // f5 plain: price + Nothing
  C(1),
  C(1),
  I(0),
  C(0, I(0), I(1)),
  C(0, I(0), I(1)),
  I(120),
);

describe("parsePartialOrderV11Datum (real mainnet 12-field record variant)", () => {
  test("decodes the live record-variant order without throwing", () => {
    const o = parsePartialOrderV11Datum(liveRecordDatum);
    expect(o.signatories).toEqual([REC_OWNER]);
    expect(o.ownerAddr.paymentCredential).toEqual({ kind: "VKey", hash: REC_OWNER });
    expect(o.ownerAddr.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: REC_STAKE },
    });
    expect(o.nft).toBe(REC_NFT);
    expect(o.nft.length / 2).toBe(29);
    expect(o.offered).toEqual({
      asset: { policyId: "", assetName: "" },
      amount: BigInt(10_207_713),
    });
    expect(o.asked).toEqual({
      asset: { policyId: REC_ASKED_POLICY, assetName: REC_ASKED_NAME },
      amount: BigInt(0),
    });
    expect(o.record.kind).toBe("record");
    if (o.record.kind === "record") {
      expect(o.record.nft).toBe(REC_F5_NFT);
      expect(o.record.price).toEqual({ numerator: BigInt(0), denominator: BigInt(1) });
      // The trailing rationals of each pair are captured, not dropped.
      expect(o.record.price2).toEqual({ numerator: BigInt(1), denominator: BigInt(50) });
      expect(o.record.nested).toEqual({ numerator: BigInt(0), denominator: BigInt(1) });
      expect(o.record.nested2).toEqual({ numerator: BigInt(1), denominator: BigInt(50) });
    }
    expect(o.start).toBeNull();
    expect(o.end).toBeNull();
    expect(o.counter).toBe(BigInt(0));
    expect(o.rational1).toEqual({ numerator: BigInt(0), denominator: BigInt(1) });
    expect(o.rational2).toEqual({ numerator: BigInt(0), denominator: BigInt(1) });
    expect(o.trailingInt).toBe(BigInt(120));
    expect(partialOrderV11Price(o)).toEqual({ numerator: BigInt(0), denominator: BigInt(1) });
  });
});

describe("parsePartialOrderV11Datum (real mainnet 12-field plain variant)", () => {
  test("decodes the live plain-variant order and yields no issues", () => {
    const o = parsePartialOrderV11Datum(livePlainDatum);
    expect(o.nft).toBe(PLAIN_NFT);
    expect(o.offered.amount).toBe(BigInt(5_000_000));
    expect(o.record.kind).toBe("plain");
    if (o.record.kind === "plain") {
      expect(o.record.price).toEqual({
        numerator: BigInt(911_743_253),
        denominator: BigInt(5_000_000),
      });
      expect(o.record.extra).toBeNull();
    }
    expect(validatePartialOrderV11Datum(o)).toEqual([]);
  });
});

describe("parsePartialOrderV11Datum validation + rejections", () => {
  test("rejects wrong ctor tag", () => {
    expect(() => parsePartialOrderV11Datum(C(1))).toThrow();
  });

  test("rejects wrong field count", () => {
    expect(() => parsePartialOrderV11Datum(C(0, B(REC_NFT)))).toThrow();
  });

  test("rejects unknown f5 record ctor", () => {
    const bad = { ...liveRecordDatum } as { constructor: number; fields: PD[] };
    const fields = [...bad.fields];
    fields[5] = C(2);
    expect(() => parsePartialOrderV11Datum(C(0, ...fields))).toThrow();
  });

  test("flags zero denominator and identical assets", () => {
    const bad: PD = C(
      0,
      C(0, L(B(REC_OWNER)), L()),
      C(0, C(0, B(REC_OWNER)), C(1)),
      B(PLAIN_NFT),
      C(0, C(0, B(""), B("")), I(1)),
      C(0, C(0, B(""), B("")), I(1)), // asked == offered (ada)
      C(0, C(0, I(1), I(0)), C(1)), // zero denominator price
      C(1),
      C(1),
      I(0),
      C(0, I(0), I(1)),
      C(0, I(0), I(1)),
      I(0),
    );
    const issues = validatePartialOrderV11Datum(parsePartialOrderV11Datum(bad));
    expect(issues.some((i) => i.severity === "error")).toBe(true);
    expect(issues.some((i) => i.message.includes("identical"))).toBe(true);
  });
});

describe("Genius Yield V1.1 matching", () => {
  test("V1.1 NFT policy constant is 55c9ddbe…b8be", () => {
    expect(GENIUS_YIELD_V1_1.nftPolicyV11).toBe(
      "55c9ddbea5ebe40eb41b880a2c047227417c14ec1b8d81ad70afb8be",
    );
  });

  test("matches V1.1 order by NFT policy on mainnet", () => {
    expect(
      matchGeniusYieldV11NftPolicy(GENIUS_YIELD_V1_1.nftPolicyV11, [REC_NFT], "mainnet"),
    ).toBe(GENIUS_YIELD_V1_1_ROLE);
    expect(matchGeniusYieldV11NftPolicy(GENIUS_YIELD_V1_1.nftPolicyV11, [], undefined)).toBe(
      GENIUS_YIELD_V1_1_ROLE,
    );
  });

  test("checks asset name when expected order NFT supplied", () => {
    expect(
      matchGeniusYieldV11NftPolicy(GENIUS_YIELD_V1_1.nftPolicyV11, [REC_NFT], "mainnet", REC_NFT),
    ).toBe(GENIUS_YIELD_V1_1_ROLE);
    expect(
      matchGeniusYieldV11NftPolicy(GENIUS_YIELD_V1_1.nftPolicyV11, ["dead"], "mainnet", REC_NFT),
    ).toBeNull();
  });

  test("rejects the V1 policy and non-mainnet networks", () => {
    expect(
      matchGeniusYieldV11NftPolicy(
        "22f6999d4effc0ade05f6e1a70b702c65d6b3cdf0e301e4a8267f585",
        [REC_NFT],
        "mainnet",
      ),
    ).toBeNull();
    expect(
      matchGeniusYieldV11NftPolicy(GENIUS_YIELD_V1_1.nftPolicyV11, [REC_NFT], "preprod"),
    ).toBeNull();
  });
});

describe("partialOrderV11ToView trading pair", () => {
  test("pair = offered / asked (the two traded AssetClasses)", () => {
    const view = partialOrderV11ToView(parsePartialOrderV11Datum(liveRecordDatum));
    expect(view.pair).toEqual({
      assetA: { policyId: "", assetName: "" },
      assetB: { policyId: REC_ASKED_POLICY, assetName: REC_ASKED_NAME },
    });
  });
});
