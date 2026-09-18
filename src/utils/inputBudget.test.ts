import { describe, expect, test } from "bun:test";
import {
  MAX_LIB_INPUT_BYTES,
  argumentByteLength,
  formatByteSize,
  overBudgetMessage,
  utf8ByteLength,
} from "./inputBudget";

describe("utf8ByteLength", () => {
  test("counts what an encoder would produce", () => {
    for (const text of ["", "abc", "кириллица", "🦀", "a🦀b", "é", "\u{10FFFF}"]) {
      expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
    }
  });

  test("stops counting once the text cannot possibly fit", () => {
    // UTF-8 is never shorter than UTF-16, so over-limit code-unit length can stop early.
    const huge = "a".repeat(1000);
    expect(utf8ByteLength(huge, 10)).toBeGreaterThan(10);
  });

  test("a lone surrogate is still counted, not skipped", () => {
    // Lone surrogates still count (must not hang or skip).
    expect(utf8ByteLength("\ud800")).toBe(4);
  });
});

describe("argumentByteLength", () => {
  test("adds up the string arguments and ignores the rest", () => {
    expect(argumentByteLength(["abc", 7, undefined, "de", { x: 1 }])).toBe(5);
    expect(argumentByteLength([])).toBe(0);
  });

  test("stops as soon as the total is over the limit", () => {
    expect(argumentByteLength(["a".repeat(100), "b".repeat(100)], 50)).toBeGreaterThan(50);
  });
});

describe("formatByteSize", () => {
  test("reads in the units the reader thinks in", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(2048)).toBe("2.0 KB");
    expect(formatByteSize(64 * 1024)).toBe("64 KB");
    expect(formatByteSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatByteSize(13 * 1024 * 1024)).toBe("13 MB");
  });
});

describe("overBudgetMessage", () => {
  test("nothing to say while the input fits", () => {
    expect(overBudgetMessage(0, MAX_LIB_INPUT_BYTES)).toBeNull();
    expect(overBudgetMessage(MAX_LIB_INPUT_BYTES, MAX_LIB_INPUT_BYTES)).toBeNull();
  });

  test("names both numbers, because a limit alone leaves the reader guessing", () => {
    const message = overBudgetMessage(13 * 1024 * 1024, MAX_LIB_INPUT_BYTES);
    expect(message).toContain("13 MB");
    expect(message).toContain("2.0 MB");
  });

  test("the subject can name what was refused", () => {
    expect(overBudgetMessage(9e9, 1, "The shared document")).toContain("The shared document");
  });
});
