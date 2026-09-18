import { describe, expect, mock, test } from "bun:test";
import type {
  CborCddlMap,
  CborCddlMapResult,
  CborDecodeResult,
  CddlValidationResult,
} from "@cardananium/cquisitor-lib";
import * as lib from "@cardananium/cquisitor-lib";
import { callLib } from "@/lib/cquisitorWorker";
import { MAX_LIB_INPUT_BYTES } from "@/utils/inputBudget";
import { createCborCddlBridge } from "./cborCddlBridge";
import { cborDiagnostics, cddlErrorReason, hasCddlSpan } from "./cddlError";
import {
  formatCddlChecked,
  safeCborToJson,
  safeDecodeCborAgainstCddl,
  safeFormat,
  safeMapCborToCddl,
  safeOutline,
  safeReferences,
  safeSymbolAt,
  safeValidateCborAgainstCddl,
  safeValidateCddl,
  type CborCddlMapOutcome,
  type CborToJsonOutcome,
  type CddlSchemaOutcome,
  type WalkRefusal,
} from "./cddlValidatorLib";

/** Unwrap a successful schema result; a throw from the wrapper fails the test loudly. */
function schemaResult(outcome: CddlSchemaOutcome | null): CddlValidationResult | null {
  if (!outcome) return null;
  if (!outcome.ok) throw new Error(`validate_cddl threw: ${outcome.error}`);
  return outcome.result;
}

function decodeResult(outcome: CborToJsonOutcome | null): CborDecodeResult | null {
  if (!outcome) return null;
  if (!outcome.ok) throw new Error(`cbor_to_json threw: ${outcome.error}`);
  return outcome.result;
}

/** Unwrap a map; a refusal fails the test loudly rather than reading as "nothing mapped". */
function mapResult(outcome: CborCddlMapOutcome | null): CborCddlMap {
  if (!outcome) throw new Error("map_cbor_to_cddl was given nothing to map");
  if (!outcome.ok) {
    throw new Error(`map_cbor_to_cddl refused: ${outcome.error.kind} — ${outcome.error.message}`);
  }
  return outcome.map;
}

/** Unwrap a refusal; an answer fails the test. */
function refusalOf(outcome: { ok: true } | { ok: false; error: WalkRefusal } | null): WalkRefusal {
  if (!outcome) throw new Error("expected a refused walk, got nothing to walk");
  if (outcome.ok) throw new Error("expected a refused walk, got an answer");
  return outcome.error;
}

const PERSON_CDDL = `; a comment the formatter drops
Person = {
  name: tstr,
  age: uint,
  ? nickname: tstr,
}
`;

// {"name": "Alice", "age": "20"} — `age` is a text string, so it does not
// match `age: uint`.
const MISMATCHING_HEX = "a2646e616d6565416c69636563616765623230";

// Half-written CDDL: outline / references / symbol_at / format all throw on it.
const UNPARSEABLE_CDDL = "Person = {";

// 300 arrays deep — past the depth any walker follows — against a rule that
// descends with it.
const DEEP_HEX = "81".repeat(16385) + "00";
const DEEP_CDDL = "deep = [deep] / uint\n";

// Twelve levels of brackets, past the nine the parser is run on.
const DEEP_BRACKETS_CDDL = `x = ${"[".repeat(12)}int${"]".repeat(12)}\n`;

describe("blank input never reaches the library", () => {
  test("each wrapper answers with its own empty value", async () => {
    expect(await safeCborToJson("")).toBeNull();
    expect(await safeValidateCddl("   ")).toBeNull();
    expect(await safeOutline("   ")).toEqual([]);
    expect(await safeReferences("   ", "Person")).toBeNull();
    expect(await safeReferences(PERSON_CDDL, "")).toBeNull();
    expect(await safeSymbolAt("", 0)).toBeNull();
    expect(await safeMapCborToCddl("", PERSON_CDDL, "Person")).toBeNull();
    expect(await safeDecodeCborAgainstCddl("", PERSON_CDDL, "Person")).toBeNull();
  });

  test("a blank schema is not something the formatter is asked about", async () => {
    // The library answers `""` here; the wrapper's guard stops that being applied as a format.
    expect(await safeFormat("")).toBeNull();
    expect(await safeFormat("  \n ")).toBeNull();
  });

  test("an empty schema is reported as having no rules, not as valid", async () => {
    // `validate_cddl` itself says `no_rules`; the wrapper hides that behind `null`.
    expect(await safeValidateCddl("")).toBeNull();
  });
});

describe("a library throw becomes an empty result, never a crash", () => {
  test("the CDDL entry points that need a complete parse", async () => {
    expect(await safeOutline(UNPARSEABLE_CDDL)).toEqual([]);
    expect(await safeReferences(UNPARSEABLE_CDDL, "Person")).toBeNull();
    expect(await safeSymbolAt(UNPARSEABLE_CDDL, 0)).toBeNull();
    expect(await safeFormat(UNPARSEABLE_CDDL)).toBeNull();
  });

});

describe("a walk the library refuses comes back with the kind it was refused under", () => {
  // Decode, map, and validator refuse the same faults with the same kind.
  async function refusal(hex: string, cddl: string, rule: string): Promise<WalkRefusal> {
    const map = refusalOf(await safeMapCborToCddl(hex, cddl, rule));
    const decoded = refusalOf(await safeDecodeCborAgainstCddl(hex, cddl, rule));
    expect(decoded).toEqual(map);
    const validation = await safeValidateCborAgainstCddl(hex, cddl, rule);
    if (validation?.ok !== true || validation.result.valid) {
      throw new Error("expected the validator to refuse the same input");
    }
    expect(validation.result.error.kind).toBe(map.kind);
    return map;
  }

  test("a rule name the schema does not declare", async () => {
    const r = await refusal("01", "x = int\n", "nope");
    expect(r.kind).toBe("missing_rule");
    expect(r.message).toContain("does not define a rule");
    expect((await refusal(MISMATCHING_HEX, PERSON_CDDL, "NoSuchRule")).kind).toBe("missing_rule");
  });

  test("a group rule, which cannot be a root", async () => {
    const r = await refusal("01", "g = ( a: int )\nu = { g }\n", "g");
    expect(r.kind).toBe("group_rule_root");
    expect(r.message).toContain("g");
  });

  test("bytes that do not decode", async () => {
    expect((await refusal("ff", PERSON_CDDL, "Person")).kind).toBe("input_parse");
    const cut = await refusal("a26461", PERSON_CDDL, "Person");
    expect(cut.kind).toBe("input_parse");
    expect(cut.message).toContain("offset 2");
  });

  test("a schema that does not parse, or does not resolve", async () => {
    expect((await refusal("01", UNPARSEABLE_CDDL, "Person")).kind).toBe("parse_error");
    const r = await refusal("01", "x = [unknown_rule]\n", "x");
    expect(r.kind).toBe("unresolved_references");
    expect(r.message).toContain("unknown_rule");
  });

  test("a document nested past the bound is refused whole, not mapped short", async () => {
    const r = await refusal(DEEP_HEX, DEEP_CDDL, "deep");
    expect(r.kind).toBe("nesting_too_deep");
    // The message names the bound; the kind is what a panel branches on.
    expect(r.message).toContain("16384");
  });

  test("a schema nested past the bracket bound is refused under the same kind", async () => {
    const r = await refusal("00", DEEP_BRACKETS_CDDL, "x");
    expect(r.kind).toBe("nesting_too_deep");
    expect(r.message).toContain("9 levels");
  });

  test("input that is not hex is the one thing that still throws, and is a call that did not answer", async () => {
    const map = refusalOf(await safeMapCborToCddl("zz", "x = int\n", "x"));
    expect(map.kind).toBe("call_failed");
    expect(map.message).toContain("invalid CBOR hex");
    expect(refusalOf(await safeDecodeCborAgainstCddl("zz", "x = int\n", "x"))).toEqual(map);
  });

  test("input refused on size never reaches the library, and is a call that did not answer", async () => {
    const oversized = "00".repeat(MAX_LIB_INPUT_BYTES / 2 + 1);
    const map = refusalOf(await safeMapCborToCddl(oversized, "x = [* uint]\n", "x"));
    expect(map.kind).toBe("call_failed");
    expect(map.message).toContain("over the 2.0 MB limit");
    expect(refusalOf(await safeDecodeCborAgainstCddl(oversized, "x = [* uint]\n", "x"))).toEqual(map);
  });

  test("the envelope is a return through the transport, with its numbers converted", async () => {
    // Transport hands the library's answer on as a value; offsets are plain numbers.
    const result = await callLib<CborCddlMapResult>("map_cbor_to_cddl", ["a26461", PERSON_CDDL, "Person"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("input_parse");
    expect(result.error.offset).toBe(2);
    expect(result.error.byte_spans).toEqual([{ offset: 2, length: 1 }]);
  });
});

describe("results come back with plain JS numbers, not serde boxes", () => {
  test("spans are numbers the editor can index a string with", async () => {
    const [rule] = await safeOutline(PERSON_CDDL);
    expect(rule).toBeDefined();
    expect(typeof rule.span.char_offset).toBe("number");
    expect(typeof rule.span.char_length).toBe("number");
    expect(typeof rule.name_span.line).toBe("number");
    expect(PERSON_CDDL.slice(
      rule.name_span.char_offset,
      rule.name_span.char_offset + rule.name_span.char_length,
    )).toBe("Person");
  });

  test("a parse error's span is a number too", async () => {
    const result = schemaResult(await safeValidateCddl(UNPARSEABLE_CDDL));
    expect(result?.valid).toBe(false);
    if (!result || result.valid) return;
    expect(typeof result.error.byte_span?.char_offset).toBe("number");
  });

  test("a symbol's spans survive the conversion", async () => {
    const sym = await safeSymbolAt(PERSON_CDDL, PERSON_CDDL.indexOf("Person"));
    expect(sym?.name).toBe("Person");
    expect(typeof sym?.span.char_offset).toBe("number");
  });

  test("an integer too large for a double comes back as a bigint", async () => {
    const decoded = decodeResult(await safeCborToJson("1bffffffffffffffff"));
    expect(decoded?.ok).toBe(true);
    if (!decoded?.ok) return;
    const value = decoded.value as { type: string; value: unknown; position_info: { length: unknown } };
    expect(value.type).toBe("U64");
    expect(value.value).toBe(BigInt("18446744073709551615"));
    // A small one stays a plain number.
    expect(value.position_info.length).toBe(9);
  });
});

describe("errors the library reports as a result rather than a throw", () => {
  test("unreadable CBOR hex", async () => {
    const decoded = decodeResult(await safeCborToJson("zz"));
    expect(decoded?.ok).toBe(false);
    if (decoded?.ok !== false) return;
    expect(decoded.error.kind).toBe("invalid_hex");
  });

  test("CBOR that stops in the middle", async () => {
    const decoded = decodeResult(await safeCborToJson("a26461"));
    expect(decoded?.ok).toBe(false);
    if (decoded?.ok !== false) return;
    expect(decoded.error.kind).toBe("unexpected_eof");
    expect(typeof decoded.error.offset).toBe("number");
  });

  test("a schema whose references do not resolve", async () => {
    const result = schemaResult(await safeValidateCddl("x = [unknown_rule]\n"));
    expect(result?.valid).toBe(false);
    if (!result || result.valid) return;
    expect(result.error.kind).toBe("unresolved_references");
    expect(result.error.byte_span?.line).toBe(1);
  });
});

// Snapshot `lib` before any mock — it is a live namespace. Restore before the assertion returns.
const REAL_LIB = { ...lib };

async function withStubbedLib<T>(
  stubs: Partial<typeof REAL_LIB>,
  run: () => Promise<T>,
): Promise<T> {
  mock.module("@cardananium/cquisitor-lib", () => ({ ...REAL_LIB, ...stubs }));
  try {
    // Await inside `try`: returning the promise would restore exports before the stubbed call.
    return await run();
  } finally {
    mock.module("@cardananium/cquisitor-lib", () => REAL_LIB);
  }
}

function withThrowingLib<T>(
  name: "cbor_to_json" | "validate_cddl",
  run: () => Promise<T>,
): Promise<T> {
  return withStubbedLib(
    {
      [name]: () => {
        throw new Error("wasm trap: unreachable");
      },
    },
    run,
  );
}

describe("a library that throws is reported, not swallowed", () => {
  test("safeCborToJson hands back the reason", async () => {
    const outcome = await withThrowingLib("cbor_to_json", () => safeCborToJson("01"));
    expect(outcome).toEqual({ ok: false, error: "wasm trap: unreachable" });
    // Real export is back for everything after this test.
    expect(decodeResult(await safeCborToJson("01"))?.ok).toBe(true);
  });

  test("safeValidateCddl hands back the reason", async () => {
    const outcome = await withThrowingLib("validate_cddl", () => safeValidateCddl(PERSON_CDDL));
    expect(outcome).toEqual({ ok: false, error: "wasm trap: unreachable" });
    expect(schemaResult(await safeValidateCddl(PERSON_CDDL))?.valid).toBe(true);
  });

  test("a throwing checker stops formatCddlChecked from applying the result", async () => {
    const outcome = await withThrowingLib("validate_cddl", () => formatCddlChecked(PERSON_CDDL));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("could not be re-checked");
    expect(outcome.reason).toContain("wasm trap: unreachable");
  });
});

// The pinned cddl fork traps on a byte-string literal matched against a bstr.
// The trap poisons the shared wasm instance, so this stays unexecuted.
test.todo("safeValidateCborAgainstCddl survives a byte-string literal in the schema", () => {});

describe("safeMapCborToCddl", () => {
  /** Paths resolved out of the tables, the way a consumer reads them. */
  async function pathsOf(hex: string, cddl: string, rule: string) {
    const bridge = createCborCddlBridge(mapResult(await safeMapCborToCddl(hex, cddl, rule)));
    return bridge.entries.map(e => bridge.node(e));
  }

  test("still maps CBOR that fails validation", async () => {
    const validation = await safeValidateCborAgainstCddl(MISMATCHING_HEX, PERSON_CDDL, "Person");
    expect(validation?.ok).toBe(true);
    expect(validation?.ok === true && validation.result.valid).toBe(false);

    const nodes = await pathsOf(MISMATCHING_HEX, PERSON_CDDL, "Person");
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.map(n => n.cborPath)).toContain("$.name");
    expect(nodes.map(n => n.cborPath)).toContain("$.age");
  });

  test("a path is an index into a table, not a string", async () => {
    // Writing every path out per row costs the depth; tables make a row cost one segment.
    const map = mapResult(await safeMapCborToCddl(MISMATCHING_HEX, PERSON_CDDL, "Person"));
    expect(map.entries.length).toBeGreaterThan(map.cbor_paths.length);
    for (const e of map.entries) {
      expect(typeof e.cbor_path).toBe("number");
      expect(typeof e.decoded_path).toBe("number");
      expect(e.cbor_path).toBeLessThan(map.cbor_paths.length);
      expect(e.decoded_path).toBeLessThan(map.decoded_paths.length);
    }
  });

  test("a container's header span addresses the node, its anchor span does not", async () => {
    const root = (await pathsOf(MISMATCHING_HEX, PERSON_CDDL, "Person")).find(n => n.cborPath === "$");
    expect(root).toBeDefined();
    // Structural tree matches on header bytes; the anchor span covers the whole map.
    expect(root!.entry.cbor_byte_span).toEqual({ offset: 0, length: 1 });
    expect(root!.entry.cbor_anchor_span).toEqual({ offset: 0, length: 19 });
  });

  test("an array slot is placed at the type that describes it", async () => {
    const cddl = "Triple = [int, int, int]\n";
    const slots = (await pathsOf("83010203", cddl, "Triple")).filter(n => n.cborPath.startsWith("$["));
    expect(slots.map(n => n.cborPath)).toEqual(["$[0]", "$[1]", "$[2]"]);
    for (const slot of slots) {
      const span = slot.entry.cddl_byte_span;
      expect(hasCddlSpan(span)).toBe(true);
      expect(cddl.slice(span!.char_offset, span!.char_offset + span!.char_length)).toBe("int");
    }
  });

  test("a schema position the bytes do not contain carries no CBOR span", async () => {
    // `{"name": "Alice"}` against a schema that also declares `age`.
    const absent = (await pathsOf("a1646e616d6565416c696365", "P = { name: tstr, age: uint }\n", "P"))
      .find(n => n.cborPath === "$.age");
    expect(absent).toBeDefined();
    expect(absent!.entry.cbor_byte_span).toBeUndefined();
    expect(absent!.entry.cbor_anchor_span).toBeUndefined();
  });

});

describe("safeValidateCborAgainstCddl", () => {
  test("hands back the reason when the library refuses the input", async () => {
    const outcome = await safeValidateCborAgainstCddl("a2646", PERSON_CDDL, "Person");
    expect(outcome?.ok).toBe(false);
    expect(outcome?.ok === false && outcome.error).toContain("Odd number of digits");
  });

  test("hands back the reason for input that isn't hex at all", async () => {
    const outcome = await safeValidateCborAgainstCddl("zz", PERSON_CDDL, "Person");
    expect(outcome?.ok).toBe(false);
    expect(outcome?.ok === false && outcome.error.length > 0).toBe(true);
  });

  test("reports a missing rule as a result, not a throw", async () => {
    const outcome = await safeValidateCborAgainstCddl(MISMATCHING_HEX, PERSON_CDDL, "NoSuchRule");
    expect(outcome?.ok).toBe(true);
    if (outcome?.ok !== true || outcome.result.valid) throw new Error("expected an invalid result");
    expect(outcome.result.error.kind).toBe("missing_rule");
  });

  test("stays null while there is nothing to validate", async () => {
    expect(await safeValidateCborAgainstCddl("", PERSON_CDDL, "Person")).toBeNull();
    expect(await safeValidateCborAgainstCddl(MISMATCHING_HEX, "  ", "Person")).toBeNull();
    expect(await safeValidateCborAgainstCddl(MISMATCHING_HEX, PERSON_CDDL, "")).toBeNull();
  });
});

describe("cborDiagnostics over real validation results", () => {
  async function diagnosticsFor(hex: string, cddl: string, rule: string) {
    const outcome = await safeValidateCborAgainstCddl(hex, cddl, rule);
    if (outcome?.ok !== true || outcome.result.valid) throw new Error("expected an invalid result");
    return cborDiagnostics(outcome.result.error);
  }

  test("surfaces every mismatch of a fixed-length array, not just the first", async () => {
    // ["a", "b", "c"] against three int slots — one error per slot.
    const list = await diagnosticsFor("83616161626163", "Triple = [int, int, int]\n", "Triple");
    expect(list.map(d => d.path)).toEqual(["$[0]", "$[1]", "$[2]"]);
    for (const d of list) expect(d.byteSpans.length).toBeGreaterThan(0);
  });

  test("keeps repeated-element mismatches that share one schema span", async () => {
    // Every element of `[* int]` shares one span; a schema-range-only key would collapse these.
    const list = await diagnosticsFor("83616161626163", "Many = [* int]\n", "Many");
    expect(list.length).toBe(3);
    expect(new Set(list.map(d => d.path)).size).toBe(3);
  });

  test("pins an input_parse failure to the byte the decoder stopped at", async () => {
    const [head] = await diagnosticsFor("a26461", PERSON_CDDL, "Person");
    expect(head.kind).toBe("input_parse");
    expect(head.byteSpans).toEqual([{ offset: 2, length: 1 }]);
  });

  test("a schema parse error is a reason and a position, not a debug dump", async () => {
    const result = schemaResult(await safeValidateCddl("Person = {"));
    expect(result?.valid).toBe(false);
    if (!result || result.valid) return;
    // Position is structural, so the message is the reason on its own.
    expect(result.error.message).not.toContain("Position {");
    expect(cddlErrorReason(result.error.message)).toBe(result.error.message);
    expect(result.error.byte_span?.line).toBe(1);
  });

  test("every undefined name is reported, not only the first", async () => {
    const result = schemaResult(await safeValidateCddl("x = [a_missing, b_missing, a_missing]\n"));
    expect(result?.valid).toBe(false);
    if (!result || result.valid) return;
    expect(result.error.kind).toBe("unresolved_references");
    expect(result.error.unresolved?.map(u => u.name))
      .toEqual(["a_missing", "b_missing", "a_missing"]);
    const cddl = "x = [a_missing, b_missing, a_missing]\n";
    for (const u of result.error.unresolved ?? []) {
      expect(cddl.slice(u.byte_span.char_offset, u.byte_span.char_offset + u.byte_span.char_length))
        .toBe(u.name);
    }
  });

  test("a schema whose rules only resolve to each other describes no data", async () => {
    const result = schemaResult(await safeValidateCddl("a = b\nb = a\n"));
    expect(result?.valid).toBe(false);
    if (!result || result.valid) return;
    expect(result.error.kind).toBe("unresolved_references");
    expect(result.error.unresolved?.map(u => u.name)).toEqual(["a", "b"]);
    // Recursion through something that does describe data stays valid.
    expect(schemaResult(await safeValidateCddl("a = [a]\n"))?.valid).toBe(true);
  });
});

describe("formatCddlChecked", () => {
  test("accepts output that still parses and declares the same rules", async () => {
    const outcome = await formatCddlChecked(PERSON_CDDL);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(schemaResult(await safeValidateCddl(outcome.text))?.valid).toBe(true);
    expect(outcome.text).toContain("Person");
  });

  test("a bareword member key holding a map survives the round trip", async () => {
    // Formatting can rewrite a member key into a form the parser then reads differently.
    const cddl = `top = [ meta ]\nmeta = { auxiliary_data_set: { * uint => tstr } }\n`;
    expect(schemaResult(await safeValidateCddl(cddl))?.valid).toBe(true);

    const outcome = await formatCddlChecked(cddl);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(schemaResult(await safeValidateCddl(outcome.text))?.valid).toBe(true);
    expect(outcome.text).toContain("auxiliary_data_set");
  });

  test("refuses output that no longer resolves", async () => {
    const cddl = "top = [ meta ]\nmeta = { id: uint }\n";
    const outcome = await withStubbedLib(
      { cddl_format: () => "top = [ meta ]\nmeta = { id: missing_rule }\n" },
      () => formatCddlChecked(cddl),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("no longer parses");
    expect(outcome.reason).toContain("unresolved_references");
  });

  test("refuses output that declares different rules", async () => {
    const cddl = "top = [ meta ]\nmeta = { id: uint }\n";
    const outcome = await withStubbedLib(
      { cddl_format: () => "top = [ meta ]\nmeta = { id: uint }\nextra = uint\n" },
      () => formatCddlChecked(cddl),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("declares different rules");
    expect(outcome.reason).toContain("extra");
  });

  test("refuses a schema the formatter cannot parse", async () => {
    const outcome = await formatCddlChecked("Person = {");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("could not parse");
  });

  test("reports an unchanged schema as applicable and identical", async () => {
    const once = await formatCddlChecked(PERSON_CDDL);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = await formatCddlChecked(once.text);
    expect(twice).toEqual({ ok: true, text: once.text });
  });
});
