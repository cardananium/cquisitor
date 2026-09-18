import { describe, expect, test } from "bun:test";
import type { CborDecodeError } from "@cardananium/cquisitor-lib";
import type { CborDiagnostic } from "./cddlError";
import type { CborValidationOutcome } from "./cddlValidatorLib";
import { hexRefusalFor, isListable, verdictChipText, verdictFor, type VerdictInput } from "./verdict";

const LIMIT = "CBOR nesting is deeper than the supported limit of 16384 levels";

function diagnostic(over: Partial<CborDiagnostic> = {}): CborDiagnostic {
  return {
    kind: "mismatch",
    message: "expected type uint",
    expected: "uint",
    path: "$.age",
    cddlRange: [10, 14],
    byteSpans: [{ offset: 4, length: 2 }],
    anchorSpans: [],
    ...over,
  };
}

const INVALID: CborValidationOutcome = {
  ok: true,
  result: { valid: false, error: { kind: "mismatch", message: "expected type uint" } },
};
const VALID: CborValidationOutcome = { ok: true, result: { valid: true } };
const THREW: CborValidationOutcome = { ok: false, error: "wasm trap: unreachable" };
const BOUND: CborValidationOutcome = {
  ok: true,
  result: { valid: false, error: { kind: "nesting_too_deep", message: LIMIT } },
};
const REFUSED: CborValidationOutcome = {
  ok: true,
  result: {
    valid: false,
    error: {
      kind: "group_rule_root",
      message: "parsing error: position Position { line: 1, column: 1, range: (0, 1), index: 0 }, msg: CDDL rule g is a group rule",
    },
  },
};

function input(over: Partial<VerdictInput> = {}): VerdictInput {
  return {
    outcome: INVALID,
    diagnostics: [diagnostic({ path: "$.a" }), diagnostic({ path: "$.b" })],
    reportedDiagnostics: 2,
    rule: "Person",
    decodeError: null,
    decoderFailure: null,
    ...over,
  };
}

describe("verdictFor", () => {
  test("nothing without a run", () => {
    expect(verdictFor(input({ outcome: null }))).toEqual({ kind: "none" });
  });

  test("nothing while the bytes do not decode — the hex says it", () => {
    const decodeError = { kind: "unexpected_eof", message: "unexpected end", path: "$" } as CborDecodeError;
    expect(verdictFor(input({ decodeError }))).toEqual({ kind: "none" });
    expect(verdictFor(input({ decoderFailure: "wasm trap" }))).toEqual({ kind: "none" });
  });

  test("a validator that threw is a refusal under its own label", () => {
    expect(verdictFor(input({ outcome: THREW })))
      .toEqual({ kind: "refused", label: "validator error", message: "wasm trap: unreachable" });
  });

  test("a match names the rule", () => {
    expect(verdictFor(input({ outcome: VALID, diagnostics: [], reportedDiagnostics: 0 })))
      .toEqual({ kind: "valid", rule: "Person" });
  });

  test("a refusal with no diagnostics reads the result's own kind, with the parser dump stripped", () => {
    expect(verdictFor(input({ outcome: REFUSED, diagnostics: [], reportedDiagnostics: 0 })))
      .toEqual({ kind: "refused", label: "group_rule_root", message: "CDDL rule g is a group rule" });
  });

  test("a bound reached as the head diagnostic is a refusal, not a count", () => {
    const head = diagnostic({ kind: "nesting_too_deep", message: LIMIT, expected: null, path: "$[0][0]" });
    expect(verdictFor(input({ outcome: BOUND, diagnostics: [head], reportedDiagnostics: 1 })))
      .toEqual({ kind: "refused", label: "nesting_too_deep", message: LIMIT });
  });

  test("mismatches carry the run's count and the head", () => {
    const v = verdictFor(input());
    expect(v.kind).toBe("mismatches");
    if (v.kind !== "mismatches") return;
    expect(v.count).toBe(2);
    expect(v.head.path).toBe("$.a");
  });

  test("the count is what the run found, not what the list keeps", () => {
    const v = verdictFor(input({ reportedDiagnostics: 400 }));
    expect(v.kind === "mismatches" && v.count).toBe(400);
    // A count under the list's length is stale; the list wins.
    const under = verdictFor(input({ reportedDiagnostics: 0 }));
    expect(under.kind === "mismatches" && under.count).toBe(2);
  });
});

describe("verdictChipText", () => {
  test("reads each verdict", () => {
    expect(verdictChipText({ kind: "none" })).toBe("");
    expect(verdictChipText({ kind: "valid", rule: "Person" })).toBe("✓ matches Person");
    expect(verdictChipText({ kind: "mismatches", count: 1, head: diagnostic() })).toBe("✗ 1 mismatch");
    expect(verdictChipText({ kind: "mismatches", count: 3, head: diagnostic() })).toBe("✗ 3 mismatches");
    expect(verdictChipText({ kind: "refused", label: "nesting_too_deep", message: LIMIT })).toBe("✗ nesting_too_deep");
  });
});

describe("isListable", () => {
  test("only a verdict with something behind it opens a list", () => {
    expect(isListable({ kind: "none" })).toBe(false);
    expect(isListable({ kind: "valid", rule: "Person" })).toBe(false);
    expect(isListable({ kind: "mismatches", count: 1, head: diagnostic() })).toBe(true);
    expect(isListable({ kind: "refused", label: "validator error", message: "x" })).toBe(true);
  });
});

describe("hexRefusalFor", () => {
  test("nothing for a run that reached a verdict", () => {
    expect(hexRefusalFor(input())).toBeNull();
    expect(hexRefusalFor(input({ outcome: VALID, diagnostics: [] }))).toBeNull();
    expect(hexRefusalFor(input({ outcome: null, diagnostics: [] }))).toBeNull();
  });

  test("a decode error comes first, with its path when it is below the root", () => {
    const decodeError = {
      kind: "unexpected_eof", message: "unexpected end", path: "$.entries[1]", offset: 7,
    } as CborDecodeError;
    const refusal = hexRefusalFor(input({ decodeError, outcome: THREW }));
    expect(refusal).toEqual({
      kind: "unexpected_eof",
      message: "unexpected end",
      path: "$.entries[1]",
      limitNote: null,
      note: "The CBOR has to decode before it can be checked against the schema.",
    });
  });

  test("a decode error at the root names no path", () => {
    const decodeError = { kind: "unexpected_eof", message: "unexpected end", path: "$" } as CborDecodeError;
    expect(hexRefusalFor(input({ decodeError }))?.path).toBeNull();
  });

  test("the decoder's own bound gets the limit note", () => {
    const decodeError = { kind: "nesting_too_deep", message: LIMIT, path: "$" } as CborDecodeError;
    const refusal = hexRefusalFor(input({ decodeError }));
    expect(refusal?.kind).toBe("nesting_too_deep");
    expect(refusal?.limitNote).toContain("not a finding about the input");
  });

  test("a decoder that gave up is named as such", () => {
    const refusal = hexRefusalFor(input({ decoderFailure: "wasm trap: unreachable" }));
    expect(refusal).toEqual({
      kind: "decoder failed",
      message: "wasm trap: unreachable",
      path: null,
      limitNote: null,
      note: "The decoder stopped on this input instead of reporting what was wrong with it.",
    });
  });

  test("a validator that threw is named as such", () => {
    const refusal = hexRefusalFor(input({ outcome: THREW, diagnostics: [] }));
    expect(refusal).toEqual({
      kind: "validator error",
      message: "wasm trap: unreachable",
      path: null,
      limitNote: null,
      note: "The validator stopped on this input instead of returning a result.",
    });
  });

  test("a refusal with no diagnostics reads the result's kind", () => {
    const refusal = hexRefusalFor(input({ outcome: REFUSED, diagnostics: [] }));
    expect(refusal).toEqual({
      kind: "group_rule_root",
      message: "CDDL rule g is a group rule",
      path: null,
      limitNote: null,
      note: null,
    });
  });

  test("a bound reached as the head diagnostic is announced with the limit note and where it was reached", () => {
    const head = diagnostic({ kind: "nesting_too_deep", message: LIMIT, expected: null, path: "$[0][0]" });
    const refusal = hexRefusalFor(input({ outcome: BOUND, diagnostics: [head] }));
    expect(refusal?.kind).toBe("nesting_too_deep");
    expect(refusal?.message).toBe(LIMIT);
    expect(refusal?.path).toBe("$[0][0]");
    expect(refusal?.limitNote).toContain("not a finding about the input");
    expect(refusal?.note).toBeNull();
  });
});
