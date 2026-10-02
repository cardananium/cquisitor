import { describe, expect, test } from "bun:test";
import { boundedJson } from "./boundedJson";

describe("boundedJson", () => {
  test("matches JSON.stringify for small values", () => {
    for (const v of [null, 1, "a\"b", true, [1, [2, {}]], { a: 1, b: [null, "x"], c: undefined }, []]) {
      expect(boundedJson(v, 1_000)).toBe(JSON.stringify(v));
    }
  });

  test("prints bigints as digits", () => {
    const big = BigInt(2) ** BigInt(70);
    expect(boundedJson({ n: big })).toBe(`{"n":${big.toString()}}`);
  });

  test("a value nested 100,000 levels deep is cut, not a RangeError", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 100_000; i++) deep = [deep];
    const text = boundedJson(deep, 50);
    expect(text.length).toBe(50);
    expect(text.endsWith("…")).toBe(true);
  });
});
