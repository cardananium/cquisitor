// Hex-view hover as DOM ranges over already-rendered runs.
// Markup is rebuilt when spans change; hover is painted on top so it is not.

import type { CborPosition } from "@cardananium/cquisitor-lib";

/** A byte range that keeps its own colour where the hover would cover it. */
export interface HexOccluder {
  offset: number;
  length: number;
}

/** A `[start, end)` range of hex characters. */
export type CharRange = [number, number];

/**
 * Hex characters of `hover` minus occluders, clamped to the text.
 * Zero-length occluders still cover one byte.
 */
export function hoverHexCharRanges(
  hover: CborPosition,
  hexLength: number,
  occluders: ReadonlyArray<HexOccluder>,
): CharRange[] {
  const start = Math.max(0, hover.offset * 2);
  const end = Math.min(hexLength, (hover.offset + hover.length) * 2);
  if (end <= start) return [];
  let ranges: CharRange[] = [[start, end]];
  for (const o of occluders) {
    const from = o.offset * 2;
    const to = (o.offset + Math.max(1, o.length)) * 2;
    const next: CharRange[] = [];
    for (const [s, e] of ranges) {
      if (to <= s || from >= e) {
        next.push([s, e]);
        continue;
      }
      if (from > s) next.push([s, from]);
      if (to < e) next.push([to, e]);
    }
    ranges = next;
    if (ranges.length === 0) break;
  }
  return ranges;
}

/** `hoverHexCharRanges` for each position. Duplicates are skipped so overlapping map rows are not painted darker. */
export function hoverHexCharRangesAll(
  positions: ReadonlyArray<CborPosition>,
  hexLength: number,
  occluders: ReadonlyArray<HexOccluder>,
): CharRange[] {
  if (positions.length === 1) return hoverHexCharRanges(positions[0], hexLength, occluders);
  const out: CharRange[] = [];
  const seen = new Set<number>();
  for (const p of positions) {
    const key = p.offset * 4294967296 + p.length;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const range of hoverHexCharRanges(p, hexLength, occluders)) out.push(range);
  }
  return out;
}

/**
 * Rendered runs in document order: `pos`/`len` per run; `inner` is a region's child runs, or `null`.
 * A region's inner runs are laid end to end and fill it.
 */
export interface RunAccessor {
  readonly length: number;
  pos(i: number): number;
  len(i: number): number;
  inner(i: number): RunAccessor | null;
}

/** Where a character offset falls among the runs. */
export interface RunLocation {
  /** Last run starting at or before the character; `-1` before the first. */
  run: number;
  /** Whether the character is inside that run, rather than in the plain text after it. */
  inside: boolean;
  /** Offset into the run's text, or into the text that follows it. */
  offset: number;
}

/** Binary-search the run holding `char`. */
export function locateRun(runs: RunAccessor, char: number): RunLocation {
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs.pos(mid) > char) hi = mid;
    else lo = mid + 1;
  }
  const run = lo - 1;
  if (run < 0) return { run: -1, inside: false, offset: char };
  const pos = runs.pos(run);
  const len = runs.len(run);
  if (char < pos + len) return { run, inside: true, offset: char - pos };
  return { run, inside: false, offset: char - pos - len };
}

/** Where a character offset falls, down to the run whose text holds it. */
export interface RunPoint extends RunLocation {
  /** Inner run holding the character when `run` is a region; `-1` otherwise. */
  inner: number;
}

/**
 * `locateRun` into a region. `offset` is then into the inner run; a short inner list snaps to the previous run's end.
 */
export function locatePoint(runs: RunAccessor, char: number): RunPoint {
  const at = locateRun(runs, char);
  if (!at.inside) return { ...at, inner: -1 };
  const nested = runs.inner(at.run);
  if (!nested || nested.length === 0) return { ...at, inner: -1 };
  const within = locateRun(nested, char);
  if (within.run < 0) return { run: at.run, inner: 0, inside: true, offset: 0 };
  if (within.inside) return { run: at.run, inner: within.run, inside: true, offset: within.offset };
  return { run: at.run, inner: within.run, inside: true, offset: nested.len(within.run) };
}

/** `runs` over the direct `data-pos` children of a rendered hex view, or of one of its regions. */
export function domRuns(root: HTMLElement): RunAccessor {
  const children = root.children;
  const holdsRuns = (el: Element) => el.firstChild !== null && el.firstChild.nodeType !== Node.TEXT_NODE;
  return {
    length: children.length,
    pos: (i) => Number(children[i].getAttribute("data-pos")),
    // Region length is on the element; no walk of inner runs.
    len: (i) => {
      const el = children[i];
      return holdsRuns(el)
        ? Number(el.getAttribute("data-len"))
        : el.firstChild?.nodeValue?.length ?? 0;
    },
    inner: (i) => {
      const el = children[i];
      return holdsRuns(el) ? domRuns(el as HTMLElement) : null;
    },
  };
}

/** DOM point at hex character `char` of `root`, or `null` if the rendered text ends before it. */
export function domPointAt(
  root: HTMLElement,
  runs: RunAccessor,
  char: number,
): [Node, number] | null {
  const at = locatePoint(runs, char);
  const asText = (node: Node | null, offset: number): [Node, number] | null =>
    node && node.nodeType === Node.TEXT_NODE
      ? [node, Math.min(offset, node.nodeValue?.length ?? 0)]
      : null;
  // The end of a run's text: its own, or its last inner run's.
  const textEnd = (el: Element): [Node, number] | null => {
    const last = el.lastElementChild ?? el;
    return asText(last.firstChild, last.firstChild?.nodeValue?.length ?? 0);
  };
  if (at.run < 0) return asText(root.firstChild, at.offset);
  const runEl = root.children[at.run];
  if (at.inside) {
    const el = at.inner < 0 ? runEl : runEl.children[at.inner];
    return asText(el.firstChild, at.offset);
  }
  // In the plain text after the run, or at the run's end if there is none.
  return asText(runEl.nextSibling, at.offset) ?? textEnd(runEl);
}

/**
 * Leaf run elements whose characters meet `[start, end)`. First run by binary search, then walk.
 * A partially covered run is included whole (Highlight API fallback).
 */
export function runElementsIn(
  root: HTMLElement,
  runs: RunAccessor,
  start: number,
  end: number,
  out: Element[] = [],
): Element[] {
  if (end <= start) return out;
  const at = locateRun(runs, start);
  let i = at.run < 0 ? 0 : at.run;
  for (; i < runs.length; i++) {
    const pos = runs.pos(i);
    if (pos >= end) break;
    if (pos + runs.len(i) <= start) continue;
    const el = root.children[i] as HTMLElement;
    const nested = runs.inner(i);
    if (nested) runElementsIn(el, nested, start, end, out);
    else out.push(el);
  }
  return out;
}
