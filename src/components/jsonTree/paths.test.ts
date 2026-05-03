import { describe, expect, test } from "bun:test";
import {
  dotIsPathAncestor,
  dotJoinKey,
  dotPathsEqual,
  libIsPathAncestor,
  libJoinKey,
  libPathsEqual,
  libSplitPath,
} from "./paths";

describe("libJoinKey", () => {
  test("array index uses bracketed integer", () => {
    expect(libJoinKey("$", 0, { isArrayItem: true })).toBe("$[0]");
    expect(libJoinKey("$.body", 12, { isArrayItem: true })).toBe("$.body[12]");
  });

  test("identifier-safe string key uses dot notation", () => {
    expect(libJoinKey("$", "body", { isArrayItem: false })).toBe("$.body");
    expect(libJoinKey("$.body", "tx_inputs", { isArrayItem: false })).toBe(
      "$.body.tx_inputs",
    );
    expect(libJoinKey("$", "_underscore", { isArrayItem: false })).toBe(
      "$._underscore",
    );
    expect(libJoinKey("$", "with-dash", { isArrayItem: false })).toBe(
      "$.with-dash",
    );
  });

  test("non-identifier string key uses bracketed quoted form", () => {
    expect(libJoinKey("$", "with space", { isArrayItem: false })).toBe(
      '$["with space"]',
    );
    expect(libJoinKey("$", "0", { isArrayItem: false })).toBe('$["0"]');
    expect(libJoinKey("$", "@entries", { isArrayItem: false })).toBe(
      '$["@entries"]',
    );
  });

  test("escapes embedded quotes and backslashes", () => {
    expect(libJoinKey("$", 'a"b', { isArrayItem: false })).toBe('$["a\\"b"]');
    expect(libJoinKey("$", "a\\b", { isArrayItem: false })).toBe('$["a\\\\b"]');
  });
});

describe("libSplitPath", () => {
  test("splits the canonical mix of dots, brackets and quoted strings", () => {
    expect(libSplitPath("$.body[0].tx_inputs[12]")).toEqual([
      "body",
      "0",
      "tx_inputs",
      "12",
    ]);
    expect(libSplitPath('$["@entries"][2]["complex key"]')).toEqual([
      "@entries",
      "2",
      "complex key",
    ]);
  });

  test("empty for the bare root", () => {
    expect(libSplitPath("$")).toEqual([]);
  });

  test("re-entrant — repeated invocation yields the same result", () => {
    const p = "$.a[0].b";
    expect(libSplitPath(p)).toEqual(["a", "0", "b"]);
    expect(libSplitPath(p)).toEqual(["a", "0", "b"]);
  });

  test("decodes escaped quotes in bracketed string segments", () => {
    expect(libSplitPath('$["a\\"b"]')).toEqual(['a\\"b']);
  });
});

describe("libPathsEqual", () => {
  test("true for identical strings", () => {
    expect(libPathsEqual("$.body[0]", "$.body[0]")).toBe(true);
  });

  test("treats numeric map key and array index as the same segment", () => {
    // The lib emits `["0"]` for numeric *map* keys but `[0]` for array
    // indices. Segment-wise compare collapses both to the segment "0".
    expect(libPathsEqual('$.body["0"]', "$.body[0]")).toBe(true);
  });

  test("false on different segments", () => {
    expect(libPathsEqual("$.body[0]", "$.body[1]")).toBe(false);
    expect(libPathsEqual("$.a", "$.b")).toBe(false);
  });

  test("false on differing length", () => {
    expect(libPathsEqual("$.a", "$.a.b")).toBe(false);
  });
});

describe("libIsPathAncestor", () => {
  test("strict ancestor", () => {
    expect(libIsPathAncestor("$.body", "$.body[0]")).toBe(true);
    expect(libIsPathAncestor("$", '$["@entries"][0]')).toBe(true);
  });

  test("not an ancestor of itself", () => {
    expect(libIsPathAncestor("$.body", "$.body")).toBe(false);
  });

  test("not an ancestor when descendant is on a different branch", () => {
    expect(libIsPathAncestor("$.body[0]", "$.body[1]")).toBe(false);
    expect(libIsPathAncestor("$.x", "$.y.z")).toBe(false);
  });

  test("not an ancestor in the wrong direction", () => {
    expect(libIsPathAncestor("$.body[0]", "$.body")).toBe(false);
  });
});

describe("dotJoinKey", () => {
  test("empty parent yields bare key", () => {
    expect(dotJoinKey("", "transaction", { isArrayItem: false })).toBe(
      "transaction",
    );
    expect(dotJoinKey("", 0, { isArrayItem: true })).toBe("0");
  });

  test("non-empty parent dot-joins regardless of array-ness", () => {
    expect(dotJoinKey("transaction", "body", { isArrayItem: false })).toBe(
      "transaction.body",
    );
    expect(dotJoinKey("transaction.body", 0, { isArrayItem: true })).toBe(
      "transaction.body.0",
    );
  });
});

describe("dotPathsEqual / dotIsPathAncestor", () => {
  test("equality is plain ===", () => {
    expect(dotPathsEqual("a.b", "a.b")).toBe(true);
    expect(dotPathsEqual("a.b", "a.c")).toBe(false);
  });

  test("ancestor uses prefix-with-dot", () => {
    expect(dotIsPathAncestor("transaction", "transaction.body")).toBe(true);
    expect(
      dotIsPathAncestor("transaction.body", "transaction.body.0"),
    ).toBe(true);
    expect(dotIsPathAncestor("transaction", "transaction")).toBe(false);
    // Avoids the substring trap: "tx" is not an ancestor of "txt".
    expect(dotIsPathAncestor("tx", "txt")).toBe(false);
  });
});
