// Shared depth wording: folded-run label, closed-row note, and the lead-in for a deep document.

import type { FlatFold } from "./flatten";

const count = new Intl.NumberFormat("en-US");

/** Keys of a folded run shown in full up to this many levels; longer runs show first two, last, and a count between. */
const FOLD_KEYS_SHOWN = 4;

/** Folded-run label: keys joined, middle elided when long. */
export function describeFold(
  fold: FlatFold,
  keyText: (key: string | number, isArrayItem: boolean) => string,
): string {
  // The synthetic root has no key of its own and adds nothing to the label.
  const keys = fold.keys.filter((k) => k !== "");
  const text = (k: string | number) => keyText(k, typeof k === "number");
  if (keys.length === 0) return `${count.format(fold.levels)} levels`;
  if (keys.length <= FOLD_KEYS_SHOWN) return keys.map(text).join(" › ");
  const hidden = keys.length - 3;
  return `${text(keys[0])} › ${text(keys[1])} › … ${count.format(hidden)} more … › ${text(keys[keys.length - 1])}`;
}

/** A closed row is annotated once this many levels lie under it. */
export const LEVELS_WORTH_NOTING = 8;

/** `"nests 9,997 levels deep"`, or `""` when the subtree is shallow. */
export function describeLevelsBelow(depthBelow: number): string {
  if (depthBelow < LEVELS_WORTH_NOTING) return "";
  return `nests ${count.format(depthBelow)} levels deep`;
}

/** A document is led with a note on its depth from this many levels. */
export const DOCUMENT_DEPTH_WORTH_NOTING = 32;

/** Lead-in for a deep document, or `null` if shallow. `depth` is levels below the root. */
export function describeDocumentDepth(depth: number): string | null {
  if (depth < DOCUMENT_DEPTH_WORTH_NOTING) return null;
  return (
    `This document nests ${count.format(depth)} levels deep. Rows open on demand, ` +
    `and a run of levels that each hold one child is shown as one row.`
  );
}
