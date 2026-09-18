import { describe, expect, test } from "bun:test";
import type { NetworkType } from "@cardananium/cquisitor-lib";
import type { FetchedValidationData } from "@/utils/transactionValidation";
import { CONWAY_CDDL } from "@/app/cddl-validator/conwaySchema";
import {
  encodeCardanoCborLink,
  encodeCddlLink,
  encodeGeneralCborLink,
  encodeValidatorLink,
  getBuildLinkOpts,
  type BuildLinkOpts,
} from "./encoder";
import {
  parseCardanoCborShare,
  parseCddlShare,
  parseGeneralCborShare,
  parseHash,
  parseValidatorShare,
} from "./parser";
import { CTX_SCHEMA_VERSION, URL_FORMAT_VERSION } from "./version";
import { hexToBytes, textToBytes, toBase64Url } from "./base64url";

const OPTS: BuildLinkOpts = { origin: "https://example.test", basePath: "/cquisitor" };

const SAMPLE_CBOR = "a3646e616d6565416c69636563616765181e686e69636b6e616d6563416c69";
const SAMPLE_CDDL = `; CDDL schema — edit me.
Person = {
  name: tstr,
  age: uint,
  ? nickname: tstr,
}
`;

/** The query part of a link, read back the way the app reads a location. */
function paramsOf(url: string): URLSearchParams {
  const parsed = parseHash(url.slice(url.indexOf("#")));
  return parsed.params;
}

function tabOf(url: string): string | null {
  return parseHash(url.slice(url.indexOf("#"))).tab;
}

/** Encoder container: BE u32 CBOR length, CBOR bytes, JSON rest. Built here for malformed cases. */
function packContainer(cborHex: string, rest: unknown): Uint8Array {
  const cborBytes = cborHex ? hexToBytes(cborHex) : new Uint8Array(0);
  const jsonBytes = textToBytes(JSON.stringify(rest));
  const out = new Uint8Array(4 + cborBytes.length + jsonBytes.length);
  new DataView(out.buffer).setUint32(0, cborBytes.length, false);
  out.set(cborBytes, 4);
  out.set(jsonBytes, 4 + cborBytes.length);
  return out;
}

/** An uncompressed (`e=j`) rich link carrying exactly `container`. */
function richParams(container: Uint8Array, version = URL_FORMAT_VERSION): URLSearchParams {
  return new URLSearchParams({
    v: String(version),
    e: "j",
    d: toBase64Url(container),
  });
}

// ---------------------------------------------------------------------------
// parseHash
// ---------------------------------------------------------------------------

describe("parseHash", () => {
  test("an empty hash opens the default tab", () => {
    const parsed = parseHash("");
    expect(parsed.tab).toBe("transaction-validator");
    expect([...parsed.params]).toEqual([]);
    expect(parsed.invalidHash).toBeNull();
  });

  test("splits tab from query", () => {
    const parsed = parseHash("#cardano-cbor?cbor=00&net=preview");
    expect(parsed.tab).toBe("cardano-cbor");
    expect(parsed.params.get("cbor")).toBe("00");
    expect(parsed.params.get("net")).toBe("preview");
  });

  test("accepts the cddl-validator tab", () => {
    expect(parseHash("#cddl-validator").tab).toBe("cddl-validator");
    expect(parseHash("#cddl-validator?rule=Person").params.get("rule")).toBe("Person");
  });

  test("reports an unknown tab rather than guessing one", () => {
    const parsed = parseHash("#not-a-tab?cbor=00");
    expect(parsed.tab).toBeNull();
    expect(parsed.invalidHash).toBe("not-a-tab");
    expect([...parsed.params]).toEqual([]);
  });
});

test("getBuildLinkOpts falls back to relative links with no window", () => {
  expect(getBuildLinkOpts()).toEqual({ origin: "", basePath: "" });
});

// ---------------------------------------------------------------------------
// CDDL validator round trips
// ---------------------------------------------------------------------------

describe("encodeCddlLink / parseCddlShare", () => {
  const input = { cddl: SAMPLE_CDDL, cbor: SAMPLE_CBOR, rule: "Person" };

  test("compressed round trip", async () => {
    const url = await encodeCddlLink(OPTS, input, { kind: "compressed" });
    expect(tabOf(url)).toBe("cddl-validator");
    const params = paramsOf(url);
    expect(params.get("v")).toBe(String(URL_FORMAT_VERSION));
    expect(params.get("e")).toBe("b");
    // Schema must not appear in the URL if compression worked.
    expect(url).not.toContain("nickname");

    const parsed = await parseCddlShare(params);
    expect(parsed).toEqual({ cddl: SAMPLE_CDDL, cbor: SAMPLE_CBOR, rule: "Person" });
  });

  test("uncompressed round trip", async () => {
    const url = await encodeCddlLink(OPTS, input, { kind: "readable" });
    expect(paramsOf(url).get("e")).toBe("j");
    const parsed = await parseCddlShare(paramsOf(url));
    expect(parsed).toEqual({ cddl: SAMPLE_CDDL, cbor: SAMPLE_CBOR, rule: "Person" });
  });

  test("minimal round trip uses plain params only", async () => {
    const url = await encodeCddlLink(OPTS, input, { kind: "minimal" });
    const params = paramsOf(url);
    expect(params.get("v")).toBeNull();
    expect(params.get("d")).toBeNull();
    expect(params.get("cddl")).toBe(SAMPLE_CDDL);
    expect(params.get("rule")).toBe("Person");
    expect(params.get("cbor")).toBe(SAMPLE_CBOR);

    const parsed = await parseCddlShare(params);
    expect(parsed).toEqual({ cddl: SAMPLE_CDDL, cbor: SAMPLE_CBOR, rule: "Person" });
  });

  test("an empty schema and empty CBOR survive as empty", async () => {
    const url = await encodeCddlLink(
      OPTS,
      { cddl: "", cbor: "", rule: "" },
      { kind: "compressed" },
    );
    const parsed = await parseCddlShare(paramsOf(url));
    expect(parsed.cddl).toBeUndefined();
    expect(parsed.cbor).toBeUndefined();
    expect(parsed.rule).toBeUndefined();
    expect(parsed.parseError).toBeUndefined();
  });

  test("an unedited preset travels as its id, not as 24 KB of text", async () => {
    const url = await encodeCddlLink(
      OPTS,
      { cddl: CONWAY_CDDL, cbor: SAMPLE_CBOR, rule: "transaction", preset: "conway" },
      { kind: "compressed" },
    );
    expect(url.length).toBeLessThan(512);

    const parsed = await parseCddlShare(paramsOf(url));
    expect(parsed.preset).toBe("conway");
    expect(parsed.cddl).toBeUndefined();
    expect(parsed.rule).toBe("transaction");
    expect(parsed.cbor).toBe(SAMPLE_CBOR);
  });

  test("a preset is a plain param in minimal mode", async () => {
    const url = await encodeCddlLink(
      OPTS,
      { cddl: CONWAY_CDDL, cbor: SAMPLE_CBOR, rule: "transaction", preset: "conway" },
      { kind: "minimal" },
    );
    const params = paramsOf(url);
    expect(params.get("preset")).toBe("conway");
    expect(params.get("cddl")).toBeNull();
    expect(await parseCddlShare(params)).toEqual({
      preset: "conway",
      rule: "transaction",
      cbor: SAMPLE_CBOR,
    });
  });

  test("a full era schema still yields a usable URL", async () => {
    expect(CONWAY_CDDL.length).toBeGreaterThan(24_000);
    const input24k = { cddl: CONWAY_CDDL, cbor: SAMPLE_CBOR, rule: "transaction" };

    const compressed = await encodeCddlLink(OPTS, input24k, { kind: "compressed" });
    const readable = await encodeCddlLink(OPTS, input24k, { kind: "readable" });

    // Under typical URL limits; compression must beat uncompressed by a lot.
    expect(compressed.length).toBeLessThan(12_000);
    expect(compressed.length).toBeLessThan(readable.length / 3);

    const parsed = await parseCddlShare(paramsOf(compressed));
    expect(parsed.cddl).toBe(CONWAY_CDDL);
    expect(parsed.rule).toBe("transaction");
    expect(parsed.cbor).toBe(SAMPLE_CBOR);
  });

  test("plain params win over the same field inside the payload", async () => {
    const url = await encodeCddlLink(OPTS, input, { kind: "compressed" });
    const params = paramsOf(url);
    params.set("rule", "Other");
    params.set("cbor", "00");
    const parsed = await parseCddlShare(params);
    expect(parsed.rule).toBe("Other");
    expect(parsed.cbor).toBe("00");
    expect(parsed.cddl).toBe(SAMPLE_CDDL);
  });
});

// ---------------------------------------------------------------------------
// Parser failure modes
// ---------------------------------------------------------------------------

describe("rich payload failure modes", () => {
  test("a truncated payload is reported, and the plain params still land", async () => {
    const url = await encodeCddlLink(
      OPTS,
      { cddl: SAMPLE_CDDL, cbor: SAMPLE_CBOR, rule: "Person" },
      { kind: "compressed" },
    );
    const params = paramsOf(url);
    params.set("d", params.get("d")!.slice(0, 40));
    params.set("rule", "Person");

    const parsed = await parseCddlShare(params);
    expect(parsed.parseError).toBeTruthy();
    expect(parsed.cddl).toBeUndefined();
    expect(parsed.rule).toBe("Person");
  });

  test("a container with no length header is rejected", async () => {
    const parsed = await parseCddlShare(richParams(new Uint8Array([1, 2, 3])));
    expect(parsed.parseError).toBe("Rich payload too short");
  });

  test("a CBOR length longer than the container is rejected", async () => {
    const container = packContainer(SAMPLE_CBOR, { rule: "Person" });
    new DataView(container.buffer).setUint32(0, 0xffff, false);
    const parsed = await parseCddlShare(richParams(container));
    expect(parsed.parseError).toBe("Rich payload cbor length overflow");
  });

  test("an unknown encoding is rejected rather than guessed at", async () => {
    const params = richParams(packContainer("", {}));
    params.set("e", "x");
    const parsed = await parseCddlShare(params);
    expect(parsed.parseError).toBe("Unsupported encoding: x");
  });

  test("a future format version is flagged, not decoded", async () => {
    const params = richParams(packContainer(SAMPLE_CBOR, { rule: "Person" }), URL_FORMAT_VERSION + 1);
    params.set("cbor", "00");

    const parsed = await parseCddlShare(params);
    expect(parsed.futureVersion).toBe(true);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.rule).toBeUndefined();
    // Plain params of any version still apply.
    expect(parsed.cbor).toBe("00");
  });

  test("a future format version is flagged on every tab", async () => {
    const container = packContainer(SAMPLE_CBOR, {});
    const params = richParams(container, URL_FORMAT_VERSION + 1);
    expect((await parseValidatorShare(params)).futureVersion).toBe(true);
    expect((await parseCardanoCborShare(params)).futureVersion).toBe(true);
    expect((await parseGeneralCborShare(params)).futureVersion).toBe(true);
  });

  test("a payload for another tab is not read as this one's", async () => {
    const url = await encodeCddlLink(
      OPTS,
      { cddl: SAMPLE_CDDL, cbor: SAMPLE_CBOR, rule: "Person" },
      { kind: "compressed" },
    );
    // Wrong parser: CBOR comes through; CDDL fields do not.
    const parsed = await parseGeneralCborShare(paramsOf(url));
    expect(parsed.cbor).toBe(SAMPLE_CBOR);
    expect(parsed.parseError).toBeUndefined();
    expect(tabOf(url)).toBe("cddl-validator");
  });
});

// ---------------------------------------------------------------------------
// Validation context versioning
// ---------------------------------------------------------------------------

describe("validator share context", () => {
  const ctx = { utxos: [], protocolParams: null } as unknown as FetchedValidationData;

  test("a context of the current schema version round trips", async () => {
    const url = await encodeValidatorLink(
      OPTS,
      { cbor: SAMPLE_CBOR, net: "preprod" as NetworkType, ctx, capturedAt: 1700000000 },
      { kind: "compressed" },
      true,
    );
    const parsed = await parseValidatorShare(paramsOf(url));
    expect(parsed.cbor).toBe(SAMPLE_CBOR);
    expect(parsed.net).toBe("preprod");
    expect(parsed.capturedAt).toBe(1700000000);
    expect(parsed.ctx).toEqual(ctx);
    expect(parsed.ctxIncompatible).toBeUndefined();
  });

  test("a context from another schema version is dropped, not misread", async () => {
    const container = packContainer(SAMPLE_CBOR, {
      ctx_v: CTX_SCHEMA_VERSION + 1,
      net: "mainnet",
      ctx,
    });
    const parsed = await parseValidatorShare(richParams(container));
    expect(parsed.ctxIncompatible).toBe(true);
    expect(parsed.ctx).toBeUndefined();
    // Tx and network survive so a fresh context can be fetched.
    expect(parsed.cbor).toBe(SAMPLE_CBOR);
    expect(parsed.net).toBe("mainnet");
  });

  test("without a context the link stays minimal", async () => {
    const url = await encodeValidatorLink(
      OPTS,
      { cbor: SAMPLE_CBOR, net: "mainnet" as NetworkType },
      { kind: "compressed" },
      true,
    );
    const params = paramsOf(url);
    expect(params.get("d")).toBeNull();
    expect(params.get("cbor")).toBe(SAMPLE_CBOR);

    const parsed = await parseValidatorShare(params);
    expect(parsed).toEqual({ cbor: SAMPLE_CBOR, net: "mainnet" });
  });

  test("declining to include the context downgrades the link", async () => {
    const url = await encodeValidatorLink(
      OPTS,
      { cbor: SAMPLE_CBOR, net: "mainnet" as NetworkType, ctx },
      { kind: "compressed" },
      false,
    );
    expect(paramsOf(url).get("d")).toBeNull();
    expect((await parseValidatorShare(paramsOf(url))).ctx).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cardano-cbor / general-cbor: shared container round trips
// ---------------------------------------------------------------------------

describe("cardano-cbor and general-cbor round trips", () => {
  test("cardano-cbor compressed round trip", async () => {
    const url = await encodeCardanoCborLink(
      OPTS,
      {
        cbor: SAMPLE_CBOR,
        net: "preview" as NetworkType,
        type: "Transaction",
        psv: 3,
        pds: "DetailedSchema",
      },
      { kind: "compressed" },
    );
    expect(tabOf(url)).toBe("cardano-cbor");
    expect(await parseCardanoCborShare(paramsOf(url))).toEqual({
      cbor: SAMPLE_CBOR,
      net: "preview",
      type: "Transaction",
      psv: 3,
      pds: "DetailedSchema",
    });
  });

  test("cardano-cbor minimal abbreviates the plutus data schema", async () => {
    const url = await encodeCardanoCborLink(
      OPTS,
      { cbor: SAMPLE_CBOR, net: "mainnet" as NetworkType, pds: "BasicConversions" },
      { kind: "minimal" },
    );
    expect(paramsOf(url).get("pds")).toBe("b");
    expect((await parseCardanoCborShare(paramsOf(url))).pds).toBe("BasicConversions");
  });

  test("an out-of-range plutus script version is ignored", async () => {
    const params = new URLSearchParams({ cbor: SAMPLE_CBOR, psv: "9" });
    expect((await parseCardanoCborShare(params)).psv).toBeUndefined();
  });

  test("an unknown network is ignored rather than trusted", async () => {
    const params = new URLSearchParams({ cbor: SAMPLE_CBOR, net: "sanchonet" });
    expect((await parseCardanoCborShare(params)).net).toBeUndefined();
  });

  test("general-cbor compressed round trip", async () => {
    const url = await encodeGeneralCborLink(OPTS, { cbor: SAMPLE_CBOR }, { kind: "compressed" });
    expect(tabOf(url)).toBe("general-cbor");
    expect(paramsOf(url).get("e")).toBe("b");
    expect(await parseGeneralCborShare(paramsOf(url))).toEqual({ cbor: SAMPLE_CBOR });
  });
});
