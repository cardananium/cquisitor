import { describe, expect, test } from "bun:test";
import type { CddlOutlineEntry } from "@cardananium/cquisitor-lib";
import { outlineOf } from "./libForTests";
import {
  candidateRootRules,
  declaredRuleNames,
  filterRuleNames,
  isParameterisedRule,
  resolveRootRule,
  retainOutline,
  rootRuleNames,
} from "./ruleSelection";

// Generic, type, group, and a type that uses both — the four shapes a rule list has to tell apart.
const SCHEMA = `set<a0> = [* a0]
Person = {
  name: tstr,
  tags: set<tstr>,
}
address = (line: tstr, zip: uint)
Company = { name: tstr, seat: address }
`;

describe("rule lists from a real outline", () => {
  test("only non-generic type rules can be a validation root", () => {
    const outline = outlineOf(SCHEMA);
    expect(outline.length).toBe(4);
    expect(rootRuleNames(outline, SCHEMA)).toEqual(["Person", "Company"]);
  });

  test("every declared name stays available for colouring references", () => {
    expect(declaredRuleNames(outlineOf(SCHEMA))).toEqual([
      "set",
      "Person",
      "address",
      "Company",
    ]);
  });

  test("a generic rule is recognised by the parameter list after its name", () => {
    const outline = outlineOf(SCHEMA);
    const byName = (n: string) => outline.find(e => e.name === n)!;
    expect(isParameterisedRule(byName("set"), SCHEMA)).toBe(true);
    expect(isParameterisedRule(byName("Person"), SCHEMA)).toBe(false);
  });

  test("an outline is classified against the text it came from", () => {
    // Spans move with the text, so a retained outline must be read against the text that produced it.
    const edited = `; a comment pushes every span along\n${SCHEMA}Other = {`;
    const kept = retainOutline({ source: SCHEMA, outline: outlineOf(SCHEMA) }, edited, []);
    expect(rootRuleNames(kept.outline, kept.source)).toEqual(["Person", "Company"]);
    expect(rootRuleNames(kept.outline, edited)).toContain("set");
  });

  test("a half-written rule has no outline at all", () => {
    expect(outlineOf("Person = {\n  name: tstr,\n  age: ")).toEqual([]);
  });

  test("a name nothing defines yet still yields the rules around it", () => {
    // Outline needs the schema to parse, not to resolve.
    expect(outlineOf("Person = [thing]").map(e => e.name)).toEqual(["Person"]);
    expect(rootRuleNames(outlineOf("Person = [thing]"), "Person = [thing]")).toEqual(["Person"]);
  });
});

describe("retainOutline", () => {
  const outline = outlineOf(SCHEMA);
  const snapshot = { source: SCHEMA, outline };

  test("keeps the last outline while the schema doesn't parse", () => {
    const midEdit = `${SCHEMA}Other = {`;
    expect(retainOutline(snapshot, midEdit, [])).toBe(snapshot);
  });

  test("takes a new outline as soon as one arrives", () => {
    const next = `${SCHEMA}Other = { id: uint }\n`;
    const nextOutline = outlineOf(next);
    const kept = retainOutline(snapshot, next, nextOutline);
    expect(kept.source).toBe(next);
    expect(rootRuleNames(kept.outline, kept.source)).toEqual(["Person", "Company", "Other"]);
  });

  test("an emptied schema drops the outline instead of keeping stale rules", () => {
    expect(retainOutline(snapshot, "   ", []).outline).toEqual([]);
  });

  test("returns the same object when nothing moved, so callers can compare by identity", () => {
    expect(retainOutline(snapshot, SCHEMA, outline)).toBe(snapshot);
  });
});

describe("resolveRootRule", () => {
  const names = ["block", "transaction", "Person"];

  test("the picked rule wins while the schema declares it", () => {
    expect(resolveRootRule(names, "transaction", "typed")).toBe("transaction");
  });

  test("falls back to the first rule when the pick is gone", () => {
    // Renaming or replacing the selected rule must not leave validation against a name the schema no longer has.
    expect(resolveRootRule(names, "Persons", "typed")).toBe("block");
  });

  test("with no rules to offer, the typed name is used, trimmed", () => {
    expect(resolveRootRule([], "Person", "  Person  ")).toBe("Person");
    expect(resolveRootRule([], "", "")).toBe("");
  });
});

describe("candidateRootRules", () => {
  // Shapes a candidate list has to sort: current rule, generic, group, each kind, unsettled, and a multi-kind choice.
  const SCHEMA = `set<a0> = [* a0]
Person = { name: tstr }
Persons = [+ Person]
address = (line: tstr)
Company = { seat: address }
Count = uint
Either = Person / Count
Open = any
Tagged = #6.24(bstr)
`;
  const outline = outlineOf(SCHEMA);

  test("offers every other root when the document's kind is not known", () => {
    expect(candidateRootRules(outline, SCHEMA, "Person", null)).toEqual([
      "Persons", "Company", "Count", "Either", "Open", "Tagged",
    ]);
  });

  test("excludes the rule the document was checked against, generics and groups", () => {
    const names = candidateRootRules(outline, SCHEMA, "Persons", null);
    expect(names).not.toContain("Persons");
    expect(names).not.toContain("set");
    expect(names).not.toContain("address");
  });

  test("an array document is never offered a map-only rule, and the reverse", () => {
    expect(candidateRootRules(outline, SCHEMA, "Person", "array")).toEqual(["Persons", "Open"]);
    expect(candidateRootRules(outline, SCHEMA, "Persons", "map")).toEqual([
      "Person", "Company", "Either", "Open",
    ]);
  });

  test("a rule whose kind the text does not settle is always kept", () => {
    for (const kind of ["array", "map", "uint", "text", "tag:24", "tag:2"]) {
      expect(candidateRootRules(outline, SCHEMA, "Person", kind)).toContain("Open");
    }
  });

  test("a choice is offered to a document of any of its kinds", () => {
    expect(candidateRootRules(outline, SCHEMA, "Persons", "uint")).toEqual(["Count", "Either", "Open"]);
  });

  test("a tag is offered only to a document under that tag", () => {
    expect(candidateRootRules(outline, SCHEMA, "Person", "tag:24")).toEqual(["Open", "Tagged"]);
    expect(candidateRootRules(outline, SCHEMA, "Person", "tag:25")).toEqual(["Open"]);
  });

  test("keeps the schema's declaration order", () => {
    const names = candidateRootRules(outline, SCHEMA, "Open", null);
    const declared = rootRuleNames(outline, SCHEMA).filter(n => n !== "Open");
    expect(names).toEqual(declared);
  });
});

describe("filterRuleNames", () => {
  const names = ["transaction", "transaction_body", "transaction_index", "block", "action"];

  test("an empty query keeps the schema's own order", () => {
    expect(filterRuleNames(names, "  ")).toBe(names);
  });

  test("exact match first, then prefixes, then anything containing the query", () => {
    expect(filterRuleNames(names, "transaction")).toEqual([
      "transaction",
      "transaction_body",
      "transaction_index",
    ]);
    expect(filterRuleNames(names, "action")).toEqual([
      "action",
      "transaction",
      "transaction_body",
      "transaction_index",
    ]);
  });

  test("matching ignores case and reports nothing when nothing matches", () => {
    expect(filterRuleNames(names, "BLOCK")).toEqual(["block"]);
    expect(filterRuleNames(names, "witness")).toEqual([]);
  });
});

describe("defensive against outline entries the library may not fill in", () => {
  test("an entry without a name span is treated as non-generic", () => {
    const entry = { name: "thing", kind: "type" } as unknown as CddlOutlineEntry;
    expect(isParameterisedRule(entry, "thing = uint")).toBe(false);
    expect(rootRuleNames([entry], "thing = uint")).toEqual(["thing"]);
  });

  test("a name repeated across entries is offered once", () => {
    const outline = outlineOf("a = uint\n");
    expect(rootRuleNames([...outline, ...outline], "a = uint\n")).toEqual(["a"]);
    expect(declaredRuleNames([...outline, ...outline])).toEqual(["a"]);
  });
});
