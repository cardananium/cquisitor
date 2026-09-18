import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import CddlEditor, {
  INDENT,
  indentEdit,
  lineBlock,
  newlineEdit,
  pointerMove,
  charAtPointer,
  type FrameSlot,
  type OverlayMark,
} from "./CddlEditor";
import { PRIORITY_LINKED, PRIORITY_PINNED } from "./pinResolvers";

/** Applies an edit the way the editor does. */
function apply(value: string, edit: ReturnType<typeof indentEdit>): string {
  if (!edit) return value;
  return value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}

const SRC = "a = {\n  b: uint,\n  c: tstr,\n}\n";

describe("lineBlock", () => {
  test("covers the whole line the caret is on", () => {
    expect(lineBlock(SRC, 8, 8)).toEqual([6, 16]);
    expect(SRC.slice(6, 16)).toBe("  b: uint,");
  });

  test("extends over every line a selection touches", () => {
    expect(lineBlock(SRC, 8, 20)).toEqual([6, 27]);
  });

  test("a caret at the start of the text starts at 0", () => {
    expect(lineBlock(SRC, 0, 0)).toEqual([0, 5]);
  });

  test("the last line runs to the end when it has no newline", () => {
    expect(lineBlock("x = int", 3, 3)).toEqual([0, 7]);
  });
});

describe("indentEdit", () => {
  test("a caret indents at the caret", () => {
    const edit = indentEdit(SRC, 6, 6, false);
    expect(edit).not.toBeNull();
    expect(apply(SRC, edit)).toBe("a = {\n    b: uint,\n  c: tstr,\n}\n");
    expect(edit!.selection).toEqual([6 + INDENT.length, 6 + INDENT.length]);
  });

  test("a selection inside one line is replaced by the indent", () => {
    const edit = indentEdit(SRC, 6, 8, false)!;
    expect(apply(SRC, edit)).toBe("a = {\n  b: uint,\n  c: tstr,\n}\n");
    expect(edit.from).toBe(6);
    expect(edit.to).toBe(8);
  });

  test("a selection spanning lines indents each of them", () => {
    const edit = indentEdit(SRC, 8, 20, false)!;
    expect(apply(SRC, edit)).toBe("a = {\n    b: uint,\n    c: tstr,\n}\n");
    expect(edit.selection).toEqual([8 + INDENT.length, 20 + 2 * INDENT.length]);
  });

  test("blank lines in a block are left alone", () => {
    const src = "a = 1\n\nb = 2\n";
    const edit = indentEdit(src, 0, 8, false)!;
    expect(apply(src, edit)).toBe("  a = 1\n\n  b = 2\n");
  });

  test("shift+tab outdents the caret's line", () => {
    const edit = indentEdit(SRC, 10, 10, true)!;
    expect(apply(SRC, edit)).toBe("a = {\nb: uint,\n  c: tstr,\n}\n");
  });

  test("shift+tab removes a single leading space when there is no full indent", () => {
    const src = " a = 1\n";
    expect(apply(src, indentEdit(src, 3, 3, true))).toBe("a = 1\n");
  });

  test("outdenting a line with no leading whitespace is not an edit", () => {
    expect(indentEdit("a = 1\n", 2, 2, true)).toBeNull();
  });

  test("outdent keeps the selection inside the line it shrank", () => {
    const edit = indentEdit(SRC, 6, 16, true)!;
    expect(edit.selection[0]).toBe(6);
    expect(edit.selection[1]).toBe(16 - INDENT.length);
  });
});

describe("newlineEdit", () => {
  test("carries the current line's indentation", () => {
    // Caret at the end of "  b: uint,".
    const edit = newlineEdit(SRC, 16, 16);
    expect(edit.text).toBe("\n  ");
    expect(edit.selection).toEqual([19, 19]);
  });

  test("an unindented line gets a plain newline", () => {
    expect(newlineEdit(SRC, 5, 5).text).toBe("\n");
  });

  test("indentation is taken from the text before the caret only", () => {
    // Caret between the two spaces of the indent.
    expect(newlineEdit(SRC, 7, 7).text).toBe("\n ");
  });

  test("a selection is replaced by the newline", () => {
    const edit = newlineEdit(SRC, 6, 16);
    expect(edit.from).toBe(6);
    expect(edit.to).toBe(16);
    expect(edit.text).toBe("\n");
  });
});

describe("pointerMove", () => {
  /** Frame scheduler that runs nothing until told to. */
  function frames() {
    const queued: Array<() => void> = [];
    return {
      queued,
      schedule: (callback: () => void) => queued.push(callback),
      run: () => {
        const due = queued.splice(0);
        for (const callback of due) callback();
      },
    };
  }

  test("the offset goes out on the event, whether or not a frame ever runs", () => {
    const frame: FrameSlot = { current: null };
    const offsets: Array<[number, number]> = [];
    const tips: Array<[number, number]> = [];
    const { schedule } = frames();
    pointerMove(frame, 91, 213, (x, y) => offsets.push([x, y]), (x, y) => tips.push([x, y]), schedule);
    expect(offsets).toEqual([[91, 213]]);
    expect(tips).toEqual([]);
  });

  test("a move while a frame is pending still emits its offset, and folds its tip into that frame", () => {
    const frame: FrameSlot = { current: null };
    const offsets: Array<[number, number]> = [];
    const tips: Array<[number, number]> = [];
    const { queued, schedule, run } = frames();
    pointerMove(frame, 1, 1, (x, y) => offsets.push([x, y]), (x, y) => tips.push([x, y]), schedule);
    pointerMove(frame, 2, 2, (x, y) => offsets.push([x, y]), (x, y) => tips.push([x, y]), schedule);
    expect(offsets).toEqual([[1, 1], [2, 2]]);
    expect(queued.length).toBe(1);
    expect(frame.current).not.toBeNull();
    run();
    expect(tips).toEqual([[1, 1]]);
    expect(frame.current).toBeNull();
    pointerMove(frame, 3, 3, (x, y) => offsets.push([x, y]), (x, y) => tips.push([x, y]), schedule);
    expect(queued.length).toBe(1);
    expect(offsets.length).toBe(3);
  });
});

describe("the hover mark in the overlay", () => {
  const value = "Person = {\n  name: tstr,\n  age: uint,\n}\n";
  const tstr: [number, number] = [value.indexOf("tstr"), value.indexOf("tstr") + 4];
  const hover: OverlayMark = { range: tstr, className: "cddl-editor-linked-mark", priority: PRIORITY_LINKED };
  const markup = (props: { marks?: OverlayMark[]; hoverMark?: OverlayMark | null }) =>
    renderToStaticMarkup(<CddlEditor value={value} onChange={() => {}} {...props} />);

  /** Text inside every `<mark class="…">` of `html`, by class. */
  const marksIn = (html: string) =>
    Array.from(html.matchAll(/<mark class="([^"]+)"[^>]*>(.*?)<\/mark>/g)).map(m => [
      m[1],
      m[2].replace(/<[^>]+>/g, ""),
    ]);

  test("wraps exactly the hovered construct in the linked mark", () => {
    expect(marksIn(markup({ hoverMark: hover }))).toEqual([["cddl-editor-linked-mark", "tstr"]]);
  });

  test("a pinned mark on the same range wins, and no linked mark is painted", () => {
    const pinned: OverlayMark = { range: tstr, className: "cddl-editor-pinned-mark", priority: PRIORITY_PINNED };
    const html = markup({ marks: [pinned], hoverMark: hover });
    expect(marksIn(html)).toEqual([["cddl-editor-pinned-mark", "tstr"]]);
    expect(html).not.toContain("cddl-editor-linked-mark");
  });

  test("without a hover mark the overlay carries no mark at all", () => {
    expect(marksIn(markup({ hoverMark: null }))).toEqual([]);
    expect(marksIn(markup({}))).toEqual([]);
  });

  test("the hover mark's message is the mark's title, and none means no title", () => {
    expect(markup({ hoverMark: { ...hover, message: "U8 value at $.age" } }))
      .toContain('<mark class="cddl-editor-linked-mark" title="U8 value at $.age">');
    expect(markup({ hoverMark: hover })).toContain('<mark class="cddl-editor-linked-mark">');
  });

  test("the overlay's text is the value, mark or no mark", () => {
    const text = (html: string) =>
      (html.match(/<pre[^>]*>([^]*?)<\/pre>/)?.[1] ?? "").replace(/<[^>]+>/g, "");
    expect(text(markup({ hoverMark: hover }))).toBe(value);
    expect(text(markup({}))).toBe(value);
  });
});

describe("charAtPointer", () => {
  // `name: tstr,` from x=100 in 8px cells: `t` of tstr is offset 6 at [148, 156).
  const line = "name: tstr, age";
  const cell = 8;
  const boundaryLeft = (offset: number) => 100 + offset * cell;
  /** Hit-test at `x`: nearest boundary and its left. */
  const hit = (x: number) => {
    const offset = Math.min(line.length, Math.max(0, Math.round((x - 100) / cell)));
    return charAtPointer(x, offset, boundaryLeft(offset), cell, line);
  };

  test("the left half of a cell names its own boundary and is on the character", () => {
    expect(charAtPointer(149, 6, 148, cell, line)).toBe(6);
    expect(charAtPointer(148, 6, 148, cell, line)).toBe(6);
  });

  test("the right half of a cell snaps to the next boundary and is still on the character", () => {
    // Right half of `t`: hit-test names boundary 7, whose box starts to the right of the pointer.
    expect(charAtPointer(153, 7, 156, cell, line)).toBe(6);
    expect(charAtPointer(155.9, 7, 156, cell, line)).toBe(6);
  });

  test("a sweep across a token lands on it at every pixel", () => {
    const seen = new Set<number | null>();
    for (let x = 148; x < 180; x += 0.5) seen.add(hit(x));
    expect(seen).toEqual(new Set([6, 7, 8, 9]));
  });

  test("the right half of a token's last character is on that character, not the comma", () => {
    // `r` is offset 9 at [172, 180); its right half snaps to boundary 10.
    expect(hit(178)).toBe(9);
    expect(hit(179.5)).toBe(9);
  });

  test("blank space past the line's end is refused", () => {
    // Past the last character the hit-test names the end boundary; there is no cell to its right.
    const end = line.length;
    expect(charAtPointer(400, end, boundaryLeft(end), cell, line)).toBeNull();
    expect(charAtPointer(boundaryLeft(end) + 1, end, boundaryLeft(end), cell, line)).toBeNull();
  });

  test("a pointer more than a cell from the boundary it snapped to is refused", () => {
    expect(charAtPointer(139, 6, 148, cell, line)).toBeNull();
    expect(charAtPointer(157, 6, 148, cell, line)).toBeNull();
  });

  test("whitespace is no construct on either side of the boundary", () => {
    // Boundary 5 sits between `:` and the space; the space's cell is [140, 148).
    expect(charAtPointer(141, 5, 140, cell, line)).toBeNull();
    expect(charAtPointer(147, 6, 148, cell, line)).toBeNull();
    expect(charAtPointer(98, 0, 100, cell, "\nx")).toBeNull();
    expect(charAtPointer(98, 1, 100, cell, "\nx")).toBeNull();
  });

  test("a boundary with no rect answers with its own character", () => {
    expect(charAtPointer(300, 6, 300, Infinity, line)).toBe(6);
    expect(charAtPointer(300, 5, 300, Infinity, line)).toBeNull();
  });
});
