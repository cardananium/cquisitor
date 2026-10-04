// Where the hint card goes: next to its target while the target is on screen,
// docked to the top of the tab otherwise. Pure, in viewport coordinates.

export interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface CardPlacement {
  top: number;
  left: number;
  /** `below` / `above` the target, `inside` the top corner of a tall one, or `docked` at the top of the tab. */
  mode: "below" | "above" | "inside" | "docked";
}

const GAP = 6;
const MARGIN = 8;
/** A target showing more than this much height gets the card in its top corner rather than past its end. */
export const TALL_TARGET = 240;

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

/**
 * Card position. `target` is the target's box, `clip` the part of the page its
 * scroll containers show (null when there is no on-screen target), `dock` the
 * tab's box.
 */
export function placeCard(
  target: Box | null,
  clip: Box | null,
  dock: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): CardPlacement {
  const maxLeft = viewport.width - card.width - MARGIN;
  const visible = target && clip ? intersectBoxes(target, clip) : null;
  if (!target || !clip || !visible || boxIsEmpty(visible)) {
    return {
      mode: "docked",
      top: clamp(dock.top + MARGIN, MARGIN, viewport.height - card.height - MARGIN),
      left: clamp(dock.right - card.width - MARGIN * 1.5, MARGIN, maxLeft),
    };
  }
  const area = intersectBoxes(clip, { top: 0, left: 0, bottom: viewport.height, right: viewport.width });
  if (visible.bottom - visible.top > TALL_TARGET) {
    return {
      mode: "inside",
      top: clamp(visible.top + GAP, MARGIN, viewport.height - card.height - MARGIN),
      left: clamp(visible.right - card.width - MARGIN, MARGIN, maxLeft),
    };
  }
  const left = clamp(visible.left, MARGIN, maxLeft);
  const below = visible.bottom + GAP;
  if (below + card.height <= area.bottom) return { mode: "below", top: below, left };
  const above = visible.top - GAP - card.height;
  if (above >= area.top) return { mode: "above", top: above, left };
  // No room on either side: keep the card on screen over the target.
  return {
    mode: "below",
    top: clamp(below, Math.max(area.top, MARGIN), Math.min(area.bottom, viewport.height) - card.height - MARGIN),
    left,
  };
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
