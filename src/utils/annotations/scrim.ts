// Scrim: while annotations are shown, the whole page darkens except for the
// parts of the focused annotation's target, which show through rounded holes.
// Pure geometry in viewport coordinates; the layer reads the rects from the DOM.

export interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** A hole in the scrim: a rounded rect in viewport coordinates. */
export interface ScrimHole {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

/** Space left around a part inside its hole. */
export const HOLE_PADDING = 4;
/** Corner radius of a hole. */
export const HOLE_RADIUS = 6;
/** Rect changes smaller than this leave the mask as it is. */
export const HOLE_TOLERANCE = 0.5;

/** One on-screen piece of a target and the boxes of the scroll containers around it, innermost first. */
export interface TargetPart {
  /** Index of the annotation the piece belongs to. */
  index: number;
  box: Box;
  clips: readonly Box[];
}

function intersect(a: Box, b: Box): Box {
  return {
    top: Math.max(a.top, b.top),
    left: Math.max(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.min(a.right, b.right),
  };
}

function isEmpty(b: Box): boolean {
  return b.bottom <= b.top || b.right <= b.left;
}

/** The part of `box` its scroll containers leave visible; `null` when none is. */
export function clipToContainers(box: Box, clips: readonly Box[]): Box | null {
  let shown = box;
  for (const clip of clips) {
    shown = intersect(shown, clip);
    if (isEmpty(shown)) return null;
  }
  return isEmpty(shown) ? null : shown;
}

/**
 * The hole around a visible box: padded, kept inside the viewport, its radius
 * no larger than half its shorter side. `null` when nothing of it is on screen.
 */
export function holeAround(
  visible: Box,
  viewport: { width: number; height: number },
  padding = HOLE_PADDING,
  radius = HOLE_RADIUS,
): ScrimHole | null {
  const padded = intersect(
    {
      top: visible.top - padding,
      left: visible.left - padding,
      bottom: visible.bottom + padding,
      right: visible.right + padding,
    },
    { top: 0, left: 0, bottom: viewport.height, right: viewport.width },
  );
  if (isEmpty(padded)) return null;
  const width = padded.right - padded.left;
  const height = padded.bottom - padded.top;
  return { x: padded.left, y: padded.top, width, height, radius: Math.min(radius, width / 2, height / 2) };
}

/** Holes for the focused annotation's parts that are on screen; other annotations' parts make none. */
export function focusedHoles(
  parts: readonly TargetPart[],
  focus: number,
  viewport: { width: number; height: number },
): ScrimHole[] {
  const holes: ScrimHole[] = [];
  for (const part of parts) {
    if (part.index !== focus) continue;
    const visible = clipToContainers(part.box, part.clips);
    const hole = visible && holeAround(visible, viewport);
    if (hole) holes.push(hole);
  }
  return holes;
}

export interface ScrimState {
  /** The tab has annotations. */
  active: boolean;
  /** The navigator's toggle. */
  enabled: boolean;
  /** The focused target resolved on this tab. */
  resolved: boolean;
  holes: readonly ScrimHole[];
}

/** The scrim shows only with a hole in it: never a dark page with nothing lit. */
export function scrimVisible({ active, enabled, resolved, holes }: ScrimState): boolean {
  return active && enabled && resolved && holes.length > 0;
}

/** Whether two hole lists would draw the same mask, within `HOLE_TOLERANCE`. */
export function sameHoles(a: readonly ScrimHole[], b: readonly ScrimHole[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      Math.abs(x.x - y.x) > HOLE_TOLERANCE ||
      Math.abs(x.y - y.y) > HOLE_TOLERANCE ||
      Math.abs(x.width - y.width) > HOLE_TOLERANCE ||
      Math.abs(x.height - y.height) > HOLE_TOLERANCE ||
      Math.abs(x.radius - y.radius) > HOLE_TOLERANCE
    ) {
      return false;
    }
  }
  return true;
}

/** Where the viewer's choice is kept: `"false"` when the scrim is off. */
export const SPOTLIGHT_STORAGE_KEY = "cquisitor_ann_dim";

/** The part of `Storage` the preference uses. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Whether the scrim is on; on unless turned off, and on when storage cannot be read. */
export function readSpotlightEnabled(storage: PreferenceStorage | null | undefined): boolean {
  try {
    return storage?.getItem(SPOTLIGHT_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeSpotlightEnabled(storage: PreferenceStorage | null | undefined, enabled: boolean): void {
  try {
    storage?.setItem(SPOTLIGHT_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Private mode or quota: the choice lasts for this page only.
  }
}

export function browserPreferenceStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface SpotlightStore {
  /** Whether the scrim darkens the page around the focused target. */
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  subscribe(listener: () => void): () => void;
}

/** A store over `storage`, read on first use so nothing touches it before the page runs. */
export function createSpotlightStore(
  storage: () => PreferenceStorage | null = browserPreferenceStorage,
): SpotlightStore {
  let value: boolean | null = null;
  const listeners = new Set<() => void>();
  return {
    enabled() {
      if (value === null) value = readSpotlightEnabled(storage());
      return value;
    },
    setEnabled(enabled) {
      writeSpotlightEnabled(storage(), enabled);
      if (value === enabled) return;
      value = enabled;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's preference, shared by every tab. */
export const spotlightStore: SpotlightStore = createSpotlightStore();
