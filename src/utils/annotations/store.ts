// Annotations a share link carries, per tab: the list, which one is focused,
// and how far each target resolved on that tab. Plain store (no React) so the
// tab contexts can fill it from their hydration and tests can drive it.

import type { Annotation, CquisitorTarget, TabId } from "@cardananium/cquisitor-lib";

export type AnnotationTab = TabId;

/** How far a target got on its tab. */
export type ResolutionState =
  /** Found and highlighted. */
  | "resolved"
  /** The tab has nothing to resolve it against yet (still decoding, no validation result). */
  | "waiting"
  /** Resolved against the tab's data, and not there. */
  | "not_found"
  /** A kind this tab does not show. */
  | "unsupported";

export interface AnnotationStatus {
  state: ResolutionState;
  /** Why it is not resolved, in a sentence. */
  note?: string;
}

export type CquisitorAnnotation = Annotation<CquisitorTarget>;

export interface TabAnnotations {
  annotations: readonly CquisitorAnnotation[];
  /** Index into `annotations`. */
  focus: number;
  /** Bumped by every focus request, the same index included, so the view reveals it again. */
  focusSeq: number;
  /** Parallel to `annotations`; `waiting` until the tab reports. */
  statuses: readonly AnnotationStatus[];
  /** The input the link wrote; once the tab has shown it, replacing it dismisses the annotations. */
  inputKey: string | null;
  inputSeen: boolean;
}

export interface AnnotationStore {
  get(tab: AnnotationTab): TabAnnotations | null;
  subscribe(listener: () => void): () => void;
  /** Set a tab's annotations from a link. An empty list clears the tab. */
  apply(
    tab: AnnotationTab,
    annotations: readonly CquisitorAnnotation[],
    focus?: number,
    inputKey?: string | null,
  ): void;
  dismiss(tab: AnnotationTab): void;
  focus(tab: AnnotationTab, index: number): void;
  /** Move focus by `delta`, wrapping at both ends. */
  step(tab: AnnotationTab, delta: number): void;
  setStatuses(tab: AnnotationTab, statuses: readonly AnnotationStatus[]): void;
  /** The tab's current input: the first time it equals the link's, later changes dismiss. */
  noteInput(tab: AnnotationTab, key: string): void;
}

const WAITING: AnnotationStatus = { state: "waiting" };

/** `current + delta`, wrapped into `[0, total)`; 0 when there is nothing. */
export function stepFocus(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

function clampFocus(focus: number | undefined, total: number): number {
  if (total <= 0 || focus === undefined || !Number.isInteger(focus) || focus < 0) return 0;
  return Math.min(focus, total - 1);
}

function sameStatuses(a: readonly AnnotationStatus[], b: readonly AnnotationStatus[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].state !== b[i].state || a[i].note !== b[i].note) return false;
  }
  return true;
}

export function createAnnotationStore(): AnnotationStore {
  const state = new Map<AnnotationTab, TabAnnotations>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const update = (tab: AnnotationTab, next: TabAnnotations | null) => {
    if (next) state.set(tab, next);
    else if (!state.delete(tab)) return;
    emit();
  };

  return {
    get: (tab) => state.get(tab) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply(tab, annotations, focus, inputKey = null) {
      if (annotations.length === 0) {
        update(tab, null);
        return;
      }
      const prev = state.get(tab);
      update(tab, {
        annotations: [...annotations],
        focus: clampFocus(focus, annotations.length),
        focusSeq: (prev?.focusSeq ?? 0) + 1,
        statuses: annotations.map(() => WAITING),
        inputKey,
        inputSeen: false,
      });
    },
    dismiss: (tab) => update(tab, null),
    focus(tab, index) {
      const cur = state.get(tab);
      if (!cur) return;
      update(tab, {
        ...cur,
        focus: clampFocus(index, cur.annotations.length),
        focusSeq: cur.focusSeq + 1,
      });
    },
    step(tab, delta) {
      const cur = state.get(tab);
      if (!cur) return;
      update(tab, {
        ...cur,
        focus: stepFocus(cur.focus, delta, cur.annotations.length),
        focusSeq: cur.focusSeq + 1,
      });
    },
    setStatuses(tab, statuses) {
      const cur = state.get(tab);
      if (!cur || statuses.length !== cur.annotations.length) return;
      if (sameStatuses(cur.statuses, statuses)) return;
      update(tab, { ...cur, statuses: [...statuses] });
    },
    noteInput(tab, key) {
      const cur = state.get(tab);
      if (!cur || cur.inputKey === null) return;
      if (key === cur.inputKey) {
        if (!cur.inputSeen) update(tab, { ...cur, inputSeen: true });
        return;
      }
      if (cur.inputSeen) update(tab, null);
    },
  };
}

/** The app's store; every tab context writes here. */
export const annotationStore: AnnotationStore = createAnnotationStore();
