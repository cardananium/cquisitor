import { describe, expect, test } from "bun:test";
import type { CborValidationErrorInfo, CddlErrorInfo, SourceSpan } from "@cardananium/cquisitor-lib";
import { symbolAtOf, validateCborOf, validateCddlOf } from "./libForTests";
import {
  abbreviatePath,
  cborDiagnostics,
  cborDiagnosticsTruncated,
  cborErrorOnCddlRange,
  cddlErrorRanges,
  cddlErrorReason,
  cddlParseErrorLine,
  cddlParseErrorRange,
  cddlUnresolvedNames,
  describeDiagnostic,
  describeDiagnosticCoverage,
  groupUnresolvedNames,
  implementationLimitNote,
  isImplementationLimit,
  schemaErrorGuidance,
  hasCddlSpan,
  utf16ToByte,
  walkRefusalNotice,
} from "./cddlError";

function span(p: Partial<SourceSpan>): SourceSpan {
  return { offset: 0, length: 0, char_offset: 0, char_length: 0, line: 0, ...p };
}

function mismatch(p: Partial<CborValidationErrorInfo>): CborValidationErrorInfo {
  return { kind: "mismatch", message: "expected type int", ...p };
}

function parseError(p: Partial<CddlErrorInfo>): CddlErrorInfo {
  return { kind: "parse_error", message: "boom", ...p };
}

describe("utf16ToByte", () => {
  const encoder = new TextEncoder();
  /** What the library's own offset would be — the reference implementation. */
  const encoded = (text: string, jsIndex: number) => encoder.encode(text.slice(0, jsIndex)).length;

  test("ASCII offsets are unchanged", () => {
    const text = "Person = { name: tstr }";
    for (let i = 0; i <= text.length; i++) expect(utf16ToByte(text, i)).toBe(i);
  });

  test("counts the extra bytes of two-, three- and four-byte characters", () => {
    expect(utf16ToByte("ü", 1)).toBe(2);
    expect(utf16ToByte("€", 1)).toBe(3);
    // One emoji is two UTF-16 code units and four UTF-8 bytes.
    expect(utf16ToByte("🦀", 2)).toBe(4);
  });

  test("an index in the middle of a surrogate pair counts the whole character", () => {
    // A caret cannot land there, but a stale offset can; stay a valid byte offset.
    expect(utf16ToByte("🦀x", 1)).toBe(4);
  });

  test("agrees with a UTF-8 encoder at every character boundary of a mixed string", () => {
    const text = "; кириллица 🦀\nfoo = int\n";
    let boundaries = 0;
    for (let i = 0; i <= text.length; i++) {
      // An index splitting a surrogate pair is not a character boundary.
      const code = text.charCodeAt(i - 1);
      if (i > 0 && code >= 0xd800 && code <= 0xdbff) continue;
      expect(utf16ToByte(text, i)).toBe(encoded(text, i));
      boundaries++;
    }
    expect(boundaries).toBe(text.length);
  });

  test("an index before the text is byte 0", () => {
    expect(utf16ToByte("abc", 0)).toBe(0);
    expect(utf16ToByte("abc", -5)).toBe(0);
    expect(utf16ToByte("abc", Number.NaN)).toBe(0);
  });

  test("an index past the end stops at the end", () => {
    expect(utf16ToByte("é", 99)).toBe(2);
    expect(utf16ToByte("", 3)).toBe(0);
  });

  test("the caret's byte offset is the one the library answers to", () => {
    const text = "; кириллица 🦀\nPerson = int\n";
    const caret = text.indexOf("Person");
    expect(symbolAtOf(text, utf16ToByte(text, caret))?.name).toBe("Person");
    // Handing the raw UTF-16 index over lands somewhere else entirely.
    expect(symbolAtOf(text, caret)?.name).not.toBe("Person");
  });
});

describe("cddlParseErrorRange", () => {
  test("maps the error's span to a char range", () => {
    const range = cddlParseErrorRange(parseError({
      byte_span: span({ offset: 3, length: 4, char_offset: 3, char_length: 4, line: 1 }),
    }));
    expect(range).toEqual([3, 7]);
  });

  test("an error with no span has no range", () => {
    expect(cddlParseErrorRange(parseError({}))).toBeNull();
    expect(cddlParseErrorRange(undefined)).toBeNull();
    expect(cddlParseErrorRange(null)).toBeNull();
  });

  test("a span that cannot be a range is refused", () => {
    expect(cddlParseErrorRange(parseError({ byte_span: span({ char_offset: 8, char_length: -3 }) }))).toBeNull();
    expect(cddlParseErrorRange(parseError({ byte_span: span({ char_offset: Number.NaN }) }))).toBeNull();
  });

  test("refuses a span covering no characters rather than pointing at char 0", () => {
    expect(cddlParseErrorRange(parseError({ byte_span: span({ line: 1 }) }))).toBeNull();
    expect(cddlParseErrorRange(parseError({ byte_span: span({}) }))).toBeNull();
  });

  test("a duplicate rule is marked on the redeclaration, not on the first one", () => {
    // The offending declaration is the second one; marking the first would blame the fine rule.
    const schema = "Person = { name: tstr }\nPerson = { age: uint }\n";
    const outcome = validateCddlOf(schema);
    expect(outcome?.ok).toBe(true);
    const result = outcome?.ok ? outcome.result : null;
    expect(result?.valid).toBe(false);
    if (result && !result.valid) {
      expect(result.error.message).toContain("already defined");
      const range = cddlParseErrorRange(result.error);
      expect(range).not.toBeNull();
      expect(schema.slice(range![0], range![1])).toBe("Person = { age: uint }");
      expect(cddlParseErrorLine(result.error)).toBe(2);
    }
  });
});

describe("cddlParseErrorLine", () => {
  test("reports the line the library pinned", () => {
    expect(cddlParseErrorLine(parseError({ byte_span: span({ line: 12 }) }))).toBe(12);
  });

  test("nothing to report without a span", () => {
    expect(cddlParseErrorLine(parseError({}))).toBeNull();
    expect(cddlParseErrorLine(undefined)).toBeNull();
  });
});

describe("hasCddlSpan", () => {
  test("accepts a span that points at source", () => {
    expect(hasCddlSpan(span({ offset: 13, length: 4, char_offset: 13, char_length: 4, line: 2 }))).toBe(true);
  });

  test("accepts a span at the very start of line 1", () => {
    expect(hasCddlSpan(span({ char_length: 6, length: 6, line: 1 }))).toBe(true);
  });

  test("rejects a missing span", () => {
    // A position the library could not determine is left out of the result.
    expect(hasCddlSpan(undefined)).toBe(false);
    expect(hasCddlSpan(null)).toBe(false);
  });

  test("rejects a span covering no characters, wherever it claims to be", () => {
    // A schema-wide error still reports one; highlighting it would show nothing.
    expect(hasCddlSpan(span({}))).toBe(false);
    expect(hasCddlSpan(span({ char_offset: 40, offset: 40, line: 3 }))).toBe(false);
  });
});

describe("cddlUnresolvedNames", () => {
  test("one entry per occurrence, in source order", () => {
    const cddl = "x = [a_missing, b_missing, a_missing]\n";
    const outcome = validateCddlOf(cddl);
    const result = outcome?.ok ? outcome.result : null;
    expect(result?.valid).toBe(false);
    if (!result || result.valid) return;
    const names = cddlUnresolvedNames(result.error);
    expect(names.map(n => n.name)).toEqual(["a_missing", "b_missing", "a_missing"]);
    for (const n of names) {
      expect(cddl.slice(n.range[0], n.range[1])).toBe(n.name);
      expect(n.line).toBe(1);
    }
  });

  test("every other kind of schema error has none", () => {
    expect(cddlUnresolvedNames(parseError({ byte_span: span({ char_length: 4, line: 1 }) }))).toEqual([]);
    expect(cddlUnresolvedNames(undefined)).toEqual([]);
  });

  test("an occurrence the span walker could not place is left out", () => {
    const names = cddlUnresolvedNames(parseError({
      kind: "unresolved_references",
      unresolved: [
        { name: "placed", byte_span: span({ char_offset: 4, char_length: 6, line: 1 }) },
        { name: "unplaced", byte_span: span({ line: 1 }) },
      ],
    }));
    expect(names.map(n => n.name)).toEqual(["placed"]);
  });
});

describe("cddlErrorRanges", () => {
  test("every unresolved occurrence gets a range of its own", () => {
    const outcome = validateCddlOf("x = [a_missing, b_missing]\n");
    const result = outcome?.ok ? outcome.result : null;
    if (!result || result.valid) throw new Error("expected an invalid schema");
    expect(cddlErrorRanges(result.error)).toEqual([[5, 14], [16, 25]]);
  });

  test("any other error contributes the one range it pinned", () => {
    expect(cddlErrorRanges(parseError({
      byte_span: span({ offset: 3, length: 4, char_offset: 3, char_length: 4, line: 1 }),
    }))).toEqual([[3, 7]]);
  });

  test("an error with nothing to point at contributes nothing", () => {
    expect(cddlErrorRanges(parseError({}))).toEqual([]);
    expect(cddlErrorRanges(null)).toEqual([]);
  });
});

describe("cborErrorOnCddlRange", () => {
  test("maps a real span to a char range", () => {
    const range = cborErrorOnCddlRange(mismatch({
      cddl_byte_span: span({ offset: 32, length: 4, char_offset: 32, char_length: 4, line: 3 }),
    }));
    expect(range).toEqual([32, 36]);
  });

  test("refuses the placeholder span rather than pointing at char 0", () => {
    expect(cborErrorOnCddlRange(mismatch({ cddl_byte_span: span({}) }))).toBeNull();
    expect(cborErrorOnCddlRange(mismatch({}))).toBeNull();
  });
});

describe("cddlErrorReason", () => {
  test("drops the parser's position dump", () => {
    const raw = "parsing error: position Position { line: 1, column: 10, range: (9, 10), index: 9 }, "
      + "msg: expected one of: group_choice_op, group entry";
    expect(cddlErrorReason(raw)).toBe("expected one of: group_choice_op, group entry");
  });

  test("drops it for unresolved references too", () => {
    const raw = "parsing error: position Position { line: 1, column: 10, range: (9, 21), index: 9 }, "
      + "msg: missing definition for rule unknown_rule";
    expect(cddlErrorReason(raw)).toBe("missing definition for rule unknown_rule");
  });

  test("passes a message with no dump through unchanged", () => {
    expect(cddlErrorReason("CDDL document defines no rules")).toBe("CDDL document defines no rules");
    expect(cddlErrorReason("expected type uint, got Text(\"20\")")).toBe("expected type uint, got Text(\"20\")");
  });

  test("keeps the original when stripping would leave nothing", () => {
    const raw = "parsing error: position Position { line: 1, column: 1, range: (0, 1), index: 0 }, msg: ";
    expect(cddlErrorReason(raw)).toBe(raw.trim());
  });

  test("survives a missing message", () => {
    expect(cddlErrorReason(undefined)).toBe("");
    expect(cddlErrorReason(null)).toBe("");
  });
});

describe("cborDiagnostics", () => {
  test("returns the head error and every additional one", () => {
    const list = cborDiagnostics(mismatch({
      path: "$[0]",
      additional: [mismatch({ path: "$[1]" }), mismatch({ path: "$[2]" })],
    }));
    expect(list.map(d => d.path)).toEqual(["$[0]", "$[1]", "$[2]"]);
  });

  test("keeps errors that share a schema span but sit at different paths", () => {
    const shared = span({ offset: 7, length: 7, char_offset: 7, char_length: 7, line: 1 });
    const list = cborDiagnostics(mismatch({
      path: "$[0]",
      cddl_byte_span: shared,
      additional: [
        mismatch({ path: "$[1]", cddl_byte_span: shared }),
        mismatch({ path: "$[2]", cddl_byte_span: shared }),
      ],
    }));
    expect(list.length).toBe(3);
    expect(list.every(d => d.cddlRange?.[0] === 7)).toBe(true);
  });

  test("collapses the same failure reported once per alternative tried", () => {
    const at = span({ offset: 7, length: 7, char_offset: 7, char_length: 7, line: 1 });
    const list = cborDiagnostics(mismatch({
      path: "$.age",
      cddl_byte_span: at,
      byte_spans: [{ offset: 16, length: 3 }],
      additional: [
        mismatch({ path: "$.age", cddl_byte_span: at, byte_spans: [{ offset: 16, length: 3 }] }),
      ],
    }));
    expect(list.length).toBe(1);
  });

  test("gives an input_parse offset a one-byte span the hex view can paint", () => {
    const list = cborDiagnostics({
      kind: "input_parse",
      message: "unexpected end of CBOR input at offset 2",
      path: "$.entries[0].key",
      offset: 2,
    } as CborValidationErrorInfo);
    expect(list[0].byteSpans).toEqual([{ offset: 2, length: 1 }]);
    expect(list[0].cddlRange).toBeNull();
  });

  test("cleans the message of each entry", () => {
    const list = cborDiagnostics(mismatch({
      kind: "parse_error",
      message: "parsing error: position Position { line: 2, column: 1, range: (5, 6), index: 5 }, msg: nope",
    }));
    expect(list[0].message).toBe("nope");
  });

  test("returns nothing for a missing error", () => {
    expect(cborDiagnostics(null)).toEqual([]);
    expect(cborDiagnostics(undefined)).toEqual([]);
  });

  test("orders rows by the byte they blame, head included", () => {
    const at = (offset: number, path: string) =>
      mismatch({ path, byte_spans: [{ offset, length: 2 }] });
    const list = cborDiagnostics(mismatch({
      path: "$[9]",
      byte_spans: [{ offset: 40, length: 2 }],
      additional: [at(4, "$[1]"), at(20, "$[5]"), at(2, "$[0]")],
    }));
    expect(list.map(d => d.byteSpans[0].offset)).toEqual([2, 4, 20, 40]);
  });

  test("an alternative that failed on the container sorts after what it contains", () => {
    // Two rows for one bad field: the value, and an alternative that failed against the whole document.
    const list = cborDiagnostics(mismatch({
      path: "$[0][0]",
      byte_spans: [{ offset: 3, length: 1 }],
      anchor_spans: [{ offset: 3, length: 72 }],
      additional: [mismatch({
        path: "$",
        byte_spans: [{ offset: 0, length: 1 }],
        anchor_spans: [{ offset: 0, length: 369 }],
      })],
    }));
    expect(list.map(d => d.path)).toEqual(["$[0][0]", "$"]);
  });

  test("rows that sit side by side stay in buffer order", () => {
    // Nesting reorders rows; elements of a repeated slot contain nothing of each other.
    const at = (offset: number, path: string) =>
      mismatch({ path, byte_spans: [{ offset, length: 2 }], anchor_spans: [{ offset, length: 2 }] });
    const list = cborDiagnostics({
      ...at(9, "$[4]"),
      additional: [at(3, "$[1]"), at(15, "$[7]")],
    });
    expect(list.map(d => d.path)).toEqual(["$[1]", "$[4]", "$[7]"]);
  });

  test("a truncated hash headlines the field, not the document", () => {
    // `[h'00', 0]` against a 32-byte hash in the first slot, or a tagged set of the same.
    const cddl = "thing = [inner] / #6.258([inner])\ninner = [hash, uint]\nhash = bytes .size 32\n";
    const outcome = validateCborOf("81824100 00".replace(/\s/g, ""), cddl, "thing");
    if (outcome?.ok !== true || outcome.result.valid) throw new Error("expected a mismatch");
    const list = cborDiagnostics(outcome.result.error);
    expect(list.length).toBeGreaterThan(1);
    expect(list[0].path).toBe("$[0][0]");
    expect(list.at(-1)!.path).toBe("$");
  });

  test("falls back to the containing structure, then the path", () => {
    const anchored = (anchor: number, path: string) =>
      mismatch({ path, anchor_spans: [{ offset: anchor, length: 8 }] });
    const list = cborDiagnostics({
      ...anchored(9, "$.b"),
      additional: [anchored(3, "$.c"), anchored(9, "$.a")],
    });
    expect(list.map(d => d.path)).toEqual(["$.c", "$.a", "$.b"]);
  });

  test("rows with no position at all come last", () => {
    const list = cborDiagnostics(mismatch({
      path: "$",
      additional: [mismatch({ path: "$[0]", byte_spans: [{ offset: 1, length: 1 }] })],
    }));
    expect(list.map(d => d.path)).toEqual(["$[0]", "$"]);
  });

  test("a real run comes back in buffer order", () => {
    // 40 text strings against `[* int]`: every element fails; library order is not positional.
    const items = Array.from({ length: 40 }, (_, i) => `s${i}`);
    const hex = "9828" + items.map(s => {
      const bytes = Buffer.from(s, "utf8");
      return (0x60 + bytes.length).toString(16).padStart(2, "0") + bytes.toString("hex");
    }).join("");
    const outcome = validateCborOf(hex, "thing = [* int]", "thing");
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok || outcome.result.valid) throw new Error("expected a mismatch");
    const offsets = cborDiagnostics(outcome.result.error).map(d => d.byteSpans[0]?.offset ?? -1);
    expect(offsets.length).toBeGreaterThan(1);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});

describe("describeDiagnostic", () => {
  test("names the kind, the path and the reason", () => {
    const [d] = cborDiagnostics(mismatch({ path: "$.age", message: "expected type uint" }));
    expect(describeDiagnostic(d)).toBe("mismatch at $.age — expected type uint");
  });

  test("omits the path when the library gave none", () => {
    const [d] = cborDiagnostics(mismatch({ message: "expected type uint" }));
    expect(describeDiagnostic(d)).toBe("mismatch — expected type uint");
  });

  test("carries the expected type, which some callers show nowhere else", () => {
    // Editor marks and hex spans have only this one line.
    const [d] = cborDiagnostics(mismatch({ path: "$.age", expected: "uint", message: "found tstr" }));
    expect(describeDiagnostic(d)).toBe("mismatch at $.age (expected uint) — found tstr");
  });
});

describe("cborDiagnosticsTruncated", () => {
  test("reports what the library dropped from `additional`", () => {
    expect(cborDiagnosticsTruncated(mismatch({ additional_truncated: 199 }))).toBe(199);
  });

  test("a run the library reported whole has nothing dropped", () => {
    expect(cborDiagnosticsTruncated(mismatch({}))).toBe(0);
    expect(cborDiagnosticsTruncated(mismatch({ additional_truncated: 0 }))).toBe(0);
    expect(cborDiagnosticsTruncated(null)).toBe(0);
    expect(cborDiagnosticsTruncated(undefined)).toBe(0);
  });

  test("a value that is not a count is read as none", () => {
    expect(cborDiagnosticsTruncated(mismatch({ additional_truncated: -3 }))).toBe(0);
    expect(cborDiagnosticsTruncated(mismatch({ additional_truncated: Number.NaN }))).toBe(0);
    expect(cborDiagnosticsTruncated(mismatch({ additional_truncated: 2.7 }))).toBe(2);
  });

  test("it is read off the head error, not off a sibling", () => {
    const head = mismatch({ additional: [mismatch({ additional_truncated: 5 })] });
    expect(cborDiagnosticsTruncated(head)).toBe(0);
  });

  test("the library really does report one for a run it cut short", () => {
    // 400 elements against `[* uint]`, all of the wrong type: more than the 200 the library describes.
    const items = Array.from({ length: 400 }, () => "6161").join("");
    const outcome = validateCborOf(`990190${items}`, "Root = [* uint]", "Root");
    if (outcome?.ok !== true || outcome.result.valid) throw new Error("expected an invalid result");
    const dropped = cborDiagnosticsTruncated(outcome.result.error);
    expect(dropped).toBeGreaterThan(0);
    // What the panel would otherwise report as the whole story.
    expect(cborDiagnostics(outcome.result.error).length + dropped).toBeGreaterThan(
      cborDiagnostics(outcome.result.error).length,
    );
  });
});

describe("describeDiagnosticCoverage", () => {
  test("a run shown whole says nothing", () => {
    expect(describeDiagnosticCoverage({ shown: 3, hidden: 0, undescribed: 0 })).toBeNull();
  });

  test("the panel's own cap is named as the panel's", () => {
    expect(describeDiagnosticCoverage({ shown: 100, hidden: 101, undescribed: 0 }))
      .toBe("100 of 201 mismatches shown — 101 more the panel does not list.");
  });

  test("the validator's cap is named as the validator's", () => {
    expect(describeDiagnosticCoverage({ shown: 100, hidden: 0, undescribed: 199 }))
      .toBe("100 of 299 mismatches shown — 199 the validator counted without describing.");
  });

  test("both caps are one sentence against one total", () => {
    expect(describeDiagnosticCoverage({ shown: 100, hidden: 101, undescribed: 199 }))
      .toBe(
        "100 of 400 mismatches shown — 101 more the panel does not list,"
        + " and 199 the validator counted without describing.",
      );
  });

  test("negative counts cannot invent a cap", () => {
    expect(describeDiagnosticCoverage({ shown: 3, hidden: -1, undescribed: -2 })).toBeNull();
  });
});

describe("groupUnresolvedNames", () => {
  const at = (name: string, line: number, start: number) =>
    ({ name, line, range: [start, start + name.length] as [number, number] });

  test("one row per name, carrying every place it is used", () => {
    const groups = groupUnresolvedNames([at("coin", 1, 5), at("value", 2, 20), at("coin", 3, 40)]);
    expect(groups.map(g => g.name)).toEqual(["coin", "value"]);
    expect(groups[0].occurrences.map(o => o.line)).toEqual([1, 3]);
    expect(groups[1].occurrences.map(o => o.line)).toEqual([2]);
  });

  test("names keep the order they first appear in the source", () => {
    expect(groupUnresolvedNames([at("z", 1, 0), at("a", 2, 4), at("z", 3, 8)]).map(g => g.name))
      .toEqual(["z", "a"]);
  });

  test("nothing unresolved is no rows", () => {
    expect(groupUnresolvedNames([])).toEqual([]);
  });
});

describe("schemaErrorGuidance", () => {
  test("a schema that names undefined rules is not one that failed to parse", () => {
    const g = schemaErrorGuidance("unresolved_references", { names: 2, occurrences: 3, truncated: false });
    expect(g.summary).toContain("The schema parses.");
    expect(g.summary).toContain("2 rules that nothing in it defines");
    expect(g.summary).toContain("across 3 references");
    expect(g.nextStep).toContain("Define each name below");
    expect(g.nextStep).not.toContain("parse");
  });

  test("one name and one reference are said in the singular", () => {
    const g = schemaErrorGuidance("unresolved_references", { names: 1, occurrences: 1, truncated: false });
    expect(g.summary).toContain("1 rule that nothing in it defines");
    expect(g.summary).toContain("1 reference");
  });

  test("a truncated list says it is not the whole list", () => {
    expect(schemaErrorGuidance("unresolved_references", { names: 2, occurrences: 9, truncated: true }).summary)
      .toContain("not all of them");
  });

  test("a schema that declares nothing is not one that failed to parse either", () => {
    const g = schemaErrorGuidance("no_rules");
    expect(g.summary).toContain("The text parses.");
    expect(g.summary).toContain("declares no rules");
    expect(g.nextStep).toContain("Add a type rule");
  });

  test("a schema that failed to parse keeps the wording that is true for it", () => {
    const g = schemaErrorGuidance("parse_error");
    expect(g.summary).toBeNull();
    expect(g.nextStep).toBe("The schema has to parse before any CBOR can be checked against it.");
    // Anything the library adds later falls back to the same sentence.
    expect(schemaErrorGuidance("something_new").nextStep).toBe(g.nextStep);
  });

  test("the kinds it branches on are the kinds the library reports", () => {
    const unresolved = validateCddlOf("Person = {pet: Pet}");
    if (unresolved?.ok !== true || unresolved.result.valid) throw new Error("expected an invalid schema");
    expect(unresolved.result.error.kind).toBe("unresolved_references");

    const empty = validateCddlOf("; nothing but a comment\n");
    if (empty?.ok !== true || empty.result.valid) throw new Error("expected an invalid schema");
    expect(empty.result.error.kind).toBe("no_rules");
  });
});

describe("a refusal at a bound", () => {
  const LIMIT = "CBOR nesting is deeper than the supported limit of 16384 levels";

  test("the two limit kinds are the ones that get a note, and no other", () => {
    expect(isImplementationLimit("nesting_too_deep")).toBe(true);
    expect(isImplementationLimit("validation_too_complex")).toBe(true);
    for (const finding of ["mismatch", "input_parse", "missing_rule", "group_rule_root", "parse_error", "call_failed"]) {
      expect(isImplementationLimit(finding)).toBe(false);
      expect(implementationLimitNote(finding)).toBeNull();
    }
    expect(implementationLimitNote("nesting_too_deep")).toContain("neither confirmed nor rejected");
  });

  test("the kinds it branches on are the kinds the library reports", () => {
    // 300 arrays deep against a rule that descends with it.
    const deep = validateCborOf("81".repeat(16385) + "00", "deep = [deep] / uint\n", "deep");
    if (deep?.ok !== true || deep.result.valid) throw new Error("expected a refused run");
    expect(isImplementationLimit(deep.result.error.kind)).toBe(true);
    expect(deep.result.error.kind).toBe("nesting_too_deep");
    // The message names the bound; the note says what reaching it means.
    expect(deep.result.error.message).toContain("16384");
  });

  test("the one-line notice carries the kind, the bound and what reaching it means", () => {
    const notice = walkRefusalNotice({ kind: "nesting_too_deep", message: LIMIT }, "The mapping");
    expect(notice).toBe(
      `The mapping was refused — nesting_too_deep: ${LIMIT}. `
      + "An implementation limit, not a finding about the input: nothing past the bound"
      + " was examined, so the input is neither confirmed nor rejected.",
    );
  });

  test("a refusal that is a finding is the kind and the message alone", () => {
    expect(walkRefusalNotice({ kind: "group_rule_root", message: "CDDL rule g is a group rule" }, "The mapping"))
      .toBe("The mapping was refused — group_rule_root: CDDL rule g is a group rule.");
    // A message that already ends the sentence is not given a second stop.
    expect(walkRefusalNotice({ kind: "input_parse", message: "unexpected end of CBOR input at offset 2." }, "The mapping"))
      .toBe("The mapping was refused — input_parse: unexpected end of CBOR input at offset 2.");
  });

  test("a call that never answered is said as that, with the transport's reason", () => {
    expect(walkRefusalNotice({ kind: "call_failed", message: "This input is 6.7 MB, over the 2.0 MB limit." }, "The mapping"))
      .toBe("The mapping did not run: This input is 6.7 MB, over the 2.0 MB limit.");
  });
});

describe("abbreviatePath", () => {
  test("a path that fits is shown whole", () => {
    expect(abbreviatePath("$.body[0].outputs[3].amount")).toBe("$.body[0].outputs[3].amount");
  });

  test("a path from a deep document keeps both ends and counts the segments between", () => {
    const path = "$" + "[0]".repeat(10_000);
    const shown = abbreviatePath(path);
    expect(shown.length).toBeLessThan(140);
    expect(shown.startsWith("$[0][0]")).toBe(true);
    expect(shown.endsWith("[0][0]")).toBe(true);
    expect(shown).toContain("(10,000 segments)");
  });

  test("a tooltip names the path briefly", () => {
    const d = { kind: "mismatch", path: "$" + "[0]".repeat(10_000), message: "expected uint", expected: "uint" } as Parameters<typeof describeDiagnostic>[0];
    expect(describeDiagnostic(d).length).toBeLessThan(200);
    expect(describeDiagnostic(d)).toContain("(10,000 segments)");
  });
});
