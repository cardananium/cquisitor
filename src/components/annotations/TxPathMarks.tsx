"use client";

// Annotation marks for the decoded-transaction card view, by view path
// (`transaction.body.outputs.0`). Cards read their own mark, so the marks do
// not have to be threaded through every card's props.

import { createContext, useContext, type ReactNode } from "react";
import { annotationClassName, type AnnotationMark } from "@/utils/annotations/marks";

const NO_MARKS: ReadonlyMap<string, AnnotationMark> = new Map();

const TxPathMarksContext = createContext<ReadonlyMap<string, AnnotationMark>>(NO_MARKS);

export function TxPathMarksProvider({
  marks,
  children,
}: {
  marks: ReadonlyMap<string, AnnotationMark>;
  children: ReactNode;
}) {
  return <TxPathMarksContext.Provider value={marks}>{children}</TxPathMarksContext.Provider>;
}

export interface TxPathMark {
  /** Classes to add to the element showing `path`; `""` when it carries no annotation. */
  className: string;
  /** `data-tx-path`, so a target with no card of its own anchors to the closest enclosing one. */
  attrs: { "data-tx-path"?: string };
}

/** The annotation mark of the element that shows `path`. */
export function useTxPathMark(path: string | undefined): TxPathMark {
  const marks = useContext(TxPathMarksContext);
  if (!path) return { className: "", attrs: {} };
  return { className: annotationClassName(marks.get(path)), attrs: { "data-tx-path": path } };
}
