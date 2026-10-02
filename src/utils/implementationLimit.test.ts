import { describe, expect, test } from "bun:test";
import { isImplementationLimitMessage, limitAwareErrorMessage, nestingRefusalOf, NOT_EXAMINED_PREFIX } from "./implementationLimit";

describe("limitAwareErrorMessage", () => {
  test("each library nesting refusal reads as not examined, naming its bound and decoder", () => {
    const cases: [string, string][] = [
      ["CBOR nesting is deeper than the supported limit of 64 levels for typed decoding", "64 levels for typed decoding"],
      ["Failed to get necessary data: CBOR nesting is deeper than the supported limit of 128 levels for decoding by the serialization library", "128 levels for decoding by the serialization library"],
      ["CBOR nesting is deeper than the supported limit of 128 levels for decoding by pallas and the Plutus evaluator", "128 levels for decoding by pallas and the Plutus evaluator"],
      ["CBOR nesting is deeper than the supported limit of 32768 levels", "32,768 levels."],
    ];
    const exempt = "; native scripts do not count toward it and may nest up to 32768 levels";
    for (const [raw, named] of cases.slice(0, 3)) {
      cases.push([raw + exempt, `${named} (native scripts do not count toward it and may nest up to 32,768 levels).`]);
    }
    for (const [raw, named] of cases) {
      const shown = limitAwareErrorMessage(new Error(raw));
      expect(shown.startsWith(NOT_EXAMINED_PREFIX)).toBe(true);
      expect(shown).toContain(named);
      expect(shown).toContain("implementation limit");
      expect(isImplementationLimitMessage(shown)).toBe(true);
    }
  });

  test("the native-script exemption is parsed from the refusal", () => {
    expect(nestingRefusalOf("CBOR nesting is deeper than the supported limit of 64 levels for typed decoding; native scripts do not count toward it and may nest up to 32768 levels"))
      .toEqual({ limit: 64, decoder: "for typed decoding", nativeScriptLimit: 32768 });
    expect(nestingRefusalOf("CBOR nesting is deeper than the supported limit of 32768 levels"))
      .toEqual({ limit: 32768, decoder: null, nativeScriptLimit: null });
  });

  test("a host stack overflow is an implementation limit, not a raw RangeError", () => {
    const shown = limitAwareErrorMessage(new RangeError("Maximum call stack size exceeded"));
    expect(shown.startsWith(NOT_EXAMINED_PREFIX)).toBe(true);
    expect(shown).not.toContain("RangeError");
  });

  test("any other failure keeps the library's sentence", () => {
    expect(limitAwareErrorMessage(new Error("Malformed CBOR: trailing data"))).toBe("Malformed CBOR: trailing data");
    expect(limitAwareErrorMessage("plain string")).toBe("plain string");
  });
});
