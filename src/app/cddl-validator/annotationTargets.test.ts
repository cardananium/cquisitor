import { describe, expect, test } from "bun:test";
import { readAnswer, type CborDecodeResult, type CborValue } from "@cardananium/cquisitor-lib";
import { cbor_to_json } from "@cardananium/cquisitor-lib/wasm";
import type { CquisitorAnnotation } from "@/utils/annotations/store";
import { EMPTY_CBOR_CDDL_MAP, createCborCddlBridge } from "./cborCddlBridge";
import {
  PRIORITY_ANNOTATION,
  PRIORITY_ANNOTATION_FOCUSED,
  cddlMarks,
  findCddlRule,
  resolveCddlTarget,
  type CddlResolveInput,
} from "./annotationTargets";
import { PERSON_DOC_HEX, PERSON_RULE, PERSON_SCHEMA, mapOf, outlineOf } from "./libForTests";

function decode(hex: string): CborValue {
  const result = readAnswer<CborDecodeResult>("cbor_to_json", cbor_to_json(hex));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const OUTLINE = outlineOf(PERSON_SCHEMA);
const ROOT = decode(PERSON_DOC_HEX);

function input(over: Partial<CddlResolveInput> = {}): CddlResolveInput {
  return {
    cddl: PERSON_SCHEMA,
    outline: OUTLINE,
    outlineSource: PERSON_SCHEMA,
    hydrating: false,
    bridge: createCborCddlBridge(mapOf(PERSON_DOC_HEX, PERSON_SCHEMA, PERSON_RULE), PERSON_SCHEMA),
    cbor: { root: ROOT, byteLength: PERSON_DOC_HEX.length / 2, pending: false },
    ...over,
  };
}

const ann = (target: CquisitorAnnotation["target"], label?: string): CquisitorAnnotation => ({
  target,
  ...(label ? { label } : {}),
});

describe("findCddlRule", () => {
  test("from the outline when it addresses the text", () => {
    const found = findCddlRule("Person", PERSON_SCHEMA, OUTLINE, PERSON_SCHEMA)!;
    const at = PERSON_SCHEMA.indexOf("Person =");
    expect(found.name).toEqual([at, at + "Person".length]);
    expect(found.range[0]).toBe(at);
    expect(PERSON_SCHEMA.slice(found.range[0], found.range[1]).trimEnd().endsWith("}")).toBe(true);
  });

  const TEXT = "; header\na = int\nset<t> = [* t]\na /= tstr\nm = {\n  x => int,\n}\n";

  test("from the text when the outline is of another revision", () => {
    const found = findCddlRule("a", TEXT, [], "")!;
    expect(TEXT.slice(found.range[0], found.range[1])).toBe("a = int");
    expect(TEXT.slice(found.name[0], found.name[1])).toBe("a");
  });

  test("generic parameters and multi-line bodies", () => {
    const set = findCddlRule("set", TEXT, [], "")!;
    expect(TEXT.slice(set.range[0], set.range[1])).toBe("set<t> = [* t]");
    const m = findCddlRule("m", TEXT, [], "")!;
    expect(TEXT.slice(m.range[0], m.range[1])).toBe("m = {\n  x => int,\n}");
  });

  test("a member key is not a rule, and an unknown name is not found", () => {
    expect(findCddlRule("x", TEXT, [], "")).toBeNull();
    expect(findCddlRule("nope", TEXT, [], "")).toBeNull();
  });

  test("an extension stands in when the base definition is elsewhere", () => {
    const only = "b /= tstr\n";
    const found = findCddlRule("b", only, [], "")!;
    expect(only.slice(found.range[0], found.range[1])).toBe("b /= tstr");
  });
});

describe("resolveCddlTarget", () => {
  test("a schema range is marked as given, cut at the end of the text", () => {
    const r = resolveCddlTarget(ann({ kind: "cddl_range", start: 2, end: 9999 }), input());
    expect(r.status.state).toBe("resolved");
    expect(r.cddl).toEqual([2, PERSON_SCHEMA.length]);
    expect(r.panel).toBe("cddl");
  });

  test("a range past the text waits while a link loads, else is not found", () => {
    const target = ann({ kind: "cddl_range", start: 5000, end: 5001 });
    expect(resolveCddlTarget(target, input({ hydrating: true })).status.state).toBe("waiting");
    expect(resolveCddlTarget(target, input()).status.state).toBe("not_found");
  });

  test("a rule resolves to its definition and scrolls to its name", () => {
    const r = resolveCddlTarget(ann({ kind: "cddl_rule", name: "Person" }), input());
    const at = PERSON_SCHEMA.indexOf("Person =");
    expect(r.cddlFocus).toEqual([at, at + 6]);
    expect(resolveCddlTarget(ann({ kind: "cddl_rule", name: "Nope" }), input()).status.state).toBe("not_found");
  });

  test("a CBOR path lights every panel through the map", () => {
    const r = resolveCddlTarget(ann({ kind: "cbor_path", path: "$.age" }), input());
    expect(r.status.state).toBe("resolved");
    expect(r.hex).toEqual({ offset: 16, length: 2 });
    expect(r.tree?.offset).toBe(16);
    expect(r.decoded).toBe("$.age");
    expect(r.cddl).not.toBeNull();
    expect(PERSON_SCHEMA.slice(r.cddl![0], r.cddl![1])).toContain("uint");
    expect(r.panel).toBe("hex");
  });

  test("a byte span keeps its bytes and borrows the other panels from the node holding them", () => {
    const r = resolveCddlTarget(ann({ kind: "cbor_span", offset: 17, length: 1 }), input());
    expect(r.hex).toEqual({ offset: 17, length: 1 });
    expect(r.decoded).toBe("$.age");
  });

  test("without the map, a path still lights the hex and the tree", () => {
    const r = resolveCddlTarget(
      ann({ kind: "cbor_path", path: "$.nickname" }),
      input({ bridge: createCborCddlBridge(EMPTY_CBOR_CDDL_MAP) }),
    );
    expect(r.status.state).toBe("resolved");
    expect(r.hex).toEqual({ offset: 27, length: 4 });
    expect(r.decoded).toBeNull();
    expect(r.cddl).toBeNull();
  });

  test("a path the document lacks waits during hydration, then is not found", () => {
    const target = ann({ kind: "cbor_path", path: "$.email" });
    const empty = { bridge: createCborCddlBridge(EMPTY_CBOR_CDDL_MAP) };
    expect(resolveCddlTarget(target, input({ ...empty, hydrating: true })).status.state).toBe("waiting");
    expect(resolveCddlTarget(target, input(empty)).status.state).toBe("not_found");
  });

  test("validator kinds are not shown here", () => {
    expect(resolveCddlTarget(ann({ kind: "redeemer", tag: "Spend", index: 0 }), input()).status.state).toBe("unsupported");
  });
});

describe("cddlMarks", () => {
  test("editor marks rank above mismatches; the focused one above the rest", () => {
    const annotations = [
      ann({ kind: "cddl_rule", name: "Person" }, "the root"),
      ann({ kind: "cbor_path", path: "$.age" }),
    ];
    const resolutions = annotations.map((a) => resolveCddlTarget(a, input()));
    const marks = cddlMarks(resolutions, annotations, 1);
    const [rule, age] = marks.editor;
    expect(rule.priority).toBe(PRIORITY_ANNOTATION);
    expect(rule.message).toBe("the root");
    expect(rule.className).toContain("cq-ann-at-0");
    expect(age.priority).toBe(PRIORITY_ANNOTATION_FOCUSED);
    expect(marks.decodedRows.get("$.age")).toContain("cq-ann-focused");
    expect(marks.decodedOpen).toEqual(["$.age"]);
    expect(marks.hexSpans).toHaveLength(1);
    expect(marks.treeOpen).toHaveLength(1);
  });
});
