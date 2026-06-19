import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { parseOrcfaxFeed } from "./feed";
import { orcfaxFeedToView } from "./index";
import { matchOrcfaxNftPolicy, matchOrcfaxScriptHash, ORCFAX } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });
const M = (...kv: { k: PD; v: PD }[]): PD => ({ map: kv });

// ASCII → hex helper for building ByteArray test data.
function ascii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}

const COLLECTOR = "3c12f6735ef87655c5b27bced3f828d857d0a27fd20f2cda18ebf2fb"; // 28 bytes

describe("parseOrcfaxFeed — V1 CER fact statement", () => {
  // On-chain datum: CER/CBLP-ADA/3, 54301/1250000000.
  const datum: PD = C(
    0,
    C(
      0,
      B(ascii("CER/CBLP-ADA/3")), // feed_id
      I(BigInt("1769374523749")), // created_at (ms)
      C(0, I(54301), I(1250000000)), // body Rational
    ),
    C(0, B(COLLECTOR)), // context: single 28-byte collector
  );

  test("decodes feed id, pair, price, timestamp, collector", () => {
    const f = parseOrcfaxFeed(datum);
    expect(f.generation).toBe("v1");
    if (f.generation !== "v1") throw new Error("expected v1");
    expect(f.feedId).toBe("CER/CBLP-ADA/3");
    expect(f.base).toBe("CBLP");
    expect(f.quote).toBe("ADA");
    expect(f.createdAt).toBe(BigInt("1769374523749"));
    expect(f.numerator).toBe(BigInt(54301));
    expect(f.denominator).toBe(BigInt(1250000000));
    expect(f.collector).toBe(COLLECTOR);
    expect(f.collectAfter).toBeNull();
  });

  test("tolerates a 2-field context [collect_after, collector]", () => {
    const twoField: PD = C(
      0,
      C(0, B(ascii("CER/ADA-USD/3")), I(1727701212380), C(0, I(77046047), I(200000000))),
      C(0, I(1727701200000), B(COLLECTOR)),
    );
    const f = parseOrcfaxFeed(twoField);
    if (f.generation !== "v1") throw new Error("expected v1");
    expect(f.base).toBe("ADA");
    expect(f.quote).toBe("USD");
    expect(f.collectAfter).toBe(BigInt("1727701200000"));
    expect(f.collector).toBe(COLLECTOR);
    expect(f.numerator).toBe(BigInt(77046047));
  });
});

describe("parseOrcfaxFeed — V0 schema.org PropertyValue", () => {
  // significand 24475 (0x5f9b), exponent -5 (uint64 two's-complement).
  const expNeg5 = BigInt("18446744073709551611"); // 2^64 - 5
  const datum: PD = C(
    0,
    M(
      { k: B(ascii("@context")), v: B(ascii("https://schema.org")) },
      { k: B(ascii("type")), v: B(ascii("PropertyValue")) },
      { k: B(ascii("name")), v: B(ascii("ADA-USD|USD-ADA")) },
      { k: B(ascii("value")), v: L(C(3, I(24475), I(expNeg5)), C(3, I(40858), I(expNeg5))) },
      {
        k: B(ascii("valueReference")),
        v: L(
          M(
            { k: B(ascii("@type")), v: B(ascii("PropertyValue")) },
            { k: B(ascii("name")), v: B(ascii("validFrom")) },
            { k: B(ascii("value")), v: I(1700000000000) },
          ),
          M(
            { k: B(ascii("@type")), v: B(ascii("PropertyValue")) },
            { k: B(ascii("name")), v: B(ascii("validThrough")) },
            { k: B(ascii("value")), v: I(1700000600000) },
          ),
        ),
      },
      {
        k: B(ascii("identifier")),
        v: M(
          { k: B(ascii("propertyID")), v: B(ascii("Arkly Identifier")) },
          { k: B(ascii("type")), v: B(ascii("PropertyValue")) },
          { k: B(ascii("value")), v: B(ascii("urn:orcfax:abc-123")) },
        ),
      },
      { k: B(ascii("_:contentSignature")), v: B("aa".repeat(32)) },
    ),
    B(ascii("04CA0001HBEY9KK449P1CEQ8PH7DTJYT")), // identifier (32 chars)
    C(1, I(1700000600000), B(COLLECTOR)), // Expiry Constr1 [validThrough, sourceHash]
  );

  test("decodes by key, sign-corrects exponent, reads urn/identifier/expiry", () => {
    const f = parseOrcfaxFeed(datum);
    expect(f.generation).toBe("v0");
    if (f.generation !== "v0") throw new Error("expected v0");
    expect(f.name).toBe("ADA-USD|USD-ADA");
    expect(f.base).toBe("ADA");
    expect(f.quote).toBe("USD");
    expect(f.values).toHaveLength(2);
    expect(f.values[0].significand).toBe(BigInt(24475));
    expect(f.values[0].exponent).toBe(BigInt(-5)); // sign-corrected
    expect(f.validFrom).toBe(BigInt("1700000000000"));
    expect(f.validThrough).toBe(BigInt("1700000600000"));
    expect(f.urn).toBe("urn:orcfax:abc-123");
    expect(f.identifier).toBe("04CA0001HBEY9KK449P1CEQ8PH7DTJYT");
    expect(f.sourceHash).toBe(COLLECTOR);
    expect(f.contentSignature).toBe("aa".repeat(32));
  });
});

describe("Orcfax matching", () => {
  test("FSP hash → feed-pointer; FS validator hash → feed; mainnet only", () => {
    // The FSP holds a bare-bytes pointer to the FS validator, not a feed.
    expect(matchOrcfaxScriptHash(ORCFAX.fspScriptHash, "mainnet")).toBe("feed-pointer");
    expect(matchOrcfaxScriptHash(ORCFAX.fspScriptHash, undefined)).toBe("feed-pointer");
    expect(matchOrcfaxScriptHash(ORCFAX.fspScriptHash, "preprod")).toBeNull();
    // The FS validator hash(es) hold the actual price-feed datums.
    expect(matchOrcfaxScriptHash(ORCFAX.fsValidatorHashes[0], "mainnet")).toBe("feed");
    expect(matchOrcfaxScriptHash(ORCFAX.fsValidatorHashes[0], "preprod")).toBeNull();
    expect(matchOrcfaxScriptHash("deadbeef".repeat(7), "mainnet")).toBeNull();
  });

  test("matches the legacy V0 auth NFT policy on preprod only", () => {
    expect(matchOrcfaxNftPolicy(ORCFAX.preprodV0AuthPolicy, [], "preprod")).toBe("feed");
    expect(matchOrcfaxNftPolicy(ORCFAX.preprodV0AuthPolicy, [], "preview")).toBe("feed");
    expect(matchOrcfaxNftPolicy(ORCFAX.preprodV0AuthPolicy, [], "mainnet")).toBeNull();
    expect(matchOrcfaxNftPolicy(ORCFAX.factTokenPolicy, [], "preprod")).toBeNull();
  });
});

describe("orcfaxFeedToView — completeness", () => {
  const COLLECTOR = "3c12f6735ef87655c5b27bced3f828d857d0a27fd20f2cda18ebf2fb";
  const ascii2 = (s: string): string => {
    let out = "";
    for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(2, "0");
    return out;
  };
  const rowLabels = (rows: { label: string }[]) => rows.map((r) => r.label);

  test("V1: collector + collect_after (labelled slot) both surface", () => {
    const datum: PD = C(
      0,
      C(0, B(ascii2("CER/ADA-USD/3")), I(1727701212380), C(0, I(77046047), I(200000000))),
      C(0, I(1727701200000), B(COLLECTOR)), // 2-field context: [collect_after, collector]
    );
    const view = orcfaxFeedToView(parseOrcfaxFeed(datum));
    const labels = rowLabels(view.rows);
    expect(labels).toContain("Collector");
    expect(labels).toContain("Collect after");
    const collectAfter = view.rows.find((r) => r.label === "Collect after");
    // collect_after is a slot gate, NOT a ms timestamp — must not claim "POSIX ms".
    expect(collectAfter?.value).toContain("(slot)");
    expect(collectAfter?.value).not.toContain("POSIX");
    // collector rendered as a 28-byte hash row.
    const collector = view.rows.find((r) => r.label === "Collector");
    expect(collector?.value).toBe(COLLECTOR);
    expect(collector?.hash).toBe(true);
  });

  test("V0: every value pair is rendered, not just the first two", () => {
    const expNeg5 = BigInt("18446744073709551611"); // 2^64 - 5
    const datum: PD = C(
      0,
      M(
        { k: B(ascii2("name")), v: B(ascii2("ADA-USD|USD-ADA")) },
        {
          k: B(ascii2("value")),
          v: L(C(3, I(1), I(expNeg5)), C(3, I(2), I(expNeg5)), C(3, I(3), I(expNeg5))),
        },
      ),
      B(ascii2("ID")),
      C(1, I(1700000600000), B(COLLECTOR)),
    );
    const view = orcfaxFeedToView(parseOrcfaxFeed(datum));
    const labels = rowLabels(view.rows);
    // all three pairs surface — the 3rd (extra) one is NOT silently dropped.
    expect(labels).toContain("Value (rate)");
    expect(labels).toContain("Value (inverse)");
    expect(labels).toContain("Value [2]");
  });
});
