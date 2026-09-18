// Walkers over a 10k-nested document, through the same wrappers and transport the UI uses.
// Depth must not overflow the JS stack: these verdicts are the real ones, not refusals.

import { describe, expect, test } from "bun:test";
import type { CborValue, CborValidationResult } from "@cardananium/cquisitor-lib";
import {
  safeCborToJson,
  safeDecodeCborAgainstCddl,
  safeMapCborToCddl,
  safeValidateCborAgainstCddl,
} from "./cddlValidatorLib";

/** Ten thousand levels: past every host stack, inside the library's bound of 16384. */
export const DEEP_LEVELS = 10_000;
/** One past the library's bound: the refusal every walker has to give. */
const PAST_THE_BOUND = 16_385;

/** `[[[…leaf…]]]`, `levels` arrays deep. */
export const nestedArrays = (levels: number, leaf = "05") => "81".repeat(levels) + leaf;
/** Schema the nesting matches: a one-field array at every level, an unsigned integer at the bottom. */
export const NESTED_SCHEMA = "x = [a: x] / uint";

describe("a document nested ten thousand levels deep", () => {
  test("decodes to a tree that reaches the leaf", async () => {
    const outcome = await safeCborToJson(nestedArrays(DEEP_LEVELS));
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok || !outcome.result.ok) throw new Error("expected a decoded tree");
    let node: CborValue = outcome.result.value;
    let levels = 0;
    while (node.type === "Array") {
      node = node.values[0];
      levels++;
    }
    expect(levels).toBe(DEEP_LEVELS);
    expect(node).toMatchObject({ type: "U8", value: 5 });
  });

  test("validates with the right verdict — matching, then a bad leaf named by its path", async () => {
    const good = await safeValidateCborAgainstCddl(nestedArrays(DEEP_LEVELS), NESTED_SCHEMA, "x");
    expect(good?.ok).toBe(true);
    if (good?.ok) expect(good.result.valid).toBe(true);

    const bad = await safeValidateCborAgainstCddl(nestedArrays(DEEP_LEVELS, "60"), NESTED_SCHEMA, "x");
    expect(bad?.ok).toBe(true);
    if (!bad?.ok) return;
    const result = bad.result as CborValidationResult & { valid: false };
    expect(result.valid).toBe(false);
    expect(result.error.kind).toBe("mismatch");
    expect(result.error.path).toBe("$" + "[0]".repeat(DEEP_LEVELS));
    expect(result.error.byte_spans?.[0]).toEqual({ offset: DEEP_LEVELS, length: 1 });
    const span = result.error.cddl_byte_span;
    expect(span && NESTED_SCHEMA.slice(span.offset, span.offset + span.length)).toBe("x");
  });

  test("decodes against the schema down to the labelled leaf", async () => {
    const outcome = await safeDecodeCborAgainstCddl(nestedArrays(DEEP_LEVELS), NESTED_SCHEMA, "x");
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok) return;
    let cursor: unknown = outcome.value;
    let levels = 0;
    while (cursor && typeof cursor === "object" && "a" in cursor) {
      cursor = (cursor as { a: unknown }).a;
      levels++;
    }
    expect(levels).toBe(DEEP_LEVELS);
    expect(cursor).toBe(5);
  });

  test("maps with a row for every level", async () => {
    const outcome = await safeMapCborToCddl(nestedArrays(DEEP_LEVELS), NESTED_SCHEMA, "x");
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok) return;
    // One row per array and one per field slot at every level, plus the leaf.
    expect(outcome.map.entries.length).toBe(2 * DEEP_LEVELS + 2);
    expect(outcome.map.decoded_paths.length).toBe(DEEP_LEVELS + 1);
  });
});

describe("a document nested past the bound", () => {
  test("is refused by every walker with the kind, and the library still answers afterwards", async () => {
    const hex = nestedArrays(PAST_THE_BOUND);

    const decoded = await safeCborToJson(hex);
    expect(decoded?.ok).toBe(true);
    if (decoded?.ok) {
      expect(decoded.result.ok).toBe(false);
      if (!decoded.result.ok) expect(decoded.result.error.kind).toBe("nesting_too_deep");
    }

    const validated = await safeValidateCborAgainstCddl(hex, NESTED_SCHEMA, "x");
    expect(validated?.ok).toBe(true);
    if (validated?.ok) {
      expect(validated.result.valid).toBe(false);
      if (!validated.result.valid) expect(validated.result.error.kind).toBe("nesting_too_deep");
    }

    for (const walker of [safeDecodeCborAgainstCddl, safeMapCborToCddl]) {
      const outcome = await walker(hex, NESTED_SCHEMA, "x");
      expect(outcome?.ok).toBe(false);
      if (outcome && !outcome.ok) expect(outcome.error.kind).toBe("nesting_too_deep");
    }

    const alive = await safeDecodeCborAgainstCddl("8105", NESTED_SCHEMA, "x");
    expect(alive).toEqual({ ok: true, value: { a: 5 } });
  });
});
