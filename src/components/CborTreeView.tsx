"use client";

// Structural CBOR tree: one row per node, linked to hex by hover and right-click.
// Rendered flat (`flatTree/flatten`): indent by depth, not nested components.
// Single-child runs fold to one row; closed rows and the panel header report document depth.

import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { CborValue, CborPosition, CborOddity, CborOddityKind, CborPartialValue } from "@cardananium/cquisitor-lib";
import { CopyIcon, CheckIcon } from "./Icons";
import type { PanelMenuAction } from "./panelMenuActions";
import {
  depthBelowMap,
  flattenTree,
  rowKeys,
  type FlatChild,
  type FlatRow,
  type FlatTreeAdapter,
} from "./flatTree/flatten";
import { describeDocumentDepth, describeFold, describeLevelsBelow } from "./flatTree/depthNotes";
import {
  DiagnosticBadge,
  DiagnosticCaption,
  placementOf,
  selectedIn,
  type TreeDiagnostic,
  type TreeDiagnosticRows,
} from "./treeDiagnostics";

export interface CborTreeViewProps {
  // CborPartialValue is structurally compatible with CborValue for our traversal
  // (same fields), plus optional `incomplete` flags on containers and the rare
  // partial map-entry with a missing key/value. We accept both.
  data: CborValue | CborPartialValue;
  hexValue: string;
  onHoverPosition: (position: CborPosition | null) => void;
  onHighlightAndScroll: (position: CborPosition) => void;
  // Position to highlight in tree (from hex view context menu)
  highlightedTreePosition?: CborPosition | null;
  onClearHighlight?: () => void;
  /** Pinned row: opened and persistently marked. Independent of `highlightedTreePosition` (a self-clearing pulse). */
  pinnedPosition?: CborPosition | null;
  /** Extra rows kept open (stepped pin instances) without the pin mark or a scroll. */
  openPositions?: readonly CborPosition[];
  /**
   * Scroll the pinned row into view when it becomes pinned. Default true.
   * Pass whether this tree is on screen: a hidden row has no box, and showing the panel does not change the pin.
   */
  scrollOnHighlight?: boolean;
  /** Right-click: node's CBOR position and this panel's menu actions. Host owns the menu when wired. */
  onPinPosition?: (position: CborPosition | null, actions: PanelMenuAction[]) => void;
  /** Diagnostics keyed by `spanAttr` of the named bytes. Matching header (or container extent) gets a badge. */
  rowDiagnostics?: TreeDiagnosticRows;
  /** Selected diagnostic index: open its row and show its caption. Host scrolls. */
  selectedDiagnostic?: number | null;
  /** Badge click: select that diagnostic, or `null` to clear. */
  onSelectDiagnostic?: (index: number | null) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: CborValue | CborPartialValue;
  path: string;
}

type AnyNode = CborValue | CborPartialValue;

const EMPTY_POSITIONS: readonly CborPosition[] = [];

// A node matches on `position_info` (header) or `struct_position_info` (container extent). Callers use either.
function nodeSpanMatches(node: AnyNode, position: CborPosition): boolean {
  const structInfo = "struct_position_info" in node ? node.struct_position_info : undefined;
  for (const span of [node.position_info, structInfo]) {
    if (span && span.offset === position.offset && span.length === position.length) return true;
  }
  return false;
}

/** `offset:length` for `data-span`, so a host can find a row without a render. */
export function spanAttr(position: CborPosition): string {
  return `${position.offset}:${position.length}`;
}

/** Row `data-span`: header, plus container extent as a second word (`~=` matches either). */
export function rowSpanAttr(node: RowNode): string | undefined {
  if (isMissing(node)) return undefined;
  const header = node.position_info;
  if (!header) return undefined;
  const extent = "struct_position_info" in node ? node.struct_position_info : undefined;
  const words = spanAttr(header);
  return extent && (extent.offset !== header.offset || extent.length !== header.length)
    ? `${words} ${spanAttr(extent)}`
    : words;
}

/** Position reported on hover: container extent, or a leaf's bytes. */
export function hoverPositionOf(node: RowNode): CborPosition | null {
  if (isMissing(node)) return null;
  const structPosition = "struct_position_info" in node ? node.struct_position_info : undefined;
  return structPosition ?? node.position_info ?? null;
}

/** Diagnostics on this row: keyed by header and, for a container, by extent. Returns the map's own list unless both spans have entries, which are joined. */
export function ownDiagnosticsOf(node: RowNode, rows: TreeDiagnosticRows): readonly TreeDiagnostic[] | undefined {
  if (isMissing(node)) return undefined;
  const header = node.position_info;
  if (!header) return undefined;
  const own = rows.get(spanAttr(header));
  const extent = "struct_position_info" in node ? node.struct_position_info : undefined;
  const around = extent && (extent.offset !== header.offset || extent.length !== header.length)
    ? rows.get(spanAttr(extent))
    : undefined;
  if (own && around) return [...own, ...around];
  return own ?? around;
}

/** One step down from a node, as `findPathToPosition` names it. */
type PathStep =
  | { segment: string; node: AnyNode };

function stepsBelow(node: AnyNode): PathStep[] {
  if (!("type" in node)) return [];
  const steps: PathStep[] = [];
  if (node.type === "Array" && node.values) {
    node.values.forEach((child, i) => steps.push({ segment: `array[${i}]`, node: child }));
  } else if (node.type === "Map" && node.values) {
    node.values.forEach((entry, i) => {
      const e = entry as { key?: AnyNode; value?: AnyNode };
      if (e.key) steps.push({ segment: `map[${i}].key`, node: e.key });
      if (e.value) steps.push({ segment: `map[${i}].value`, node: e.value });
    });
  } else if (node.type === "Tag" && "value" in node && node.value) {
    steps.push({ segment: "tag.value", node: node.value });
  } else if ((node.type === "IndefiniteLengthString" || node.type === "IndefiniteLengthBytes") && node.chunks) {
    node.chunks.forEach((chunk, i) => steps.push({ segment: `chunks[${i}]`, node: chunk }));
  }
  return steps;
}

/** Path segments from `node` to `targetPosition` (`[]` for `node`, `null` if none). Explicit stack: decoder depth would overflow the call stack. */
export function findPathToPosition(
  node: AnyNode,
  targetPosition: CborPosition,
): string[] | null {
  if (!node || typeof node !== "object") return null;
  if (nodeSpanMatches(node, targetPosition)) return [];

  interface Frame {
    steps: PathStep[];
    next: number;
    /** The segment that led here, for reading the path back up. */
    segment: string;
    parent: Frame | null;
  }
  const stack: Frame[] = [{ steps: stepsBelow(node), next: 0, segment: "", parent: null }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.next >= frame.steps.length) {
      stack.pop();
      continue;
    }
    const step = frame.steps[frame.next++];
    if (!step.node || typeof step.node !== "object") continue;
    if (nodeSpanMatches(step.node, targetPosition)) {
      const path = [step.segment];
      for (let f: Frame | null = frame; f && f.parent; f = f.parent) path.push(f.segment);
      return path.reverse();
    }
    stack.push({ steps: stepsBelow(step.node), next: 0, segment: step.segment, parent: frame });
  }
  return null;
}

function getCborHex(hexValue: string, position: CborPosition): string {
  const start = position.offset * 2;
  const end = (position.offset + position.length) * 2;
  return hexValue.slice(start, end);
}

function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") return String(val);
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") {
    // Check if it looks like hex bytes - return as-is (no truncation)
    if (/^[0-9a-fA-F]+$/.test(val) && val.length > 0 && val.length % 2 === 0) {
      return val;
    }
    return `"${val}"`;
  }
  if (val instanceof Uint8Array || (Array.isArray(val) && val.every(v => typeof v === "number"))) {
    const arr = val instanceof Uint8Array ? Array.from(val) : val as number[];
    const hex = arr.map(b => b.toString(16).padStart(2, "0")).join("");
    return hex;
  }
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    if ("value" in obj) {
      return formatValue(obj.value);
    }
    try {
      return JSON.stringify(val);
    } catch {
      return "[object]";
    }
  }
  return String(val);
}

// The library includes the terminating Break marker as the last element of `chunks`
// for indefinite-length strings/bytes. Filter it out for counting purposes.
function countDataChunks(chunks: CborValue[]): number {
  return chunks.filter(c => !("type" in c) || c.type !== "Break").length;
}

function getNodeLabel(node: AnyNode): { type: string; value: string; color: string; detail?: string } {
  // All CborValue types have a "type" field
  if ("type" in node && typeof node.type === "string") {
    const rawValue = (node as { value?: unknown }).value;
    
    switch (node.type) {
      // Complex types
      case "Array": {
        const count = node.items === "Indefinite" ? "∞" : node.items;
        const isIndefinite = node.items === "Indefinite";
        return {
          type: isIndefinite ? "array (indefinite)" : "array",
          value: `${count} items`,
          color: "#ef4444", // red
        };
      }
      case "Map": {
        const count = node.items === "Indefinite" ? "∞" : node.items;
        const isIndefinite = node.items === "Indefinite";
        return {
          type: isIndefinite ? "map (indefinite)" : "map",
          value: `${count} entries`,
          color: "#f97316", // orange
        };
      }
      case "Tag":
        return {
          type: "tag",
          value: `#${node.tag}`,
          color: "#8b5cf6", // violet
          detail: getTagDescription(Number(node.tag)),
        };
      case "IndefiniteLengthString":
        return {
          type: "text (indefinite)",
          value: `${countDataChunks(node.chunks)} chunks`,
          color: "#22c55e", // green
        };
      case "IndefiniteLengthBytes":
        return {
          type: "bytes (indefinite)",
          value: `${countDataChunks(node.chunks)} chunks`,
          color: "#06b6d4", // cyan
        };
      
      // Simple types (CborSimpleType)
      case "Null":
        return { type: "null", value: "", color: "#6b7280" };
      case "Undefined":
        return { type: "undefined", value: "", color: "#6b7280" };
      case "Bool":
        return { type: "bool", value: formatValue(rawValue), color: "#3b82f6" };
      case "U8":
        return { type: "uint8", value: formatValue(rawValue), color: "#eab308" };
      case "U16":
        return { type: "uint16", value: formatValue(rawValue), color: "#eab308" };
      case "U32":
        return { type: "uint32", value: formatValue(rawValue), color: "#eab308" };
      case "U64":
        return { type: "uint64", value: formatValue(rawValue), color: "#eab308" };
      case "I8":
        return { type: "nint8", value: formatValue(rawValue), color: "#f59e0b" };
      case "I16":
        return { type: "nint16", value: formatValue(rawValue), color: "#f59e0b" };
      case "I32":
        return { type: "nint32", value: formatValue(rawValue), color: "#f59e0b" };
      case "I64":
        return { type: "nint64", value: formatValue(rawValue), color: "#f59e0b" };
      case "Int":
        return { type: "bigint", value: formatValue(rawValue), color: "#d97706" };
      case "F16":
        return { type: "float16", value: formatValue(rawValue), color: "#10b981" };
      case "F32":
        return { type: "float32", value: formatValue(rawValue), color: "#10b981" };
      case "F64":
        return { type: "float64", value: formatValue(rawValue), color: "#10b981" };
      case "Bytes": {
        const hex = formatValue(rawValue);
        const byteLen = typeof rawValue === "string" ? rawValue.length / 2 : 
                        rawValue instanceof Uint8Array ? rawValue.length :
                        Array.isArray(rawValue) ? rawValue.length : 0;
        return { 
          type: "bytes", 
          value: `${byteLen} bytes`,
          detail: hex,
          color: "#06b6d4" 
        };
      }
      case "String": {
        const str = String(rawValue ?? "");
        return { 
          type: "tstr", 
          value: `${str.length} chars`,
          detail: formatValue(rawValue),
          color: "#22c55e" 
        };
      }
      case "Simple":
        return { type: `simple(${formatValue(rawValue)})`, value: "", color: "#6b7280" };
      case "Break":
        return { type: "break", value: "", color: "#6b7280" };
    }
  }

  // Fallback for unknown structure
  const rawValue = (node as { value?: unknown }).value;
  return { type: "unknown", value: formatValue(rawValue), color: "#6b7280" };
}

// Short labels for non-canonical encoding flags (RFC 8949 §4.1/§4.2)
const ODDITY_LABELS: Record<CborOddityKind, string> = {
  IntNotShortest: "integer not in shortest form",
  FloatNotShortest: "float not in shortest form",
  IndefiniteLength: "indefinite length",
  MapKeysNotSorted: "map keys not sorted",
  DuplicateMapKeys: "duplicate map keys",
  BignumForSmallInt: "bignum for small int",
  BignumLeadingZeroes: "bignum has leading zero bytes",
};

function OdditiesBadge({ oddities }: { oddities: CborOddity[] }) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="cbor-tree-oddity" aria-label="Non-canonical encoding">
            <span className="cbor-tree-oddity-icon">⚠</span>
            {oddities.length > 1 && <span className="cbor-tree-oddity-count">×{oddities.length}</span>}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="cbor-oddity-tooltip" sideOffset={4} side="top">
            <div className="cbor-oddity-tooltip-title">Non-canonical encoding</div>
            <ul className="cbor-oddity-tooltip-list">
              {oddities.map((o, i) => (
                <li key={i}>
                  <span className="cbor-oddity-tooltip-kind">{ODDITY_LABELS[o.kind] ?? o.kind}</span>
                  {o.detail && <span className="cbor-oddity-tooltip-detail"> — {o.detail}</span>}
                </li>
              ))}
            </ul>
            <Tooltip.Arrow className="cbor-oddity-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// Visual marker for container nodes the decoder couldn't finish
// (shows up only on partial trees returned alongside a CborDecodeError).
function IncompleteBadge() {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="cbor-tree-incomplete" aria-label="Incomplete">
            incomplete
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="cbor-oddity-tooltip" sideOffset={4} side="top">
            <div className="cbor-oddity-tooltip-title">Incomplete</div>
            <div>This container was cut short by a decode error.</div>
            <Tooltip.Arrow className="cbor-oddity-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// Common CBOR tag descriptions
function getTagDescription(tag: number): string | undefined {
  const tags: Record<number, string> = {
    0: "date/time string",
    1: "epoch timestamp",
    2: "positive bignum",
    3: "negative bignum",
    4: "decimal fraction",
    5: "bigfloat",
    21: "base64url",
    22: "base64",
    23: "base16",
    24: "encoded CBOR",
    32: "URI",
    33: "base64url string",
    34: "base64 string",
    35: "regex",
    36: "MIME message",
    55799: "self-describe CBOR",
    // Cardano specific
    121: "Plutus data (constr 0)",
    122: "Plutus data (constr 1)", 
    123: "Plutus data (constr 2)",
    124: "Plutus data (constr 3)",
    125: "Plutus data (constr 4)",
    126: "Plutus data (constr 5)",
    127: "Plutus data (constr 6)",
    258: "set",
    259: "map (preserve order)",
  };
  return tags[tag];
}

// Expandable value component for long data
function ExpandableValue({ value }: { value: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  // Check if text overflows
  useEffect(() => {
    if (containerRef.current && textRef.current) {
      setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [value]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOverflowing || isExpanded) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isExpanded) {
    return (
      <div className="cbor-tree-detail-expanded" onClick={handleClick} title="Click to collapse">
        <div className="cbor-tree-detail-expanded-header">
          <button 
            className="cbor-tree-detail-copy"
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy value"}
          >
            {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
          </button>
        </div>
        <div className="cbor-tree-detail-expanded-value">
          {value}
        </div>
      </div>
    );
  }

  return (
    <span
      ref={containerRef}
      className={`cbor-tree-detail${isOverflowing ? " cbor-tree-detail-clickable" : ""}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (isOverflowing && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          e.stopPropagation();
          setIsExpanded(true);
        }
      }}
      title={isOverflowing ? "Click to expand" : undefined}
      role={isOverflowing ? "button" : undefined}
      tabIndex={isOverflowing ? 0 : undefined}
    >
      <span ref={textRef} className="cbor-tree-detail-text">
        {value}
      </span>
      {isOverflowing && (
        <span className="cbor-tree-detail-ellipsis" aria-label="Expand value">
          <span className="cbor-tree-detail-ellipsis-dots">…</span>
          <svg
            className="cbor-tree-detail-ellipsis-icon"
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="3,6 8,11 13,6" />
          </svg>
        </span>
      )}
    </span>
  );
}

/** What a row is labelled with, beyond the node itself. */
interface RowLabel {
  keyLabel?: string;
  keyType?: "map-key" | "map-value";
  /** Path suffix from the parent, and the highlight-route step. */
  pathSuffix: string;
}

/** A map entry's missing half: the decoder stopped before it. */
interface MissingNode {
  missing: "key" | "value";
}

type RowNode = AnyNode | MissingNode;

function isMissing(node: RowNode): node is MissingNode {
  return "missing" in node;
}

function hasChildren(node: RowNode): boolean {
  if (isMissing(node) || !("type" in node)) return false;
  return (
    node.type === "Array" || node.type === "Map" || node.type === "Tag" ||
    node.type === "IndefiniteLengthString" || node.type === "IndefiniteLengthBytes"
  );
}

type Child = FlatChild<RowNode, RowLabel>;

const child = (key: string | number, node: RowNode, label: RowLabel, isArrayItem = false): Child =>
  ({ key, node, isArrayItem, label });

/** Children in display order. Paths match `findPathToPosition` segments. */
function childrenOf(node: RowNode): Child[] {
  if (isMissing(node) || !("type" in node)) return [];
  if (node.type === "Array") {
    return node.values.map((item, index) => {
      // Indefinite-length arrays surface the terminating Break as the last
      // child; label it "end" for consistency with maps/strings/bytes.
      const isBreak = "type" in item && item.type === "Break";
      return child(index, item, { keyLabel: isBreak ? "end" : `[${index}]`, pathSuffix: `[${index}]` }, true);
    });
  }
  if (node.type === "Map") {
    const out: Child[] = [];
    node.values.forEach((entry, index) => {
      // Indefinite-length maps surface the terminating Break as a bare node
      // (`{type: "Break"}`) — the last child — mirroring how indefinite
      // arrays/strings show it. It is not a {key, value} pair, so it is a
      // row of its own rather than a key/value pair.
      if ("type" in entry) {
        const bare = entry as unknown as CborValue;
        const isBreak = (bare as { type?: string }).type === "Break";
        out.push(child(index, bare, { keyLabel: isBreak ? "end" : `[${index}]`, pathSuffix: `[${index}]` }));
        return;
      }
      // Partial map entries (from CborDecodeResult.partial) may have an
      // undefined/null key or value on the entry where decoding stopped.
      const partial = entry as { key?: CborValue; value?: CborValue };
      out.push(child(
        `keys[${index}]`,
        partial.key ?? { missing: "key" },
        { keyLabel: "key", keyType: "map-key", pathSuffix: `.keys[${index}]` },
      ));
      out.push(child(
        `values[${index}]`,
        partial.value ?? { missing: "value" },
        { keyLabel: "val", keyType: "map-value", pathSuffix: `.values[${index}]` },
      ));
    });
    return out;
  }
  if (node.type === "Tag") {
    // Partial Tag may omit `value` when the inner item couldn't parse.
    const value: RowNode = "value" in node && node.value !== undefined ? node.value : { missing: "value" };
    return [child("value", value, { keyLabel: "value", pathSuffix: ".value" })];
  }
  if (node.type === "IndefiniteLengthString" || node.type === "IndefiniteLengthBytes") {
    let chunkIdx = 0;
    return node.chunks.map((chunk, index) => {
      const isBreak = "type" in chunk && chunk.type === "Break";
      const keyLabel = isBreak ? "end" : `chunk ${chunkIdx++}`;
      return child(`chunks[${index}]`, chunk, { keyLabel, pathSuffix: `.chunks[${index}]` });
    });
  }
  return [];
}

const treeAdapter: FlatTreeAdapter<RowNode, RowLabel> = {
  childrenOf,
  isContainer: hasChildren,
  childPath: (parent, c) => `${parent}${c.label!.pathSuffix}`,
  stepOf: (c) => c.label!.pathSuffix,
};

/** A `findPathToPosition` segment as the step the tree takes for it. */
function routeStep(segment: string): string {
  if (segment.startsWith("array[")) return segment.slice("array".length);
  const map = segment.match(/^map\[(\d+)\]\.(key|value)$/);
  if (map) return `.${map[2] === "key" ? "keys" : "values"}[${map[1]}]`;
  if (segment === "tag.value") return ".value";
  if (segment.startsWith("chunks[")) return `.${segment}`;
  return segment;
}

/** A run of single-child levels this long is shown as one row. */
const FOLD_CHAINS_FROM = 4;
/** Past this many levels the indent stops growing; the depth is on the row. */
const MAX_INDENT_LEVELS = 40;
const INDENT_PX = 16;
/** Rows rendered before the rest are held behind "show more". */
const ROW_BUDGET = 2000;

type Row = FlatRow<RowNode, RowLabel>;

/** A user's toggle, and which highlight it was made after. */
interface RowToggle {
  open: boolean;
  epoch: number;
}

interface TreeRowProps {
  row: Row;
  isHighlighted: boolean;
  isPinned: boolean;
  scrollOnPin: boolean;
  /** Diagnostics on this row — the host's own list, stable until the run changes. */
  diagnostics?: readonly TreeDiagnostic[];
  /** Selected diagnostic on this row, or `null`. */
  selectedOwn: number | null;
  onToggle: (row: Row) => void;
  onContextMenu: (e: React.MouseEvent, node: AnyNode, path: string) => void;
  onHover: (position: CborPosition | null) => void;
  onSelectDiagnostic: (index: number | null) => void;
  onRevealBytes: (position: CborPosition) => void;
}

const TreeRow = memo(function TreeRow({
  row,
  isHighlighted,
  isPinned,
  scrollOnPin,
  diagnostics,
  selectedOwn,
  onToggle,
  onContextMenu,
  onHover,
  onSelectDiagnostic,
  onRevealBytes,
}: TreeRowProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const { node, depth } = row;
  const indent = Math.min(depth, MAX_INDENT_LEVELS) * INDENT_PX;

  // Scroll into view when highlighted, or when pinned and asked to. Not animated: animated scrolls are dropped where the browser does not run them.
  const shouldScroll = isHighlighted || (isPinned && scrollOnPin);
  useEffect(() => {
    if (!shouldScroll || !nodeRef.current) return;
    const element = nodeRef.current;

    // Find the scrollable container (.tree-view-container)
    let scrollContainer = element.parentElement;
    while (scrollContainer && !scrollContainer.classList.contains("tree-view-container")) {
      scrollContainer = scrollContainer.parentElement;
    }

    // Root node (depth === 0) - scroll to top
    if (depth === 0) {
      // Host pane may not use `.tree-view-container`; the root is still the first row.
      if (scrollContainer) scrollContainer.scrollTo({ top: 0 });
      else element.scrollIntoView({ block: "start" });
      return;
    }

    // For other nodes, use RAF to ensure DOM is ready after expansion
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const el = nodeRef.current;
        if (!el || !scrollContainer) {
          el?.scrollIntoView({ block: "center" });
          return;
        }

        // Calculate position relative to scroll container
        const containerRect = scrollContainer.getBoundingClientRect();
        const elementRect = el.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top + scrollContainer.scrollTop;

        // Scroll to center the element
        const targetScroll = relativeTop - (containerRect.height / 2) + (elementRect.height / 2);
        scrollContainer.scrollTo({ top: Math.max(0, targetScroll) });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [shouldScroll, depth]);

  if (isMissing(node)) {
    return (
      <div className="cbor-tree-node" style={{ paddingLeft: indent }}>
        <div className={`cbor-tree-row cbor-tree-row-${row.label?.keyType ?? "plain"}`}>
          <span className="cbor-tree-missing">{node.missing}: missing</span>
        </div>
      </div>
    );
  }

  const hoverPosition = hoverPositionOf(node);
  const label = getNodeLabel(node);
  const container = hasChildren(node);
  const expanded = row.kind === "open";
  const keyType = row.label?.keyType;
  const keyLabel = row.fold
    ? describeFold(row.fold, (k) => (typeof k === "number" ? `[${k}]` : String(k)))
    : row.label?.keyLabel;
  const levelsBelow = !expanded ? describeLevelsBelow(row.depthBelow) : "";
  const selectedDiagnostic = diagnostics ? selectedIn(diagnostics, selectedOwn) : null;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (container) onToggle(row);
  };

  // Fire on move as well as enter: the host clears hover when inputs change, and a still-over pointer would stay dark.
  const handleMouseEnter = () => {
    if (hoverPosition) onHover(hoverPosition);
  };

  const handleMouseLeave = () => {
    onHover(null);
  };

  const handleContextMenuEvent = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, node, row.path);
  };

  return (
    <div
      className={`cbor-tree-node ${isHighlighted ? "cbor-tree-node-highlighted" : ""}`}
      style={{ paddingLeft: indent }}
      ref={nodeRef}
    >
      <div
        className={`cbor-tree-row ${keyType ? `cbor-tree-row-${keyType}` : ""} ${isPinned ? "cbor-tree-row-pinned" : ""} ${isHighlighted ? "cbor-tree-row-highlighted" : ""}${diagnostics ? " cbor-tree-row-mismatch" : ""}${selectedDiagnostic ? " cbor-tree-row-mismatch-selected" : ""}`}
        data-span={rowSpanAttr(node)}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenuEvent}
      >
        {/* Expand/Collapse toggle */}
        <button
          className={`cbor-tree-toggle ${container ? "has-children" : ""} ${expanded ? "expanded" : ""}`}
          onClick={handleToggle}
          tabIndex={-1}
        >
          {container ? (expanded ? "▼" : "▶") : "•"}
        </button>

        {/* Key label if present; for a folded run, the run's keys */}
        {keyLabel && (
          <span
            className={`cbor-tree-key ${keyType === "map-key" ? "is-map-key" : ""} ${keyType === "map-value" ? "is-map-value" : ""} ${row.fold ? "cbor-tree-fold" : ""}`}
            title={row.fold ? `${row.fold.levels} nested levels, each holding one child, shown as one row` : undefined}
          >
            {keyLabel}
          </span>
        )}

        {/* Type badge */}
        <span
          className="cbor-tree-type"
          style={{
            backgroundColor: label.color,
            color: "#fff",
          }}
        >
          {label.type}
        </span>

        {/* Non-canonical encoding indicator */}
        {node.oddities && node.oddities.length > 0 && (
          <OdditiesBadge oddities={node.oddities} />
        )}

        {/* Incomplete container (only present on partial trees from decode errors) */}
        {(node as { incomplete?: true }).incomplete && <IncompleteBadge />}

        {/* Value info */}
        {label.value && (
          <span className="cbor-tree-info">{label.value}</span>
        )}
        {levelsBelow && (
          <span className="cbor-tree-info cbor-tree-depth">{levelsBelow}</span>
        )}

        {/* Detail (actual value) */}
        {label.detail && (
          <ExpandableValue value={label.detail} />
        )}

        {/* Badge last in markup; CSS order places it before the action button. */}
        {diagnostics && (
          <DiagnosticBadge
            diagnostics={diagnostics}
            selected={selectedOwn}
            onSelect={onSelectDiagnostic}
            className="cbor-tree-mismatch-badge"
          />
        )}

        {/* Action button */}
        <button
          className="cbor-tree-action"
          onClick={handleContextMenuEvent}
          title="Actions"
        >
          ⋮
        </button>
      </div>
      {/* Caption after the row so `data-span` lookup and in-place marks never hit it. */}
      {selectedDiagnostic && (
        <DiagnosticCaption
          diagnostic={selectedDiagnostic}
          className="cbor-tree-row-caption"
          onRevealBytes={onRevealBytes}
        />
      )}
    </div>
  );
});

// Context menu with smart positioning
interface ContextMenuPortalProps {
  x: number;
  y: number;
  onClickOutside: () => void;
  children: React.ReactNode;
}

function ContextMenuPortal({ x, y, onClickOutside, children }: ContextMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Adjust position after mount
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    // Use requestAnimationFrame to wait for paint
    const frame = requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = x;
      let top = y;

      // Check right overflow - if menu would go past viewport, show on left side
      if (x + menuRect.width > viewportWidth - 10) {
        left = x - menuRect.width;
      }

      // Check bottom overflow
      if (y + menuRect.height > viewportHeight - 10) {
        top = viewportHeight - menuRect.height - 10;
      }

      // Ensure not off left edge
      if (left < 10) left = 10;
      // Ensure not off top edge
      if (top < 10) top = 10;

      if (left !== x || top !== y) {
        setPosition({ left, top });
      }
    });
    
    return () => cancelAnimationFrame(frame);
  }, [x, y]);

  // Handle click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onClickOutside]);

  return (
    <div
      ref={menuRef}
      className="cbor-context-menu"
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
      }}
    >
      {children}
    </div>
  );
}

export default function CborTreeView({
  data,
  hexValue,
  onHoverPosition,
  onHighlightAndScroll,
  highlightedTreePosition,
  onClearHighlight,
  pinnedPosition,
  openPositions = EMPTY_POSITIONS,
  scrollOnHighlight = true,
  onPinPosition,
  rowDiagnostics,
  selectedDiagnostic,
  onSelectDiagnostic,
}: CborTreeViewProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Selected diagnostic's row, or none if the run placed it on no row.
  const selectedPlacement = useMemo(
    () => placementOf(rowDiagnostics, selectedDiagnostic),
    [rowDiagnostics, selectedDiagnostic],
  );
  const selectedPosition = selectedPlacement?.diagnostic.position ?? null;

  // Open the way to the highlight, pin, selected diagnostic, and kept-open rows. Other pin instances are marked in place, not opened.
  const highlightRoutes = useMemo<string[][]>(() => {
    if (!data) return [];
    const routes: string[][] = [];
    for (const target of [highlightedTreePosition, pinnedPosition, selectedPosition, ...openPositions]) {
      if (!target) continue;
      const segments = findPathToPosition(data, target);
      if (segments) routes.push(segments.map(routeStep));
    }
    return routes;
  }, [highlightedTreePosition, pinnedPosition, selectedPosition, openPositions, data]);

  // Stable per-row callbacks via refs so a new host handler per render does not rebuild every row.
  const selectRef = useRef(onSelectDiagnostic);
  const revealRef = useRef(onHighlightAndScroll);
  useEffect(() => {
    selectRef.current = onSelectDiagnostic;
    revealRef.current = onHighlightAndScroll;
  }, [onSelectDiagnostic, onHighlightAndScroll]);
  const selectDiagnostic = useCallback((index: number | null) => selectRef.current?.(index), []);
  const revealBytes = useCallback((position: CborPosition) => revealRef.current(position), []);

  // User toggles keyed on the node object so a folded run is not asked per level. Cleared when `data` changes.
  const [toggled, setToggled] = useState<ReadonlyMap<object, RowToggle>>(() => new Map());
  const [toggledFor, setToggledFor] = useState<AnyNode | null>(data);
  if (toggledFor !== data) {
    setToggledFor(data);
    setToggled(new Map());
  }
  // A highlight reopens ancestors the user had closed. A close after this highlight stands (`epoch`).
  const [highlightEpoch, setHighlightEpoch] = useState(0);
  const [routesSeen, setRoutesSeen] = useState(highlightRoutes);
  if (routesSeen !== highlightRoutes) {
    setRoutesSeen(highlightRoutes);
    setHighlightEpoch((n) => n + 1);
  }
  const [limit, setLimit] = useState(ROW_BUDGET);
  const [limitFor, setLimitFor] = useState<AnyNode | null>(data);
  if (limitFor !== data) {
    setLimitFor(data);
    setLimit(ROW_BUDGET);
  }

  const depthBelow = useMemo(() => depthBelowMap<RowNode, RowLabel>(data, treeAdapter), [data]);
  const depthNote = useMemo(
    () => describeDocumentDepth(depthBelow.get(data) ?? 0),
    [depthBelow, data],
  );

  const flat = useMemo(
    () =>
      flattenTree<RowNode, RowLabel>(data, {
        adapter: treeAdapter,
        rootPath: "root",
        isOpen: ({ node, depth, onHighlightRoute, chainOpen }) => {
          const chosen = toggled.get(node as object);
          if (chosen && !(onHighlightRoute && !chosen.open && chosen.epoch < highlightEpoch)) {
            return chosen.open;
          }
          return chainOpen || onHighlightRoute || depth < 2;
        },
        opensChain: true,
        highlightRoutes,
        foldChainsFrom: FOLD_CHAINS_FROM,
        limit,
        depthBelow,
      }),
    [data, toggled, highlightEpoch, highlightRoutes, limit, depthBelow],
  );
  const keys = useMemo(() => rowKeys(flat.rows.map((row) => row.path)), [flat]);

  const toggleRow = useCallback((row: Row) => {
    setToggled((prev) => {
      const next = new Map(prev);
      // Collapse a folded run from its first node; opening a closed row opens that node (the run follows).
      if (row.kind === "open") next.set(row.foldStartNode as object, { open: false, epoch: highlightEpoch });
      else next.set(row.node as object, { open: true, epoch: highlightEpoch });
      return next;
    });
  }, [highlightEpoch]);
  const showMore = useCallback(() => setLimit((n) => n + ROW_BUDGET), []);

  // Clear highlight after animation (3 seconds)
  useEffect(() => {
    if (highlightedTreePosition) {
      const timer = setTimeout(() => {
        onClearHighlight?.();
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [highlightedTreePosition, onClearHighlight]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: CborValue | CborPartialValue, path: string) => {
      const pos = node.struct_position_info || node.position_info;
      // Host owns the pin menu: hand it this panel's actions instead of a second menu.
      if (onPinPosition) {
        const actions: PanelMenuAction[] = [];
        if (pos) {
          actions.push({
            id: "copy-cbor-hex",
            label: "Copy CBOR hex",
            run: () => navigator.clipboard.writeText(getCborHex(hexValue, pos)),
          });
          actions.push({
            id: "highlight-in-hex",
            label: "Highlight in hex view",
            run: () => onHighlightAndScroll(pos),
          });
        }
        onPinPosition(pos ?? null, actions);
        return;
      }
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        node,
        path,
      });
    },
    [onPinPosition, hexValue, onHighlightAndScroll]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopyCbor = useCallback(() => {
    if (contextMenu) {
      const position = contextMenu.node.struct_position_info || contextMenu.node.position_info;
      if (position) {
        const hex = getCborHex(hexValue, position);
        navigator.clipboard.writeText(hex);
      }
    }
    closeContextMenu();
  }, [contextMenu, hexValue, closeContextMenu]);

  const handleHighlightCbor = useCallback(() => {
    if (contextMenu) {
      const position = contextMenu.node.struct_position_info || contextMenu.node.position_info;
      if (position) {
        onHighlightAndScroll(position);
      }
    }
    closeContextMenu();
  }, [contextMenu, onHighlightAndScroll, closeContextMenu]);

  return (
    <div className="cbor-tree-view">
      {depthNote && <div className="cbor-tree-depth-note">{depthNote}</div>}
      {flat.rows.map((row, i) => {
        const diagnostics = rowDiagnostics ? ownDiagnosticsOf(row.node, rowDiagnostics) : undefined;
        const selectedOwn =
          diagnostics && selectedDiagnostic != null && diagnostics.some((d) => d.index === selectedDiagnostic)
            ? selectedDiagnostic
            : null;
        return (
          <TreeRow
            key={keys[i]}
            row={row}
            isHighlighted={
              !!highlightedTreePosition && !isMissing(row.node) &&
              nodeSpanMatches(row.node, highlightedTreePosition)
            }
            isPinned={
              !!pinnedPosition && !isMissing(row.node) &&
              nodeSpanMatches(row.node, pinnedPosition)
            }
            scrollOnPin={scrollOnHighlight}
            diagnostics={diagnostics}
            selectedOwn={selectedOwn}
            onToggle={toggleRow}
            onContextMenu={handleContextMenu}
            onHover={onHoverPosition}
            onSelectDiagnostic={selectDiagnostic}
            onRevealBytes={revealBytes}
          />
        );
      })}
      {flat.truncated && (
        <button type="button" className="cbor-tree-more" onClick={showMore}>
          Show more rows
        </button>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenuPortal
          x={contextMenu.x}
          y={contextMenu.y}
          onClickOutside={closeContextMenu}
        >
          <button onClick={handleCopyCbor}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy CBOR Hex
          </button>
          <button onClick={handleHighlightCbor}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Highlight in Hex View
          </button>
        </ContextMenuPortal>
      )}
    </div>
  );
}
