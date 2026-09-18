import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import JsonTreeView, { attrSelector } from "./JsonTreeView";
import type { RenderRowArgs } from "./JsonTreeView";
import { entriesAwareMapEntries } from "./mapEntries";

/** Class scheme both cq-json consumers use; row container is inline-level, so an unwrapped row would share a line with the next. */
function markup(data: unknown, extra: Partial<Parameters<typeof JsonTreeView>[0]> = {}) {
  return renderToStaticMarkup(
    <JsonTreeView
      data={data}
      expanded={5}
      renderRow={({ keyLabel, value, isComplex, fold, depthBelow }: RenderRowArgs) => (
        <span>
          {fold ? `${fold.keys.join("/")}×${fold.levels}` : String(keyLabel)}
          {isComplex ? `{${depthBelow}}` : `:${String(value)}`}
        </span>
      )}
      renderClosingRow={({ kind }) => (
        <div className="cq-json-row">{kind === "array" ? "]" : "}"}</div>
      )}
      rowClassName="cq-json-row"
      nodeBlockClassName="cq-json-block"
      {...extra}
    />,
  );
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Two node rows next to each other with no block between them. Closing-bracket rows are the one case that legitimately follows a block, and they have no `<span>`. */
const ADJACENT_ROWS = /<\/div><div class="cq-json-row"><span>/;

/** Visible text of every row, in order. */
const rowTexts = (html: string) =>
  Array.from(html.matchAll(/<div class="cq-json-row[^"]*"[^>]*>(?:<span>)?([^<]*)/g)).map((m) => m[1]);

describe("JsonTreeView rows", () => {
  test("every row sits in its own block, so no two rows are siblings", () => {
    const html = markup({ a: 1, b: 2, c: { d: 3 } });
    expect(html).not.toMatch(ADJACENT_ROWS);
    // root + a + b + c + d, plus a block per closing bracket
    expect(count(html, '<div class="cq-json-block"')).toBe(5 + 2);
    expect(count(html, '<div class="cq-json-row"')).toBe(5 + 2);
  });

  test("rows are flat siblings indented by depth, never nested in each other", () => {
    const html = markup({ a: { b: { c: 1 } } });
    expect(html).not.toMatch(/<div class="cq-json-block"[^>]*>(?:(?!<\/div>).)*<div class="cq-json-block"/);
    expect(html).toContain('style="padding-left:22px"');
    expect(html).toContain('style="padding-left:44px"');
    expect(html).toContain('style="padding-left:66px"');
    expect(rowTexts(html)).toEqual(["null{3}", "a{2}", "b{1}", "c:1", "}", "}", "}"]);
  });

  test("array leaves are wrapped too", () => {
    const html = markup([1, 2, 3]);
    expect(count(html, '<div class="cq-json-block"')).toBe(4 + 1);
    expect(html).not.toMatch(ADJACENT_ROWS);
  });

  test("the closing bracket row follows the last child's block at the container's indent", () => {
    const html = markup({ a: 1 });
    expect(html).toContain('</div></div><div class="cq-json-block"><div class="cq-json-row">}</div>');
  });

  test("per-node block classes reach leaves", () => {
    const html = markup(
      { a: 1 },
      { getNodeBlockClassName: (ctx: RenderRowArgs) => (ctx.isComplex ? "" : "leaf") },
    );
    expect(html).toContain('<div class="cq-json-block leaf"');
  });

  test("skipRoot still drops the synthetic root's own block", () => {
    const html = markup({ a: 1 }, { skipRoot: true });
    expect(count(html, '<div class="cq-json-block"')).toBe(1);
    expect(html).not.toContain("}");
  });

  test("a closed container shows nothing below it", () => {
    const html = markup({ a: { b: { c: 1 } } }, { expanded: 1 });
    expect(rowTexts(html)).toEqual(["null{3}", "a{2}", "}"]);
  });

  test("a highlighted path is opened on the way down and marked", () => {
    const html = markup(
      { a: { b: { c: { d: 1 } } } },
      { expanded: 0, highlightedPaths: ["$.a.b.c"], highlightedRowClassName: "hot" },
    );
    expect(rowTexts(html)).toEqual(["null{4}", "a{3}", "b{2}", "c{1}", "}", "}", "}"]);
    expect(count(html, 'class="cq-json-row hot"')).toBe(1);
  });
});

describe("a wire-order map whose key repeats", () => {
  test("shows a row per entry, each with its own value", () => {
    const doc = {
      "@entries": [
        { key: 1, value: "a", match: { via: "unmatched", label: null } },
        { key: 1, value: "b", match: { via: "unmatched", label: null } },
      ],
    };
    const html = markup(doc, { mapEntries: entriesAwareMapEntries });
    expect(rowTexts(html)).toEqual(["null{1}", "1:a", "1:b", "}"]);
  });
});

describe("a deeply nested document", () => {
  const chain = (levels: number) => {
    let node: unknown = 5;
    for (let i = 0; i < levels; i++) node = { a: node };
    return node;
  };

  test("ten thousand single-child levels are one folded row, not ten thousand", () => {
    const html = markup(chain(10_000), { foldChains: 4 });
    // The run's keys, synthetic root's empty one first.
    expect(rowTexts(html)).toEqual([`${"/a".repeat(9_999)}×10000{1}`, "a:5", "}"]);
    expect(count(html, '<div class="cq-json-block"')).toBe(3);
  });

  test("with folding off, only the levels the defaults open are rendered", () => {
    const html = markup(chain(10_000), { expanded: 3 });
    expect(rowTexts(html)).toEqual(["null{10000}", "a{9999}", "a{9998}", "a{9997}", "}", "}", "}"]);
  });

  test("the indent stops growing past forty levels", () => {
    const html = markup(chain(60), { expanded: 100 });
    expect(html).toContain('style="padding-left:880px"');
    expect(html).not.toContain('style="padding-left:902px"');
  });

  test("rows past the budget are held behind a control", () => {
    const html = markup({ a: [1, 2, 3, 4, 5, 6, 7, 8] }, { rowBudget: 4 });
    expect(count(html, '<div class="cq-json-row"')).toBe(4);
    expect(html).toContain("Show more rows");
    expect(markup({ a: [1, 2] }, { rowBudget: 100 })).not.toContain("Show more rows");
  });
});

describe("a row's path attribute", () => {
  test("every node row carries its path; closing rows do not", () => {
    const html = markup({ a: { b: 1 } }, { rowPathAttribute: "data-path" });
    const paths = Array.from(html.matchAll(/data-path="([^"]*)"/g)).map((m) => m[1]);
    expect(paths).toEqual(["$", "$.a", "$.a.b"]);
    expect(count(html, '<div class="cq-json-row"')).toBe(3 + 2);
    expect(html).toContain('<div class="cq-json-row" data-path="$.a">');
  });

  test("without the prop no path is written", () => {
    expect(markup({ a: { b: 1 } })).not.toContain("data-path");
  });

  test("attrSelector quotes what a CSS string cannot hold bare", () => {
    expect(attrSelector("data-path", '$["a\\"b"]')).toBe('[data-path="$[\\"a\\\\\\"b\\"]"]');
    expect(attrSelector("data-path", "$.plain[0]")).toBe('[data-path="$.plain[0]"]');
    expect(attrSelector("data-path", "a\nb")).toBe('[data-path="a\\a b"]');
  });
});

describe("a row's footer", () => {
  const data = { a: { b: 1 } };
  const footer = ({ path }: RenderRowArgs) => <i className="foot">{path}</i>;

  test("follows each node row's element inside its block, and no closing row", () => {
    const html = markup(data, { rowPathAttribute: "data-path", renderRowFooter: footer });
    // Root, a and a.b; the two closing rows get none.
    expect(count(html, '<i class="foot">')).toBe(3);
    expect(html).toContain(
      '<div class="cq-json-row" data-path="$.a"><span>a{1}</span></div><i class="foot">$.a</i></div>',
    );
    expect(html).toContain('<div class="cq-json-row" data-path="$.a.b"><span>b:1</span></div><i class="foot">$.a.b</i></div>');
    expect(html).toContain('<div class="cq-json-block" style="padding-left:22px"><div class="cq-json-row">}</div></div>');
    // Outside the path-bearing element, so a lookup by path never lands on a footer.
    expect(html).not.toMatch(/foot[^>]*data-path/);
  });

  test("a footer of null renders nothing, and without the prop nothing changes", () => {
    const plain = markup(data, { rowPathAttribute: "data-path" });
    expect(markup(data, { rowPathAttribute: "data-path", renderRowFooter: () => null })).toBe(plain);
    expect(markup(data, { rowPathAttribute: "data-path", renderRowFooter: () => undefined })).toBe(plain);
    expect(plain).not.toContain("foot");
  });
});

describe("a pinned construct's instances", () => {
  test("only the current is a highlighted path, so only one row can scroll", () => {
    // The tree scrolls a row on a highlight transition; with every instance in `highlightedPaths` the last rendered would win. Others are marked by the caller.
    const html = markup(
      { a: [{ n: 1 }, { n: 2 }, { n: 3 }] },
      { expanded: 9, highlightedPaths: ["$.a[1].n"], highlightedRowClassName: "cq-json-pinned" },
    );
    expect(count(html, "cq-json-pinned")).toBe(1);
    expect(count(html, "cq-json-pinned-other")).toBe(0);
  });

  test("an open path is opened on the way down and kept, without the highlight", () => {
    const data = { a: [{ n: { v: 1 } }, { n: { v: 2 } }, { n: { v: 3 } }] };
    const html = markup(data, {
      expanded: 0,
      highlightedPaths: ["$.a[1].n"],
      openPaths: ["$.a[2].n"],
      highlightedRowClassName: "hot",
      rowPathAttribute: "data-path",
    });
    expect(rowTexts(html)).toEqual(["null{4}", "a{3}", "0{2}", "1{2}", "n{1}", "}", "2{2}", "n{1}", "}", "]", "}"]);
    expect(count(html, 'class="cq-json-row hot"')).toBe(1);
    expect(html).toContain('class="cq-json-row hot" data-path="$.a[1].n"');
    expect(html).toContain('class="cq-json-row" data-path="$.a[2].n"');
  });
});
