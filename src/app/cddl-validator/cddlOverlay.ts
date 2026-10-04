// CDDL editor highlight overlay: split source into runs of one syntax class and one winning mark.
// The editor paints a `pre` under a transparent textarea; this module is a pure function of its inputs.

import type { SyntaxToken } from "./cddlSyntax";

/** One overlay highlight. Higher `priority` wins on overlap. */
export interface OverlayMark {
  range: [number, number];
  className: string;
  message?: string | null;
  /** Higher priority wins overlap. Default 0. */
  priority?: number;
}

/** Mark clamped to the current text, with a sort priority. */
export interface NormalisedMark {
  start: number;
  end: number;
  className: string;
  message: string | null;
  priority: number;
}

/** Run of text with one syntax class and at most one mark. */
export interface OverlaySegment {
  start: number;
  end: number;
  text: string;
  syntaxClassName: string | null;
  mark: NormalisedMark | null;
}

/**
 * Clamp mark ranges to `[0, valueLength]`, drop empties, and widen a zero-width mark to one character.
 * Marks may come from an older revision of the text, so out-of-range values are expected.
 */
export function normaliseMarks(
  rawMarks: ReadonlyArray<OverlayMark> | undefined | null,
  valueLength: number,
): NormalisedMark[] {
  if (!rawMarks || rawMarks.length === 0) return [];
  const out: NormalisedMark[] = [];
  for (const m of rawMarks) {
    const s = Math.max(0, Math.min(m.range[0], valueLength));
    const e = Math.max(s, Math.min(m.range[1], valueLength));
    const end = s === e ? Math.min(s + 1, valueLength) : e;
    if (end <= s) continue;
    out.push({
      start: s,
      end,
      className: m.className,
      message: m.message ?? null,
      priority: m.priority ?? 0,
    });
  }
  return out;
}

/**
 * Cut `value` at every syntax-run and mark boundary so each segment has one syntax class and one winning mark.
 * Segments tile `[0, value.length)` in order; `syntax` is walked with a cursor (ascending, non-overlapping).
 */
export function overlaySegments(
  value: string,
  syntax: ReadonlyArray<SyntaxToken>,
  marks: ReadonlyArray<NormalisedMark>,
): OverlaySegment[] {
  return segmentAt(value, syntax, marks, cutPoints(value, syntax, marks, false));
}

/** Offsets the segmentation has to break at. */
function cutPoints(
  value: string,
  syntax: ReadonlyArray<SyntaxToken>,
  marks: ReadonlyArray<NormalisedMark>,
  atLineStarts: boolean,
): number[] {
  const cuts = new Set<number>([0, value.length]);
  for (const r of syntax) {
    if (r.start > 0 && r.start < value.length) cuts.add(r.start);
    if (r.end > 0 && r.end < value.length) cuts.add(r.end);
  }
  for (const m of marks) {
    if (m.start > 0 && m.start < value.length) cuts.add(m.start);
    if (m.end > 0 && m.end < value.length) cuts.add(m.end);
  }
  if (atLineStarts) {
    for (let nl = value.indexOf("\n"); nl !== -1; nl = value.indexOf("\n", nl + 1)) {
      if (nl + 1 < value.length) cuts.add(nl + 1);
    }
  }
  return [...cuts].sort((a, b) => a - b);
}

function segmentAt(
  value: string,
  syntax: ReadonlyArray<SyntaxToken>,
  marks: ReadonlyArray<NormalisedMark>,
  points: ReadonlyArray<number>,
): OverlaySegment[] {
  const out: OverlaySegment[] = [];
  let syntaxCursor = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;

    while (syntaxCursor < syntax.length && syntax[syntaxCursor].end <= start) syntaxCursor++;
    const run = syntax[syntaxCursor];
    const syntaxClassName = run && run.start <= start && start < run.end ? run.className : null;

    let mark: NormalisedMark | null = null;
    for (const m of marks) {
      if (m.start <= start && start < m.end && (mark === null || m.priority > mark.priority)) {
        mark = m;
      }
    }

    out.push({ start, end, text: value.slice(start, end), syntaxClassName, mark });
  }
  return out;
}

/** Segments of one source line and the range they cover. The ending newline belongs to the line. */
export interface OverlayLine {
  start: number;
  end: number;
  segments: OverlaySegment[];
}

/**
 * Same segmentation as `overlaySegments`, additionally cut at every line start and grouped per line.
 * Typing one character changes one line; handing the editor lines lets it keep the other rendered nodes.
 */
export function overlayLines(
  value: string,
  syntax: ReadonlyArray<SyntaxToken>,
  marks: ReadonlyArray<NormalisedMark>,
): OverlayLine[] {
  const segments = segmentAt(value, syntax, marks, cutPoints(value, syntax, marks, true));
  const out: OverlayLine[] = [];
  let current: OverlaySegment[] = [];
  let start = 0;
  for (const seg of segments) {
    if (current.length === 0) start = seg.start;
    current.push(seg);
    // A cut sits after every newline, so a newline is only ever the last character of a segment.
    if (seg.text.charCodeAt(seg.text.length - 1) === 10 /* \n */) {
      out.push({ start, end: seg.end, segments: current });
      current = [];
    }
  }
  if (current.length > 0) out.push({ start, end: current[current.length - 1].end, segments: current });
  return out;
}

/** `segment` cut down to `[start, end)`, carrying `mark`. */
function cutSegment(
  segment: OverlaySegment,
  start: number,
  end: number,
  mark: NormalisedMark | null,
): OverlaySegment {
  return {
    start,
    end,
    text: segment.text.slice(start - segment.start, end - segment.start),
    syntaxClassName: segment.syntaxClassName,
    mark,
  };
}

/**
 * `lines` with one more mark laid over them, recutting only the lines the mark touches.
 * Untouched lines keep identity; equal-or-higher existing marks stay. `mark` must be normalised.
 */
export function layerMark(
  lines: ReadonlyArray<OverlayLine>,
  mark: NormalisedMark | null,
): ReadonlyArray<OverlayLine> {
  if (!mark || mark.end <= mark.start || lines.length === 0) return lines;
  // The first line that ends after the mark starts.
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].end > mark.start) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= lines.length || lines[lo].start >= mark.end) return lines;

  const out = lines.slice();
  for (let i = lo; i < lines.length && lines[i].start < mark.end; i++) {
    const line = lines[i];
    const segments: OverlaySegment[] = [];
    for (const seg of line.segments) {
      if (seg.end <= mark.start || seg.start >= mark.end) {
        segments.push(seg);
        continue;
      }
      const start = Math.max(seg.start, mark.start);
      const end = Math.min(seg.end, mark.end);
      const winner = seg.mark && seg.mark.priority >= mark.priority ? seg.mark : mark;
      if (start > seg.start) segments.push(cutSegment(seg, seg.start, start, seg.mark));
      segments.push(
        winner === seg.mark && start === seg.start && end === seg.end
          ? seg
          : cutSegment(seg, start, end, winner),
      );
      if (end < seg.end) segments.push(cutSegment(seg, end, seg.end, seg.mark));
    }
    out[i] = { start: line.start, end: line.end, segments };
  }
  return out;
}

/**
 * Whether two segment lists would paint identically (text, syntax class, winning mark class and message).
 * Marks are rebuilt on every keystroke, so object identity would report every marked line as changed.
 */
export function sameSegments(
  a: ReadonlyArray<OverlaySegment>,
  b: ReadonlyArray<OverlaySegment>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.text !== y.text || x.syntaxClassName !== y.syntaxClassName) return false;
    const mx = x.mark;
    const my = y.mark;
    if (mx === my) continue;
    if (!mx || !my) return false;
    if (mx.className !== my.className || mx.message !== my.message) return false;
  }
  return true;
}

/**
 * Whether the overlay must reserve the extra empty line a `<textarea>` shows when the text has no trailing newline.
 * Adding one unconditionally would grow the overlay whenever the text already ends in a newline.
 */
export function needsPhantomNewline(value: string): boolean {
  return !value.endsWith("\n");
}
