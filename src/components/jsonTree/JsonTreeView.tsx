"use client";

// Generic JSON-tree viewer shared by `ValidationJsonViewer`, `DecodedJsonTree`, and `JsonDocumentView`.
// Owns a flat walk (`flatTree/flatten`), `PathScheme` paths, expand/collapse (auto-open to a highlight), and optional scroll-into-view.
// Caller owns row UI, CSS classes, and cross-panel callbacks via `renderRow`.
// Closing-bracket rows are produced here so every consumer places them the same.

import React, { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { depthBelowMap, flattenTree, rowKeys, type FlatFold, type FlatRow } from "../flatTree/flatten";
import { jsonAdapter } from "./jsonAdapter";
import { libPathScheme, type PathScheme } from "./paths";
import { type MapEntry, plainMapEntries } from "./mapEntries";

export type JsonNodeKind = "primitive" | "array" | "object";

export interface JsonNodeContext {
  /** Display label for the row. `null` only for the synthetic root. */
  keyLabel: string | number | null;
  value: unknown;
  /** Path of this node in the tree, per the path scheme. */
  path: string;
  /** Indentation level — the open rows above this one. */
  depth: number;
  /** Data depth; equals `depth` unless a run above was folded. */
  dataDepth: number;
  kind: JsonNodeKind;
  /** True when the parent is an array (so callers can render `[i]`). */
  isArrayItem: boolean;
  /** True when this exact node is in `highlightedPaths`. */
  isHighlighted: boolean;
  /** True when an open child of this node is highlighted. */
  hasHighlightedDescendant: boolean;
  /** Current expand state. Only meaningful for complex nodes. */
  isOpen: boolean;
  /** Toggle expand state. No-op for primitives. */
  toggle: () => void;
  /** Number of immediate children. 0 for primitives. */
  childCount: number;
  /** Folded single-child run this row stands for, if any. */
  fold: FlatFold | null;
  /** How many levels of data lie below this node. 0 for primitives. */
  depthBelow: number;
}

export interface RenderRowArgs extends JsonNodeContext {
  /**
   * `true` when the row sits inside a complex (object/array) node; lets
   * the caller render a toggle button. `false` for primitive leaves.
   */
  isComplex: boolean;
}

export interface JsonTreeViewProps {
  data: unknown;
  /** How deep to expand by default. Default 3. */
  expanded?: number;

  /** How paths are written and read. Default: lib-canonical (`$.foo[0]["bar"]`). */
  pathScheme?: PathScheme;

  /** Set of paths to highlight, in the path scheme's own spelling. */
  highlightedPaths?: ReadonlyArray<string> | ReadonlySet<string>;

  /** Paths kept on screen without highlight: opened and not folded, not scrolled to. */
  openPaths?: ReadonlyArray<string>;

  /** Object-shape adapter. Default: `Object.entries`-based. */
  mapEntries?: (value: unknown) => MapEntry[];

  /**
   * Render the row content (header line). The walker handles children +
   * the closing bracket row underneath.
   */
  renderRow: (args: RenderRowArgs) => React.ReactNode;

  /** Render the closing bracket row after children. Default: a no-op. */
  renderClosingRow?: (
    args: { kind: "array" | "object"; path: string; depth: number },
  ) => React.ReactNode;

  /** After a node row, outside `rowPathAttribute`, so path lookup never hits it. */
  renderRowFooter?: (args: RenderRowArgs) => React.ReactNode;

  /**
   * Returns true to open the node by default, regardless of `expanded` depth.
   * A node the user has toggled keeps their state.
   */
  shouldDefaultExpand?: (args: {
    path: string;
    depth: number;
    value: unknown;
    kind: JsonNodeKind;
  }) => boolean;

  /** Fold a single-child chain into one row once it is this many levels long. Off by default. */
  foldChains?: number;

  /** Rows rendered before the rest sit behind a control. Default 2000. */
  rowBudget?: number;
  /** Renders the control shown when rows are held back. */
  renderMoreRows?: (args: { showMore: () => void }) => React.ReactNode;

  /** Right-click on the row container. */
  onContextMenuPath?: (path: string, value: unknown, ev: React.MouseEvent) => void;

  /**
   * Click on the row container. Receives the full row context so the
   * caller can decide what to do (e.g. toggle expand). Used by the
   * Transaction Validator viewer where clicking anywhere on a row
   * toggles the node.
   */
  onRowClick?: (ctx: RenderRowArgs, ev: React.MouseEvent) => void;

  /** Pointer enter/move/leave (`null`) on a node row. Fired every move. */
  onRowHover?: (ctx: RenderRowArgs | null, ev: React.MouseEvent) => void;

  /** Attribute to store each node row's path (`data-path`) for lookup without a render. */
  rowPathAttribute?: string;

  /**
   * Scroll into view when `isHighlighted` becomes true. Default false.
   * Pass whether this tree is on screen: a hidden row has no box.
   */
  scrollOnHighlight?: boolean;

  /**
   * Wrapping element class for the whole tree. Default `"cq-json-tree"`.
   * Pass `""` for no wrapper class.
   */
  wrapperClassName?: string;

  /** Class for the row container `div` produced by the walker. */
  rowClassName?: string;
  /** Class for the highlighted row container. Merged with `rowClassName`. */
  highlightedRowClassName?: string;
  /** Per-row extra class — computed from row context (e.g. severity). */
  getRowClassName?: (ctx: RenderRowArgs) => string;
  /** Class for the per-row block wrapper `div`, which carries the indent. */
  nodeBlockClassName?: string;
  /** Per-node-block extra class — computed from row context. */
  getNodeBlockClassName?: (ctx: RenderRowArgs) => string;
  /** Pixels of indent per level. Default 22. */
  indentPx?: number;

  /**
   * When true, do not render the synthetic root row or its closing
   * bracket — only the root's children. The root must be a complex
   * (object/array) value. Used by `ValidationJsonViewer` whose original
   * markup iterates top-level entries directly under `vjv-root`.
   */
  skipRoot?: boolean;
}

/** Indent cap: a row this deep is reached through a fold or a pin, and its depth is on the row. */
const MAX_INDENT_LEVELS = 40;

/** CSS selector for `[name="value"]`, with the value escaped. */
export function attrSelector(name: string, value: string): string {
  const quoted = value.replace(/[\\"\n\r\f]/g, (c) =>
    c === "\\" || c === '"' ? `\\${c}` : `\\${c.charCodeAt(0).toString(16)} `,
  );
  return `[${name}="${quoted}"]`;
}

const DEFAULT_ROW_BUDGET = 2000;

function valueKind(v: unknown): JsonNodeKind {
  if (v === null) return "primitive";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return "primitive";
}

function highlightedList(
  hp: ReadonlyArray<string> | ReadonlySet<string> | undefined,
): ReadonlyArray<string> {
  if (!hp) return [];
  return hp instanceof Set ? Array.from(hp as Set<string>) : (hp as ReadonlyArray<string>);
}

type Row = FlatRow<unknown>;

/** A user's toggle, and which highlight it was made after. */
interface Toggle {
  open: boolean;
  epoch: number;
}

interface RowProps {
  row: Row;
  ctx: RenderRowArgs;
  renderRow: (args: RenderRowArgs) => React.ReactNode;
  renderClosingRow?: JsonTreeViewProps["renderClosingRow"];
  renderRowFooter?: JsonTreeViewProps["renderRowFooter"];
  onContextMenuPath?: JsonTreeViewProps["onContextMenuPath"];
  onRowClick?: JsonTreeViewProps["onRowClick"];
  onRowHover?: JsonTreeViewProps["onRowHover"];
  pathAttribute?: string;
  scrollOnHighlight: boolean;
  rowClass: string;
  blockClass: string;
  indent: number;
}

const TreeRow = memo(function TreeRow({
  row,
  ctx,
  renderRow,
  renderClosingRow,
  renderRowFooter,
  onContextMenuPath,
  onRowClick,
  onRowHover,
  pathAttribute,
  scrollOnHighlight,
  rowClass,
  blockClass,
  indent,
}: RowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const { isHighlighted } = ctx;
  // Scroll into view on highlight transition. useLayoutEffect runs before paint. Not animated: animated scrolls are dropped where the browser does not run them.
  useLayoutEffect(() => {
    if (!scrollOnHighlight || !isHighlighted) return;
    rowRef.current?.scrollIntoView({ block: "start" });
  }, [isHighlighted, scrollOnHighlight]);

  const style = indent > 0 ? { paddingLeft: indent } : undefined;

  if (row.kind === "closing") {
    return (
      <div className={blockClass || undefined} style={style}>
        {renderClosingRow?.({
          kind: ctx.kind as "array" | "object",
          path: ctx.path,
          depth: ctx.depth,
        })}
      </div>
    );
  }

  const handleContextMenu = onContextMenuPath
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenuPath(ctx.path, ctx.value, e);
      }
    : undefined;
  const handleClick = onRowClick ? (e: React.MouseEvent) => onRowClick(ctx, e) : undefined;
  const handleHover = onRowHover ? (e: React.MouseEvent) => onRowHover(ctx, e) : undefined;
  const handleHoverEnd = onRowHover ? (e: React.MouseEvent) => onRowHover(null, e) : undefined;
  const pathAttr = pathAttribute ? { [pathAttribute]: ctx.path } : undefined;

  return (
    <div className={blockClass || undefined} style={style}>
      <div
        ref={rowRef}
        className={rowClass || undefined}
        {...pathAttr}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
        onMouseEnter={handleHover}
        onMouseMove={handleHover}
        onMouseLeave={handleHoverEnd}
      >
        {renderRow(ctx)}
      </div>
      {renderRowFooter?.(ctx)}
    </div>
  );
});

export default function JsonTreeView({
  data,
  expanded = 3,
  pathScheme = libPathScheme,
  highlightedPaths,
  openPaths,
  mapEntries = plainMapEntries,
  renderRow,
  renderClosingRow,
  renderRowFooter,
  shouldDefaultExpand,
  foldChains,
  rowBudget = DEFAULT_ROW_BUDGET,
  renderMoreRows,
  onContextMenuPath,
  onRowClick,
  onRowHover,
  rowPathAttribute,
  scrollOnHighlight = false,
  wrapperClassName = "cq-json-tree",
  rowClassName = "",
  highlightedRowClassName = "",
  nodeBlockClassName = "",
  getRowClassName,
  getNodeBlockClassName,
  indentPx = 22,
  skipRoot = false,
}: JsonTreeViewProps) {
  const adapter = useMemo(() => jsonAdapter(pathScheme, mapEntries), [pathScheme, mapEntries]);
  const depthBelow = useMemo(() => depthBelowMap(data, adapter), [data, adapter]);

  // User toggles keyed on the node object so deep walks are not O(depth²) on path strings. Cleared when `data` changes.
  const [toggled, setToggled] = useState<ReadonlyMap<object, Toggle>>(() => new Map());
  const [toggledFor, setToggledFor] = useState(data);
  if (toggledFor !== data) {
    setToggledFor(data);
    setToggled(new Map());
  }

  const hpList = useMemo(() => highlightedList(highlightedPaths), [highlightedPaths]);
  // Highlighted routes first; the walk marks targets before `hpList.length`.
  const routes = useMemo(
    () => [...hpList, ...(openPaths ?? [])].map((p) => pathScheme.splitPath(p)),
    [hpList, openPaths, pathScheme],
  );
  // A highlight reopens ancestors the user had closed. A close after this highlight stands (`epoch`).
  const [highlightEpoch, setHighlightEpoch] = useState(0);
  const [routesSeen, setRoutesSeen] = useState(routes);
  if (routesSeen !== routes) {
    setRoutesSeen(routes);
    setHighlightEpoch((n) => n + 1);
  }

  const [limit, setLimit] = useState(rowBudget);
  const [limitFor, setLimitFor] = useState(data);
  if (limitFor !== data) {
    setLimitFor(data);
    setLimit(rowBudget);
  }

  const flat = useMemo(
    () =>
      flattenTree(data, {
        adapter,
        rootPath: pathScheme.rootPath,
        isOpen: ({ path, node, depth, onHighlightRoute, chainOpen }) => {
          const chosen = toggled.get(node as object);
          if (chosen && !(onHighlightRoute && !chosen.open && chosen.epoch < highlightEpoch)) {
            return chosen.open;
          }
          return (
            chainOpen ||
            onHighlightRoute ||
            depth < expanded ||
            (shouldDefaultExpand?.({ path, depth, value: node, kind: valueKind(node) }) ?? false)
          );
        },
        opensChain: foldChains !== undefined,
        highlightRoutes: routes,
        unmarkedRoutesFrom: hpList.length,
        foldChainsFrom: foldChains,
        closingRows: !!renderClosingRow,
        skipRoot,
        limit,
        depthBelow,
      }),
    [
      data, adapter, pathScheme, toggled, highlightEpoch, expanded, shouldDefaultExpand,
      foldChains, routes, hpList.length, renderClosingRow, skipRoot, limit, depthBelow,
    ],
  );

  const toggle = useCallback((row: Row) => {
    setToggled((prev) => {
      const next = new Map(prev);
      // Collapse a folded run from its first node; opening a closed row opens that node (the run follows).
      if (row.kind === "open") next.set(row.foldStartNode as object, { open: false, epoch: highlightEpoch });
      else next.set(row.node as object, { open: true, epoch: highlightEpoch });
      return next;
    });
  }, [highlightEpoch]);

  const showMore = useCallback(() => setLimit((n) => n + rowBudget), [rowBudget]);

  // Closing rows share the node path; duplicate wire-order keys share a path too.
  const keys = rowKeys(flat.rows.map((row) => (row.kind === "closing" ? `${row.path}\u0000close` : row.path)));
  const rows = flat.rows.map((row, i) => {
    const kind = valueKind(row.node);
    const isComplex = kind !== "primitive";
    const ctx: RenderRowArgs = {
      keyLabel: row.key,
      value: row.node,
      path: row.path,
      depth: row.depth,
      dataDepth: row.dataDepth,
      kind,
      isArrayItem: row.isArrayItem,
      isHighlighted: row.isHighlighted,
      hasHighlightedDescendant: row.onHighlightRoute,
      isOpen: row.kind === "open" || row.kind === "closing",
      toggle: () => toggle(row),
      childCount: row.childCount,
      isComplex,
      fold: row.fold,
      depthBelow: row.depthBelow,
    };
    const rowClass = [
      rowClassName,
      row.isHighlighted ? highlightedRowClassName : "",
      getRowClassName?.(ctx) ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    const blockClass = [nodeBlockClassName, getNodeBlockClassName?.(ctx) ?? ""]
      .filter(Boolean)
      .join(" ");
    return (
      <TreeRow
        key={keys[i]}
        row={row}
        ctx={ctx}
        renderRow={renderRow}
        renderClosingRow={renderClosingRow}
        renderRowFooter={renderRowFooter}
        onContextMenuPath={onContextMenuPath}
        onRowClick={onRowClick}
        onRowHover={onRowHover}
        pathAttribute={rowPathAttribute}
        scrollOnHighlight={scrollOnHighlight}
        rowClass={rowClass}
        blockClass={blockClass}
        indent={Math.min(row.depth, MAX_INDENT_LEVELS) * indentPx}
      />
    );
  });

  return (
    <div className={wrapperClassName || undefined}>
      {rows}
      {flat.truncated &&
        (renderMoreRows ? (
          renderMoreRows({ showMore })
        ) : (
          <button type="button" className="cq-json-more" onClick={showMore}>
            Show more rows
          </button>
        ))}
    </div>
  );
}
