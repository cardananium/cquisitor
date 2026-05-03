import { describe, expect, test } from "bun:test";
import { entriesAwareMapEntries, plainMapEntries } from "./mapEntries";

describe("plainMapEntries", () => {
  test("returns empty for non-objects", () => {
    expect(plainMapEntries(null)).toEqual([]);
    expect(plainMapEntries(undefined)).toEqual([]);
    expect(plainMapEntries(42)).toEqual([]);
    expect(plainMapEntries("string")).toEqual([]);
    expect(plainMapEntries([1, 2])).toEqual([]);
  });

  test("returns Object.entries-shaped output for plain objects", () => {
    expect(plainMapEntries({ a: 1, b: "two" })).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: "two" },
    ]);
  });

  test("preserves @entries key as a regular field", () => {
    expect(plainMapEntries({ "@entries": [1, 2, 3] })).toEqual([
      { key: "@entries", value: [1, 2, 3] },
    ]);
  });
});

describe("entriesAwareMapEntries", () => {
  test("returns empty for non-objects", () => {
    expect(entriesAwareMapEntries(null)).toEqual([]);
    expect(entriesAwareMapEntries([1, 2])).toEqual([]);
  });

  test("treats plain objects as Object.entries (no @entries field)", () => {
    expect(entriesAwareMapEntries({ a: 1, b: 2 })).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
  });

  test("expands @entries wire-order shape", () => {
    const value = {
      "@entries": [
        { key: "name", value: "alice", match: { via: "literal", label: null } },
        { key: 42, value: "answer" },
      ],
    };
    expect(entriesAwareMapEntries(value)).toEqual([
      { key: "name", value: "alice" },
      { key: 42, value: "answer" },
    ]);
  });

  test("stringifies non-number keys for stable React-side rendering", () => {
    const value = {
      "@entries": [
        { key: "literal", value: 1 },
        { key: 7, value: 2 },
        // Complex key (array) — collapsed to its String() form.
        { key: ["a", "b"], value: 3 },
      ],
    };
    expect(entriesAwareMapEntries(value)).toEqual([
      { key: "literal", value: 1 },
      { key: 7, value: 2 },
      { key: "a,b", value: 3 },
    ]);
  });

  test("ignores @entries when it is not an array (treats as plain object)", () => {
    expect(entriesAwareMapEntries({ "@entries": "not-an-array", x: 1 })).toEqual([
      { key: "@entries", value: "not-an-array" },
      { key: "x", value: 1 },
    ]);
  });
});
