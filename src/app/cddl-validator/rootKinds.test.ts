import { describe, expect, test } from "bun:test";
import { CONWAY_CDDL } from "./conwaySchema";
import { CONWAY_TX_HEX, outlineOf, validateCborOf } from "./libForTests";
import { cbor_to_json } from "@cardananium/cquisitor-lib";
import { parseSerdeJson } from "@/utils/serdeNumbers";
import { PRELUDE_NAMES, cborRootKind, rootKindsAdmit, ruleRootKinds, tagNumberOf, tokenizeCddl } from "./rootKinds";
import { rootRuleNames } from "./ruleSelection";

/** Kinds `rule` admits, read from a schema parsed by the real library. */
function kindsOf(schema: string, rule: string): string[] | null {
  const outline = outlineOf(schema);
  if (outline.length === 0) throw new Error(`schema did not parse:\n${schema}`);
  const kinds = ruleRootKinds(rule, outline, schema);
  return kinds === null ? null : [...kinds].sort();
}

/** Root kind of a document, as the decoder reports it. */
function documentKind(hex: string): string | null {
  const decoded = parseSerdeJson<{ ok: boolean; value: { type: string; tag?: string } }>(
    cbor_to_json(hex),
  );
  if (!decoded.ok) throw new Error(`${hex} did not decode`);
  return cborRootKind(decoded.value);
}

describe("the kind of a decoded document", () => {
  test.each([
    ["a0", "map"],
    ["80", "array"],
    ["9f01ff", "array"],
    ["bf0102ff", "map"],
    ["60", "text"],
    ["7f6161ff", "text"],
    ["40", "bytes"],
    ["5f4101ff", "bytes"],
    ["05", "uint"],
    ["1bffffffffffffffff", "uint"],
    ["20", "nint"],
    ["3bffffffffffffffff", "nint"],
    ["f93c00", "float"],
    ["fb3ff0000000000000", "float"],
    ["f5", "bool"],
    ["f6", "null"],
    ["f7", "null"],
    ["f0", "simple"],
    ["c2420100", "tag:2"],
    ["d81843010203", "tag:24"],
    ["d9010280", "tag:258"],
    ["d87980", "tag:121"],
  ])("%s is %s", (hex, kind) => {
    expect(documentKind(hex)).toBe(kind);
  });

  test("a node type this reading does not know admits every rule", () => {
    expect(cborRootKind({ type: "Break" })).toBeNull();
    expect(cborRootKind(null)).toBeNull();
    expect(rootKindsAdmit(["array"], null)).toBe(true);
  });

  test("a tag name the decoder does not produce is a tag of unknown number", () => {
    expect(tagNumberOf("Cbor")).toBe(24);
    expect(tagNumberOf("Unassigned(1004)")).toBe(1004);
    expect(tagNumberOf("Unassigned(x)")).toBeNull();
    expect(cborRootKind({ type: "Tag", tag: "Something" })).toBe("tag");
    expect(rootKindsAdmit(["tag:24"], "tag")).toBe(true);
    expect(rootKindsAdmit(["tag"], "tag")).toBe(true);
    expect(rootKindsAdmit(["map"], "tag")).toBe(false);
  });

  test("any tag admits every numbered tag, and a number admits only itself", () => {
    expect(rootKindsAdmit(["tag"], "tag:24")).toBe(true);
    expect(rootKindsAdmit(["tag:24"], "tag:24")).toBe(true);
    expect(rootKindsAdmit(["tag:25"], "tag:24")).toBe(false);
  });
});

describe("the kinds a rule admits, read from its text", () => {
  test.each<[string, string, string[] | null]>([
    ["a map", "r = { a: int }", ["map"]],
    ["an array", "r = [ + int ]", ["array"]],
    ["a tagged type", "r = #6.24(bstr)", ["tag:24"]],
    ["a tag with no number", "r = #6", ["tag"]],
    ["a major type", "r = #2", ["bytes"]],
    ["major type 7 is left open", "r = #7", null],
    ["a bare #", "r = #", null],
    ["a text literal", 'r = "yes"', ["text"]],
    ["a hex bytes literal", "r = h'0102'", ["bytes"]],
    ["an unprefixed bytes literal", "r = 'ab'", ["bytes"]],
    ["a base64 bytes literal", "r = b64'AQI='", ["bytes"]],
    ["a positive integer", "r = 5", ["uint"]],
    ["a negative integer may be -0", "r = -5", ["nint", "uint"]],
    ["a float literal", "r = 1.5", ["float"]],
    ["an exponent literal", "r = 1e3", ["float"]],
    ["a range of literals", "r = 1..5", ["float", "nint", "uint"]],
    ["an exclusive range", "r = 0...100", ["float", "nint", "uint"]],
    ["uint", "r = uint", ["uint"]],
    ["int", "r = int", ["nint", "uint"]],
    ["number", "r = number", ["float", "nint", "uint"]],
    ["tstr", "r = tstr", ["text"]],
    ["bytes", "r = bytes", ["bytes"]],
    ["bool", "r = bool", ["bool"]],
    ["nil", "r = nil", ["null"]],
    ["biguint", "r = biguint", ["tag:2"]],
    ["a tagged name the validator also admits untagged", "r = time", ["float", "nint", "tag:1", "uint"]],
    ["tdate", "r = tdate", ["tag:0", "text"]],
    ["uri", "r = uri", ["tag:32", "text"]],
    ["b64url", "r = b64url", ["tag:33", "text"]],
    ["a tagged name the validator admits only tagged", "r = eb64url", ["tag:21"]],
    ["any", "r = any", null],
    ["undefined", "r = undefined", null],
    ["a control operator narrows but does not change the kind", "r = bstr .size 32", ["bytes"]],
    ["a control operator with a bracketed controller", "r = uint .size (1..4)", ["uint"]],
    ["a .cbor payload is still bytes", "r = bytes .cbor r2\nr2 = [int]", ["bytes"]],
    ["a choice is the union", "r = { a: int } / [ int ] / 5", ["array", "map", "uint"]],
    ["a choice with one open alternative is open", "r = { a: int } / any", null],
    ["a name resolves through the rule it names", "r = r2\nr2 = r3\nr3 = bstr .size 28", ["bytes"]],
    ["a name of a choice rule unions its alternatives", "r = r2\nr2 = int / bstr", ["bytes", "nint", "uint"]],
    ["a name nothing defines", "r = x\nr2 = [ int ]", null],
    ["a generic reference", "set<a> = [* a]\nr = set<int>", null],
    ["a group rule referenced as a type", "g = (a: int)\nr = g", null],
    ["a choice from a group", "g = (1: 2)\nr = &g", null],
    ["a parenthesised type", "r = (int / tstr)", null],
    ["an unwrap", "r2 = [int]\nr = ~r2", null],
    ["a socket", "$s /= int\nr = $s", null],
    ["a rule that has alternatives is open", "r = int\nr /= tstr", null],
    ["a rule that names itself at the head is open", "r = r / int", null],
    ["a rule whose head cycles is open", "r = r2\nr2 = r", null],
    ["a nested container does not leak its kind", "r = [ { a: int }, 1..5 ]", ["array"]],
    ["a comment holding brackets is not read", "r = [ int ] ; a comment with { and /\n", ["array"]],
    ["a string holding brackets is not read", 'r = { "a / b": int }', ["map"]],
    ["a string holding an escaped quote", 'r = { "it\\"s": int }', ["map"]],
    ["a control operator after a container", "r = [ int ] .size 1", ["array"]],
    ["a name with a dot in it is not a control operator", "a.b = int\nr = a.b", ["nint", "uint"]],
    ["a name with a dash resolves", "my-int = int\nr = my-int", ["nint", "uint"]],
    ["a tagged choice inside another rule", "r = r2 / tstr\nr2 = #6.121([int])", ["tag:121", "text"]],
  ])("%s", (_label, schema, kinds) => {
    expect(kindsOf(schema, "r")).toEqual(kinds);
  });

  test("a schema's own rule shadows the prelude name it reuses", () => {
    // The validator resolves a name against the schema before the prelude.
    expect(kindsOf("text = [ tstr ]\nr = text", "r")).toEqual(["array"]);
  });

  test("a name the outline does not declare is no rule at all", () => {
    expect(ruleRootKinds("uint", outlineOf("r = int"), "r = int")).toBeNull();
  });

  test("text this tokeniser cannot bound is left open", () => {
    expect(tokenizeCddl('r = "unterminated')).toBeNull();
    expect(tokenizeCddl("r = int ` int")).toBeNull();
    expect(kindsOf("r = #6.<x>\nx = 5", "r")).toBeNull();
  });

  test("a literal is one token whatever it holds", () => {
    expect(tokenizeCddl("'it\\'s' \"a \\\" b\" h'01 02' 0x1F")).toEqual([
      { kind: "bytes", text: "'it\\'s'" },
      { kind: "text", text: '"a \\" b"' },
      { kind: "bytes", text: "h'01 02'" },
      { kind: "number", text: "0x1F" },
    ]);
  });
});

// A rule is dropped from a sweep only when the validator would refuse the
// document at its root. Every accepting rule names that kind, or answers unknown.
describe("over-approximation against the validator", () => {
  const documents = [
    CONWAY_TX_HEX,
    "05",
    "20",
    "6161",
    "4101",
    "a0",
    "80",
    "f5",
    "f6",
    "f93c00",
    "d8798100",
    "d9010280",
    "c2420100",
  ];

  test("no rule that accepts a document is filtered out for it", () => {
    const outline = outlineOf(CONWAY_CDDL);
    const roots = rootRuleNames(outline, CONWAY_CDDL);
    expect(roots.length).toBeGreaterThan(100);
    let accepted = 0;
    let settled = 0;
    for (const rule of roots) {
      const kinds = ruleRootKinds(rule, outline, CONWAY_CDDL);
      if (kinds !== null) settled++;
      for (const hex of documents) {
        const outcome = validateCborOf(hex, CONWAY_CDDL, rule);
        if (!outcome?.ok || !outcome.result.valid) continue;
        accepted++;
        expect({ rule, hex, kinds, admits: rootKindsAdmit(kinds, documentKind(hex)) })
          .toEqual({ rule, hex, kinds, admits: true });
      }
    }
    // Vacuous unless the oracle accepted something; pointless unless most rules settled.
    expect(accepted).toBeGreaterThan(20);
    expect(settled).toBeGreaterThan(roots.length / 2);
  });

  // Prelude table vs the validator, not vs prelude definitions. Names that
  // admit an untagged item must name that item's kind.
  const preludeDocuments: Array<[string, string]> = [
    ["uint 0", "00"],
    ["uint 1363896240", "1a514b67b0"],
    ["uint max", "1bffffffffffffffff"],
    ["nint -1", "20"],
    ["nint -1363896240", "3a514b67af"],
    ["float16 1.0", "f93c00"],
    ["float32 1.0", "fa3f800000"],
    ["float64 1363896240.0", "fb41d452d9ec000000"],
    ["text a", "6161"],
    ["text empty", "60"],
    ["text rfc3339", "74323031332d30332d32315432303a30343a30305a"],
    ["text uri", "68687474703a2f2f78"],
    ["text base64url", "6459574a6a"],
    ["text mime", "7821436f6e74656e742d547970653a20746578742f706c61696e0d0a0d0a68656c6c6f"],
    ["bytes 01", "4101"],
    ["bytes empty", "40"],
    ["map {}", "a0"],
    ["array []", "80"],
    ["bool true", "f5"],
    ["bool false", "f4"],
    ["null", "f6"],
    ["undefined", "f7"],
    ["simple 16", "f0"],
    ["tag 0 rfc3339", "c074323031332d30332d32315432303a30343a30305a"],
    ["tag 1 int", "c11a514b67b0"],
    ["tag 1 float", "c1fb41d452d9ec000000"],
    ["tag 2", "c2420100"],
    ["tag 3", "c3420100"],
    ["tag 4", "c482201903e8"],
    ["tag 5", "c5822003"],
    ["tag 21", "d54101"],
    ["tag 22", "d64101"],
    ["tag 23", "d74101"],
    ["tag 24", "d8184105"],
    ["tag 32", "d82068687474703a2f2f78"],
    ["tag 33", "d8216459574a6a"],
    ["tag 34", "d8226459574a6a"],
    ["tag 35", "d8236161"],
    ["tag 36", "d8247821436f6e74656e742d547970653a20746578742f706c61696e0d0a0d0a68656c6c6f"],
    ["tag 55799", "d9d9f701"],
    ["tag 121", "d87980"],
  ];

  test("no prelude name that accepts a document is filtered out for it", () => {
    const names = [...PRELUDE_NAMES, "any", "undefined"];
    const accepted = new Map<string, string[]>();
    for (const name of names) {
      // Not the first declared rule, so the validator roots at it like any other.
      const schema = `first = { a: int }\nr = ${name}\n`;
      const outline = outlineOf(schema);
      const kinds = ruleRootKinds("r", outline, schema);
      for (const [label, hex] of preludeDocuments) {
        const outcome = validateCborOf(hex, schema, "r");
        if (!outcome?.ok || !outcome.result.valid) continue;
        const kind = documentKind(hex);
        accepted.set(name, [...(accepted.get(name) ?? []), kind ?? label]);
        expect({ name, label, kinds, admits: rootKindsAdmit(kinds, kind) }).toEqual({
          name,
          label,
          kinds,
          admits: true,
        });
      }
    }
    // Untagged kinds in the table were reached through those items.
    expect(accepted.get("time")).toEqual(expect.arrayContaining(["uint", "nint", "float", "tag:1"]));
    expect(accepted.get("tdate")).toEqual(expect.arrayContaining(["text", "tag:0"]));
    expect(accepted.get("uri")).toEqual(expect.arrayContaining(["text", "tag:32"]));
    expect(accepted.get("b64url")).toEqual(expect.arrayContaining(["text", "tag:33"]));
    // Every settled prelude name was reached through at least one document.
    for (const name of PRELUDE_NAMES) {
      expect({ name, reached: (accepted.get(name) ?? []).length > 0 }).toEqual({ name, reached: true });
    }
  });
});
