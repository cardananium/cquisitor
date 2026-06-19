import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  formatOnChainDecimal,
  parseCDPCreatorRedeemer,
  parseCDPDatum,
  parseCDPRedeemer,
  parseOnChainDecimal,
  parseOracleAssetNft,
  validateCDPDatum,
  type CDPPosition,
  type IAssetConfig,
} from "./cdp";
import { INDIGO, matchIndigoNftPolicy, matchIndigoScriptHash } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const PKH = "f788579b3019ff5f2c48eb086f79b52912275f13f29c51cf0031df39";
const POLICY = "11112222333344445555666677778888999900001111222233334444";
const TN = "cafebabe";
const IJPY = "694a5059"; // "iJPY"
const IUSD = "69555344"; // "iUSD"
const ISOL = "69534f4c"; // "iSOL"

// AssetClass = Constr0[policy, name]
const asset: PD = C(0, B(POLICY), B(TN));
// ADA collateral = Constr0["",""]
const ada: PD = C(0, B(""), B(""));
// Rational = Constr0[num, den]
const ratio = (n: number | bigint, d: number | bigint): PD => C(0, I(n), I(d));
// OnChainDecimal = Constr0[Int]
const dec = (n: number | bigint): PD => C(0, I(n));
// Nullable: Just = Constr0[x], Nothing = Constr1[]
const just = (x: PD): PD => C(0, x);
const nothing: PD = C(1);
// Boolean: False = Constr0[], True = Constr1[]
const FALSE: PD = C(0);
const TRUE: PD = C(1);

describe("parseOnChainDecimal / formatOnChainDecimal", () => {
  test("scale 1e6 fixed-point", () => {
    expect(parseOnChainDecimal(dec(1_500_000))).toBe(BigInt(1_500_000));
    expect(formatOnChainDecimal(BigInt(1_500_000))).toBe("1.5");
    expect(formatOnChainDecimal(BigInt(2_000_000))).toBe("2");
    expect(formatOnChainDecimal(BigInt(1_100_000))).toBe("1.1");
    expect(formatOnChainDecimal(BigInt(-1_500_000))).toBe("-1.5");
  });
});

describe("parseOracleAssetNft", () => {
  test("three nested Constr0 wrappers ending in AssetClass", () => {
    const nft: PD = C(0, C(0, C(0, asset)));
    expect(parseOracleAssetNft(nft)).toEqual({ policyId: POLICY, assetName: TN });
  });
});

// CDP position (CDP auth-token, validator ff0b10bf…),
// datum hash 4131937e…: top-level Constr0[ Constr0[ Just(pkh), iJPY,
// AssetClass(ada), mintedAmt, ActiveInterestTracking ] ].
describe("parseCDPDatum — CDP position (real live shape, 5 fields)", () => {
  const content = C(
    0,
    just(B(PKH)),
    B(IJPY),
    ada, // collateral AssetClass (ADA on chain)
    I(174_304_020),
    C(0, I(1_781_119_236_000), I(2_670_146_806_031_202)), // ActiveInterestTracking
  );
  const datum: PD = C(0, content);

  test("parses an active, owned CDP with collateral asset", () => {
    const d = parseCDPDatum(datum, "cdp") as CDPPosition;
    expect(d.role).toBe("cdp");
    expect(d.frozen).toBe(false);
    expect(d.cdpOwner).toBe(PKH);
    expect(d.iasset).toBe(IJPY);
    expect(d.collateral).toEqual({ policyId: "", assetName: "" });
    expect(d.mintedAmt).toBe(BigInt(174_304_020));
    expect(d.cdpFees.kind).toBe("ActiveInterestTracking");
    if (d.cdpFees.kind !== "ActiveInterestTracking") throw new Error("bad fees");
    expect(d.cdpFees.lastSettled).toBe(BigInt(1_781_119_236_000));
    expect(d.cdpFees.unitaryInterestSnapshot).toBe(BigInt(2_670_146_806_031_202));
    expect(validateCDPDatum(d)).toEqual([]);
  });

  test("defaults to the cdp role when no role hint is given", () => {
    const d = parseCDPDatum(datum) as CDPPosition;
    expect(d.role).toBe("cdp");
    expect(d.iasset).toBe(IJPY);
  });

  test("Nothing owner => frozen, with FrozenCDPAccumulatedFees", () => {
    const frozen: PD = C(
      0,
      C(0, nothing, B(IUSD), asset, I(500), C(1, I(10), I(20))), // FrozenCDPAccumulatedFees
    );
    const d = parseCDPDatum(frozen, "cdp") as CDPPosition;
    expect(d.frozen).toBe(true);
    expect(d.cdpOwner).toBeNull();
    expect(d.collateral).toEqual({ policyId: POLICY, assetName: TN });
    expect(d.cdpFees.kind).toBe("FrozenAccumulatedFees");
    if (d.cdpFees.kind !== "FrozenAccumulatedFees") throw new Error("bad fees");
    expect(d.cdpFees.lovelacesTreasury).toBe(BigInt(10));
    expect(d.cdpFees.lovelacesIndyStakers).toBe(BigInt(20));
    const issues = validateCDPDatum(d);
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });
});

// IAsset config (IASSET auth-token, validator a9c613a0…),
// datum hash 633e08e6…: top-level Constr0[ Constr0[ name, priceIdx, 5×Rational,
// Bool, Nullable(next) ] ].
describe("parseCDPDatum — IAsset config (real live shape, 9 fields, role hint)", () => {
  const content = C(
    0,
    B(ISOL), // assetName "iSOL"
    I(1), // price source index
    ratio(100_000, 100_000_000),
    ratio(2_000_000, 100_000_000),
    ratio(50_000, 100_000_000),
    ratio(1_000_000, 100_000_000),
    ratio(1_000_000, 100_000_000),
    FALSE, // flag
    just(B(IUSD)), // nextIAsset = "iUSD"
  );
  const datum: PD = C(0, content);

  test("parses a live iAsset config via the iasset role hint", () => {
    const d = parseCDPDatum(datum, "iasset") as IAssetConfig;
    expect(d.role).toBe("iasset");
    expect(d.assetName).toBe(ISOL);
    expect(d.priceSource).toBe(BigInt(1));
    expect(d.ratios).toHaveLength(5);
    expect(d.ratios[0]).toEqual({ numerator: BigInt(100_000), denominator: BigInt(100_000_000) });
    expect(d.ratios[1]).toEqual({ numerator: BigInt(2_000_000), denominator: BigInt(100_000_000) });
    expect(d.flag).toBe(false);
    expect(d.nextIAsset).toBe(IUSD);
    expect(validateCDPDatum(d)).toEqual([]);
  });

  test("Nothing nextIAsset = list tail; True flag", () => {
    const tail: PD = C(
      0,
      C(
        0,
        B(IUSD),
        I(2),
        ratio(1, 1000),
        ratio(2, 100),
        ratio(5, 10000),
        ratio(1, 100),
        ratio(1, 100),
        TRUE,
        nothing,
      ),
    );
    const d = parseCDPDatum(tail, "iasset") as IAssetConfig;
    expect(d.flag).toBe(true);
    expect(d.nextIAsset).toBeNull();
  });

  test("zero-denominator ratio flags an error", () => {
    const bad: PD = C(
      0,
      C(
        0,
        B(ISOL),
        I(1),
        ratio(1, 0),
        ratio(1, 1),
        ratio(1, 1),
        ratio(1, 1),
        ratio(1, 1),
        FALSE,
        nothing,
      ),
    );
    const d = parseCDPDatum(bad, "iasset") as IAssetConfig;
    expect(validateCDPDatum(d).some((i) => i.severity === "error")).toBe(true);
  });
});

// IAsset config "v2" — the NEWER Constr1-wrapped 11-field record. Real live
// shape (iETH/USDCx market): the parser must surface the price-pair AssetClass,
// the Constr2 price-oracle hash, the interest-oracle AssetClass, the bare-Int
// parameter, the field-9 bool, and the field-10 Option<AssetClass> — none of
// which exist in the v1 layout.
describe("parseCDPDatum — IAsset config v2 (Constr1, 11 fields, real live shape)", () => {
  const ORACLE = "f83f5e86412ad360e1f6f248503b11fa92edf4aaa4a6799f1f067317"; // 28-byte
  const USDCX_POLICY = "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34";
  const USDCX = "5553444378"; // "USDCx"
  const INT_ORACLE_POLICY = "44686156f9e6a34b974eeced389585837b75b82a11077154fb74f4f4";
  const INT_ORACLE_NAME = "494554485f55534443585f494e5445524553545f4f5241434c45"; // IETH_USDCX_INTEREST_ORACLE
  const acOf = (p: string, n: string): PD => C(0, B(p), B(n));

  const inner = C(
    0,
    B("69455448"), // [0] iAsset name "iETH"
    acOf(USDCX_POLICY, USDCX), // [1] price-pair (quote) asset
    I(0), // [2] price-source kind
    C(2, B(ORACLE)), // [3] price oracle ref (live arm = Constr2[hash])
    acOf(INT_ORACLE_POLICY, INT_ORACLE_NAME), // [4] interest-oracle asset
    ratio(15, 10), // [5] maintenance ratio 1.5
    ratio(115, 100), // [6] 1.15
    ratio(11, 10), // [7] 1.1
    I(10_000_000), // [8] fee/limit parameter
    FALSE, // [9] bool flag
    nothing, // [10] Option<AssetClass> = Nothing
  );
  const datum: PD = C(1, inner);

  test("v2 layout surfaces every meaningful field", () => {
    const d = parseCDPDatum(datum, "iasset") as IAssetConfig;
    expect(d.role).toBe("iasset");
    expect(d.layout).toBe("v2");
    expect(d.assetName).toBe("69455448");
    expect(d.priceSource).toBe(BigInt(0));
    expect(d.ratios).toHaveLength(3);
    expect(d.ratios[0]).toEqual({ numerator: BigInt(15), denominator: BigInt(10) });
    if (!d.v2) throw new Error("expected v2 extras");
    expect(d.v2.pricePairAsset).toEqual({ policyId: USDCX_POLICY, assetName: USDCX });
    expect(d.v2.priceOracle).toEqual({ ctor: 2, hash: ORACLE });
    expect(d.v2.interestOracleAsset).toEqual({
      policyId: INT_ORACLE_POLICY,
      assetName: INT_ORACLE_NAME,
    });
    expect(d.v2.param).toBe(BigInt(10_000_000));
    expect(d.v2.flag9).toBe(false);
    expect(d.v2.optAsset10).toEqual({ present: false, asset: null });
  });

  test("field [10] Just(AssetClass) is decoded", () => {
    const withOpt = C(
      1,
      C(
        0,
        B("69455448"),
        acOf("", ""),
        I(0),
        C(2, B(ORACLE)),
        acOf(INT_ORACLE_POLICY, INT_ORACLE_NAME),
        ratio(15, 10),
        ratio(115, 100),
        ratio(11, 10),
        I(100_000_000),
        TRUE,
        just(acOf(USDCX_POLICY, USDCX)), // Just(AssetClass)
      ),
    );
    const d = parseCDPDatum(withOpt, "iasset") as IAssetConfig;
    if (!d.v2) throw new Error("expected v2 extras");
    expect(d.v2.flag9).toBe(true);
    expect(d.v2.optAsset10).toEqual({
      present: true,
      asset: { policyId: USDCX_POLICY, assetName: USDCX },
    });
    expect(d.v2.pricePairAsset).toEqual({ policyId: "", assetName: "" }); // ADA
  });
});

// Redeemer cases use the CDP-validator spend redeemer constructor table.
describe("parseCDPRedeemer", () => {
  test("AdjustCDP = Constr3[ posixMs, Constr0[Int] ] (real live shape)", () => {
    // {"constructor":3,"fields":[{"int":1781125918000},
    //   {"constructor":0,"fields":[{"int":0}]}]}
    const r = parseCDPRedeemer(C(3, I(1_781_125_918_000), C(0, I(0))));
    expect(r.kind).toBe("AdjustCDP");
    if (r.kind !== "AdjustCDP") throw new Error("bad");
    expect(r.deadlineMs).toBe(BigInt(1_781_125_918_000));
    expect(r.inner).toBe(BigInt(0));
  });

  test("Liquidate = Constr6[] (real live shape)", () => {
    // {"constructor":6,"fields":[]}
    const r = parseCDPRedeemer(C(6));
    expect(r.kind).toBe("Liquidate");
  });

  test("UpgradeVersion = Constr8[ Int selector ] (real live shape, dominant arm)", () => {
    // {"constructor":8,"fields":[{"int":3}]}
    const r = parseCDPRedeemer(C(8, I(3)));
    expect(r.kind).toBe("UpgradeVersion");
    if (r.kind !== "UpgradeVersion") throw new Error("bad");
    expect(r.selector).toBe(BigInt(3));
  });

  test("MergeCDPs = Constr4[] and MergeAuxiliary = Constr5", () => {
    expect(parseCDPRedeemer(C(4)).kind).toBe("MergeCDPs");
    expect(parseCDPRedeemer(C(5)).kind).toBe("MergeAuxiliary");
  });

  test("UpgradeAsset = Constr7", () => {
    expect(parseCDPRedeemer(C(7)).kind).toBe("UpgradeAsset");
  });

  test("rare/unobserved low arms surface as Unknown with a conservative label", () => {
    const r = parseCDPRedeemer(C(2, I(1)));
    expect(r.kind).toBe("Unknown");
    if (r.kind !== "Unknown") throw new Error("bad");
    expect(r.tag).toBe(2);
    expect(r.label).toBe("CDP action 2");
  });
});

describe("parseCDPCreatorRedeemer", () => {
  test("CreateCDP = Constr0[pkh, minted, collateral, time] (V2 4-field)", () => {
    const r = parseCDPCreatorRedeemer(C(0, B(PKH), I(100), I(5_000_000), I(1_700_000_000_000)));
    expect(r.kind).toBe("CreateCDP");
    if (r.kind !== "CreateCDP") throw new Error("bad");
    expect(r.cdpOwner).toBe(PKH);
    expect(r.minted).toBe(BigInt(100));
    expect(r.collateral).toBe(BigInt(5_000_000));
    expect(r.currentTime).toBe(BigInt(1_700_000_000_000));
  });

  test("UpgradeCreatorVersion = Constr1[]", () => {
    expect(parseCDPCreatorRedeemer(C(1)).kind).toBe("UpgradeCreatorVersion");
  });
});

describe("Indigo matching", () => {
  test("CDP / iAsset validator hashes → roles (mainnet only)", () => {
    expect(matchIndigoScriptHash(INDIGO.cdpHash, "mainnet")).toBe("cdp");
    expect(matchIndigoScriptHash(INDIGO.iAssetHash, "mainnet")).toBe("iasset");
    expect(matchIndigoScriptHash(INDIGO.cdpHash, undefined)).toBe("cdp");
    expect(matchIndigoScriptHash(INDIGO.cdpHash, "preprod")).toBeNull();
    expect(matchIndigoScriptHash(PKH, "mainnet")).toBeNull();
  });

  test("auth-token NFT policies refine the role by asset name", () => {
    expect(
      matchIndigoNftPolicy(INDIGO.cdpAuthTokenPolicy, [INDIGO.cdpAuthTokenName], "mainnet"),
    ).toBe("cdp");
    expect(
      matchIndigoNftPolicy(INDIGO.iAssetAuthTokenPolicy, [INDIGO.iAssetAuthTokenName], "mainnet"),
    ).toBe("iasset");
    // right policy, wrong asset name → no match
    expect(matchIndigoNftPolicy(INDIGO.cdpAuthTokenPolicy, ["deadbeef"], "mainnet")).toBeNull();
    // non-mainnet → null
    expect(
      matchIndigoNftPolicy(INDIGO.cdpAuthTokenPolicy, [INDIGO.cdpAuthTokenName], "preprod"),
    ).toBeNull();
  });
});
