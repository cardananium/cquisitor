"use client";

// Thin adapter over the shared `JsonTreeView`. Renders the CDDL
// validator's Decoded JSON panel using lib-canonical paths
// so right-click pinning round-trips with the CBOR/CDDL panels.
// Deep single-child runs fold to one row; findings are badges plus a selected-row caption.

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { CborPosition } from "@cardananium/cquisitor-lib";
import {
  JsonTreeView,
  attrSelector,
  entriesAwareMapEntries,
  type RenderRowArgs,
} from "@/components/jsonTree";
import { depthBelowMap } from "@/components/flatTree/flatten";
import { describeDocumentDepth, describeFold, describeLevelsBelow } from "@/components/flatTree/depthNotes";
import { jsonAdapter } from "@/components/jsonTree/jsonAdapter";
import { libPathScheme } from "@/components/jsonTree/paths";
import {
  DiagnosticBadge,
  DiagnosticCaption,
  holdsLabel,
  placementOf,
  selectedIn,
  type TreeDiagnostic,
  type TreeDiagnosticRows,
} from "@/components/treeDiagnostics";
import type { EntryRole } from "./cborCddlBridge";
import {
  EMPTY_PATHS,
  NO_MARKS,
  decodedHolders,
  markLinkedRows,
  pathKeys,
  type HolderMarks,
  type RowMarks,
} from "./instances";

export interface DecodedJsonTreeProps {
  data: unknown;
  /** Lib-format path of the currently pinned node, e.g. `$.body[0]["k"]`. */
  pinnedPath?: string | null;
  /** Other pin instances. Marked on row elements; not opened (a pin must not unfold sibling subtrees). */
  pinnedOtherPaths?: ReadonlySet<string> | null;
  /** Extra paths kept open (instances already stepped through) so a step does not collapse the previous one. */
  openPaths?: readonly string[];
  /** Hovered instance paths. Marked on row elements so a hover does not re-render rows. */
  hoverPaths?: readonly string[];
  /** Pin lights the key or value half of the row; one role applies to every instance. */
  pinnedRole?: EntryRole | null;
  /** Likewise for the rows the hover link lights. */
  hoverRole?: EntryRole | null;
  /** Bumped to scroll the pinned row into view without changing the pin. */
  revealSeq?: number;
  /**
   * Right-click on a node → fired with that node's lib-format path and
   * a hint about which part of the row the click landed on. The lib emits
   * separate `key` / `value` entries that share the same `decoded_path`,
   * so the consumer can pick the right one.
   */
  onPinPath?: (path: string, role: "key" | "value") => void;
  /** Pointer over a row: path and key/value role; `null` on leave. */
  onHoverPath?: (path: string | null, role: "key" | "value") => void;
  /** How deep to expand by default. */
  expanded?: number;
  /** Scroll the pinned row into view when it becomes highlighted. */
  scrollOnHighlight?: boolean;
  /** Diagnostics keyed by decoded path. On-screen rows get a badge; off-screen ones count on the holding row. */
  rowDiagnostics?: TreeDiagnosticRows;
  /** Selected diagnostic index: open its row and show its caption. */
  selectedDiagnostic?: number | null;
  /** Badge click: select that diagnostic, or `null` to clear. */
  onSelectDiagnostic?: (index: number | null) => void;
  /** Caption "show bytes" handler; omitted when there are no bytes. */
  onRevealBytes?: (position: CborPosition) => void;
  /** Bumped to scroll the selected diagnostic's row into view. */
  diagnosticRevealSeq?: number;
  /** Whether that scroll applies to this tree; independent of the pin scroll. */
  scrollOnDiagnostic?: boolean;
}

/** A run of single-child levels this long is shown as one row. */
const FOLD_CHAINS_FROM = 4;

/** Where a row's path is written, so the hover mark can find the row. */
const ROW_PATH_ATTRIBUTE = "data-path";
const HOVER_CLASS = "cq-json-hover";
const PINNED_OTHER_CLASS = "cq-json-pinned-other";
// Off-screen instances: count on the holding row, in the link colour.
const HOVER_HOLDS: HolderMarks = {
  className: "cq-json-holds-hover",
  countAttribute: "data-holds-hover",
  find: decodedHolders,
};
const PINNED_HOLDS: HolderMarks = {
  className: "cq-json-holds-pinned",
  countAttribute: "data-holds-pinned",
  find: decodedHolders,
};
// Off-screen diagnostics: count mismatches on the holding row; on-screen rows flag themselves.
const MISMATCH_HOLDS: HolderMarks = {
  className: "cq-json-holds-mismatch",
  countAttribute: "data-holds-mismatch",
  find: decodedHolders,
  format: holdsLabel,
};
const NO_ROWS: ArrayLike<Element> = [];

/** Map-key hit vs value. Array-index key spans are treated as the value. */
function roleAt(ev: React.MouseEvent): "key" | "value" {
  const target = ev.target as Element | null;
  return target?.closest(".cq-json-key:not(.cq-json-array-key)") ? "key" : "value";
}

// Rows are memoised; this wrapper re-renders on hover, the core must not.
const TreeCore = memo(JsonTreeView);

function renderPrimitive(v: unknown): React.ReactNode {
  if (v === null) return <span className="cq-json-value cq-json-null">null</span>;
  if (v === undefined) return <span className="cq-json-value cq-json-null">undefined</span>;
  if (typeof v === "string") return <span className="cq-json-value cq-json-string">&quot;{v}&quot;</span>;
  if (typeof v === "number" || typeof v === "bigint")
    return <span className="cq-json-value cq-json-number">{String(v)}</span>;
  if (typeof v === "boolean") return <span className="cq-json-value cq-json-bool">{String(v)}</span>;
  return <span className="cq-json-value">{String(v)}</span>;
}

function keyText(key: string | number, isArrayItem: boolean): string {
  return isArrayItem || typeof key === "number" ? `[${key}]` : String(key);
}

interface RowProps extends RenderRowArgs {
  /** The diagnostics on this row — the host's own list. */
  diagnostics?: readonly TreeDiagnostic[];
  /** Selected run index, for this row's badge pressed state. */
  selectedDiagnostic: number | null;
  onSelectDiagnostic?: (index: number | null) => void;
}

function Row({
  keyLabel,
  value,
  isArrayItem,
  isComplex,
  isOpen,
  toggle,
  childCount,
  kind,
  fold,
  depthBelow,
  diagnostics,
  selectedDiagnostic,
  onSelectDiagnostic,
}: RowProps) {
  const badge = diagnostics && (
    <DiagnosticBadge
      diagnostics={diagnostics}
      selected={selectedIn(diagnostics, selectedDiagnostic)?.index ?? null}
      onSelect={onSelectDiagnostic}
      className="cq-json-mismatch-badge"
    />
  );
  const keyEl =
    fold ? (
      <span
        className="cq-json-key cq-json-fold"
        title={`${fold.levels} nested levels, each holding one child, shown as one row`}
      >
        {describeFold(fold, keyText)}
      </span>
    ) : keyLabel === null ? null : (
      <span className={`cq-json-key${isArrayItem ? " cq-json-array-key" : ""}`}>
        {keyText(keyLabel, isArrayItem)}
      </span>
    );

  if (!isComplex) {
    return (
      <>
        {keyEl}
        {keyEl && <span className="cq-json-colon">:</span>}
        {renderPrimitive(value)}
        {badge}
      </>
    );
  }

  const isArray = kind === "array";
  const bracketOpen = isArray ? "[" : "{";
  const bracketClose = isArray ? "]" : "}";
  const levelsBelow = describeLevelsBelow(depthBelow);

  return (
    <>
      <button
        type="button"
        className={`cq-json-toggle${isOpen ? " open" : ""}`}
        onClick={toggle}
        aria-label={isOpen ? "Collapse" : "Expand"}
        tabIndex={-1}
      >
        {isOpen ? "▾" : "▸"}
      </button>
      {keyEl}
      {keyEl && <span className="cq-json-colon">:</span>}
      <span className="cq-json-bracket">{bracketOpen}</span>
      {!isOpen && (
        <span className="cq-json-summary">
          {childCount} {isArray ? "items" : "fields"}
          {levelsBelow ? ` · ${levelsBelow}` : ""}
        </span>
      )}
      {!isOpen && <span className="cq-json-bracket">{bracketClose}</span>}
      {badge}
    </>
  );
}

export default function DecodedJsonTree({
  data,
  pinnedPath,
  pinnedOtherPaths,
  openPaths,
  hoverPaths = EMPTY_PATHS,
  pinnedRole = null,
  hoverRole = null,
  revealSeq,
  onPinPath,
  onHoverPath,
  expanded = 3,
  scrollOnHighlight = false,
  rowDiagnostics,
  selectedDiagnostic,
  onSelectDiagnostic,
  onRevealBytes,
  diagnosticRevealSeq,
  scrollOnDiagnostic = false,
}: DecodedJsonTreeProps) {
  const highlightedPaths = useMemo(
    () => (pinnedPath ? [pinnedPath] : []),
    [pinnedPath],
  );

  // Selected diagnostic's row path, or none. Kept open like a pin, but not highlighted; scroll is via `diagnosticRevealSeq`.
  const selected = useMemo(
    () => placementOf(rowDiagnostics, selectedDiagnostic),
    [rowDiagnostics, selectedDiagnostic],
  );
  const selectedPath = selected?.key ?? null;
  const openPathsAll = useMemo(
    () => (selectedPath ? [...(openPaths ?? EMPTY_PATHS), selectedPath] : openPaths),
    [openPaths, selectedPath],
  );

  // Stable callbacks so a new host function per render does not rebuild the core.
  const selectRef = useRef(onSelectDiagnostic);
  const revealRef = useRef(onRevealBytes);
  useEffect(() => {
    selectRef.current = onSelectDiagnostic;
    revealRef.current = onRevealBytes;
  }, [onSelectDiagnostic, onRevealBytes]);
  const selectDiagnostic = useCallback((index: number | null) => selectRef.current?.(index), []);
  const revealBytes = useCallback((position: CborPosition) => revealRef.current?.(position), []);
  const hasReveal = onRevealBytes !== undefined;

  const renderRow = useCallback(
    (ctx: RenderRowArgs) => (
      <Row
        {...ctx}
        diagnostics={rowDiagnostics?.get(ctx.path)}
        selectedDiagnostic={selectedDiagnostic ?? null}
        onSelectDiagnostic={selectDiagnostic}
      />
    ),
    [rowDiagnostics, selectedDiagnostic, selectDiagnostic],
  );

  // Leaf values are one span (markable alone); container rows are the opening bracket.
  const getRowClassName = useCallback(
    (ctx: RenderRowArgs) => {
      const leaf = ctx.isComplex ? "" : "cq-json-leaf";
      const own = rowDiagnostics?.get(ctx.path);
      if (!own) return leaf;
      const mismatch = selectedIn(own, selectedDiagnostic) ? "cq-json-mismatch cq-json-mismatch-selected" : "cq-json-mismatch";
      return leaf ? `${leaf} ${mismatch}` : mismatch;
    },
    [rowDiagnostics, selectedDiagnostic],
  );

  // Caption sits after the row element so path lookup never hits it.
  const renderRowFooter = useCallback(
    (ctx: RenderRowArgs) => {
      const own = rowDiagnostics?.get(ctx.path);
      const diagnostic = own ? selectedIn(own, selectedDiagnostic) : null;
      return diagnostic ? (
        <DiagnosticCaption
          diagnostic={diagnostic}
          className="cq-json-caption"
          onRevealBytes={hasReveal ? revealBytes : undefined}
        />
      ) : null;
    },
    [rowDiagnostics, selectedDiagnostic, hasReveal, revealBytes],
  );

  const handleContextMenu = useCallback(
    (path: string, _value: unknown, ev: React.MouseEvent) => {
      onPinPath?.(path, roleAt(ev));
    },
    [onPinPath],
  );

  const handleRowHover = useCallback(
    (ctx: RenderRowArgs | null, ev: React.MouseEvent) => {
      if (ctx) onHoverPath?.(ctx.path, roleAt(ev));
      else onHoverPath?.(null, "value");
    },
    [onHoverPath],
  );

  // Hover/other-instance/mismatch-holder classes go on row elements after render so the memoised core does not paint them. Re-applied every render (core class changes drop them); hover last so it wins.
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverMarks = useRef<RowMarks>(NO_MARKS);
  const otherMarks = useRef<RowMarks>(NO_MARKS);
  const mismatchMarks = useRef<RowMarks>(NO_MARKS);
  const hoverKeys = useMemo(() => pathKeys(hoverPaths), [hoverPaths]);
  const mismatchKeys = useMemo(
    () => (rowDiagnostics && rowDiagnostics.size > 0 ? new Set(rowDiagnostics.keys()) : null),
    [rowDiagnostics],
  );
  const mismatchHolds = useMemo<HolderMarks>(
    () => ({ ...MISMATCH_HOLDS, weight: key => rowDiagnostics?.get(key)?.length ?? 1 }),
    [rowDiagnostics],
  );
  useLayoutEffect(() => {
    const wanted =
      (hoverKeys?.size ?? 0) + (pinnedOtherPaths?.size ?? 0) + (mismatchKeys?.size ?? 0) > 0;
    const rows = wanted && wrapRef.current ? wrapRef.current.querySelectorAll(`[${ROW_PATH_ATTRIBUTE}]`) : NO_ROWS;
    mismatchMarks.current = markLinkedRows(
      mismatchMarks.current, rows, ROW_PATH_ATTRIBUTE, mismatchKeys, null, mismatchHolds,
    );
    otherMarks.current = markLinkedRows(
      otherMarks.current, rows, ROW_PATH_ATTRIBUTE, pinnedOtherPaths ?? null, PINNED_OTHER_CLASS, PINNED_HOLDS,
    );
    hoverMarks.current = markLinkedRows(
      hoverMarks.current, rows, ROW_PATH_ATTRIBUTE, hoverKeys, HOVER_CLASS, HOVER_HOLDS,
    );
  });

  // Re-scroll the pin when the host bumps `revealSeq` without changing the highlight.
  useLayoutEffect(() => {
    if (!revealSeq || !pinnedPath || !scrollOnHighlight || !wrapRef.current) return;
    wrapRef.current
      .querySelector(attrSelector(ROW_PATH_ATTRIBUTE, pinnedPath))
      ?.scrollIntoView({ block: "start" });
  }, [revealSeq, pinnedPath, scrollOnHighlight]);

  // Scroll the selected diagnostic's row here (the core only scrolls the pin). Re-runs when this tree is shown; a row with no box cannot scroll.
  useLayoutEffect(() => {
    if (!diagnosticRevealSeq || !selectedPath || !scrollOnDiagnostic || !wrapRef.current) return;
    wrapRef.current
      .querySelector(attrSelector(ROW_PATH_ATTRIBUTE, selectedPath))
      ?.scrollIntoView({ block: "center" });
  }, [diagnosticRevealSeq, selectedPath, scrollOnDiagnostic]);

  const renderClosingRow = useCallback(
    ({ kind }: { kind: "array" | "object" }) => (
      <div className="cq-json-row">
        <span className="cq-json-bracket">{kind === "array" ? "]" : "}"}</span>
      </div>
    ),
    [],
  );

  const renderMoreRows = useCallback(
    ({ showMore }: { showMore: () => void }) => (
      <button type="button" className="cq-json-more" onClick={showMore}>
        Show more rows
      </button>
    ),
    [],
  );

  const depthNote = useMemo(() => {
    if (data === null || typeof data !== "object") return null;
    const depth = depthBelowMap(data, jsonAdapter(libPathScheme, entriesAwareMapEntries)).get(data) ?? 0;
    return describeDocumentDepth(depth);
  }, [data]);

  return (
    <div
      ref={wrapRef}
      className="cq-json-tree-wrap"
      data-pin-role={pinnedRole ?? undefined}
      data-hover-role={hoverRole ?? undefined}
    >
      {depthNote && <div className="cq-json-depth-note">{depthNote}</div>}
      <TreeCore
        data={data}
        expanded={expanded}
        mapEntries={entriesAwareMapEntries}
        highlightedPaths={highlightedPaths}
        openPaths={openPathsAll}
        scrollOnHighlight={scrollOnHighlight}
        onContextMenuPath={onPinPath ? handleContextMenu : undefined}
        onRowHover={onHoverPath ? handleRowHover : undefined}
        rowPathAttribute={ROW_PATH_ATTRIBUTE}
        renderRow={renderRow}
        renderClosingRow={renderClosingRow}
        renderRowFooter={selected ? renderRowFooter : undefined}
        renderMoreRows={renderMoreRows}
        foldChains={FOLD_CHAINS_FROM}
        wrapperClassName="cq-json-tree"
        rowClassName="cq-json-row"
        highlightedRowClassName="cq-json-pinned"
        getRowClassName={getRowClassName}
        nodeBlockClassName="cq-json-block"
      />
    </div>
  );
}
