import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreeDiagnostic, TreeDiagnosticRows } from "@/components/treeDiagnostics";
import DecodedJsonTree from "./DecodedJsonTree";

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("DecodedJsonTree with a pinned construct", () => {
  const data = { a: [{ n: 1 }, { n: 2 }, { n: 3 }] };

  test("the current instance is rendered pinned; the others are not classes of the render", () => {
    // Other instances are marked on row elements after render, so naming a thousand of them re-renders no row.
    const html = renderToStaticMarkup(
      <DecodedJsonTree
        data={data}
        expanded={9}
        pinnedPath="$.a[1].n"
        pinnedOtherPaths={new Set(["$.a[0].n", "$.a[2].n"])}
      />,
    );
    expect(count(html, "cq-json-pinned")).toBe(1);
    expect(count(html, "cq-json-pinned-other")).toBe(0);
    expect(count(html, "cq-json-hover")).toBe(0);
    expect(html).toContain('data-path="$.a[1].n"');
  });

  test("the hover paths are not classes of the render either", () => {
    const html = renderToStaticMarkup(
      <DecodedJsonTree data={data} expanded={9} hoverPaths={["$.a[0].n", "$.a[2].n"]} />,
    );
    expect(count(html, "cq-json-hover")).toBe(0);
  });

  test("the half of the row the construct is goes on the wrap, and leaves and values are classed for it", () => {
    const html = renderToStaticMarkup(
      <DecodedJsonTree data={data} expanded={9} pinnedPath="$.a[1].n" pinnedRole="key" hoverRole="value" />,
    );
    expect(html).toContain('class="cq-json-tree-wrap" data-pin-role="key" data-hover-role="value"');
    // A leaf row is classed as one and its value is one span; a container's row is neither.
    expect(html).toMatch(/<div class="cq-json-row cq-json-pinned cq-json-leaf" data-path="\$\.a\[1\]\.n"><span class="cq-json-key">n<\/span><span class="cq-json-colon">:<\/span><span class="cq-json-value cq-json-number">2<\/span>/);
    expect(html).toMatch(/<div class="cq-json-row" data-path="\$\.a"><button/);
    const bare = renderToStaticMarkup(<DecodedJsonTree data={data} expanded={9} />);
    expect(bare).toContain('<div class="cq-json-tree-wrap">');
  });
});

// ---------- the diagnostics a run placed on rows ----------

function diagnostic(index: number, path: string, over: Partial<TreeDiagnostic> = {}): TreeDiagnostic {
  return {
    index,
    kind: "mismatch",
    expected: "tstr",
    message: `expected type tstr, got uint ${index}`,
    path,
    pathLabel: path,
    position: { offset: 4 + index, length: 1 },
    title: `mismatch at ${path} (expected tstr) — expected type tstr, got uint ${index}`,
    held: false,
    ...over,
  };
}

const rowsOf = (entries: Array<[string, TreeDiagnostic[]]>): TreeDiagnosticRows => new Map(entries);

/** Markup of the row element carrying `path`, opening tag to closing. */
function rowMarkup(html: string, path: string): string {
  const at = html.indexOf(`data-path="${path}"`);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<div", at);
  const end = html.indexOf("</div>", at);
  return html.slice(start, end + "</div>".length);
}

/** `data-path` of every row rendered, in order. */
const paths = (html: string) => Array.from(html.matchAll(/data-path="([^"]+)"/g)).map((m) => m[1]);

describe("DecodedJsonTree's diagnostics", () => {
  const data = { a: [{ n: 1 }, { n: 2 }, { n: 3 }] };
  const ON_N1 = rowsOf([["$.a[1].n", [diagnostic(0, "$.a[1].n")]]]);
  const markup = (extra: Partial<Parameters<typeof DecodedJsonTree>[0]> = {}) =>
    renderToStaticMarkup(<DecodedJsonTree data={data} expanded={9} {...extra} />);

  test("a flagged row carries the mismatch class and ends with its badge", () => {
    const html = markup({ rowDiagnostics: ON_N1 });
    const row = rowMarkup(html, "$.a[1].n");
    expect(row).toMatch(/^<div class="cq-json-row cq-json-leaf cq-json-mismatch" data-path="\$\.a\[1\]\.n">/);
    expect(row).not.toContain("cq-json-mismatch-selected");
    expect(row).toMatch(
      /<span class="cq-json-value cq-json-number">2<\/span><button type="button" class="cq-json-mismatch-badge" title="[^"]*" aria-label="mismatch" aria-pressed="false">✗ mismatch<\/button><\/div>$/,
    );
    expect(row).toContain('title="mismatch at $.a[1].n (expected tstr) — expected type tstr, got uint 0"');
    expect(rowMarkup(html, "$.a[0].n")).toBe('<div class="cq-json-row cq-json-leaf" data-path="$.a[0].n"><span class="cq-json-key">n</span><span class="cq-json-colon">:</span><span class="cq-json-value cq-json-number">1</span></div>');
    expect(count(html, "cq-json-mismatch")).toBe(2);
    expect(html).not.toContain("cq-json-caption");
  });

  test("the selected diagnostic's row is marked selected, pressed and captioned once, outside the row element", () => {
    const html = markup({ rowDiagnostics: ON_N1, selectedDiagnostic: 0, onRevealBytes: () => {} });
    const row = rowMarkup(html, "$.a[1].n");
    expect(row).toMatch(/^<div class="cq-json-row cq-json-leaf cq-json-mismatch cq-json-mismatch-selected" data-path="\$\.a\[1\]\.n">/);
    expect(row).toContain('aria-pressed="true">✗ mismatch</button>');
    expect(count(html, 'class="cq-json-caption"')).toBe(1);
    // Caption follows the row's closing tag and carries no path of its own.
    expect(html).toContain(`${row}<div class="cq-json-caption">`);
    expect(html).not.toMatch(/cq-json-caption[^>]*data-path/);
    const caption = html.slice(html.indexOf('<div class="cq-json-caption">'));
    expect(caption).toContain('<span class="cq-json-caption-kind">mismatch</span> · expected <code>tstr</code>');
    expect(caption).toContain('<div class="cq-json-caption-message">expected type tstr, got uint 0</div>');
    expect(caption).toContain('<button type="button" class="cq-json-caption-link">show bytes</button>');
    expect(count(html, "cq-json-caption-message")).toBe(1);
  });

  test("the caption offers no bytes without a way to show them, or a diagnostic without any", () => {
    expect(markup({ rowDiagnostics: ON_N1, selectedDiagnostic: 0 })).not.toContain("show bytes");
    const bare = rowsOf([["$.a[1].n", [diagnostic(0, "$.a[1].n", { position: null })]]]);
    expect(markup({ rowDiagnostics: bare, selectedDiagnostic: 0, onRevealBytes: () => {} })).not.toContain("show bytes");
  });

  test("a selection opens the way to its row and keeps it, without the pin's mark", () => {
    const closed = markup({ expanded: 0 });
    expect(paths(closed)).toEqual(["$"]);
    const html = markup({ expanded: 0, rowDiagnostics: ON_N1, selectedDiagnostic: 0 });
    expect(paths(html)).toEqual(["$", "$.a", "$.a[0]", "$.a[1]", "$.a[1].n", "$.a[2]"]);
    expect(html).not.toContain("cq-json-pinned");
    expect(rowMarkup(html, "$.a[1].n")).toContain("cq-json-mismatch-selected");
    const both = markup({ expanded: 0, rowDiagnostics: ON_N1, selectedDiagnostic: 0, openPaths: ["$.a[2].n"] });
    expect(paths(both)).toEqual(["$", "$.a", "$.a[0]", "$.a[1]", "$.a[1].n", "$.a[2]", "$.a[2].n"]);
  });

  test("with no selection a flagged row under a closed one is not opened", () => {
    const html = markup({ expanded: 0, rowDiagnostics: ON_N1 });
    expect(paths(html)).toEqual(["$"]);
    expect(html).not.toContain("cq-json-mismatch");
    expect(paths(markup({ expanded: 0, rowDiagnostics: ON_N1, selectedDiagnostic: 7 }))).toEqual(["$"]);
  });

  test("a row with two diagnostics reads their count and captions the selected one", () => {
    const rows = rowsOf([["$.a[1].n", [
      diagnostic(0, "$.a[1].n"),
      diagnostic(3, "$.a[1].n", { kind: "generic", expected: null, message: "second finding" }),
    ]]]);
    const html = markup({ rowDiagnostics: rows, selectedDiagnostic: 3 });
    const row = rowMarkup(html, "$.a[1].n");
    expect(row).toContain('aria-pressed="true">✗ 2</button>');
    expect(row).toMatch(/title="mismatch at \$\.a\[1\]\.n[^"]*\nmismatch at \$\.a\[1\]\.n/);
    expect(html).toContain('<span class="cq-json-caption-kind">generic</span></div>');
    expect(html).toContain('<div class="cq-json-caption-message">second finding</div>');
    expect(count(html, "cq-json-caption-message")).toBe(1);
  });

  test("a row standing in for rows the tree does not have says what it holds", () => {
    const held = rowsOf([["$.a[1]", [
      diagnostic(0, '$.a[1]["@x"]', { held: true, pathLabel: '$.a[1]["@x"]' }),
    ]]]);
    const html = markup({ rowDiagnostics: held });
    const row = rowMarkup(html, "$.a[1]");
    expect(row).toContain('class="cq-json-mismatch-badge cq-json-mismatch-badge-holds"');
    expect(row).toContain(">⚠ holds 1 mismatch</button>");
    const selected = markup({ rowDiagnostics: held, selectedDiagnostic: 0 });
    expect(selected).toContain('<span class="cq-json-caption-kind">mismatch</span> at <code>$.a[1][&quot;@x&quot;]</code> · expected <code>tstr</code>');
    const two = rowsOf([["$.a[1]", [
      diagnostic(0, '$.a[1]["@x"]', { held: true }),
      diagnostic(1, '$.a[1]["@y"]', { held: true }),
    ]]]);
    expect(rowMarkup(markup({ rowDiagnostics: two }), "$.a[1]")).toContain(">⚠ holds 2 mismatches</button>");
  });

  test("the holder cue for a flagged row with no row on screen is not a class of the render", () => {
    // Written on row elements after render, like the pin, so a closed tree renders nothing for the diagnostic.
    const html = markup({ expanded: 0, rowDiagnostics: ON_N1 });
    expect(html).not.toContain("cq-json-holds-mismatch");
    expect(html).not.toContain("data-holds-mismatch");
  });

  test("a badge on a complex row follows its brackets", () => {
    const onA1 = rowsOf([["$.a[1]", [diagnostic(0, "$.a[1]")]]]);
    const open = rowMarkup(markup({ rowDiagnostics: onA1 }), "$.a[1]");
    expect(open).toMatch(/<span class="cq-json-bracket">\{<\/span><button type="button" class="cq-json-mismatch-badge"/);
    const closed = rowMarkup(markup({ expanded: 2, rowDiagnostics: onA1 }), "$.a[1]");
    expect(closed).toMatch(/<span class="cq-json-bracket">\}<\/span><button type="button" class="cq-json-mismatch-badge"/);
  });

  test("without diagnostics the markup is what it was, whether the props are absent or empty", () => {
    const plain = markup();
    expect(plain).not.toContain("mismatch");
    expect(plain).not.toContain("caption");
    expect(markup({
      rowDiagnostics: new Map(), selectedDiagnostic: null, onSelectDiagnostic: () => {}, onRevealBytes: () => {},
    })).toBe(plain);
    expect(markup({ selectedDiagnostic: 0, diagnosticRevealSeq: 3 })).toBe(plain);
    const pinned = markup({ pinnedPath: "$.a[1].n", pinnedOtherPaths: new Set(["$.a[0].n"]) });
    expect(markup({ pinnedPath: "$.a[1].n", pinnedOtherPaths: new Set(["$.a[0].n"]), rowDiagnostics: new Map() })).toBe(pinned);
  });
});
