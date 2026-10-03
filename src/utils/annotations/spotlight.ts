// Spotlight: while a view shows resolved annotation targets, everything else in
// that view is dimmed so the targets stand out. Each view decides per unit (a
// tree row, a hex run, a card, a list item, a stretch of schema text) whether
// it stays bright; the viewer can turn dimming off, and the choice is kept.

import { annotationClassName, type AnnotationMark } from "./marks";

/** Class that dims a unit; hovering the unit lifts it. */
export const DIM_CLASS = "cq-dim";

/**
 * Class that dims an inline run of the hex view: its text fades and its tint is
 * veiled. Runs come in thousands there, and opacity would give each one a layer
 * of its own to paint on every repaint.
 */
export const DIM_RUN_CLASS = "cq-dim-run";

/** Where the viewer's choice is kept: `"false"` when dimming is off. */
export const SPOTLIGHT_STORAGE_KEY = "cquisitor_ann_dim";

/** The part of `Storage` the preference uses. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Whether dimming is on; on unless turned off, and on when storage cannot be read. */
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
  /** Whether views dim what is not annotated. */
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

/** Whether a view dims: dimming is on and the view holds at least one resolved target. */
export function spotlightActive(enabled: boolean, resolvedTargets: number): boolean {
  return enabled && resolvedTargets > 0;
}

/** How an element showing a dotted path (`transaction.body.outputs.0`) stands to the target paths. */
export type TargetRelation =
  /** It shows a target. */
  | "target"
  /** It shows part of a target. */
  | "inside"
  /** A target is part of what it shows. */
  | "holder"
  | "none";

/** `path` against `targets`; a target the element is inside wins over one it holds. */
export function txPathRelation(path: string, targets: Iterable<string>): TargetRelation {
  let holder = false;
  let inside = false;
  for (const target of targets) {
    if (target === path) return "target";
    if (path.startsWith(`${target}.`)) inside = true;
    else if (target.startsWith(`${path}.`)) holder = true;
  }
  return inside ? "inside" : holder ? "holder" : "none";
}

/** What `litRows` reads of a flattened tree's row (`flatTree/flatten`). */
export interface SpotlightRow {
  /** Indent: a row's children sit one level deeper and follow it. */
  depth: number;
  kind: "leaf" | "closed" | "open" | "closing";
  path: string;
}

/**
 * Which rows stay bright: each target row, every row under it, and its closing
 * row. Rows are in walk order; ancestors and siblings of a target are not lit.
 */
export function litRows<R extends SpotlightRow>(rows: readonly R[], isTarget: (row: R) => boolean): boolean[] {
  const lit = new Array<boolean>(rows.length).fill(false);
  let open: { depth: number; path: string } | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (open) {
      if (row.depth > open.depth) {
        lit[i] = true;
        continue;
      }
      const closesTarget = row.kind === "closing" && row.depth === open.depth && row.path === open.path;
      open = null;
      if (closesTarget) {
        lit[i] = true;
        continue;
      }
    }
    if (row.kind !== "closing" && isTarget(row)) {
      lit[i] = true;
      if (row.kind === "open") open = { depth: row.depth, path: row.path };
    }
  }
  return lit;
}

/** Classes of a list item (a diagnostic, a Plutus result): its mark, or dimmed when it has none under the spotlight. */
export function markOrDimClass(mark: AnnotationMark | null | undefined, spotlight: boolean): string {
  if (mark) return annotationClassName(mark);
  return spotlight ? DIM_CLASS : "";
}

/** Whether `[start, end)` meets any of the `[start, end)` ranges. */
export function overlapsAny(start: number, end: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [from, to] of ranges) if (start < to && from < end) return true;
  return false;
}
