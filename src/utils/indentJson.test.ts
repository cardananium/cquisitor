import { describe, expect, test } from "bun:test";
import { indentJsonText, MAX_INDENTED_DEPTH } from "./indentJson";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

describe("indentJsonText", () => {
  test("lays a document out the way JSON.stringify does", () => {
    const value = {
      a: 1,
      b: [1, "two", null, true, false, { c: [] }, {}],
      d: { e: { f: 'g"h\\' } },
      "k e y": -1.5e10,
    };
    expect(indentJsonText(JSON.stringify(value))).toBe(pretty(value));
    // Already indented or oddly spaced: same layout.
    expect(indentJsonText(pretty(value))).toBe(pretty(value));
    expect(indentJsonText('{ "a" :\n[ 1 ,2 ] }')).toBe(pretty({ a: [1, 2] }));
  });

  test("keeps every token as it was: an integer past 2^53 keeps its digits", () => {
    const text = '{"amount":18446744073709551615,"n":1.0,"s":"\\u0041"}';
    expect(indentJsonText(text)).toBe('{\n  "amount": 18446744073709551615,\n  "n": 1.0,\n  "s": "\\u0041"\n}');
    expect(pretty(JSON.parse(text))).not.toContain("18446744073709551615");
  });

  test("brackets inside strings are text, not structure", () => {
    expect(indentJsonText('["[{", "}]", "\\"[\\""]')).toBe('[\n  "[{",\n  "}]",\n  "\\"[\\""\n]');
  });

  test("a document at the depth bound is indented to the bottom, and one level deeper comes back as it came", () => {
    const chain = (depth: number) => "[".repeat(depth) + "5" + "]".repeat(depth);
    const at = chain(MAX_INDENTED_DEPTH);
    expect(indentJsonText(at)).toBe(pretty(JSON.parse(at)));
    const past = chain(MAX_INDENTED_DEPTH + 1);
    expect(indentJsonText(past)).toBe(past);
    // Deep enough that JSON.stringify throws: returned unchanged.
    const deep = chain(100_000);
    expect(() => pretty(JSON.parse(deep))).toThrow(RangeError);
    expect(indentJsonText(deep)).toBe(deep);
  });

  test("text that is not well-formed JSON comes back as it came", () => {
    for (const text of ['{"a": 1', '{"a": 1}}', '"unterminated', "[1, 2"]) {
      expect(indentJsonText(text)).toBe(text);
    }
  });
});
