import { describe, expect, test } from "bun:test";
import { base64ToHex, looksLikeBase64, stripWhitespace } from "./inputNormalization";

describe("looksLikeBase64", () => {
  test("accepts base64 that could not be hex", () => {
    // CBOR {"name": "Alice"} as base64.
    expect(looksLikeBase64("oWRuYW1lZUFsaWNl")).toBe(true);
  });

  test("rejects plain hex so it is not decoded twice", () => {
    expect(looksLikeBase64("deadbeef")).toBe(false);
    expect(looksLikeBase64("a3646e616d6565416c696365")).toBe(false);
  });

  test("rejects empty and non-base64 text", () => {
    expect(looksLikeBase64("")).toBe(false);
    expect(looksLikeBase64("not base64!")).toBe(false);
  });
});

describe("base64ToHex", () => {
  test("round-trips a CBOR payload", () => {
    expect(base64ToHex("oWRuYW1lZUFsaWNl")).toBe("a1646e616d6565416c696365");
  });
});

describe("stripWhitespace", () => {
  test("removes the line breaks of a wrapped paste", () => {
    expect(stripWhitespace(" a164\n6e61 6d65\r\n")).toBe("a1646e616d65");
  });
});
