import { describe, expect, test } from "bun:test";
import { buildTxLink, parseTxPath, readTxLinkParams, txLinkHash } from "./txLink";

const HASH = "bc8b7cdee06fa82db5239580a7ba9ea36485c378eb4354c19a57f59df081c028";

describe("readTxLinkParams", () => {
  test("reads a valid hash and defaults the network to mainnet", () => {
    expect(readTxLinkParams(new URLSearchParams({ tx: HASH }))).toEqual({ hash: HASH, net: "mainnet" });
    expect(readTxLinkParams(new URLSearchParams({ tx: HASH.toUpperCase(), net: "preprod" }))).toEqual({
      hash: HASH,
      net: "preprod",
    });
  });

  test("rejects a missing, short or non-hex hash and an unknown network", () => {
    expect(readTxLinkParams(new URLSearchParams())).toBeNull();
    expect(readTxLinkParams(new URLSearchParams({ tx: HASH.slice(1) }))).toBeNull();
    expect(readTxLinkParams(new URLSearchParams({ tx: "z".repeat(64) }))).toBeNull();
    expect(readTxLinkParams(new URLSearchParams({ tx: HASH, net: "sanchonet" }))?.net).toBe("mainnet");
  });
});

describe("parseTxPath", () => {
  test("reads /tx/<hash> at the root and under a base path", () => {
    expect(parseTxPath(`/tx/${HASH}`, "")).toEqual({ basePath: "", hash: HASH, net: "mainnet" });
    expect(parseTxPath(`/cquisitor/tx/${HASH}/`, "?net=preview")).toEqual({
      basePath: "/cquisitor",
      hash: HASH,
      net: "preview",
    });
  });

  test("ignores other paths", () => {
    expect(parseTxPath("/", "")).toBeNull();
    expect(parseTxPath("/tx/", "")).toBeNull();
    expect(parseTxPath("/tx/not-a-hash", "")).toBeNull();
    expect(parseTxPath(`/tx/${HASH}/extra`, "")).toBeNull();
  });
});

describe("link builders", () => {
  test("txLinkHash omits net for mainnet", () => {
    expect(txLinkHash({ hash: HASH, net: "mainnet" })).toBe(`#transaction-validator?tx=${HASH}`);
    expect(txLinkHash({ hash: HASH, net: "preprod" })).toBe(`#transaction-validator?tx=${HASH}&net=preprod`);
  });

  test("buildTxLink produces the short path form", () => {
    const opts = { origin: "https://example.test", basePath: "/cquisitor" };
    expect(buildTxLink(opts, { hash: HASH, net: "mainnet" })).toBe(`https://example.test/cquisitor/tx/${HASH}`);
    expect(buildTxLink({ origin: "https://example.test", basePath: "" }, { hash: HASH, net: "preview" })).toBe(
      `https://example.test/tx/${HASH}?net=preview`,
    );
  });

  test("a path link round-trips through parseTxPath into the hash the app reads", () => {
    const parsed = parseTxPath(`/cquisitor/tx/${HASH}`, "?net=preprod");
    expect(parsed && txLinkHash(parsed)).toBe(`#transaction-validator?tx=${HASH}&net=preprod`);
  });
});
