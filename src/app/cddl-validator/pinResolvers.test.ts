import { describe, expect, test } from "bun:test";
import type {
  CborCddlMapEntry,
  CborCddlPathEntry,
  SourceSpan,
} from "@cardananium/cquisitor-lib";
import { createCborCddlBridge, type CborCddlBridge, type CborCddlNode } from "./cborCddlBridge";
import { cborDiagnostics, hasCddlSpan, type CborDiagnostic } from "./cddlError";
import { hoverEditorMark, projectLink, type HoverLink, type HoverSource } from "./hoverLink";
import { instanceSetFor, makePin, stepPin, type PinnedInstance } from "./instances";
import { mapOf, validateCborOf } from "./libForTests";
import {
  PRIORITY_ERROR,
  PRIORITY_LINKED,
  PRIORITY_MISMATCH,
  PRIORITY_MISMATCH_CURRENT,
  PRIORITY_MISMATCH_OTHER,
  PRIORITY_PINNED,
  PRIORITY_REFERENCE,
  buildEditorMarks,
  buildExtraErrorSpans,
  findNodeByCborOffset,
  findNodeByCddlOffset,
  findNodeByDecodedPath,
  linkedHexSpansForCddlOffset,
  pinMenuNotice,
  pinTargetBlockers,
  pinnedHexSpans,
  pinnedOtherHexSpans,
  projectNode,
  resolveProbe,
  ALL_PIN_TARGETS,
  type HoverProbe,
} from "./pinResolvers";

function span(p: Partial<SourceSpan>): SourceSpan {
  return { offset: 0, length: 0, char_offset: 0, char_length: 0, line: 1, ...p };
}

/** Schema span the UI is allowed to highlight (`hasCddlSpan` accepts it). */
function cddlSpan(charOffset: number, charLength: number): SourceSpan {
  return span({
    offset: charOffset,
    length: charLength,
    char_offset: charOffset,
    char_length: charLength,
    line: 1,
  });
}

/** Span covering no characters — a location that would highlight nothing. */
const EMPTY_SPAN = cddlSpan(0, 0);

/** One row as the tests write it: paths as text, rest as the library emits it. */
type EntrySpec = Omit<Partial<CborCddlMapEntry>, "cbor_path" | "decoded_path"> & {
  cborPath?: string;
  decodedPath?: string;
};

function entry(p: EntrySpec = {}): EntrySpec {
  return {
    cborPath: "$",
    decodedPath: "$",
    entry_role: "value",
    cbor_byte_span: { offset: 0, length: 1 },
    cbor_anchor_span: { offset: 0, length: 1 },
    ...p,
  };
}

/**
 * Map as the library ships it. A path that extends one already in the table
 * is stored as that row plus the added text, so the resolver's fold is used.
 */
function pathTable() {
  const rows: CborCddlPathEntry[] = [];
  const resolved: string[] = [];
  return {
    rows,
    intern(path: string): number {
      const already = resolved.indexOf(path);
      if (already >= 0) return already;
      let prefix: number | undefined;
      let shared = 0;
      for (let i = 0; i < resolved.length; i++) {
        if (path.startsWith(resolved[i]) && resolved[i].length > shared) {
          shared = resolved[i].length;
          prefix = i;
        }
      }
      rows.push(prefix === undefined ? { suffix: path } : { prefix, suffix: path.slice(shared) });
      resolved.push(path);
      return rows.length - 1;
    },
  };
}

function bridgeOf(specs: EntrySpec[]): CborCddlBridge {
  const cbor = pathTable();
  const decoded = pathTable();
  const entries: CborCddlMapEntry[] = specs.map(({ cborPath, decodedPath, ...rest }) => ({
    entry_role: "value",
    ...rest,
    cbor_path: cbor.intern(cborPath ?? "$"),
    decoded_path: decoded.intern(decodedPath ?? "$"),
  }));
  return createCborCddlBridge({
    cbor_paths: cbor.rows,
    decoded_paths: decoded.rows,
    entries,
  });
}

/** Single node of a one-row bridge. */
function nodeOf(spec: EntrySpec): CborCddlNode {
  const bridge = bridgeOf([spec]);
  return bridge.node(bridge.entries[0]);
}

/** Link the hover store would hold for `node`. */
function linkOf(node: CborCddlNode, source: HoverSource = "tree", cddlSource = ""): HoverLink {
  const bridge = bridgeOf([]);
  const set = instanceSetFor(bridge, node, source);
  return {
    source,
    node,
    cddlSource,
    projection: projectLink(bridge, node, set),
    instances: set.instances,
    instanceIndex: set.index,
  };
}

/** Pin of `node` alone — a group of one. */
function pinOf(node: CborCddlNode, source: HoverSource = "hex"): PinnedInstance {
  return makePin(bridgeOf([]), node, source);
}

function diagnostic(p: Partial<CborDiagnostic>): CborDiagnostic {
  return {
    kind: "mismatch",
    message: "expected type uint",
    expected: null,
    path: null,
    cddlRange: null,
    byteSpans: [],
    anchorSpans: [],
    ...p,
  };
}

describe("findNodeByCborOffset", () => {
  const map = entry({ cborPath: "$", cbor_anchor_span: { offset: 0, length: 19 } });
  const value = entry({ cborPath: "$.age", cbor_anchor_span: { offset: 16, length: 3 } });

  test("the narrowest structure covering the byte wins", () => {
    expect(findNodeByCborOffset(bridgeOf([map, value]), 17)?.cborPath).toBe("$.age");
    expect(findNodeByCborOffset(bridgeOf([value, map]), 17)?.cborPath).toBe("$.age");
  });

  test("falls back to the container when nothing narrower covers the byte", () => {
    expect(findNodeByCborOffset(bridgeOf([map, value]), 3)?.cborPath).toBe("$");
  });

  test("the last byte of a span is inside it, the one after is not", () => {
    expect(findNodeByCborOffset(bridgeOf([value]), 18)?.cborPath).toBe("$.age");
    expect(findNodeByCborOffset(bridgeOf([value]), 19)).toBeNull();
  });

  test("an empty map resolves to nothing", () => {
    expect(findNodeByCborOffset(bridgeOf([]), 0)).toBeNull();
  });

  test("a row for a schema position the bytes do not contain covers nothing", () => {
    // No CBOR span — the decoder renders `null`, and there is nothing to click.
    const absent = entry({
      cborPath: "$.age",
      cbor_byte_span: undefined,
      cbor_anchor_span: undefined,
    });
    expect(findNodeByCborOffset(bridgeOf([absent]), 0)).toBeNull();
  });

  test("equal-width candidates keep the library's own order", () => {
    const first = entry({ cborPath: "$.a", cbor_anchor_span: { offset: 4, length: 2 } });
    const second = entry({ cborPath: "$.b", cbor_anchor_span: { offset: 4, length: 2 } });
    expect(findNodeByCborOffset(bridgeOf([first, second]), 4)?.cborPath).toBe("$.a");
  });
});

describe("findNodeByCddlOffset", () => {
  test("the narrowest schema span covering the character wins", () => {
    const rule = entry({ cborPath: "$", cddl_byte_span: cddlSpan(0, 40) });
    const member = entry({ cborPath: "$.age", cddl_byte_span: cddlSpan(20, 9) });
    expect(findNodeByCddlOffset(bridgeOf([rule, member]), 22)?.cborPath).toBe("$.age");
  });

  test("rows with no schema span are not candidates", () => {
    const wrapper = entry({ cborPath: "$", cbor_type: "map_entries" });
    expect(findNodeByCddlOffset(bridgeOf([wrapper]), 0)).toBeNull();
  });

  test("a span covering no characters is not a location", () => {
    const bare = entry({ cborPath: "$[0]", cddl_byte_span: EMPTY_SPAN });
    expect(findNodeByCddlOffset(bridgeOf([bare]), 0)).toBeNull();
  });

  test("an offset outside every span resolves to nothing", () => {
    const member = entry({ cddl_byte_span: cddlSpan(20, 9) });
    expect(findNodeByCddlOffset(bridgeOf([member]), 19)).toBeNull();
    expect(findNodeByCddlOffset(bridgeOf([member]), 29)).toBeNull();
  });
});

describe("findNodeByDecodedPath", () => {
  test("a numeric map key and an array index address the same segment", () => {
    const row = entry({ cborPath: "$[0]", decodedPath: '$.m["0"]' });
    expect(findNodeByDecodedPath(bridgeOf([row]), "$.m[0]")?.decodedPath).toBe('$.m["0"]');
    const arrayRow = entry({ cborPath: "$[0]", decodedPath: "$.m[0]" });
    expect(findNodeByDecodedPath(bridgeOf([arrayRow]), '$.m["0"]')?.decodedPath).toBe("$.m[0]");
  });

  test("the clicked role wins when the library emitted both", () => {
    const key = entry({ decodedPath: "$.age", entry_role: "key" });
    const value = entry({ decodedPath: "$.age", entry_role: "value" });
    const bridge = bridgeOf([key, value]);
    expect(findNodeByDecodedPath(bridge, "$.age", "key")?.entry).toBe(bridge.entries[0]);
    expect(findNodeByDecodedPath(bridge, "$.age", "value")?.entry).toBe(bridge.entries[1]);
  });

  test("falls back to the other role when only one was emitted", () => {
    const bridge = bridgeOf([entry({ decodedPath: "$[0]", entry_role: "value" })]);
    expect(findNodeByDecodedPath(bridge, "$[0]", "key")?.entry).toBe(bridge.entries[0]);
  });

  test("a synthetic decoder path resolves to its deepest real ancestor", () => {
    const bridge = bridgeOf([
      entry({ cborPath: "$", decodedPath: "$" }),
      entry({ cborPath: "$.m", decodedPath: "$.m" }),
      entry({ cborPath: "$.other", decodedPath: "$.other" }),
    ]);
    const found = findNodeByDecodedPath(bridge, '$.m["@entries"][1].key');
    expect(found?.entry).toBe(bridge.entries[1]);
  });

  test("the standing-in ancestor is its value row, not its key row", () => {
    const bridge = bridgeOf([
      entry({ cborPath: "$.m", decodedPath: "$.m", entry_role: "key" }),
      entry({ cborPath: "$.m", decodedPath: "$.m", entry_role: "value" }),
    ]);
    expect(findNodeByDecodedPath(bridge, '$.m["@entries"][0]["value"]')?.entry)
      .toBe(bridge.entries[1]);
  });

  test("an unrelated path resolves to nothing", () => {
    expect(findNodeByDecodedPath(bridgeOf([entry({ decodedPath: "$.m" })]), "$.other.deep")).toBeNull();
    expect(findNodeByDecodedPath(bridgeOf([]), "$.m")).toBeNull();
  });
});

describe("linkedHexSpansForCddlOffset", () => {
  test("only the entries with the narrowest schema span at that character", () => {
    const rule = entry({ cborPath: "$", cddl_byte_span: cddlSpan(0, 40), cbor_anchor_span: { offset: 0, length: 19 } });
    const member = entry({ cborPath: "$.age", cddl_byte_span: cddlSpan(20, 9), cbor_anchor_span: { offset: 16, length: 3 } });
    const spans = linkedHexSpansForCddlOffset(bridgeOf([rule, member]), 22);
    expect(spans).toEqual([{ offset: 16, length: 3, message: "node value at $.age" }]);
  });

  test("collapses repeats of one byte range and role", () => {
    const at = cddlSpan(20, 9);
    const rows = [
      entry({ cborPath: "$.age", cddl_byte_span: at, cbor_anchor_span: { offset: 16, length: 3 } }),
      entry({ cborPath: "$.age", cddl_byte_span: at, cbor_anchor_span: { offset: 16, length: 3 } }),
    ];
    expect(linkedHexSpansForCddlOffset(bridgeOf(rows), 22).length).toBe(1);
  });

  test("keeps the key and the value of one map entry apart", () => {
    const at = cddlSpan(20, 9);
    const rows = [
      entry({ cborPath: "$.age", entry_role: "key", cddl_byte_span: at, cbor_anchor_span: { offset: 12, length: 4 } }),
      entry({ cborPath: "$.age", entry_role: "value", cddl_byte_span: at, cbor_anchor_span: { offset: 12, length: 4 } }),
    ];
    const spans = linkedHexSpansForCddlOffset(bridgeOf(rows), 20);
    expect(spans.map(s => s.message)).toEqual(["node key at $.age", "node value at $.age"]);
  });

  test("a schema position the bytes do not contain lights up nothing", () => {
    const absent = entry({
      cborPath: "$.age",
      cddl_byte_span: cddlSpan(20, 9),
      cbor_byte_span: undefined,
      cbor_anchor_span: undefined,
    });
    expect(linkedHexSpansForCddlOffset(bridgeOf([absent]), 22)).toEqual([]);
  });

  test("nothing at that character means no highlight", () => {
    expect(linkedHexSpansForCddlOffset(bridgeOf([entry({ cddl_byte_span: cddlSpan(20, 9) })]), 5)).toEqual([]);
    expect(linkedHexSpansForCddlOffset(bridgeOf([]), 0)).toEqual([]);
  });
});

describe("pinnedHexSpans", () => {
  test("paints the pinned node's whole extent; a group of one says no position", () => {
    const pinned = pinOf(nodeOf(entry({ cborPath: "$.age", cbor_type: "U8", cbor_anchor_span: { offset: 16, length: 3 } })));
    expect(pinnedHexSpans(pinned, true)).toEqual([
      { offset: 16, length: 3, message: "Pinned: U8 at $.age" },
    ]);
  });

  test("a pinned schema position the bytes do not contain paints nothing", () => {
    const pinned = pinOf(nodeOf(entry({ cborPath: "$.age", cbor_byte_span: undefined, cbor_anchor_span: undefined })));
    expect(pinnedHexSpans(pinned, true)).toEqual([]);
  });

  test("stays empty when the hex panel is not a chosen target", () => {
    expect(pinnedHexSpans(pinOf(nodeOf(entry())), false)).toEqual([]);
    expect(pinnedHexSpans(null, true)).toEqual([]);
  });
});

describe("projectNode", () => {
  test("each panel gets the span it addresses a node by", () => {
    const node = nodeOf(entry({
      cborPath: "$.age",
      decodedPath: "$.age",
      cbor_type: "U8",
      entry_role: "key",
      cbor_byte_span: { offset: 12, length: 4 },
      cbor_anchor_span: { offset: 12, length: 7 },
      cddl_byte_span: cddlSpan(20, 9),
      rule_name: "age_t",
    }));
    expect(projectNode(node)).toEqual({
      cddl: [20, 29],
      hex: { offset: 12, length: 7 },
      tree: { offset: 12, length: 4 },
      decoded: "$.age",
      label: "U8 key at $.age (rule: age_t)",
    });
  });

  test("a decoder wrapper row has no schema span to project", () => {
    const wrapper = projectNode(nodeOf(entry({ cbor_type: "map_entries" })));
    expect(wrapper.cddl).toBeNull();
    expect(wrapper.hex).not.toBeNull();
    expect(projectNode(nodeOf(entry({ cddl_byte_span: EMPTY_SPAN }))).cddl).toBeNull();
  });

  test("a member the bytes omit has no bytes to project", () => {
    const missing = projectNode(nodeOf(entry({
      cddl_byte_span: cddlSpan(22, 3),
      cbor_byte_span: undefined,
      cbor_anchor_span: undefined,
    })));
    expect(missing.hex).toBeNull();
    expect(missing.tree).toBeNull();
    expect(missing.cddl).toEqual([22, 25]);
  });

  test("the label names the rule only when one matched", () => {
    expect(projectNode(nodeOf(entry({ cborPath: "$[0]", cbor_type: "Bytes" }))).label)
      .toBe("Bytes value at $[0]");
  });
});

describe("resolveProbe", () => {
  test("an exact-length tree position picks the node over its container", () => {
    const container = entry({
      cborPath: "$",
      cbor_byte_span: { offset: 0, length: 1 },
      cbor_anchor_span: { offset: 0, length: 19 },
      cddl_byte_span: cddlSpan(0, 40),
    });
    const scalar = entry({
      cborPath: "$.name",
      cbor_byte_span: { offset: 0, length: 6 },
      cbor_anchor_span: { offset: 0, length: 6 },
      cddl_byte_span: cddlSpan(14, 10),
    });
    const bridge = bridgeOf([container, scalar]);
    const node = resolveProbe(bridge, { source: "tree", position: { offset: 0, length: 6 } });
    expect(node?.cborPath).toBe("$.name");
    expect(projectNode(node!).cddl).toEqual([14, 24]);
  });

  test("the narrowest node at a tree position wins", () => {
    const container = entry({
      cbor_byte_span: { offset: 4, length: 1 },
      cbor_anchor_span: { offset: 4, length: 12 },
      cddl_byte_span: cddlSpan(0, 40),
    });
    const inner = entry({
      cbor_byte_span: { offset: 4, length: 1 },
      cbor_anchor_span: { offset: 4, length: 3 },
      cddl_byte_span: cddlSpan(20, 9),
    });
    const node = resolveProbe(bridgeOf([container, inner]), { source: "tree", position: { offset: 4, length: 99 } });
    expect(projectNode(node!).cddl).toEqual([20, 29]);
  });

  test("a row with no usable schema span still resolves, and projects no range", () => {
    const wrapper = entry({ cbor_byte_span: { offset: 4, length: 1 }, cbor_anchor_span: { offset: 4, length: 1 } });
    const empty = entry({
      cbor_byte_span: { offset: 4, length: 1 },
      cbor_anchor_span: { offset: 4, length: 1 },
      cddl_byte_span: EMPTY_SPAN,
    });
    const node = resolveProbe(bridgeOf([wrapper, empty]), { source: "hex", byteOffset: 4 });
    expect(node).not.toBeNull();
    expect(projectNode(node!).cddl).toBeNull();
    expect(hoverEditorMark(linkOf(node!), "")).toBeNull();
  });

  test("the editor's tooltip names the rule that matched", () => {
    const row = entry({
      cborPath: "$.age",
      cbor_type: "U8",
      entry_role: "key",
      cbor_byte_span: { offset: 4, length: 1 },
      cbor_anchor_span: { offset: 4, length: 1 },
      cddl_byte_span: cddlSpan(20, 9),
      rule_name: "age_t",
    });
    const node = resolveProbe(bridgeOf([row]), { source: "tree", position: { offset: 4, length: 1 } });
    expect(hoverEditorMark(linkOf(node!), "")?.message).toBe("U8 key at $.age (rule: age_t)");
  });

  test("an empty bridge resolves nothing from any panel", () => {
    const empty = bridgeOf([]);
    const probes: HoverProbe[] = [
      { source: "hex", byteOffset: 0 },
      { source: "tree", position: { offset: 0, length: 1 } },
      { source: "cddl", charOffset: 0 },
      { source: "decoded", path: "$", role: "value" },
    ];
    for (const probe of probes) expect(resolveProbe(empty, probe)).toBeNull();
  });
});

describe("buildEditorMarks", () => {
  const base = {
    schemaError: null,
    diagnostics: [],
    selectedDiagnostic: null,
    referenceRanges: [],
    pinnedNode: null,
    pinInCddl: true,
  } as const;

  test("ranks the pin over errors, errors over mismatches, mismatches over hover", () => {
    const marks = buildEditorMarks({
      ...base,
      schemaError: { ranges: [[0, 4]], message: "boom" },
      diagnostics: [diagnostic({ cddlRange: [10, 14] })],
      referenceRanges: [[30, 34]],
      pinnedNode: nodeOf(entry({ cddl_byte_span: cddlSpan(40, 4) })),
    });
    const hover = hoverEditorMark(linkOf(nodeOf(entry({ cddl_byte_span: cddlSpan(20, 4) }))), "");
    const byClass = new Map([...marks, hover!].map(m => [m.className, m.priority]));
    expect(byClass.get("cddl-editor-pinned-mark")).toBe(PRIORITY_PINNED);
    expect(byClass.get("cddl-editor-error-mark")).toBe(PRIORITY_ERROR);
    expect(byClass.get("cddl-editor-mismatch-mark")).toBe(PRIORITY_MISMATCH);
    expect(byClass.get("cddl-editor-linked-mark")).toBe(PRIORITY_LINKED);
    expect(byClass.get("cddl-editor-reference-mark")).toBe(PRIORITY_REFERENCE);
    expect(PRIORITY_PINNED > PRIORITY_ERROR).toBe(true);
    expect(PRIORITY_ERROR > PRIORITY_MISMATCH_CURRENT).toBe(true);
    expect(PRIORITY_MISMATCH_CURRENT > PRIORITY_MISMATCH).toBe(true);
    expect(PRIORITY_MISMATCH > PRIORITY_MISMATCH_OTHER).toBe(true);
    expect(PRIORITY_MISMATCH_OTHER > PRIORITY_LINKED).toBe(true);
    expect(PRIORITY_LINKED > PRIORITY_REFERENCE).toBe(true);
  });

  test("every mismatch with a schema span gets a mark", () => {
    const marks = buildEditorMarks({
      ...base,
      diagnostics: [
        diagnostic({ path: "$[0]", cddlRange: [10, 14] }),
        diagnostic({ path: "$[1]", cddlRange: [20, 24] }),
        diagnostic({ path: "$[2]", cddlRange: null }),
      ],
    });
    expect(marks.map(m => m.range)).toEqual([[10, 14], [20, 24]]);
  });

  test("a schema span several mismatches share is marked once", () => {
    const marks = buildEditorMarks({
      ...base,
      diagnostics: [
        diagnostic({ path: "$[0]", cddlRange: [10, 14] }),
        diagnostic({ path: "$[1]", cddlRange: [10, 14] }),
      ],
    });
    expect(marks.length).toBe(1);
    expect(marks[0].priority).toBe(PRIORITY_MISMATCH);
  });

  test("the selected mismatch is marked even where another already is", () => {
    const marks = buildEditorMarks({
      ...base,
      diagnostics: [
        diagnostic({ path: "$[0]", cddlRange: [10, 14] }),
        diagnostic({ path: "$[1]", cddlRange: [10, 14] }),
      ],
      selectedDiagnostic: 1,
    });
    expect(marks.length).toBe(2);
    expect(marks[1].priority).toBe(PRIORITY_MISMATCH_CURRENT);
    expect(marks[1].message).toContain("$[1]");
  });

  test("mismatches after the first sit below it unless selected", () => {
    const marks = buildEditorMarks({
      ...base,
      diagnostics: [
        diagnostic({ path: "$[0]", cddlRange: [10, 14] }),
        diagnostic({ path: "$[1]", cddlRange: [20, 24] }),
      ],
    });
    expect(marks.map(m => m.priority)).toEqual([PRIORITY_MISMATCH, PRIORITY_MISMATCH_OTHER]);
  });

  test("no pin mark when the editor is not a chosen target", () => {
    const marks = buildEditorMarks({
      ...base,
      pinnedNode: nodeOf(entry({ cddl_byte_span: cddlSpan(40, 4) })),
      pinInCddl: false,
    });
    expect(marks).toEqual([]);
  });

  test("no pin mark for a row the library gave no schema span", () => {
    expect(buildEditorMarks({ ...base, pinnedNode: nodeOf(entry()) })).toEqual([]);
    expect(buildEditorMarks({ ...base, pinnedNode: nodeOf(entry({ cddl_byte_span: EMPTY_SPAN })) })).toEqual([]);
  });

  test("an unresolved reference is marked at every occurrence, not just the first", () => {
    const marks = buildEditorMarks({
      ...base,
      schemaError: { ranges: [[5, 17], [19, 32], [34, 46]], message: "missing definition for rule coin" },
    });
    expect(marks.map(m => m.range)).toEqual([[5, 17], [19, 32], [34, 46]]);
    expect(marks.every(m => m.priority === PRIORITY_ERROR)).toBe(true);
  });

  test("nothing to show produces no marks at all", () => {
    expect(buildEditorMarks({ ...base })).toEqual([]);
  });
});

describe("buildExtraErrorSpans", () => {
  test("a selected failure's own bytes come before the structure around them", () => {
    const spans = buildExtraErrorSpans([
      diagnostic({
        path: "$.age",
        byteSpans: [{ offset: 16, length: 3 }],
        anchorSpans: [{ offset: 0, length: 19 }],
      }),
    ], 0);
    expect(spans.map(s => s.offset)).toEqual([16, 0]);
    expect(spans[0].message).toBe("mismatch at $.age — expected type uint");
  });

  test("with nothing selected, a container is not painted along with its contents", () => {
    // Root-rule alternative anchors on the whole buffer; unioning that paints every byte.
    const spans = buildExtraErrorSpans([
      diagnostic({ path: "$[0][0]", byteSpans: [{ offset: 3, length: 1 }], anchorSpans: [{ offset: 3, length: 72 }] }),
      diagnostic({ path: "$", byteSpans: [{ offset: 0, length: 1 }], anchorSpans: [{ offset: 0, length: 369 }] }),
    ]);
    expect(spans.map(s => [s.offset, s.length])).toEqual([[3, 1], [0, 1]]);
  });

  test("selecting a row paints that row and nothing else", () => {
    const diagnostics = [
      diagnostic({ path: "$[0][0]", byteSpans: [{ offset: 3, length: 1 }], anchorSpans: [{ offset: 3, length: 72 }] }),
      diagnostic({ path: "$", byteSpans: [{ offset: 0, length: 1 }], anchorSpans: [{ offset: 0, length: 369 }] }),
    ];
    expect(buildExtraErrorSpans(diagnostics, 0).map(s => [s.offset, s.length]))
      .toEqual([[3, 1], [3, 72]]);
    expect(buildExtraErrorSpans(diagnostics, 1).map(s => [s.offset, s.length]))
      .toEqual([[0, 1], [0, 369]]);
  });

  test("a row that named no bytes of its own still reaches the hex", () => {
    const spans = buildExtraErrorSpans([
      diagnostic({ path: "$.a", anchorSpans: [{ offset: 4, length: 6 }] }),
    ]);
    expect(spans.map(s => s.offset)).toEqual([4]);
  });

  test("an out-of-range selection falls back to painting every row", () => {
    const diagnostics = [
      diagnostic({ path: "$.a", byteSpans: [{ offset: 1, length: 1 }] }),
      diagnostic({ path: "$.b", byteSpans: [{ offset: 2, length: 1 }] }),
    ];
    expect(buildExtraErrorSpans(diagnostics, 7).map(s => s.offset)).toEqual([1, 2]);
  });

  test("a byte range reported by several mismatches is painted once", () => {
    const spans = buildExtraErrorSpans([
      diagnostic({ path: "$.age", byteSpans: [{ offset: 16, length: 3 }] }),
      diagnostic({ path: "$.age", byteSpans: [{ offset: 16, length: 3 }] }),
    ]);
    expect(spans.length).toBe(1);
  });

  test("a diagnostic with no position contributes nothing", () => {
    expect(buildExtraErrorSpans([diagnostic({})])).toEqual([]);
    expect(buildExtraErrorSpans([])).toEqual([]);
  });
});

// Resolvers over real `map_cbor_to_cddl` / validation output.
describe("pinTargetBlockers", () => {
  test("a row with both sides can be mirrored everywhere", () => {
    const blockers = pinTargetBlockers(nodeOf(entry({ cddl_byte_span: cddlSpan(4, 4) })));
    for (const t of ALL_PIN_TARGETS) expect(blockers[t]).toBeNull();
  });

  test("a row the bytes do not contain reaches the schema and the decoded JSON only", () => {
    // Required member the input omits: schema span, no CBOR span.
    const blockers = pinTargetBlockers(nodeOf(entry({
      cborPath: "$.age",
      decodedPath: "$.age",
      cddl_byte_span: cddlSpan(22, 3),
      cbor_byte_span: undefined,
      cbor_anchor_span: undefined,
    })));
    expect(blockers.cddl).toBeNull();
    expect(blockers.decoded).toBeNull();
    expect(blockers.hex).toContain("no bytes to point at");
    expect(blockers.tree).toContain("no bytes to point at");
  });

  test("a decoder wrapper row reaches every panel but the schema", () => {
    const blockers = pinTargetBlockers(nodeOf(entry({ cddl_byte_span: undefined })));
    expect(blockers.cddl).toContain("decoder wrapper");
    expect(blockers.hex).toBeNull();
    expect(blockers.tree).toBeNull();
    expect(blockers.decoded).toBeNull();
  });

  test("a schema span covering no characters is not a location", () => {
    expect(pinTargetBlockers(nodeOf(entry({ cddl_byte_span: EMPTY_SPAN }))).cddl).not.toBeNull();
  });

  test("nothing pinned blocks every target", () => {
    const blockers = pinTargetBlockers(null);
    for (const t of ALL_PIN_TARGETS) expect(blockers[t]).not.toBeNull();
  });

  test("what each panel needs is what that panel actually reads", () => {
    // Hex paints the anchor; tree points at the header. Each is blocked only when its own span is missing.
    const noAnchor = nodeOf(entry({ cddl_byte_span: cddlSpan(4, 4), cbor_anchor_span: undefined }));
    expect(pinnedHexSpans(pinOf(noAnchor), true)).toEqual([]);
    expect(pinTargetBlockers(noAnchor).hex).not.toBeNull();
    expect(pinTargetBlockers(noAnchor).tree).toBeNull();

    const noHeader = nodeOf(entry({ cddl_byte_span: cddlSpan(4, 4), cbor_byte_span: undefined }));
    expect(pinnedHexSpans(pinOf(noHeader), true).length).toBe(1);
    expect(pinTargetBlockers(noHeader).hex).toBeNull();
    expect(pinTargetBlockers(noHeader).tree).not.toBeNull();
  });
});

describe("over real library output", () => {
  const PERSON_CDDL = "Person = {\n  name: tstr,\n  age: uint,\n}\n";
  // {"name": "Alice", "age": "20"} — `age` is a text string, not a uint.
  const PERSON_HEX = "a2646e616d6565416c69636563616765623230";

  const personBridge = () =>
    createCborCddlBridge(mapOf(PERSON_HEX, PERSON_CDDL, "Person"));

  /** Value row, found by path the way the panels do. */
  function valueRowOf(bridge: CborCddlBridge, path: string): CborCddlNode {
    const node = bridge.entries
      .map(e => bridge.node(e))
      .find(n => n.cborPath === path && n.entry.entry_role === "value");
    expect(node).toBeDefined();
    return node!;
  }

  test("a byte inside the age value resolves to that member", () => {
    const bridge = personBridge();
    const inside = valueRowOf(bridge, "$.age").entry.cbor_anchor_span!.offset;
    expect(findNodeByCborOffset(bridge, inside)?.cborPath).toBe("$.age");
  });

  test("a character inside the `age: uint` declaration links back to its bytes", () => {
    const bridge = personBridge();
    const declaration = PERSON_CDDL.indexOf("age: uint") + 1;
    expect(findNodeByCddlOffset(bridge, declaration)?.cborPath).toBe("$.age");
    const spans = linkedHexSpansForCddlOffset(bridge, declaration);
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) expect(s.length).toBeGreaterThan(0);
  });

  test("the decoded-JSON path the tree renders finds the same entry", () => {
    const bridge = personBridge();
    const ageValue = valueRowOf(bridge, "$.age");
    expect(findNodeByDecodedPath(bridge, ageValue.decodedPath, "value")?.entry)
      .toBe(ageValue.entry);
  });

  test("hovering a decoded node's header bytes highlights its declaration", () => {
    const bridge = personBridge();
    const node = resolveProbe(bridge, { source: "tree", position: valueRowOf(bridge, "$.name").entry.cbor_byte_span! });
    const range = projectNode(node!).cddl;
    expect(range).not.toBeNull();
    expect(PERSON_CDDL.slice(range![0], range![1])).toBe("tstr");
  });

  test("a value nothing in the schema matched has no declaration to point at", () => {
    // `age` is a text string where the schema declares `uint`, so no schema position.
    const bridge = personBridge();
    const ageValue = valueRowOf(bridge, "$.age");
    expect(ageValue.entry.cddl_byte_span).toBeUndefined();
    const node = resolveProbe(bridge, { source: "tree", position: ageValue.entry.cbor_byte_span! });
    expect(node?.entry).toBe(ageValue.entry);
    expect(projectNode(node!).cddl).toBeNull();
    expect(hoverEditorMark(linkOf(node!, "tree", PERSON_CDDL), PERSON_CDDL)).toBeNull();
  });

  test("a hover and a pin at the same place name the same entry from every panel", () => {
    // Hover and right-click at the same place go through the same finder.
    const bridge = personBridge();
    const bytes = PERSON_HEX.length / 2;
    for (let byte = 0; byte < bytes; byte++) {
      expect(resolveProbe(bridge, { source: "hex", byteOffset: byte })?.entry)
        .toBe(findNodeByCborOffset(bridge, byte)?.entry);
    }
    for (const e of bridge.entries) {
      const header = e.cbor_byte_span ?? e.cbor_anchor_span;
      if (!header) continue;
      expect(resolveProbe(bridge, { source: "tree", position: header })?.entry)
        .toBe(findNodeByCborOffset(bridge, header.offset)?.entry);
    }
    for (let char = 0; char <= PERSON_CDDL.length; char++) {
      expect(resolveProbe(bridge, { source: "cddl", charOffset: char })?.entry)
        .toBe(findNodeByCddlOffset(bridge, char)?.entry);
    }
    for (const e of bridge.entries) {
      const path = bridge.node(e).decodedPath;
      for (const role of ["key", "value"] as const) {
        expect(resolveProbe(bridge, { source: "decoded", path, role })?.entry)
          .toBe(findNodeByDecodedPath(bridge, path, role)?.entry);
      }
    }
  });

  test("every panel's pin projection is the hover projection of the same node", () => {
    // Pin and hover both read the same four `projectNode` fields.
    const bridge = personBridge();
    for (const e of bridge.entries) {
      const node = bridge.node(e);
      const projection = projectNode(node);
      expect(projection.cddl).toEqual(
        hasCddlSpan(e.cddl_byte_span)
          ? [e.cddl_byte_span.char_offset, e.cddl_byte_span.char_offset + e.cddl_byte_span.char_length]
          : null,
      );
      expect(projection.hex).toEqual(e.cbor_anchor_span ?? null);
      expect(projection.tree).toEqual(e.cbor_byte_span ?? null);
      expect(projection.decoded).toBe(node.decodedPath);

      const hexPin = pinnedHexSpans(makePin(bridge, node, "hex"), true);
      expect(hexPin.length ? { offset: hexPin[0].offset, length: hexPin[0].length } : null)
        .toEqual(projection.hex);
      const editorPin = buildEditorMarks({
        schemaError: null,
        diagnostics: [],
        selectedDiagnostic: null,
        referenceRanges: [],
        pinnedNode: node,
        pinInCddl: true,
      });
      expect(projection.cddl).toEqual(editorPin[0]?.range ?? null);
      const hover = hoverEditorMark(linkOf(node, "hex", PERSON_CDDL), PERSON_CDDL);
      expect(projection.cddl).toEqual(hover?.range ?? null);
    }
  });

  test("a character inside a reference to a rule resolves to the rule's instances", () => {
    // `Person` in `[+Person]`: the map files each person under the definition, so the
    // reference itself is inside no span narrower than the array's.
    const cddl = "Person = {\n  name: tstr,\n  age: uint,\n}\n\nPersons = [+Person]\n";
    // [{"name":"Alice","age":20},{"name":"Bob","age":31}]
    const hex = "82a2646e616d6565416c6963656361676514a2646e616d6563426f6263616765181f";
    const bridge = createCborCddlBridge(mapOf(hex, cddl, "Persons"), cddl);
    const reference = cddl.indexOf("Person]") + 2;
    const node = findNodeByCddlOffset(bridge, reference);
    expect(node?.cborPath).toBe("$[0]");
    expect(node?.entry.rule_name).toBe("Person");
    expect(bridge.instancesOf(node!.entry).map(e => bridge.node(e).cborPath)).toEqual(["$[0]", "$[1]"]);
    expect(resolveProbe(bridge, { source: "cddl", charOffset: reference })?.entry).toBe(node!.entry);
    // The array's own bracket is still the array.
    expect(findNodeByCddlOffset(bridge, cddl.indexOf("[+Person"))?.cborPath).toBe("$");
    // Alt-click on the reference lights both persons' bytes.
    const spans = linkedHexSpansForCddlOffset(bridge, reference);
    expect(spans.map(s => s.offset)).toEqual([1, 18]);
  });

  test("a member the input omits is pinnable, but only into the panels that have it", () => {
    // Missing `age` is a row with a schema span and no bytes.
    const bridge = createCborCddlBridge(
      mapOf("a1646e616d656441626379", "Person = {name: tstr, age: uint}", "Person"),
    );
    const missing = bridge.entries
      .map(e => bridge.node(e))
      .find(n => !n.entry.cbor_byte_span && !n.entry.cbor_anchor_span);
    expect(missing).toBeDefined();
    expect(missing!.entry.cddl_byte_span).toBeDefined();
    const blockers = pinTargetBlockers(missing!);
    expect(blockers.cddl).toBeNull();
    expect(blockers.hex).not.toBeNull();
    expect(blockers.tree).not.toBeNull();
  });

  test("every element mismatch of `[* int]` reaches the hex view", () => {
    // [1, "a", "b"] against `[* int]` — both strings fail.
    const outcome = validateCborOf("830161616162", "thing = [* int]\n", "thing");
    if (outcome?.ok !== true || outcome.result.valid) throw new Error("expected an invalid result");
    const diagnostics = cborDiagnostics(outcome.result.error);
    const spans = buildExtraErrorSpans(diagnostics);
    expect(diagnostics.length).toBe(2);
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const marks = buildEditorMarks({
      schemaError: null,
      diagnostics,
      selectedDiagnostic: null,
      referenceRanges: [],
      pinnedNode: null,
      pinInCddl: true,
    });
    // Both elements share the same `int` span, so one mark.
    expect(marks.length).toBe(1);
    expect(marks[0].className).toBe("cddl-editor-mismatch-mark");
  });
});

describe("pinMenuNotice", () => {
  const ready = {
    schemaIsValid: true,
    hasCbor: true,
    mapPending: false,
    mapRefusal: null,
    mapIsEmpty: false,
    rule: "Person",
  };

  test("each reason rules out the ones after it", () => {
    expect(pinMenuNotice({ ...ready, schemaIsValid: false })).toContain("doesn't parse yet");
    expect(pinMenuNotice({ ...ready, hasCbor: false })).toContain("Paste CBOR hex");
    expect(pinMenuNotice({ ...ready, mapPending: true, mapIsEmpty: true })).toContain("still being built");
    expect(pinMenuNotice({ ...ready, mapIsEmpty: true })).toBe("None of this CBOR could be mapped onto Person.");
    expect(pinMenuNotice(ready)).toContain("isn't covered");
  });

  test("a map the library refused is the reason, with its kind — never \"nothing could be mapped\"", () => {
    const limit = pinMenuNotice({
      ...ready,
      mapIsEmpty: true,
      mapRefusal: {
        kind: "nesting_too_deep",
        message: "CBOR nesting is deeper than the supported limit of 16384 levels",
      },
    });
    expect(limit).toContain("was refused");
    expect(limit).toContain("nesting_too_deep");
    expect(limit).toContain("supported limit of 16384 levels");
    expect(limit).toContain("not a finding about the input");
    expect(limit).not.toContain("could be mapped");

    // A refusal that is a finding keeps its kind and gets no limit note.
    const group = pinMenuNotice({
      ...ready,
      mapIsEmpty: true,
      mapRefusal: { kind: "group_rule_root", message: "CDDL rule g is a group rule" },
    });
    expect(group).toContain("group_rule_root");
    expect(group).toContain("CDDL rule g is a group rule.");
    expect(group).not.toContain("not a finding");
    expect(group).not.toContain("could be mapped");
  });

  test("a call that never answered is said as that, not as a refusal", () => {
    const notice = pinMenuNotice({
      ...ready,
      mapIsEmpty: true,
      mapRefusal: { kind: "call_failed", message: "This input is 6.7 MB, over the 2.0 MB limit." },
    });
    expect(notice).toContain("did not run");
    expect(notice).toContain("over the 2.0 MB limit.");
    expect(notice).not.toContain("was refused");
  });
});

describe("a pin over several instances", () => {
  const PERSONS_CDDL = "Person = { name: tstr, age: uint }\nPersons = [+Person]\n";
  const PERSONS_HEX = "82a2646e616d6565416c6963656361676514a2646e616d6563426f6263616765181f";
  const personsBridge = () => createCborCddlBridge(mapOf(PERSONS_HEX, PERSONS_CDDL, "Persons"));

  test("the hex paints the current instance alone, and the others apart", () => {
    const bridge = personsBridge();
    const pin = stepPin(makePin(bridge, findNodeByCddlOffset(bridge, PERSONS_CDDL.indexOf("name"))!, "cddl"), 1);
    expect(pinnedHexSpans(pin, true)).toEqual([
      { offset: 19, length: 5, message: "Pinned (2/2): String at $[1].name" },
    ]);
    expect(pinnedOtherHexSpans(pin, true)).toEqual([{ offset: 2, length: 5 }]);
    // A run pinned from hex is a group of one: no position, no others.
    const own = makePin(bridge, resolveProbe(bridge, { source: "hex", byteOffset: 20 })!, "hex");
    expect(pinnedHexSpans(own, true)).toEqual([{ offset: 19, length: 5, message: "Pinned: String at $[1].name" }]);
    expect(pinnedOtherHexSpans(own, true)).toEqual([]);
    expect(pinnedOtherHexSpans(pin, false)).toEqual([]);
    expect(pinnedOtherHexSpans(null, true)).toEqual([]);
  });

  test("the editor's mark says where the current sits", () => {
    const bridge = personsBridge();
    const pin = makePin(bridge, findNodeByCddlOffset(bridge, PERSONS_CDDL.indexOf("name"))!, "cddl");
    const marks = buildEditorMarks({
      schemaError: null,
      diagnostics: [],
      selectedDiagnostic: null,
      referenceRanges: [],
      pinnedNode: pin.node,
      pinnedInstance: pin,
      pinInCddl: true,
    });
    expect(marks.length).toBe(1);
    expect(marks[0].message).toBe("Pinned: String key at $[0].name · instance 1 of 2");
    expect(PERSONS_CDDL.slice(...marks[0].range)).toBe("name");
  });

  test("the blockers read the current instance", () => {
    // `{"name": "Abcy"}` twice: each omitted `age` is a schema span with no bytes.
    const bridge = createCborCddlBridge(mapOf(
      "82a1646e616d656441626379a1646e616d656441626379",
      PERSONS_CDDL,
      "Persons",
    ));
    const missing = bridge.entries.filter(e => !e.cbor_byte_span);
    expect(missing.length).toBeGreaterThan(1);
    const pin = makePin(bridge, bridge.node(missing[0]), "cddl");
    expect(pin.instances).toEqual(missing);
    expect(pinTargetBlockers(pin.node).hex).not.toBeNull();
    expect(pinTargetBlockers(pin.node).tree).not.toBeNull();
    expect(pinTargetBlockers(pin.node).decoded).toBeNull();
    expect(pinnedHexSpans(pin, true)).toEqual([]);
    expect(pinnedOtherHexSpans(pin, true)).toEqual([]);
  });
});
