import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DiagnosticBadge,
  DiagnosticCaption,
  badgeLabel,
  badgeText,
  badgeTitle,
  holdsLabel,
  nextSelection,
  placementOf,
  selectedIn,
  type TreeDiagnostic,
  type TreeDiagnosticRows,
} from "./treeDiagnostics";

function diagnostic(over: Partial<TreeDiagnostic> = {}): TreeDiagnostic {
  return {
    index: 0,
    kind: "mismatch",
    expected: "uint",
    message: 'expected type uint, got text "20"',
    path: "$[0].age",
    pathLabel: "$[0].age",
    position: { offset: 17, length: 3 },
    title: 'mismatch at $[0].age (expected uint) — expected type uint, got text "20"',
    held: false,
    ...over,
  };
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("placementOf", () => {
  const rows: TreeDiagnosticRows = new Map([
    ["17:3", [diagnostic({ index: 0 }), diagnostic({ index: 2, kind: "generic" })]],
    ["$[1]", [diagnostic({ index: 5, held: true })]],
  ]);

  test("finds the row a diagnostic sits on, own or held", () => {
    expect(placementOf(rows, 2)).toEqual({ key: "17:3", diagnostic: diagnostic({ index: 2, kind: "generic" }) });
    expect(placementOf(rows, 5)?.key).toBe("$[1]");
    expect(placementOf(rows, 5)?.diagnostic.held).toBe(true);
  });

  test("is null for a diagnostic no row carries, and with nothing to look in", () => {
    expect(placementOf(rows, 7)).toBeNull();
    expect(placementOf(rows, null)).toBeNull();
    expect(placementOf(rows, undefined)).toBeNull();
    expect(placementOf(null, 0)).toBeNull();
    expect(placementOf(undefined, 0)).toBeNull();
  });
});

describe("selectedIn", () => {
  const list = [diagnostic({ index: 3 }), diagnostic({ index: 4 })];
  test("the row's own entry for the selected index", () => {
    expect(selectedIn(list, 4)).toBe(list[1]);
    expect(selectedIn(list, 9)).toBeNull();
    expect(selectedIn(list, null)).toBeNull();
    expect(selectedIn(list, undefined)).toBeNull();
    expect(selectedIn([], 0)).toBeNull();
  });
});

describe("nextSelection", () => {
  const list = [diagnostic({ index: 3 }), diagnostic({ index: 8 })];

  test("cycles through the row's diagnostics, then off", () => {
    expect(nextSelection(list, null)).toBe(3);
    expect(nextSelection(list, 3)).toBe(8);
    expect(nextSelection(list, 8)).toBeNull();
  });

  test("a selection elsewhere starts the row from its first", () => {
    expect(nextSelection(list, 99)).toBe(3);
  });

  test("a row with one diagnostic toggles it", () => {
    const one = [diagnostic({ index: 6 })];
    expect(nextSelection(one, null)).toBe(6);
    expect(nextSelection(one, 6)).toBeNull();
    expect(nextSelection([], null)).toBeNull();
  });
});

describe("badge text", () => {
  test("one diagnostic reads its kind, several read the count", () => {
    expect(badgeText([diagnostic()])).toBe("✗ mismatch");
    expect(badgeText([diagnostic({ kind: "generic" })])).toBe("✗ generic");
    expect(badgeText([diagnostic({ index: 0 }), diagnostic({ index: 1 })])).toBe("✗ 2");
  });

  test("a row holding others' diagnostics says what it holds", () => {
    expect(badgeText([diagnostic({ held: true })])).toBe("⚠ holds 1 mismatch");
    expect(badgeText([diagnostic({ index: 0, held: true }), diagnostic({ index: 1, held: true })]))
      .toBe("⚠ holds 2 mismatches");
    expect(badgeText([diagnostic({ index: 0 }), diagnostic({ index: 1, held: true })])).toBe("✗ 2");
  });

  test("holdsLabel pluralises", () => {
    expect(holdsLabel(1)).toBe("holds 1 mismatch");
    expect(holdsLabel(3)).toBe("holds 3 mismatches");
  });

  test("the title is every diagnostic's one-liner", () => {
    expect(badgeTitle([diagnostic({ title: "a" }), diagnostic({ title: "b" })])).toBe("a\nb");
  });

  test("the label names what the badge is, where the text is only a count", () => {
    expect(badgeLabel([diagnostic()])).toBe("mismatch");
    expect(badgeLabel([diagnostic({ kind: "generic" })])).toBe("generic mismatch");
    expect(badgeLabel([diagnostic(), diagnostic({ index: 1 })])).toBe("2 mismatches on this row");
    expect(badgeLabel([diagnostic({ held: true }), diagnostic({ index: 1, held: true })])).toBe("holds 2 mismatches");
  });
});

describe("DiagnosticBadge", () => {
  const markup = (list: readonly TreeDiagnostic[], selected: number | null) =>
    renderToStaticMarkup(
      <DiagnosticBadge diagnostics={list} selected={selected} onSelect={() => {}} className="badge" />,
    );

  test("is a button carrying the text, the joined titles and the pressed state", () => {
    const html = markup([diagnostic({ title: "one" })], null);
    expect(html).toContain('<button type="button" class="badge"');
    expect(html).toContain('title="one"');
    expect(html).toContain('aria-label="mismatch"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">✗ mismatch</button>");
    const pressed = markup([diagnostic({ index: 4, title: "one" }), diagnostic({ index: 5, title: "two" })], 4);
    expect(pressed).toContain('aria-pressed="true"');
    expect(pressed).toContain('title="one\ntwo"');
    expect(pressed).toContain('aria-label="2 mismatches on this row"');
    expect(pressed).toContain(">✗ 2</button>");
  });

  test("a row that only holds others' diagnostics carries the holds class", () => {
    const html = markup([diagnostic({ held: true })], null);
    expect(html).toContain('class="badge badge-holds"');
    expect(html).toContain('aria-label="holds 1 mismatch"');
    expect(html).toContain(">⚠ holds 1 mismatch</button>");
    expect(markup([diagnostic(), diagnostic({ index: 1, held: true })], null)).toContain('class="badge"');
  });
});

describe("DiagnosticCaption", () => {
  const markup = (d: TreeDiagnostic, onRevealBytes?: () => void) =>
    renderToStaticMarkup(<DiagnosticCaption diagnostic={d} className="cap" onRevealBytes={onRevealBytes} />);

  test("kind, expected type and message, each in its own element", () => {
    const html = markup(diagnostic(), () => {});
    expect(html).toContain('<span class="cap-kind">mismatch</span>');
    expect(html).toContain("expected <code>uint</code>");
    expect(html).toContain('<div class="cap-message">expected type uint, got text &quot;20&quot;</div>');
    expect(count(html, "show bytes")).toBe(1);
    expect(html).toContain('class="cap-link"');
  });

  test("no expected type, no `expected`", () => {
    const html = markup(diagnostic({ expected: null }), () => {});
    expect(html).not.toContain("expected <code>");
  });

  test("the bytes link needs bytes and a handler", () => {
    expect(markup(diagnostic({ position: null }), () => {})).not.toContain("show bytes");
    expect(markup(diagnostic({ position: { offset: 0, length: 0 } }), () => {})).not.toContain("show bytes");
    expect(markup(diagnostic())).not.toContain("show bytes");
  });

  test("a held diagnostic says where it really is", () => {
    const own = markup(diagnostic());
    expect(own).not.toContain(" at <code>");
    const held = markup(diagnostic({ held: true, pathLabel: "$[0].age" }));
    expect(held).toContain(" at <code>$[0].age</code>");
    expect(markup(diagnostic({ held: true, pathLabel: null }))).not.toContain(" at <code>");
  });
});
