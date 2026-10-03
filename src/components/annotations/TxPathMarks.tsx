"use client";

// Annotation marks for the decoded-transaction card view, by view path
// (`transaction.body.outputs.0`). Cards read their own mark, so the marks do
// not have to be threaded through every card's props.
//
// Spotlight: every card, section, field and header is a unit (`cq-dim-unit`)
// classed by how its path stands to the target paths; CSS dims each unit that
// neither shows, holds nor sits inside a target (see globals.css).

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { annotationClassName, type AnnotationMark } from "@/utils/annotations/marks";
import { txPathRelation, type TargetRelation } from "@/utils/annotations/spotlight";

const NO_MARKS: ReadonlyMap<string, AnnotationMark> = new Map();

interface TxPathMarksValue {
  marks: ReadonlyMap<string, AnnotationMark>;
  /** Dim the units that are not annotated. */
  spotlight: boolean;
}

const TxPathMarksContext = createContext<TxPathMarksValue>({ marks: NO_MARKS, spotlight: false });

export function TxPathMarksProvider({
  marks,
  spotlight = false,
  children,
}: {
  marks: ReadonlyMap<string, AnnotationMark>;
  /** Dim every unit that neither shows, holds nor sits inside a marked path. */
  spotlight?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ marks, spotlight: spotlight && marks.size > 0 }), [marks, spotlight]);
  return <TxPathMarksContext.Provider value={value}>{children}</TxPathMarksContext.Provider>;
}

/** Class of every element the spotlight weighs, while it is on. */
export const UNIT_CLASS = "cq-dim-unit";

/** Spotlight class for each relation to the targets; a target is already `cq-ann`. */
const RELATION_CLASS: Record<TargetRelation, string> = {
  target: "",
  inside: "cq-ann-in",
  holder: "cq-ann-holder",
  none: "",
};

/** Spotlight classes of a unit showing `path` (`""` while the spotlight is off). */
export function spotlightUnitClass(path: string | undefined, targets: Iterable<string>, spotlight: boolean): string {
  if (!spotlight) return "";
  const relation = path ? RELATION_CLASS[txPathRelation(path, targets)] : "";
  return relation ? `${UNIT_CLASS} ${relation}` : UNIT_CLASS;
}

export interface TxPathMark {
  /** Classes to add to the element showing `path`; `""` when it carries no annotation and the spotlight is off. */
  className: string;
  /** `data-tx-path`, so a target with no card of its own anchors to the closest enclosing one. */
  attrs: { "data-tx-path"?: string };
  /** Classes for a part of the card the spotlight dims on its own, such as a section header. */
  partClassName: string;
}

/** The annotation mark of the element that shows `path`. */
export function useTxPathMark(path: string | undefined): TxPathMark {
  const { marks, spotlight } = useContext(TxPathMarksContext);
  const partClassName = spotlight ? UNIT_CLASS : "";
  if (!path) return { className: "", attrs: {}, partClassName };
  const own = annotationClassName(marks.get(path));
  const unit = spotlightUnitClass(path, marks.keys(), spotlight);
  return {
    className: own && unit ? `${own} ${unit}` : own || unit,
    attrs: { "data-tx-path": path },
    partClassName,
  };
}

/** Whether the card view dims; its root sets the scope the CSS reads. */
export function useTxPathSpotlight(): boolean {
  return useContext(TxPathMarksContext).spotlight;
}
