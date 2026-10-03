import { describe, expect, test } from "bun:test";
import { readAnswer, type CborDecodeResult, type CborValue } from "@cardananium/cquisitor-lib";
import { cbor_to_json } from "@cardananium/cquisitor-lib/wasm";
import type { CquisitorAnnotation } from "./store";
import {
  cborKeyMatches,
  cborMarks,
  findCborNodeByPath,
  findCborNodeBySpan,
  hexSpansFor,
  resolveCborTarget,
} from "./resolveCbor";
import { buildMarks } from "./marks";

/**
 * `{1: [h'0102', "a"], "k": 24(5), "x y": true}`:
 * 0 map · 1 key 1 · 2 array · 3 bytes · 6 "a" · 8 "k" · 10 tag 24 · 12 5 · 13 "x y" · 17 true.
 */
const HEX = "a30182420102616161" + "6bd81805" + "63782079f5";

function decode(hex: string): CborValue {
  const result = readAnswer<CborDecodeResult>("cbor_to_json", cbor_to_json(hex));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const ROOT = decode(HEX);
const BYTES = HEX.length / 2;

const span = (offset: number, length: number): CquisitorAnnotation => ({ target: { kind: "cbor_span", offset, length } });
const path = (p: string, severity?: CquisitorAnnotation["severity"]): CquisitorAnnotation => ({
  target: { kind: "cbor_path", path: p },
  ...(severity ? { severity } : {}),
});

describe("findCborNodeByPath", () => {
  test("the root path is the whole document", () => {
    const hit = findCborNodeByPath(ROOT, "$")!;
    expect(hit.node.type).toBe("Map");
    expect(hit.extent).toEqual({ offset: 0, length: BYTES });
  });

  test("an integer key in brackets, then an array index", () => {
    const arr = findCborNodeByPath(ROOT, "$[1]")!;
    expect(arr.node.type).toBe("Array");
    expect(arr.extent).toEqual({ offset: 2, length: 6 });
    expect(arr.header.offset).toBe(2);
    const bytes = findCborNodeByPath(ROOT, "$[1][0]")!;
    expect(bytes.node.type).toBe("Bytes");
    expect(bytes.extent.offset).toBe(3);
  });

  test("identifier and quoted text keys", () => {
    expect(findCborNodeByPath(ROOT, "$.k")!.node.type).toBe("Tag");
    expect(findCborNodeByPath(ROOT, '$["x y"]')!.node.type).toBe("Bool");
    expect(findCborNodeByPath(ROOT, '$["k"]')!.node.type).toBe("Tag");
  });

  test("tags are transparent below them", () => {
    // `$.k` names the tagged item; a path never steps into the tag itself.
    expect(findCborNodeByPath(ROOT, "$.k[0]")).toBeNull();
  });

  test("a bracketed index names the n-th entry when the map has no such integer key", () => {
    expect(findCborNodeByPath(ROOT, "$[2]")!.node.type).toBe("Bool");
  });

  test("a place the document lacks, or a malformed path, is null", () => {
    expect(findCborNodeByPath(ROOT, "$[1][5]")).toBeNull();
    expect(findCborNodeByPath(ROOT, "$.missing")).toBeNull();
    expect(findCborNodeByPath(ROOT, "body.fee")).toBeNull();
    expect(findCborNodeByPath(null, "$")).toBeNull();
  });
});

describe("cborKeyMatches", () => {
  test("keys of every scalar kind", () => {
    const key = (type: string, value: unknown) => ({ type, value, position_info: { offset: 0, length: 1 } }) as unknown as CborValue;
    expect(cborKeyMatches(key("U8", 2), "2")).toBe(true);
    expect(cborKeyMatches(key("I8", -1), "-1")).toBe(true);
    expect(cborKeyMatches(key("String", 'a"b'), 'a\\"b')).toBe(true);
    expect(cborKeyMatches(key("Bytes", "0102"), "h'0102'")).toBe(true);
    expect(cborKeyMatches(key("Bool", true), "true")).toBe(true);
    expect(cborKeyMatches(key("Null", null), "null")).toBe(true);
    expect(cborKeyMatches(key("String", "2"), "3")).toBe(false);
  });
});

describe("findCborNodeBySpan", () => {
  test("the narrowest node covering the whole span", () => {
    expect(findCborNodeBySpan(ROOT, { offset: 4, length: 1 })!.node.type).toBe("Bytes");
    expect(findCborNodeBySpan(ROOT, { offset: 2, length: 6 })!.node.type).toBe("Array");
    expect(findCborNodeBySpan(ROOT, { offset: 5, length: 3 })!.node.type).toBe("Array");
    expect(findCborNodeBySpan(ROOT, { offset: 0, length: BYTES })!.node.type).toBe("Map");
  });
});

describe("resolveCborTarget", () => {
  const doc = { root: ROOT, byteLength: BYTES, pending: false };

  test("a span keeps its own bytes and marks the row that holds them", () => {
    const r = resolveCborTarget(span(4, 2), doc);
    expect(r.status.state).toBe("resolved");
    expect(r.hex).toEqual({ offset: 4, length: 2 });
    expect(r.tree?.offset).toBe(3);
  });

  test("a span running past the input is cut at its end; one starting past it is not found", () => {
    expect(resolveCborTarget(span(16, 10), doc).hex).toEqual({ offset: 16, length: 2 });
    expect(resolveCborTarget(span(18, 1), doc).status.state).toBe("not_found");
  });

  test("a path lights the node's extent and its header row", () => {
    const r = resolveCborTarget(path("$[1]"), doc);
    expect(r.hex).toEqual({ offset: 2, length: 6 });
    expect(r.tree).toEqual({ offset: 2, length: 1 });
    expect(resolveCborTarget(path("$.nope"), doc).status.state).toBe("not_found");
  });

  test("while decoding, targets wait; with no input they are not found", () => {
    expect(resolveCborTarget(path("$"), { root: null, byteLength: 0, pending: true }).status.state).toBe("waiting");
    expect(resolveCborTarget(span(0, 1), { root: null, byteLength: 0, pending: true }).status.state).toBe("waiting");
    expect(resolveCborTarget(span(0, 1), { root: null, byteLength: 0, pending: false }).status.state).toBe("not_found");
  });

  test("other kinds are not shown here", () => {
    const r = resolveCborTarget({ target: { kind: "tx_path", path: "transaction.body" } }, doc);
    expect(r.status.state).toBe("unsupported");
  });
});

describe("cborMarks", () => {
  test("one hex span per distinct range, the focused one painted last", () => {
    const annotations = [path("$[1]", "warning"), span(3, 3), span(3, 3)];
    const resolutions = annotations.map((a) => resolveCborTarget(a, { root: ROOT, byteLength: BYTES, pending: false }));
    const marks = cborMarks(resolutions, annotations, 0);
    expect(marks.hexSpans.map((s) => [s.offset, s.length])).toEqual([[3, 3], [2, 6]]);
    expect(marks.hexSpans[1].className).toContain("cq-ann-focused");
    expect(marks.hexSpans[0].className).toContain("cq-ann-at-1 cq-ann-at-2");
    expect(marks.treeRows.get("2:1")).toContain("cq-ann-warning");
    expect(marks.treeOpen).toContainEqual({ offset: 2, length: 1 });
  });

  test("among unfocused spans, wider ones paint first so nested ones stay visible", () => {
    const annotations = [span(0, 2), span(0, 18), span(5, 1)];
    const spans = hexSpansFor(
      buildMarks(
        annotations.map((a, index) => ({ key: `${(a.target as { offset: number }).offset}:${(a.target as { length: number }).length}`, index })),
        annotations,
        9,
      ),
    );
    expect(spans.map((s) => s.length)).toEqual([18, 2, 1]);
  });
});
