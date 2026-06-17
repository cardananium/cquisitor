import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  charli3RealPrice,
  classifyCharli3Redeemer,
  parseCharli3Feed,
  validateCharli3Feed,
} from "./feed";
import { internalToView } from "./index";
import {
  CHARLI3_FEED_ASSET_NAME,
  CHARLI3_FEED_NFT_POLICIES,
  CHARLI3_FEED_SCRIPT_HASHES,
  charli3PairForHash,
  matchCharli3NftPolicy,
  matchCharli3ScriptHash,
} from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });
const M = (...entries: { k: PD; v: PD }[]): PD => ({ map: entries });
const kv = (k: PD, v: PD) => ({ k, v });

// price_map { 0:price, 1:ts, 2:expiry, 3:precision, 4:baseId, 6:baseSym }
const priceMap = M(
  kv(I(0), I(420000000)), // price
  kv(I(1), I(1730000000000)), // timestamp ms
  kv(I(2), I(1730000600000)), // expiry ms
  kv(I(3), I(6)), // precision
  kv(I(4), B("aa".repeat(28))), // base asset_id
  kv(I(6), B("c3c3")), // base symbol
);

const ADA_USD_POLICY = "08c56c0fa73748a23c3bc1d9e6a60a4187416fc4ff8fe3475506990e";
const ADA_USD_SCRIPT = "1869c28a5c1023a10c1deb30d112226cf45130b800a22d9c2afc1c9c";
const NOT_CHARLI3 = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

describe("parseCharli3Feed — push oracle (bare OracleFeed Constr0)", () => {
  // Constr0 [ price_data=Constr2[map], extended_data=Constr1[map] ]
  const datum: PD = C(
    0,
    C(2, priceMap), // price_data
    C(1, M(kv(I(0), I(7)), kv(I(1), I(3)), kv(I(2), I(2)), kv(I(3), B("deadbeef")))),
  );

  test("decodes kind, price_map and extended_data", () => {
    const feed = parseCharli3Feed(datum);
    expect(feed.kind).toBe("OracleFeed");
    expect(feed.prices.length).toBe(1);
    const p = feed.prices[0];
    expect(p.price).toBe(BigInt(420000000));
    expect(p.timestamp).toBe(BigInt(1730000000000));
    expect(p.expiry).toBe(BigInt(1730000600000));
    expect(p.precision).toBe(BigInt(6));
    expect(p.baseAssetId).toBe("aa".repeat(28));
    expect(p.baseAssetSymbol).toBe("c3c3");
    expect(feed.extended?.oracleProviderId).toBe(BigInt(7));
    expect(feed.extended?.dataSourceCount).toBe(BigInt(3));
    expect(feed.extended?.dataSignatoriesCount).toBe(BigInt(2));
    expect(feed.extended?.oracleProviderSignature).toBe("deadbeef");
  });

  test("real price = price / 10^precision", () => {
    const p = parseCharli3Feed(datum).prices[0];
    expect(charli3RealPrice(p)).toBe(420);
  });

  test("no validation issues for a complete feed", () => {
    expect(validateCharli3Feed(parseCharli3Feed(datum))).toEqual([]);
  });
});

describe("parseCharli3Feed — pull oracle (AggState Constr0[GenericData Constr2])", () => {
  // OracleDatum Constr0 = AggState[ PriceData ]; PriceData Constr2 = GenericData[map]
  const datum: PD = C(0, C(2, priceMap));

  test("recurses into nested Constr2 to find the price_map", () => {
    const feed = parseCharli3Feed(datum);
    expect(feed.kind).toBe("OracleFeed");
    expect(feed.prices.length).toBe(1);
    expect(feed.prices[0].price).toBe(BigInt(420000000));
  });
});

describe("parseCharli3Feed — multiple priced pairs", () => {
  const second = M(kv(I(0), I(99)), kv(I(3), I(2)));
  const datum: PD = C(0, C(2, priceMap), C(2, second));

  test("collects every price_data block", () => {
    const feed = parseCharli3Feed(datum);
    expect(feed.prices.length).toBe(2);
    expect(charli3RealPrice(feed.prices[1])).toBe(0.99);
  });
});

describe("parseCharli3Feed — shared_data merge", () => {
  // shared_data = Constr0[ Map{ 0 : price_map } ] supplying precision; the
  // price_data omits precision and should inherit it.
  const sharedPM = M(kv(I(3), I(6)));
  const partialPrice = M(kv(I(0), I(420000000)));
  const datum: PD = C(0, C(0, M(kv(I(0), sharedPM))), C(2, partialPrice));

  test("shared fields merge into price where unset", () => {
    const feed = parseCharli3Feed(datum);
    expect(feed.shared).not.toBeNull();
    expect(feed.prices[0].precision).toBe(BigInt(6));
    expect(charli3RealPrice(feed.prices[0])).toBe(420);
  });
});

describe("parseCharli3Feed — CER rational price at key 0", () => {
  const datum: PD = C(0, C(2, M(kv(I(0), C(0, I(3), I(2))))));

  test("key 0 may be Rational Constr0[num,den]", () => {
    const p = parseCharli3Feed(datum).prices[0];
    expect(p.price).toBeNull();
    expect(p.priceRational).toEqual({ numerator: BigInt(3), denominator: BigInt(2) });
    expect(charli3RealPrice(p)).toBe(1.5);
  });
});

describe("validateCharli3Feed — issues", () => {
  test("non-feed outer kind is flagged", () => {
    const internal: PD = C(2, C(0)); // AggDatum wrapper
    const feed = parseCharli3Feed(internal);
    expect(feed.kind).toBe("AggDatum");
    const issues = validateCharli3Feed(feed);
    expect(issues.some((i) => i.severity === "info")).toBe(true);
  });

  test("unknown outer ctor → error", () => {
    const feed = parseCharli3Feed(C(5));
    expect(feed.kind).toBe("Unknown");
    expect(validateCharli3Feed(feed)[0].severity).toBe("error");
  });

  test("missing price key 0 → error", () => {
    const datum: PD = C(0, C(2, M(kv(I(1), I(1730000000000)))));
    const issues = validateCharli3Feed(parseCharli3Feed(datum));
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  test("expiry before timestamp → warning", () => {
    const datum: PD = C(0, C(2, M(kv(I(0), I(1)), kv(I(1), I(100)), kv(I(2), I(50)))));
    const issues = validateCharli3Feed(parseCharli3Feed(datum));
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });
});

describe("classifyCharli3Redeemer", () => {
  test("bare-enum Constr index maps to action(s)", () => {
    expect(classifyCharli3Redeemer(C(3))).toBe("Aggregate (push) / ManageSettings (pull)");
    expect(classifyCharli3Redeemer(C(0))).toBe("NodeUpdate (push) / OdvAggregate (pull)");
    expect(classifyCharli3Redeemer(C(8))).toBe("AddFunds (push)");
    expect(classifyCharli3Redeemer(I(1))).toBeNull();
  });
});

describe("Charli3 matching", () => {
  test("feed by mainnet payment script hash", () => {
    expect(matchCharli3ScriptHash(ADA_USD_SCRIPT, "mainnet")).toBe("feed");
    expect(matchCharli3ScriptHash(ADA_USD_SCRIPT, undefined)).toBe("feed");
    expect(matchCharli3ScriptHash(ADA_USD_SCRIPT, "preprod")).toBeNull();
    expect(matchCharli3ScriptHash(NOT_CHARLI3, "mainnet")).toBeNull();
  });

  test("feed by NFT policy requires OracleFeed asset name", () => {
    expect(
      matchCharli3NftPolicy(ADA_USD_POLICY, [CHARLI3_FEED_ASSET_NAME], "mainnet"),
    ).toBe("feed");
    // policy present but wrong/absent asset name → no match
    expect(matchCharli3NftPolicy(ADA_USD_POLICY, ["00"], "mainnet")).toBeNull();
    expect(matchCharli3NftPolicy(NOT_CHARLI3, [CHARLI3_FEED_ASSET_NAME], "mainnet")).toBeNull();
    expect(
      matchCharli3NftPolicy(ADA_USD_POLICY, [CHARLI3_FEED_ASSET_NAME], "preview"),
    ).toBeNull();
  });

  test("pair lookup by hash", () => {
    expect(charli3PairForHash(ADA_USD_SCRIPT)).toBe("ADA/USD");
    expect(charli3PairForHash(ADA_USD_POLICY)).toBe("ADA/USD");
    expect(charli3PairForHash(NOT_CHARLI3)).toBeNull();
    expect(Object.keys(CHARLI3_FEED_NFT_POLICIES).length).toBe(9);
    expect(Object.keys(CHARLI3_FEED_SCRIPT_HASHES).length).toBe(9);
  });
});

const NODE = "6666b66ffcf90e9c8477c1f3f4bf206826b61eb3024acefd10280579";

describe("internalToView — internal oracle datums with named source fields", () => {
  test("AggDatum → OracleSettings: node operators + named settings, no price error", () => {
    // AggState/OracleSettings = C2[ C0[ C0[ osNodeList, osUpdatedNodes, osUpdatedNodeTime ] ] ]
    const agg = C(2, C(0, C(0, L(B(NODE), B(NODE)), I(6000), I(21600000))));
    const v = internalToView("AggDatum", agg);
    expect(v.kind).toBe("AggDatum");
    expect(v.issues.some((i) => i.severity === "error")).toBe(false);
    expect(v.rows.some((r) => r.label.startsWith("Node operators"))).toBe(true);
    expect(v.rows.some((r) => r.label === "Updated nodes (%)" && r.value === "6,000")).toBe(true);
    // osUpdatedNodeTime is a ms field → rendered as a duration.
    expect(v.rows.some((r) => r.label === "Updated-node window" && r.value?.includes("21600000 ms"))).toBe(true);
  });

  test("RewardDatum → OracleReward: node reward accounts + platform reward", () => {
    // OracleReward = C3[ C0[ List<RewardInfo[owner, qty]>, orPlatformReward ] ]
    const rew = C(3, C(0, L(C(0, B(NODE), I(139868370)), C(0, B(NODE), I(253015707))), I(25073213)));
    const v = internalToView("RewardDatum", rew);
    expect(v.rows.some((r) => r.label.startsWith("Node rewards"))).toBe(true);
    expect(v.rows.some((r) => r.label === "  reward 139,868,370")).toBe(true);
    expect(v.rows.some((r) => r.label === "Platform reward" && r.value === "25,073,213")).toBe(true);
    expect(v.issues.some((i) => i.severity === "error")).toBe(false);
  });
});
