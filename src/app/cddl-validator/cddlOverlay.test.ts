import { describe, expect, test } from "bun:test";
import { tokenizeCddl, type SyntaxToken } from "./cddlSyntax";
import {
  layerMark,
  needsPhantomNewline,
  normaliseMarks,
  overlayLines,
  overlaySegments,
  sameSegments,
  type NormalisedMark,
  type OverlayLine,
  type OverlayMark,
} from "./cddlOverlay";

const SCHEMA = `; a comment
Person = {
  name: tstr,
  age: uint,
}
`;

/** Marks normalised against the text they cover. */
function segmentsFor(value: string, rawMarks: OverlayMark[] = []) {
  return overlaySegments(value, tokenizeCddl(value), normaliseMarks(rawMarks, value.length));
}

describe("normaliseMarks", () => {
  test("keeps a range that is inside the text", () => {
    expect(normaliseMarks([{ range: [3, 7], className: "m" }], 20)).toEqual([
      { start: 3, end: 7, className: "m", message: null, priority: 0 },
    ]);
  });

  test("defaults priority to 0 and message to null", () => {
    const [m] = normaliseMarks([{ range: [0, 1], className: "m" }], 5);
    expect(m.priority).toBe(0);
    expect(m.message).toBeNull();
  });

  test("clamps a range that runs past the end of the text", () => {
    expect(normaliseMarks([{ range: [3, 99], className: "m" }], 10)[0].end).toBe(10);
    expect(normaliseMarks([{ range: [-4, 3], className: "m" }], 10)[0].start).toBe(0);
  });

  test("widens a zero-width mark to one character", () => {
    expect(normaliseMarks([{ range: [4, 4], className: "m" }], 10)[0]).toMatchObject({ start: 4, end: 5 });
  });

  test("drops a mark with nothing left to cover", () => {
    // A caret-width mark at the very end has no character to widen onto.
    expect(normaliseMarks([{ range: [10, 10], className: "m" }], 10)).toEqual([]);
    expect(normaliseMarks([{ range: [40, 50], className: "m" }], 10)).toEqual([]);
    expect(normaliseMarks([], 10)).toEqual([]);
    expect(normaliseMarks(undefined, 10)).toEqual([]);
  });

  test("a reversed range covers the one character it starts on", () => {
    expect(normaliseMarks([{ range: [7, 3], className: "m" }], 10)[0]).toMatchObject({ start: 7, end: 8 });
  });
});

describe("overlaySegments", () => {
  test("segments tile the whole text with no gap and no overlap", () => {
    const segments = segmentsFor(SCHEMA, [
      { range: [14, 24], className: "err", priority: 100 },
      { range: [0, 11], className: "ref", priority: 40 },
    ]);
    let cursor = 0;
    for (const s of segments) {
      expect(s.start).toBe(cursor);
      expect(s.end).toBeGreaterThan(s.start);
      expect(s.text).toBe(SCHEMA.slice(s.start, s.end));
      cursor = s.end;
    }
    expect(cursor).toBe(SCHEMA.length);
    expect(segments.map(s => s.text).join("")).toBe(SCHEMA);
  });

  test("holds up on a schema the size of a real ledger era", () => {
    const big = Array.from({ length: 800 }, (_, i) => `rule_${i} = { a: uint, b: tstr }\n`).join("");
    const marks: OverlayMark[] = Array.from({ length: 60 }, (_, i) => ({
      range: [i * 137, i * 137 + 9] as [number, number],
      className: "err",
      priority: i,
    }));
    const segments = segmentsFor(big, marks);
    expect(segments.map(s => s.text).join("")).toBe(big);
    let cursor = 0;
    for (const s of segments) {
      expect(s.start).toBe(cursor);
      cursor = s.end;
    }
    expect(cursor).toBe(big.length);
  });

  test("the cursor-walked syntax class matches a linear search at every segment", () => {
    const syntax = tokenizeCddl(SCHEMA);
    const marks = normaliseMarks([{ range: [14, 24], className: "err", priority: 100 }], SCHEMA.length);
    for (const s of overlaySegments(SCHEMA, syntax, marks)) {
      const linear = syntax.find((r: SyntaxToken) => r.start <= s.start && s.start < r.end);
      expect(s.syntaxClassName).toBe(linear?.className ?? null);
    }
  });

  test("a mark spanning several syntax runs is cut at every run boundary", () => {
    const value = "age: uint,";
    const marked = segmentsFor(value, [{ range: [0, value.length], className: "err" }])
      .filter(s => s.mark !== null);
    expect(marked.length).toBeGreaterThan(1);
    expect(marked.map(s => s.text).join("")).toBe(value);
    expect(new Set(marked.map(s => s.syntaxClassName)).size).toBeGreaterThan(1);
  });

  test("the higher-priority mark wins where two overlap", () => {
    const value = "abcdefgh";
    const segments = segmentsFor(value, [
      { range: [0, 6], className: "low", priority: 10 },
      { range: [2, 8], className: "high", priority: 90 },
    ]);
    const classAt = (i: number) => segments.find(s => s.start <= i && i < s.end)?.mark?.className;
    expect(classAt(0)).toBe("low");
    expect(classAt(3)).toBe("high");
    expect(classAt(7)).toBe("high");
  });

  test("equal priorities leave the first mark in place", () => {
    const segments = segmentsFor("abcdefgh", [
      { range: [0, 8], className: "first", priority: 50 },
      { range: [0, 8], className: "second", priority: 50 },
    ]);
    expect(segments.every(s => s.mark?.className === "first")).toBe(true);
  });

  test("text with no marks is still cut into its syntax runs", () => {
    const segments = segmentsFor("age: uint");
    expect(segments.every(s => s.mark === null)).toBe(true);
    expect(segments.map(s => s.text).join("")).toBe("age: uint");
  });

  test("empty text produces no segments", () => {
    expect(segmentsFor("")).toEqual([]);
    expect(overlaySegments("", [], [])).toEqual([]);
  });
});

/** Same segmentation, grouped per line. */
function linesFor(value: string, rawMarks: OverlayMark[] = []) {
  return overlayLines(value, tokenizeCddl(value), normaliseMarks(rawMarks, value.length));
}

describe("overlayLines", () => {
  test("the lines' text is the source again, newlines included", () => {
    const lines = linesFor(SCHEMA);
    expect(lines.map(l => l.segments.map(s => s.text).join("")).join("")).toBe(SCHEMA);
    expect(lines.length).toBe(SCHEMA.split("\n").length - 1);
  });

  test("no segment carries a newline anywhere but at its end", () => {
    for (const line of linesFor(SCHEMA, [{ range: [0, SCHEMA.length], className: "err" }])) {
      for (const s of line.segments) {
        expect(s.text.slice(0, -1)).not.toInclude("\n");
      }
    }
  });

  test("a line's range covers exactly the segments in it", () => {
    for (const line of linesFor(SCHEMA)) {
      expect(line.start).toBe(line.segments[0].start);
      expect(line.end).toBe(line.segments[line.segments.length - 1].end);
      expect(SCHEMA.slice(line.start, line.end)).toBe(line.segments.map(s => s.text).join(""));
    }
  });

  test("text with no trailing newline still ends in a line", () => {
    const lines = linesFor("a = int\nb = tstr");
    expect(lines.length).toBe(2);
    expect(lines[1].segments.map(s => s.text).join("")).toBe("b = tstr");
  });

  test("a run of blank lines is one line each", () => {
    expect(linesFor("\n\n\n").length).toBe(3);
  });

  test("empty text produces no lines", () => {
    expect(linesFor("")).toEqual([]);
  });

  test("a mark spanning a newline is cut at the line break", () => {
    const value = "a = int\nb = tstr\n";
    const lines = linesFor(value, [{ range: [0, value.length], className: "err" }]);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.segments.every(s => s.mark?.className === "err")).toBe(true);
    }
  });

  test("every line's segments match what the flat segmentation says at that offset", () => {
    const marks: OverlayMark[] = [{ range: [14, 24], className: "err", priority: 100 }];
    const flat = segmentsFor(SCHEMA, marks);
    const classAt = (i: number) => flat.find(s => s.start <= i && i < s.end)?.syntaxClassName ?? null;
    const markAt = (i: number) => flat.find(s => s.start <= i && i < s.end)?.mark?.className ?? null;
    for (const line of linesFor(SCHEMA, marks)) {
      for (const s of line.segments) {
        expect(s.syntaxClassName).toBe(classAt(s.start));
        expect(s.mark?.className ?? null).toBe(markAt(s.start));
      }
    }
  });
});

describe("layerMark", () => {
  /** Mark as the editor hands it over: normalised against the text. */
  const hover = (value: string, range: [number, number], priority = 60): NormalisedMark =>
    normaliseMarks([{ range, className: "hover", priority, message: "hover" }], value.length)[0];

  /** What every line paints, as `(text, mark class)` runs. */
  const painted = (lines: ReadonlyArray<OverlayLine>) =>
    lines.map(l => l.segments.map(s => [s.text, s.mark?.className ?? null]));

  test("no mark hands the same array back", () => {
    const lines = linesFor(SCHEMA);
    expect(layerMark(lines, null)).toBe(lines);
  });

  test("the lines the mark does not touch are the same objects", () => {
    const lines = linesFor(SCHEMA);
    // `age` on the fourth line.
    const at = SCHEMA.indexOf("age");
    const layered = layerMark(lines, hover(SCHEMA, [at, at + 3]));
    expect(layered).not.toBe(lines);
    expect(layered.length).toBe(lines.length);
    layered.forEach((line, i) => {
      if (i === 3) expect(line).not.toBe(lines[i]);
      else expect(line).toBe(lines[i]);
    });
  });

  test("a touched line is cut at the mark's bounds, with the mark on the inside only", () => {
    const lines = linesFor(SCHEMA);
    const at = SCHEMA.indexOf("age");
    const layered = layerMark(lines, hover(SCHEMA, [at, at + 3]));
    const line = layered[3];
    expect(line.segments.map(s => s.text).join("")).toBe("  age: uint,\n");
    expect(line.start).toBe(lines[3].start);
    expect(line.end).toBe(lines[3].end);
    const marked = line.segments.filter(s => s.mark !== null);
    expect(marked.map(s => s.text).join("")).toBe("age");
    expect(marked.every(s => s.mark?.className === "hover")).toBe(true);
    for (const seg of line.segments) {
      expect(seg.text).toBe(SCHEMA.slice(seg.start, seg.end));
      expect(seg.end).toBeGreaterThan(seg.start);
    }
    // Contiguous, as the segmentation it came from.
    line.segments.reduce((cursor, seg) => {
      expect(seg.start).toBe(cursor);
      return seg.end;
    }, line.start);
  });

  test("what a layered line paints is what a full segmentation with the mark paints", () => {
    const base: OverlayMark[] = [
      { range: [14, 24], className: "err", priority: 100 },
      { range: [0, 11], className: "ref", priority: 40 },
    ];
    for (const range of [[16, 20], [8, 30], [0, SCHEMA.length], [30, 45], [44, 45]] as [number, number][]) {
      const layered = layerMark(linesFor(SCHEMA, base), hover(SCHEMA, range));
      const whole = linesFor(SCHEMA, [...base, { range, className: "hover", priority: 60, message: "hover" }]);
      expect(painted(layered)).toEqual(painted(whole));
    }
  });

  test("a lower-priority hover loses to a pinned or error segment and beats a reference", () => {
    const value = "abcdefgh\n";
    const lines = linesFor(value, [
      { range: [0, 4], className: "pinned", priority: 120 },
      { range: [4, 8], className: "ref", priority: 40 },
    ]);
    const layered = layerMark(lines, hover(value, [2, 6]));
    const classAt = (i: number) =>
      layered[0].segments.find(s => s.start <= i && i < s.end)?.mark?.className ?? null;
    expect(classAt(1)).toBe("pinned");
    expect(classAt(3)).toBe("pinned");
    expect(classAt(4)).toBe("hover");
    expect(classAt(5)).toBe("hover");
    expect(classAt(6)).toBe("ref");
  });

  test("an equal priority keeps the mark already there", () => {
    const value = "abcdefgh\n";
    const lines = linesFor(value, [{ range: [0, 8], className: "first", priority: 60 }]);
    const layered = layerMark(lines, hover(value, [2, 6], 60));
    const letters = layered[0].segments.filter(s => s.start < 8);
    expect(letters.every(s => s.mark?.className === "first")).toBe(true);
  });

  test("a mark spanning a line break touches both lines and nothing else", () => {
    const value = "a = int\nb = tstr\nc = bool\n";
    const lines = linesFor(value);
    const layered = layerMark(lines, hover(value, [4, 12]));
    expect(layered[0]).not.toBe(lines[0]);
    expect(layered[1]).not.toBe(lines[1]);
    expect(layered[2]).toBe(lines[2]);
    const markedText = layered
      .flatMap(l => l.segments)
      .filter(s => s.mark !== null)
      .map(s => s.text)
      .join("");
    expect(markedText).toBe(value.slice(4, 12));
  });

  test("a mark past the end of the text touches nothing", () => {
    const lines = linesFor(SCHEMA);
    const past: NormalisedMark = { start: SCHEMA.length + 5, end: SCHEMA.length + 9, className: "hover", message: null, priority: 60 };
    expect(layerMark(lines, past)).toBe(lines);
    const empty: NormalisedMark = { start: 4, end: 4, className: "hover", message: null, priority: 60 };
    expect(layerMark(lines, empty)).toBe(lines);
    expect(layerMark([], hover(SCHEMA, [0, 3]))).toEqual([]);
  });

  test("the mark's own object is what the pieces carry", () => {
    const lines = linesFor(SCHEMA);
    const mark = hover(SCHEMA, [14, 18]);
    const marked = layerMark(lines, mark).flatMap(l => l.segments).filter(s => s.mark !== null);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every(s => s.mark === mark)).toBe(true);
  });
});

describe("sameSegments", () => {
  const value = "age: uint,\n";
  const plain = linesFor(value)[0].segments;

  test("a line compares equal to a fresh segmentation of the same text", () => {
    expect(sameSegments(plain, linesFor(value)[0].segments)).toBe(true);
  });

  test("the same text at another offset still compares equal", () => {
    // What a line one character further down the document looks like.
    const moved = linesFor(`x = int\n${value}`)[1].segments;
    expect(sameSegments(plain, moved)).toBe(true);
  });

  test("changed text compares unequal", () => {
    expect(sameSegments(plain, linesFor("age: uint;\n")[0].segments)).toBe(false);
    expect(sameSegments(plain, linesFor("age: tstr,\n")[0].segments)).toBe(false);
  });

  test("marks are compared by what they paint, not by identity", () => {
    const marked = () => linesFor(value, [{ range: [0, 3], className: "err", message: "boom" }])[0].segments;
    expect(sameSegments(marked(), marked())).toBe(true);
    expect(sameSegments(marked(), plain)).toBe(false);
    const other = linesFor(value, [{ range: [0, 3], className: "err", message: "different" }])[0].segments;
    expect(sameSegments(marked(), other)).toBe(false);
  });

  test("a different number of segments compares unequal", () => {
    expect(sameSegments(plain, plain.slice(1))).toBe(false);
  });
});

describe("needsPhantomNewline", () => {
  test("asked for only when the text does not already end in a newline", () => {
    expect(needsPhantomNewline("Person = int")).toBe(true);
    expect(needsPhantomNewline("Person = int\n")).toBe(false);
    expect(needsPhantomNewline("")).toBe(true);
    expect(needsPhantomNewline("\n\n")).toBe(false);
  });
});
