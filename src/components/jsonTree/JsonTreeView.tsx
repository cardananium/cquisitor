"use client";

// Generic JSON-tree walker shared by `ValidationJsonViewer` (Transaction
// Validator) and `DecodedJsonTree` (CDDL Validator).
//
// What this owns:
//   - recursion over JSON-shaped data (objects, arrays, primitives)
//   - path computation via a pluggable `joinKey`
//   - per-node expand/collapse state, with auto-expand when a highlighted
//     descendant exists
//   - optional scroll-into-view when a node becomes highlighted
//
// What the caller owns (via `renderRow`):
//   - the visual row itself: toggle UI, key/value, decorations, brackets
//   - styling (CSS class scheme — `vjv-*` vs `cq-json-*`)
//   - any cross-panel callbacks (RMB pin, click-to-focus, etc.)
//
// The closing-bracket child row is rendered by the core because both
// consumers want it identically positioned under the children block.

import React, {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type IsAncestor,
  type JoinKey,
  type PathsEqual,
  libIsPathAncestor,
  libJoinKey,
  libPathsEqual,
} from "./paths";
import { type MapEntry, plainMapEntries } from "./mapEntries";

export type JsonNodeKind = "primitive" | "array" | "object";

export interface JsonNodeContext {
  /** Display label for the row. `null` only for the synthetic root. */
  keyLabel: string | number | null;
  value: unknown;
  /** Path of this node in the tree, per `joinKey`. */
  path: string;
  depth: number;
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

  /** Path of the synthetic root. Default `"$"` (lib-canonical scheme). */
  rootPath?: string;
  /** Path joiner. Default `libJoinKey`. */
  joinKey?: JoinKey;
  /** Path equality. Default `libPathsEqual`. */
  pathsEqual?: PathsEqual;
  /** Ancestor predicate. Default `libIsPathAncestor`. */
  isPathAncestor?: IsAncestor;

  /** Set of paths to highlight. Tested with `pathsEqual`. */
  highlightedPaths?: ReadonlyArray<string> | ReadonlySet<string>;

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

  /**
   * Returns true to force the node expanded by default, regardless of
   * `expanded` depth. Called once at mount per node. Use for things like
   * "expand any node that has a diagnostic on it".
   */
  shouldDefaultExpand?: (args: {
    path: string;
    depth: number;
    value: unknown;
    kind: JsonNodeKind;
  }) => boolean;

  /** Right-click on the row container. */
  onContextMenuPath?: (path: string, value: unknown, ev: React.MouseEvent) => void;

  /**
   * Click on the row container. Receives the full row context so the
   * caller can decide what to do (e.g. toggle expand). Used by the
   * Transaction Validator viewer where clicking anywhere on a row
   * toggles the node.
   */
  onRowClick?: (ctx: RenderRowArgs, ev: React.MouseEvent) => void;

  /** Scroll into view when `isHighlighted` becomes true. Default false. */
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
  /** Class for the children container `div`. */
  childrenClassName?: string;
  /** Class for the per-node block wrapper `div`. */
  nodeBlockClassName?: string;
  /** Per-node-block extra class — computed from row context. */
  getNodeBlockClassName?: (ctx: RenderRowArgs) => string;

  /**
   * When true, do not render the synthetic root row or its closing
   * bracket — only the root's children. The root must be a complex
   * (object/array) value. Used by `ValidationJsonViewer` whose original
   * markup iterates top-level entries directly under `vjv-root`.
   */
  skipRoot?: boolean;
}

function valueKind(v: unknown): JsonNodeKind {
  if (v === null) return "primitive";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return "primitive";
}

function highlightedSet(
  hp: ReadonlyArray<string> | ReadonlySet<string> | undefined,
): Set<string> | null {
  if (!hp) return null;
  return hp instanceof Set ? (hp as Set<string>) : new Set(hp);
}

interface NodeProps {
  keyLabel: string | number | null;
  value: unknown;
  path: string;
  depth: number;
  isArrayItem: boolean;
  /** Stable bag from the root component. */
  shared: SharedNodeShared;
  /** When true, this is the synthetic root and should render only its children. */
  skipSelf?: boolean;
}

interface SharedNodeShared {
  expanded: number;
  joinKey: JoinKey;
  pathsEqual: PathsEqual;
  isPathAncestor: IsAncestor;
  highlightedPaths: ReadonlyArray<string>;
  mapEntries: (value: unknown) => MapEntry[];
  renderRow: (args: RenderRowArgs) => React.ReactNode;
  renderClosingRow?: JsonTreeViewProps["renderClosingRow"];
  shouldDefaultExpand?: JsonTreeViewProps["shouldDefaultExpand"];
  onContextMenuPath?: JsonTreeViewProps["onContextMenuPath"];
  onRowClick?: JsonTreeViewProps["onRowClick"];
  scrollOnHighlight: boolean;
  rowClassName: string;
  highlightedRowClassName: string;
  childrenClassName: string;
  nodeBlockClassName: string;
  getRowClassName?: (ctx: RenderRowArgs) => string;
  getNodeBlockClassName?: (ctx: RenderRowArgs) => string;
}

function Node({ keyLabel, value, path, depth, isArrayItem, shared, skipSelf }: NodeProps) {
  // Destructure once so React Compiler can track precise deps.
  const {
    expanded: sharedExpanded,
    highlightedPaths,
    pathsEqual,
    isPathAncestor,
    shouldDefaultExpand,
    scrollOnHighlight,
  } = shared;

  const kind = valueKind(value);
  const isComplex = kind === "array" || kind === "object";

  const isHighlighted = useMemo(
    () => highlightedPaths.some((p) => pathsEqual(p, path)),
    [highlightedPaths, pathsEqual, path],
  );
  const hasHighlightedDescendant = useMemo(
    () => highlightedPaths.some((p) => isPathAncestor(path, p)),
    [highlightedPaths, isPathAncestor, path],
  );

  const initialOpen =
    depth < sharedExpanded ||
    hasHighlightedDescendant ||
    (shouldDefaultExpand?.({ path, depth, value, kind }) ?? false);
  const [open, setOpen] = useState(initialOpen);

  // Force-expand when highlight pulls a descendant into focus after mount.
  // React's recommended "store the previous value in state" pattern for
  // deriving state from prop changes — the comparison runs during render
  // and the setState calls are batched into the same render pass.
  const [prevHadDesc, setPrevHadDesc] = useState(hasHighlightedDescendant);
  if (prevHadDesc !== hasHighlightedDescendant) {
    setPrevHadDesc(hasHighlightedDescendant);
    if (hasHighlightedDescendant && !open) setOpen(true);
  }

  const rowRef = useRef<HTMLDivElement>(null);
  // Scroll into view on highlight transition. useLayoutEffect avoids a
  // visible jump between paint and scroll.
  useLayoutEffect(() => {
    if (!scrollOnHighlight || !isHighlighted || !rowRef.current) return;
    const el = rowRef.current;
    const id = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => window.clearTimeout(id);
  }, [isHighlighted, scrollOnHighlight]);

  const toggle = () => setOpen((v) => !v);

  const handleContextMenu = shared.onContextMenuPath
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        shared.onContextMenuPath!(path, value, e);
      }
    : undefined;

  const entries: Array<{
    childKey: string | number;
    childValue: unknown;
    childPath: string;
    childIsArrayItem: boolean;
  }> = [];
  if (kind === "array") {
    const arr = value as unknown[];
    for (let i = 0; i < arr.length; i++) {
      entries.push({
        childKey: i,
        childValue: arr[i],
        childPath: shared.joinKey(path, i, { isArrayItem: true }),
        childIsArrayItem: true,
      });
    }
  } else if (kind === "object") {
    for (const e of shared.mapEntries(value)) {
      entries.push({
        childKey: e.key,
        childValue: e.value,
        childPath: shared.joinKey(path, e.key, { isArrayItem: false }),
        childIsArrayItem: false,
      });
    }
  }

  const ctx: RenderRowArgs = {
    keyLabel,
    value,
    path,
    depth,
    kind,
    isArrayItem,
    isHighlighted,
    hasHighlightedDescendant,
    isOpen: open,
    toggle,
    childCount: entries.length,
    isComplex,
  };

  const rowClass = [
    shared.rowClassName,
    isHighlighted ? shared.highlightedRowClassName : "",
    shared.getRowClassName?.(ctx) ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const blockClass = [
    shared.nodeBlockClassName,
    shared.getNodeBlockClassName?.(ctx) ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleClick = shared.onRowClick
    ? (e: React.MouseEvent) => shared.onRowClick!(ctx, e)
    : undefined;

  const rowEl = (
    <div
      ref={rowRef}
      className={rowClass || undefined}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      {shared.renderRow(ctx)}
    </div>
  );

  if (skipSelf) {
    // Synthetic root in skipRoot mode: drop the row + closing bracket,
    // render children flat. Falls back to a single primitive row when the
    // root happens to be a primitive (defensive — this combination is not
    // expected in practice).
    if (!isComplex) return rowEl;
    return (
      <>
        {entries.map((c) => (
          <Node
            key={String(c.childKey)}
            keyLabel={c.childKey}
            value={c.childValue}
            path={c.childPath}
            depth={depth}
            isArrayItem={c.childIsArrayItem}
            shared={shared}
          />
        ))}
      </>
    );
  }

  if (!isComplex) {
    return rowEl;
  }

  return (
    <div className={blockClass || undefined}>
      {rowEl}
      {open && (
        <div className={shared.childrenClassName || undefined}>
          {entries.map((c) => (
            <Node
              key={String(c.childKey)}
              keyLabel={c.childKey}
              value={c.childValue}
              path={c.childPath}
              depth={depth + 1}
              isArrayItem={c.childIsArrayItem}
              shared={shared}
            />
          ))}
          {shared.renderClosingRow?.({
            kind: kind as "array" | "object",
            path,
            depth,
          })}
        </div>
      )}
    </div>
  );
}

export default function JsonTreeView({
  data,
  expanded = 3,
  rootPath = "$",
  joinKey = libJoinKey,
  pathsEqual = libPathsEqual,
  isPathAncestor = libIsPathAncestor,
  highlightedPaths,
  mapEntries = plainMapEntries,
  renderRow,
  renderClosingRow,
  shouldDefaultExpand,
  onContextMenuPath,
  onRowClick,
  scrollOnHighlight = false,
  wrapperClassName = "cq-json-tree",
  rowClassName = "",
  highlightedRowClassName = "",
  childrenClassName = "",
  nodeBlockClassName = "",
  getRowClassName,
  getNodeBlockClassName,
  skipRoot = false,
}: JsonTreeViewProps) {
  // Stabilise the highlighted-paths array so per-node memos don't churn.
  const hpArr = useMemo<ReadonlyArray<string>>(() => {
    const s = highlightedSet(highlightedPaths);
    return s ? Array.from(s) : [];
  }, [highlightedPaths]);

  const shared = useMemo<SharedNodeShared>(
    () => ({
      expanded,
      joinKey,
      pathsEqual,
      isPathAncestor,
      highlightedPaths: hpArr,
      mapEntries,
      renderRow,
      renderClosingRow,
      shouldDefaultExpand,
      onContextMenuPath,
      onRowClick,
      scrollOnHighlight,
      rowClassName,
      highlightedRowClassName,
      childrenClassName,
      nodeBlockClassName,
      getRowClassName,
      getNodeBlockClassName,
    }),
    [
      expanded,
      joinKey,
      pathsEqual,
      isPathAncestor,
      hpArr,
      mapEntries,
      renderRow,
      renderClosingRow,
      shouldDefaultExpand,
      onContextMenuPath,
      onRowClick,
      scrollOnHighlight,
      rowClassName,
      highlightedRowClassName,
      childrenClassName,
      nodeBlockClassName,
      getRowClassName,
      getNodeBlockClassName,
    ],
  );

  return (
    <div className={wrapperClassName || undefined}>
      <Node
        keyLabel={null}
        value={data}
        path={rootPath}
        depth={0}
        isArrayItem={false}
        shared={shared}
        skipSelf={skipRoot}
      />
    </div>
  );
}
