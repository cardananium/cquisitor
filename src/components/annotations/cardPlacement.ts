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
