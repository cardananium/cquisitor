import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CborArray, CborMap, CborPosition, CborValue } from "@cardananium/cquisitor-lib";
import CborTreeView, { ownDiagnosticsOf, spanAttr } from "./CborTreeView";
import type { TreeDiagnostic, TreeDiagnosticRows } from "./treeDiagnostics";

const pos = (offset: number, length: number): CborPosition => ({ offset, length });

const u8 = (offset: number, value: number): CborValue => ({ type: "U8", value, position_info: pos(offset, 1) });

const array = (offset: number, length: number, values: CborValue[]): CborArray => ({
  type: "Array", items: values.length, values, position_info: pos(offset, 1), struct_position_info: pos(offset, length),
});

const map = (offset: number, length: number, entries: Array<[CborValue, CborValue]>): CborMap => ({
  type: "Map", items: entries.length, values: entries.map(([key, value]) => ({ key, value })),
  position_info: pos(offset, 1), struct_position_info: pos(offset, length),
});

// [ {0: [7]}, {0: [8]} ] — leaves sit three levels down, under rows the defaults leave closed.
const LEAF_A = u8(4, 7);
const LEAF_B = u8(8, 8);
const DOC = array(0, 9, [
  map(1, 4, [[u8(2, 0), array(3, 2, [LEAF_A])]]),
  map(5, 4, [[u8(6, 0), array(7, 2, [LEAF_B])]]),
]);

function markup(extra: Partial<Parameters<typeof CborTreeView>[0]> = {}) {
  return renderToStaticMarkup(
    <CborTreeView
      data={DOC}
      hexValue=""
      onHoverPosition={() => {}}
      onHighlightAndScroll={() => {}}
      {...extra}
    />,
  );
}

/** `data-span` of every row rendered, in order. */
const spans = (html: string) => Array.from(html.matchAll(/data-span="([^"]+)"/g)).map((m) => m[1]);

/** Whether the row carrying `span` has `className`. */
const rowHas = (html: string, span: CborPosition, className: string) =>
  new RegExp(`class="[^"]*${className}[^"]*"[^>]*data-span="${spanAttr(span)}[ "]`).test(html);

describe("CborTreeView's open positions", () => {
  test("the defaults leave the leaves under closed rows", () => {
    const html = markup();
    expect(spans(html)).not.toContain(spanAttr(LEAF_A.position_info));
    expect(spans(html)).not.toContain(spanAttr(LEAF_B.position_info));
  });

  test("the pinned position opens the way to its row and marks it", () => {
    const html = markup({ pinnedPosition: LEAF_A.position_info, scrollOnHighlight: false });
    expect(spans(html)).toContain(spanAttr(LEAF_A.position_info));
    expect(spans(html)).not.toContain(spanAttr(LEAF_B.position_info));
    expect(rowHas(html, LEAF_A.position_info, "cbor-tree-row-pinned")).toBe(true);
  });

  test("an open position opens the way to its row too, without the pin's mark", () => {
    const html = markup({
      pinnedPosition: LEAF_A.position_info,
      openPositions: [LEAF_B.position_info],
      scrollOnHighlight: false,
    });
    expect(spans(html)).toContain(spanAttr(LEAF_A.position_info));
    expect(spans(html)).toContain(spanAttr(LEAF_B.position_info));
    expect(rowHas(html, LEAF_A.position_info, "cbor-tree-row-pinned")).toBe(true);
    expect(rowHas(html, LEAF_B.position_info, "cbor-tree-row-pinned")).toBe(false);
  });
});

// ---------- the diagnostics a run placed on rows ----------

function diagnostic(index: number, position: CborPosition, over: Partial<TreeDiagnostic> = {}): TreeDiagnostic {
  return {
    index,
    kind: "mismatch",
    expected: "tstr",
    message: `expected type tstr, got uint ${index}`,
    path: `$[${index}]`,
    pathLabel: `$[${index}]`,
    position,
    title: `mismatch at $[${index}] (expected tstr) — expected type tstr, got uint ${index}`,
    held: false,
    ...over,
  };
}

const rowsOf = (entries: Array<[CborPosition, TreeDiagnostic[]]>): TreeDiagnosticRows =>
  new Map(entries.map(([position, list]) => [spanAttr(position), list]));

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Markup of the row carrying `span`, from its opening tag to the caption or the next row. */
function rowMarkup(html: string, span: CborPosition): string {
  const at = html.indexOf(`data-span="${spanAttr(span)}`);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<div", at);
  const next = html.indexOf('data-span="', at + 1);
  return html.slice(start, next < 0 ? undefined : html.lastIndexOf("<div", next));
}

describe("CborTreeView's diagnostics", () => {
  const ON_A = rowsOf([[LEAF_A.position_info!, [diagnostic(0, LEAF_A.position_info!)]]]);

  test("the selected diagnostic opens the way to its row, which is marked and captioned", () => {
    const html = markup({ rowDiagnostics: ON_A, selectedDiagnostic: 0, scrollOnHighlight: false });
    expect(spans(html)).toContain(spanAttr(LEAF_A.position_info!));
    expect(spans(html)).not.toContain(spanAttr(LEAF_B.position_info!));
    expect(rowHas(html, LEAF_A.position_info!, "cbor-tree-row-mismatch")).toBe(true);
    expect(rowHas(html, LEAF_A.position_info!, "cbor-tree-row-mismatch-selected")).toBe(true);
    const row = rowMarkup(html, LEAF_A.position_info!);
    expect(row).toMatch(/<button type="button" class="cbor-tree-mismatch-badge" title="[^"]*" aria-label="mismatch" aria-pressed="true">✗ mismatch<\/button>/);
    expect(row).toContain('title="mismatch at $[0] (expected tstr) — expected type tstr, got uint 0"');
    expect(count(html, 'class="cbor-tree-row-caption"')).toBe(1);
    expect(row).toContain('<span class="cbor-tree-row-caption-kind">mismatch</span> · expected <code>tstr</code>');
    expect(row).toContain('<div class="cbor-tree-row-caption-message">expected type tstr, got uint 0</div>');
    expect(row).toContain(">show bytes</button>");
  });

  test("the caption is a sibling after the row element, not inside it", () => {
    const html = markup({ rowDiagnostics: ON_A, selectedDiagnostic: 0, scrollOnHighlight: false });
    const rowAt = html.indexOf(`data-span="${spanAttr(LEAF_A.position_info!)}"`);
    const captionAt = html.indexOf('<div class="cbor-tree-row-caption">');
    expect(captionAt).toBeGreaterThan(rowAt);
    // Between the row's opening tag and the caption: the row's content and exactly one closing div.
    const between = html.slice(rowAt, captionAt);
    expect(count(between, "</div>")).toBe(1);
    expect(count(between, "<div")).toBe(0);
    expect(html).toContain('</div><div class="cbor-tree-row-caption">');
    expect(html).not.toMatch(/cbor-tree-row-caption[^>]*data-span/);
  });

  test("with no selection the flagged row is not opened and nothing is captioned", () => {
    const html = markup({ rowDiagnostics: ON_A, scrollOnHighlight: false });
    expect(spans(html)).not.toContain(spanAttr(LEAF_A.position_info!));
    expect(html).not.toContain("cbor-tree-row-caption");
    expect(html).not.toContain("cbor-tree-mismatch-badge");
    const other = markup({ rowDiagnostics: ON_A, selectedDiagnostic: 7, scrollOnHighlight: false });
    expect(spans(other)).not.toContain(spanAttr(LEAF_A.position_info!));
  });

  test("a rendered flagged row carries its badge unpressed while another diagnostic is selected", () => {
    const rows = rowsOf([
      [LEAF_A.position_info!, [diagnostic(0, LEAF_A.position_info!)]],
      [LEAF_B.position_info!, [diagnostic(1, LEAF_B.position_info!)]],
    ]);
    const html = markup({ rowDiagnostics: rows, selectedDiagnostic: 1, scrollOnHighlight: false });
    expect(spans(html)).toContain(spanAttr(LEAF_B.position_info!));
    expect(spans(html)).not.toContain(spanAttr(LEAF_A.position_info!));
    const b = rowMarkup(html, LEAF_B.position_info!);
    expect(b).toContain('aria-pressed="true">✗ mismatch</button>');
    const both = markup({
      rowDiagnostics: rows, selectedDiagnostic: 1, openPositions: [LEAF_A.position_info!], scrollOnHighlight: false,
    });
    const a = rowMarkup(both, LEAF_A.position_info!);
    expect(a).toContain('aria-pressed="false">✗ mismatch</button>');
    expect(rowHas(both, LEAF_A.position_info!, "cbor-tree-row-mismatch")).toBe(true);
    expect(rowHas(both, LEAF_A.position_info!, "cbor-tree-row-mismatch-selected")).toBe(false);
    expect(count(both, 'class="cbor-tree-row-caption"')).toBe(1);
  });

  test("a row with two diagnostics reads their count, and captions the selected one", () => {
    const rows = rowsOf([[LEAF_A.position_info!, [
      diagnostic(0, LEAF_A.position_info!),
      diagnostic(3, LEAF_A.position_info!, { kind: "generic", expected: null, message: "second finding" }),
    ]]]);
    const html = markup({ rowDiagnostics: rows, selectedDiagnostic: 3, scrollOnHighlight: false });
    const row = rowMarkup(html, LEAF_A.position_info!);
    expect(row).toContain('aria-pressed="true">✗ 2</button>');
    expect(row).toContain('<span class="cbor-tree-row-caption-kind">generic</span></div>');
    expect(row).toContain('<div class="cbor-tree-row-caption-message">second finding</div>');
    expect(count(row, "cbor-tree-row-caption-message")).toBe(1);
    expect(row).toMatch(/title="mismatch at \$\[0\][^"]*\nmismatch at \$\[3\]/);
  });

  test("a diagnostic keyed by a container's whole extent lands on that container's row", () => {
    const extent = DOC.struct_position_info!;
    const rows = rowsOf([[extent, [diagnostic(0, extent, { path: "$", pathLabel: "$" })]]]);
    const html = markup({ rowDiagnostics: rows, selectedDiagnostic: 0, scrollOnHighlight: false });
    const root = rowMarkup(html, DOC.position_info!);
    expect(root).toContain('data-span="0:1 0:9"');
    expect(root).toContain("cbor-tree-row-mismatch-selected");
    expect(root).toContain(">✗ mismatch</button>");
    expect(count(html, "cbor-tree-mismatch-badge")).toBe(1);
  });

  test("without diagnostics the markup is what it was, whether the props are absent or empty", () => {
    const plain = markup();
    expect(plain).not.toContain("mismatch");
    expect(plain).not.toContain("caption");
    expect(markup({ rowDiagnostics: new Map(), selectedDiagnostic: null, onSelectDiagnostic: () => {} })).toBe(plain);
    expect(markup({ selectedDiagnostic: 0 })).toBe(plain);
    const pinned = markup({ pinnedPosition: LEAF_A.position_info, scrollOnHighlight: false });
    expect(markup({ pinnedPosition: LEAF_A.position_info, scrollOnHighlight: false, rowDiagnostics: new Map() })).toBe(pinned);
  });
});

describe("ownDiagnosticsOf", () => {
  const header = DOC.position_info!;
  const extent = DOC.struct_position_info!;
  const byHeader = [diagnostic(0, header)];
  const byExtent = [diagnostic(1, extent)];

  test("hands back the map's own list for a row's header, or a container's extent", () => {
    const rows = rowsOf([[header, byHeader]]);
    expect(ownDiagnosticsOf(DOC, rows)).toBe(byHeader);
    expect(ownDiagnosticsOf(DOC, rowsOf([[extent, byExtent]]))).toBe(byExtent);
    expect(ownDiagnosticsOf(LEAF_A, rows)).toBeUndefined();
    expect(ownDiagnosticsOf(LEAF_A, rowsOf([[LEAF_A.position_info!, byHeader]]))).toBe(byHeader);
  });

  test("joins the two lists when a container has diagnostics under both its spans", () => {
    const rows = rowsOf([[header, byHeader], [extent, byExtent]]);
    expect(ownDiagnosticsOf(DOC, rows)).toEqual([...byHeader, ...byExtent]);
  });

  test("a container whose extent is its header is asked once", () => {
    const empty: CborArray = {
      type: "Array", items: 0, values: [], position_info: pos(0, 1), struct_position_info: pos(0, 1),
    };
    expect(ownDiagnosticsOf(empty, rowsOf([[pos(0, 1), byHeader]]))).toBe(byHeader);
  });

  test("nothing for a missing half or a node without bytes", () => {
    const rows = rowsOf([[header, byHeader]]);
    expect(ownDiagnosticsOf({ missing: "value" }, rows)).toBeUndefined();
    expect(ownDiagnosticsOf({ type: "Null" } as unknown as CborValue, rows)).toBeUndefined();
  });
});
