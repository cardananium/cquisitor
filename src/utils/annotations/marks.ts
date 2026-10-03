// How an annotated target is painted: one mark per target element, coloured by
// the strongest severity on it, with a class per annotation index so the hint
// card can find the element (`.cq-ann-at-3`).

import type { AnnotationSeverity, CquisitorTarget } from "@cardananium/cquisitor-lib";
import type { AnnotationStatus, CquisitorAnnotation } from "./store";

export interface AnnotationMark {
  severity: AnnotationSeverity;
  /** Annotations on this element, ascending. */
  indices: readonly number[];
  /** The focused annotation is one of them. */
  focused: boolean;
}

const SEVERITY_RANK: Record<AnnotationSeverity, number> = { info: 0, warning: 1, error: 2 };

export function severityOf(annotation: CquisitorAnnotation): AnnotationSeverity {
  return annotation.severity ?? "info";
}

export function strongerSeverity(a: AnnotationSeverity, b: AnnotationSeverity): AnnotationSeverity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

/** Class that names annotation `index` on whatever element shows it. */
export function annotationAnchorClass(index: number): string {
  return `cq-ann-at-${index}`;
}

/** Classes for a marked element; `""` for none. */
export function annotationClassName(mark: AnnotationMark | null | undefined): string {
  if (!mark) return "";
  const parts = ["cq-ann", `cq-ann-${mark.severity}`];
  if (mark.focused) parts.push("cq-ann-focused");
  for (const i of mark.indices) parts.push(annotationAnchorClass(i));
  return parts.join(" ");
}

/**
 * One mark per key. A key several annotations land on takes the focused one's
 * severity when it is among them, else the strongest.
 */
export function buildMarks<K>(
  items: ReadonlyArray<{ key: K; index: number }>,
  annotations: readonly CquisitorAnnotation[],
  focus: number,
): Map<K, AnnotationMark> {
  const grouped = new Map<K, number[]>();
  for (const { key, index } of items) {
    const list = grouped.get(key);
    if (list) {
      if (!list.includes(index)) list.push(index);
    } else grouped.set(key, [index]);
  }
  const out = new Map<K, AnnotationMark>();
  for (const [key, indices] of grouped) {
    indices.sort((a, b) => a - b);
    const focused = indices.includes(focus);
    let severity: AnnotationSeverity = "info";
    if (focused) severity = severityOf(annotations[focus]);
    else for (const i of indices) severity = strongerSeverity(severity, severityOf(annotations[i]));
    out.set(key, { severity, indices, focused });
  }
  return out;
}

/** Map of class names, for components that take a ready-made class per key. */
export function markClassNames<K>(marks: ReadonlyMap<K, AnnotationMark>): Map<K, string> {
  const out = new Map<K, string>();
  for (const [key, mark] of marks) out.set(key, annotationClassName(mark));
  return out;
}

/** Short description of a target, for an annotation without a label. */
export function describeTarget(target: CquisitorTarget): string {
  switch (target.kind) {
    case "tx_path":
      return target.path;
    case "diagnostic":
      return "index" in target
        ? `Diagnostic #${target.index + 1}`
        : `Diagnostic ${target.name}${target.occurrence ? ` (#${target.occurrence + 1})` : ""}`;
    case "redeemer":
      return `${target.tag}[${target.index}]`;
    case "cbor_span":
      return `Bytes ${target.offset}–${target.offset + target.length - 1}`;
    case "cbor_path":
      return target.path;
    case "cddl_range":
      return `Schema characters ${target.start}–${target.end}`;
    case "cddl_rule":
      return `Rule ${target.name}`;
  }
}

export function resolvedStatus(): AnnotationStatus {
  return { state: "resolved" };
}

/** The status every target of a tab that shows no annotations gets. */
export function notShownHere(): AnnotationStatus {
  return { state: "unsupported", note: "Not shown on this tab." };
}
