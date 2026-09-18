"use client";

// Panel wrappers that read their own hover projection and write from the pointer.
// The parent never reads the link, so a pointer move does not re-render every panel.

import React, { forwardRef, memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { CborPosition } from "@cardananium/cquisitor-lib";
import EditableHexView, { type EditableHexViewProps } from "@/components/EditableHexView";
import CborTreeView, { spanAttr, type CborTreeViewProps } from "@/components/CborTreeView";
import { holdsLabel, placementOf } from "@/components/treeDiagnostics";
import DecodedJsonTree, { type DecodedJsonTreeProps } from "./DecodedJsonTree";
import CddlEditor, { type CddlEditorHandle, type CddlEditorProps } from "./CddlEditor";
import { hoverEditorMarks, type HoverLinkStore } from "./hoverLink";
import { NO_MARKS, markLinkedRows, treeHolders, treeKeys, type HolderMarks, type RowMarks } from "./instances";
import {
  selectDecodedLink,
  selectLinkRole,
  selectEditorLink,
  selectHexLink,
  selectTreeLink,
  useHoverLink,
} from "./hooks";

interface Linked {
  store: HoverLinkStore;
}

export type HexPaneProps = Omit<EditableHexViewProps, "hoverPosition" | "hoverPositions" | "onHoverByte"> & Linked;

export const HexPane = memo(function HexPane({ store, ...rest }: HexPaneProps) {
  const hoverPositions = useHoverLink(store, selectHexLink);
  const onHoverByte = useCallback(
    (byte: number | null) => (byte === null ? store.leave("hex") : store.hoverHex(byte)),
    [store],
  );
  return <EditableHexView {...rest} hoverPositions={hoverPositions} onHoverByte={onHoverByte} />;
});

export type TreePaneProps = Omit<CborTreeViewProps, "onHoverPosition"> & Linked & {
  /** Pinned construct's other instances, as `data-span` words. Marked on the rows; no way is opened to them. */
  pinnedOtherSpans?: ReadonlySet<string> | null;
  /** Bumped when the host asks to scroll the pinned row without the pin changing. */
  revealSeq?: number;
  /** Bumped when the host asks to scroll the selected diagnostic's row. */
  diagnosticRevealSeq?: number;
  /** Whether that scroll is for this pane. Separate from `scrollOnHighlight` so one reveal never scrolls the other. */
  scrollOnDiagnostic?: boolean;
};

const TREE_HOVER_CLASS = "cbor-tree-row-hover";
const TREE_PINNED_OTHER_CLASS = "cbor-tree-row-pinned-other";
// Off-screen instances (closed row or past the row budget) count on the holder.
const TREE_HOVER_HOLDS: HolderMarks = {
  className: "cbor-tree-row-holds-hover",
  countAttribute: "data-holds-hover",
  find: treeHolders,
};
const TREE_PINNED_HOLDS: HolderMarks = {
  className: "cbor-tree-row-holds-pinned",
  countAttribute: "data-holds-pinned",
  find: treeHolders,
};
// Diagnostics whose row is off screen. On-screen rows flag their own, so this
// pass adds no class to them. Weighted by how many diagnostics sit on each key.
const TREE_MISMATCH_HOLDS: HolderMarks = {
  className: "cbor-tree-row-holds-mismatch",
  countAttribute: "data-holds-mismatch",
  find: treeHolders,
  format: holdsLabel,
};
const NO_ROWS: ArrayLike<Element> = [];

// The pane renders for every hovered-row change; the tree must not.
const TreeCore = memo(CborTreeView);

/** Scrolling pane around the structural tree. Marks hover and other pin
 *  instances on elements so the memoised tree does not re-render them. */
export const TreePane = memo(function TreePane({
  store,
  pinnedOtherSpans,
  revealSeq,
  diagnosticRevealSeq,
  scrollOnDiagnostic = false,
  ...rest
}: TreePaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const hoverMarks = useRef<RowMarks>(NO_MARKS);
  const otherMarks = useRef<RowMarks>(NO_MARKS);
  const mismatchMarks = useRef<RowMarks>(NO_MARKS);
  const tree = useHoverLink(store, selectTreeLink);
  // A row answers to its header and, for a container, to its whole extent:
  // a link from another panel names the first, the tree's own the second.
  const hoverKeys = useMemo(() => treeKeys(tree), [tree]);
  const { pinnedPosition, scrollOnHighlight, rowDiagnostics, selectedDiagnostic } = rest;
  const mismatchKeys = useMemo(
    () => (rowDiagnostics && rowDiagnostics.size > 0 ? new Set(rowDiagnostics.keys()) : null),
    [rowDiagnostics],
  );
  const mismatchHolds = useMemo<HolderMarks>(
    () => ({ ...TREE_MISMATCH_HOLDS, weight: key => rowDiagnostics?.get(key)?.length ?? 1 }),
    [rowDiagnostics],
  );
  // Re-mark after each render (the tree rewrites rows and drops classes).
  // Hover last so a hovered other-instance still reads as hovered.
  useLayoutEffect(() => {
    const wanted =
      (hoverKeys?.size ?? 0) + (pinnedOtherSpans?.size ?? 0) + (mismatchKeys?.size ?? 0) > 0;
    const rows = wanted && paneRef.current ? paneRef.current.querySelectorAll("[data-span]") : NO_ROWS;
    mismatchMarks.current = markLinkedRows(
      mismatchMarks.current, rows, "data-span", mismatchKeys, null, mismatchHolds,
    );
    otherMarks.current = markLinkedRows(
      otherMarks.current, rows, "data-span", pinnedOtherSpans ?? null, TREE_PINNED_OTHER_CLASS, TREE_PINNED_HOLDS,
    );
    hoverMarks.current = markLinkedRows(
      hoverMarks.current, rows, "data-span", hoverKeys, TREE_HOVER_CLASS, TREE_HOVER_HOLDS,
    );
  });
  // Chip asked for the pinned row again; the pin has not changed.
  useLayoutEffect(() => {
    if (!revealSeq || !pinnedPosition || !scrollOnHighlight || !paneRef.current) return;
    paneRef.current
      .querySelector(`[data-span~="${spanAttr(pinnedPosition)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [revealSeq, pinnedPosition, scrollOnHighlight]);
  // Diagnostic selected elsewhere: scroll here rather than in the row, which
  // scrolls only for the pin and the pulse. Runs again when this pane is shown.
  const selectedKey = useMemo(
    () => placementOf(rowDiagnostics, selectedDiagnostic)?.key ?? null,
    [rowDiagnostics, selectedDiagnostic],
  );
  useLayoutEffect(() => {
    if (!diagnosticRevealSeq || !selectedKey || !scrollOnDiagnostic || !paneRef.current) return;
    paneRef.current
      .querySelector(`[data-span~="${selectedKey}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [diagnosticRevealSeq, selectedKey, scrollOnDiagnostic]);
  const onHoverPosition = useCallback(
    (p: CborPosition | null) => (p === null ? store.leave("tree") : store.hoverTree(p)),
    [store],
  );
  const onLeave = useCallback(() => store.leave("tree"), [store]);
  return (
    <div className="cq-tree-pane" ref={paneRef} onMouseLeave={onLeave}>
      <TreeCore {...rest} onHoverPosition={onHoverPosition} />
    </div>
  );
});

export type DecodedPaneProps = Omit<DecodedJsonTreeProps, "hoverPaths" | "onHoverPath"> & Linked;

/** Scrolling pane around the decoded tree. */
export const DecodedPane = memo(function DecodedPane({ store, ...rest }: DecodedPaneProps) {
  const hoverPaths = useHoverLink(store, selectDecodedLink);
  const hoverRole = useHoverLink(store, selectLinkRole);
  const onHoverPath = useCallback(
    (path: string | null, role: "key" | "value") =>
      path === null ? store.leave("decoded") : store.hoverDecoded(path, role),
    [store],
  );
  const onLeave = useCallback(() => store.leave("decoded"), [store]);
  return (
    <div className="cq-decoded-viewer" onMouseLeave={onLeave}>
      <DecodedJsonTree {...rest} hoverPaths={hoverPaths} hoverRole={hoverRole} onHoverPath={onHoverPath} />
    </div>
  );
});

export type EditorPaneProps = Omit<CddlEditorProps, "hoverMark" | "onHoverOffset"> & Linked;

export const EditorPane = memo(
  forwardRef<CddlEditorHandle, EditorPaneProps>(function EditorPane({ store, ...rest }, ref) {
    const link = useHoverLink(store, selectEditorLink);
    // Derived here rather than in the selector: a snapshot must be the same
    // value for the same link, and a mark is made per call.
    const hoverMark = useMemo(() => hoverEditorMarks(link, rest.value), [link, rest.value]);
    const onHoverOffset = useCallback(
      (offset: number | null) => (offset === null ? store.leave("cddl") : store.hoverCddl(offset)),
      [store],
    );
    return <CddlEditor {...rest} ref={ref} hoverMark={hoverMark} onHoverOffset={onHoverOffset} />;
  }),
);
