import { describe, expect, test } from "bun:test";
import { convertSerdeNumbers, parseSerdeJson } from "./serdeNumbers";

const box = (digits: string): unknown => ({ "$serde_json::private::Number": digits });

describe("convertSerdeNumbers", () => {
  test("a box holding what a number holds exactly becomes a number", () => {
    expect(convertSerdeNumbers(box("42"))).toBe(42);
    expect(convertSerdeNumbers(box("-9007199254740991"))).toBe(-9007199254740991);
  });

  test("a box past the safe integers becomes a bigint", () => {
    expect(convertSerdeNumbers(box("18446744073709551615"))).toBe(BigInt("18446744073709551615"));
    expect(convertSerdeNumbers(box("-18446744073709551616"))).toBe(BigInt("-18446744073709551616"));
  });

  test("a box holding a float stays a number", () => {
    expect(convertSerdeNumbers(box("1.5"))).toBe(1.5);
    expect(convertSerdeNumbers(box("1e300"))).toBe(1e300);
  });

  test("converts inside arrays and objects, and leaves the input as it was", () => {
    const input = { a: [box("1"), { b: box("99999999999999999999") }], c: "s", d: null };
    const out = convertSerdeNumbers<unknown>(input);
    expect(out).toEqual({ a: [1, { b: BigInt("99999999999999999999") }], c: "s", d: null });
    expect(input.a[0]).toEqual(box("1"));
    expect(out).not.toBe(input);
  });

  test("primitives, null and undefined pass through", () => {
    expect(convertSerdeNumbers(5)).toBe(5);
    expect(convertSerdeNumbers("x")).toBe("x");
    expect(convertSerdeNumbers(null)).toBe(null);
    expect(convertSerdeNumbers(undefined)).toBe(undefined);
    expect(convertSerdeNumbers(BigInt("7"))).toBe(BigInt("7"));
  });

  test("a key spelled __proto__ is copied as an own entry, not as the copy's prototype", () => {
    const input = JSON.parse('{"__proto__": {"x": {"$serde_json::private::Number": "18446744073709551615"}}, "a": 2}');
    const out = convertSerdeNumbers<Record<string, unknown>>(input);
    expect(Object.keys(out)).toEqual(["__proto__", "a"]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toEqual({
      x: BigInt("18446744073709551615"),
    });
    expect("x" in out).toBe(false);

    const nested = JSON.parse('{"list": [{"__proto__": {"y": 1}}]}');
    const copy = convertSerdeNumbers<{ list: Record<string, unknown>[] }>(nested);
    expect(Object.keys(copy.list[0])).toEqual(["__proto__"]);
    expect("y" in copy.list[0]).toBe(false);
  });

  test("a value nested a hundred thousand levels deep is converted without a frame per level", () => {
    const depth = 100_000;
    let node: unknown = box("18446744073709551615");
    for (let i = 0; i < depth; i++) node = i % 2 === 0 ? { a: node } : [node];
    const out = convertSerdeNumbers(node);
    let cursor: unknown = out;
    for (let i = depth - 1; i >= 0; i--) {
      cursor = i % 2 === 0 ? (cursor as { a: unknown }).a : (cursor as unknown[])[0];
    }
    expect(cursor).toBe(BigInt("18446744073709551615"));
  });
});

describe("parseSerdeJson", () => {
  test("keeps a __proto__ key of the text as an own entry", () => {
    const out = parseSerdeJson<Record<string, unknown>>('{"__proto__": {"x": 1}, "a": 2}');
    expect(Object.keys(out)).toEqual(["__proto__", "a"]);
    expect("x" in out).toBe(false);
    expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toEqual({ x: 1 });
  });

  test("parses the library's text and converts its boxes by the same rule", () => {
    const text = '{"ok":true,"value":[5,{"$serde_json::private::Number":"18446744073709551615"}]}';
    expect(parseSerdeJson<unknown>(text)).toEqual({ ok: true, value: [5, BigInt("18446744073709551615")] });
  });

  test("reads text nested ten thousand levels deep", () => {
    const depth = 10_000;
    const text = "[".repeat(depth) + '{"$serde_json::private::Number":"1"}' + "]".repeat(depth);
    let cursor: unknown = parseSerdeJson(text);
    for (let i = 0; i < depth; i++) cursor = (cursor as unknown[])[0];
    expect(cursor).toBe(1);
  });
});
