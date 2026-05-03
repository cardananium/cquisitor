"use client";

// Thin adapter over the shared `JsonTreeView`. Renders the CDDL
// validator's "Decoded against schema" panel using lib-canonical paths
// so right-click pinning round-trips with the CBOR/CDDL panels.

import React, { useCallback, useMemo } from "react";
import {
  JsonTreeView,
  entriesAwareMapEntries,
  type RenderRowArgs,
} from "@/components/jsonTree";

interface DecodedJsonTreeProps {
  data: unknown;
  /** Lib-format path of the currently pinned node, e.g. `$.body[0]["k"]`. */
  pinnedPath?: string | null;
  /**
   * Right-click on a node → fired with that node's lib-format path and
   * a hint about which part of the row the click landed on. The lib emits
   * separate `key` / `value` entries that share the same `decoded_path`,
   * so the consumer can pick the right one.
   */
  onPinPath?: (path: string, role: "key" | "value") => void;
  /** How deep to expand by default. */
  expanded?: number;
}

function renderPrimitive(v: unknown): React.ReactNode {
  if (v === null) return <span className="cq-json-null">null</span>;
  if (v === undefined) return <span className="cq-json-null">undefined</span>;
  if (typeof v === "string") return <span className="cq-json-string">&quot;{v}&quot;</span>;
  if (typeof v === "number" || typeof v === "bigint")
    return <span className="cq-json-number">{String(v)}</span>;
  if (typeof v === "boolean") return <span className="cq-json-bool">{String(v)}</span>;
  return <span>{String(v)}</span>;
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
}: RenderRowArgs) {
  const keyEl =
    keyLabel === null ? null : (
      <span className={`cq-json-key${isArrayItem ? " cq-json-array-key" : ""}`}>
        {isArrayItem ? `[${keyLabel}]` : keyLabel}
      </span>
    );

  if (!isComplex) {
    return (
      <>
        {keyEl}
        {keyEl && <span className="cq-json-colon">:</span>}
        {renderPrimitive(value)}
      </>
    );
  }

  const isArray = kind === "array";
  const bracketOpen = isArray ? "[" : "{";
  const bracketClose = isArray ? "]" : "}";

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
        </span>
      )}
      {!isOpen && <span className="cq-json-bracket">{bracketClose}</span>}
    </>
  );
}

export default function DecodedJsonTree({
  data,
  pinnedPath,
  onPinPath,
  expanded = 3,
}: DecodedJsonTreeProps) {
  const highlightedPaths = useMemo(
    () => (pinnedPath ? [pinnedPath] : []),
    [pinnedPath],
  );

  const handleContextMenu = useCallback(
    (path: string, _value: unknown, ev: React.MouseEvent) => {
      // Walk up from the click target to determine whether the cursor
      // landed on the key span. `cq-json-array-key` is also a key span
      // (so e.g. RMB on `[0]` of an array still pins the array element),
      // but `entry_role: "key"` only makes sense for *map* keys — array
      // indices have no separate key entry, so always default to value
      // for arrays.
      const target = ev.target as Element | null;
      const isKeyClick = !!target?.closest(".cq-json-key:not(.cq-json-array-key)");
      onPinPath?.(path, isKeyClick ? "key" : "value");
    },
    [onPinPath],
  );

  const renderClosingRow = useCallback(
    ({ kind }: { kind: "array" | "object" }) => (
      <div className="cq-json-row">
        <span className="cq-json-bracket">{kind === "array" ? "]" : "}"}</span>
      </div>
    ),
    [],
  );

  return (
    <JsonTreeView
      data={data}
      expanded={expanded}
      mapEntries={entriesAwareMapEntries}
      highlightedPaths={highlightedPaths}
      onContextMenuPath={onPinPath ? handleContextMenu : undefined}
      renderRow={Row}
      renderClosingRow={renderClosingRow}
      wrapperClassName="cq-json-tree"
      rowClassName="cq-json-row"
      highlightedRowClassName="cq-json-pinned"
      childrenClassName="cq-json-children"
      nodeBlockClassName="cq-json-block"
    />
  );
}
