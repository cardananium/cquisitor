// Where the hint card goes: beside its target while the target is on screen,
// docked to the top of the tab otherwise. Pure, in viewport coordinates.

export interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Side of the target the card sits on. */
export type CardSide = "below" | "above" | "right" | "left";

/** Where along the target's side the card lines up: with its start, its centre or its end. */
export type CardAlign = "start" | "center" | "end";

export interface CardPlacement {
  top: number;
  left: number;
  /**
   * The side of the target the card sits on; `over` when no side has room and
   * the card covers as little of the target as it can; `docked` at the top of
   * the tab.
   */
  mode: CardSide | "over" | "docked";
  /** Alignment along the side, for a card beside its target. */
  align?: CardAlign;
}

/** The side and alignment of a card beside its target. */
export interface CardAnchor {
  mode: CardSide;
  align: CardAlign;
}

export interface PlaceOptions {
  /** On-screen parts of the same target, which the card avoids when it can. */
  parts?: readonly Box[];
  /** The side and alignment the card had in the previous frame: kept while it still fits. */
  keep?: CardAnchor | null;
}

type Size = { width: number; height: number };

/** Space between the target and the card. */
const GAP = 10;
/** Space the card keeps from the viewport's edges. */
const MARGIN = 8;
/** Space around the target and its parts that the card leaves uncovered. */
export const CARD_CLEARANCE = 8;
/** A target must be taller than this, as well as taller than wide, to get the card beside it first. */
export const TALL_TARGET = 60;
const ALIGNS: readonly CardAlign[] = ["start", "center", "end"];

export function intersectBoxes(a: Box, b: Box): Box {
  return {
    top: Math.max(a.top, b.top),
    left: Math.max(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.min(a.right, b.right),
  };
}

export function boxIsEmpty(b: Box): boolean {
  return b.bottom <= b.top || b.right <= b.left;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function pad(b: Box, by: number): Box {
  return { top: b.top - by, left: b.left - by, bottom: b.bottom + by, right: b.right + by };
}

/** Area `a` and `b` share. */
export function overlapArea(a: Box, b: Box): number {
  const i = intersectBoxes(a, b);
  return boxIsEmpty(i) ? 0 : (i.bottom - i.top) * (i.right - i.left);
}

function cardBox(at: { top: number; left: number }, card: Size): Box {
  return { top: at.top, left: at.left, bottom: at.top + card.height, right: at.left + card.width };
}

/**
 * The card on `side` of `t` lined up by `align`, moved along the side to stay
 * inside the viewport, and whether it fits there: inside the viewport and
 * clear of `t`.
 */
function besideTarget(t: Box, side: CardSide, align: CardAlign, card: Size, viewport: Size) {
  const maxLeft = viewport.width - card.width - MARGIN;
  const maxTop = viewport.height - card.height - MARGIN;
  if (side === "below" || side === "above") {
    const along = align === "start" ? t.left : align === "end" ? t.right - card.width : (t.left + t.right - card.width) / 2;
    const top = side === "below" ? t.bottom + GAP : t.top - GAP - card.height;
    const fits = top >= MARGIN && top <= maxTop && card.width <= viewport.width - 2 * MARGIN;
    return { top, left: clamp(along, MARGIN, maxLeft), fits };
  }
  const along = align === "start" ? t.top : align === "end" ? t.bottom - card.height : (t.top + t.bottom - card.height) / 2;
  const left = side === "right" ? t.right + GAP : t.left - GAP - card.width;
  const fits = left >= MARGIN && left <= maxLeft && card.height <= viewport.height - 2 * MARGIN;
  return { top: clamp(along, MARGIN, maxTop), left, fits };
}

/**
 * Sides to try, in order. A row, a card or a short token gets the card below
 * or above it, a target taller than wide (and than `TALL_TARGET`) gets it
 * right or left of it; then the other pair. Below comes before above unless above has more room;
 * right or left goes to whichever has more room.
 */
function sideOrder(t: Box, viewport: Size): CardSide[] {
  const vertical: CardSide[] = t.top > viewport.height - t.bottom ? ["above", "below"] : ["below", "above"];
  const horizontal: CardSide[] = t.left > viewport.width - t.right ? ["left", "right"] : ["right", "left"];
  const tall = t.bottom - t.top > Math.max(t.right - t.left, TALL_TARGET);
  return tall ? [...horizontal, ...vertical] : [...vertical, ...horizontal];
}

/**
 * Card position. `target` is the target's box, `clip` the part of the page its
 * scroll containers show (null when there is no on-screen target), `dock` the
 * tab's box.
 *
 * Beside the target, the card takes the first side and alignment where it fits
 * inside the viewport without covering the target (with `CARD_CLEARANCE`
 * around it), preferring places that also leave the target's other `parts`
 * uncovered. The side in `keep` stays while it fits and covers no more of the
 * parts than the best place would. When no side fits, the card goes where it
 * covers the least of the target.
 */
export function placeCard(
  target: Box | null,
  clip: Box | null,
  dock: Box,
  card: Size,
  viewport: Size,
  options: PlaceOptions = {},
): CardPlacement {
  const maxLeft = viewport.width - card.width - MARGIN;
  const maxTop = viewport.height - card.height - MARGIN;
  const screen = { top: 0, left: 0, bottom: viewport.height, right: viewport.width };
  const visible = target && clip ? intersectBoxes(intersectBoxes(target, clip), screen) : null;
  if (!visible || boxIsEmpty(visible)) {
    return {
      mode: "docked",
      top: clamp(dock.top + MARGIN, MARGIN, maxTop),
      left: clamp(dock.right - card.width - MARGIN * 1.5, MARGIN, maxLeft),
    };
  }
  const avoid = (options.parts ?? [])
    .map((p) => intersectBoxes(p, screen))
    .filter((p) => !boxIsEmpty(p))
    .map((p) => pad(p, CARD_CLEARANCE));
  const partsCovered = (at: { top: number; left: number }) => {
    const box = cardBox(at, card);
    return avoid.reduce((sum, p) => sum + overlapArea(box, p), 0);
  };

  const keep = options.keep;
  let best: (CardPlacement & { covered: number }) | null = null;
  let kept: (CardPlacement & { covered: number }) | null = null;
  for (const side of sideOrder(visible, viewport)) {
    for (const align of ALIGNS) {
      const at = besideTarget(visible, side, align, card, viewport);
      if (!at.fits) continue;
      const candidate = { mode: side, align, top: at.top, left: at.left, covered: partsCovered(at) };
      if (keep && keep.mode === side && keep.align === align) kept = candidate;
      if (!best || candidate.covered < best.covered) best = candidate;
    }
  }
  const chosen = kept && best && kept.covered <= best.covered ? kept : best;
  if (chosen) return { mode: chosen.mode, align: chosen.align, top: chosen.top, left: chosen.left };

  // No side has room: the place inside the viewport that covers the least of the target.
  const padded = pad(visible, CARD_CLEARANCE);
  const places: { top: number; left: number }[] = [];
  for (const side of sideOrder(visible, viewport)) {
    for (const align of ALIGNS) {
      const at = besideTarget(visible, side, align, card, viewport);
      places.push({ top: clamp(at.top, MARGIN, maxTop), left: clamp(at.left, MARGIN, maxLeft) });
    }
  }
  for (const top of [MARGIN, maxTop]) {
    for (const left of [maxLeft, MARGIN]) places.push({ top: clamp(top, MARGIN, maxTop), left: clamp(left, MARGIN, maxLeft) });
  }
  let over = places[0];
  let least = { target: Infinity, parts: Infinity };
  for (const at of places) {
    const covered = { target: overlapArea(cardBox(at, card), padded), parts: partsCovered(at) };
    if (covered.target < least.target || (covered.target === least.target && covered.parts < least.parts)) {
      least = covered;
      over = at;
    }
  }
  return { mode: "over", top: over.top, left: over.left };
}

/** The side and alignment of a card beside its target; `null` for one over it or docked. */
export function anchorOf(placement: CardPlacement): CardAnchor | null {
  if (placement.mode === "over" || placement.mode === "docked" || !placement.align) return null;
  return { mode: placement.mode, align: placement.align };
}

/** How far the reader dragged the card from where it is placed. */
export interface CardOffset {
  x: number;
  y: number;
}

export const NO_OFFSET: CardOffset = { x: 0, y: 0 };

/** A drag offset and the placement it was made against (see `dragKey`). */
export interface CardDrag {
  key: string;
  offset: CardOffset;
}

/**
 * Identity of the placement a drag applies to: a new focus request (previous,
 * next, the list) or docking or undocking the card starts again from no offset.
 */
export function dragKey(focusSeq: number, mode: CardPlacement["mode"]): string {
  return `${focusSeq}:${mode === "docked" ? "docked" : "anchored"}`;
}

/** The drag offset that applies under `key`. */
export function offsetFor(drag: CardDrag | null, key: string): CardOffset {
  return drag && drag.key === key ? drag.offset : NO_OFFSET;
}

/**
 * `offset` cut so the card moved by it stays inside the viewport. The card may
 * always stay where `placement` put it, even within the margin.
 */
export function clampOffset(
  placement: { top: number; left: number },
  offset: CardOffset,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): CardOffset {
  const left = placement.left + offset.x;
  const top = placement.top + offset.y;
  const minLeft = Math.min(MARGIN, placement.left);
  const maxLeft = Math.max(viewport.width - card.width - MARGIN, placement.left);
  const minTop = Math.min(MARGIN, placement.top);
  const maxTop = Math.max(viewport.height - card.height - MARGIN, placement.top);
  return {
    x: clamp(left, minLeft, maxLeft) - placement.left,
    y: clamp(top, minTop, maxTop) - placement.top,
  };
}
