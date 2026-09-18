"use client";

import { useRef, useEffect, useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { CborValue, CborPartialValue, CborPosition, CborOddity } from "@cardananium/cquisitor-lib";
import type { CborErrorLocation } from "@/utils/cborError";
import type { PanelMenuAction } from "./panelMenuActions";
import { domPointAt, domRuns, hoverHexCharRangesAll, runElementsIn, type CharRange, type HexOccluder } from "./hexHover";

// Colors for CBOR syntax highlighting
const CBOR_COLORS = [
  "rgba(99, 102, 241, 0.25)",
  "rgba(236, 72, 153, 0.25)",
  "rgba(34, 197, 94, 0.25)",
  "rgba(249, 115, 22, 0.25)",
  "rgba(14, 165, 233, 0.25)",
  "rgba(168, 85, 247, 0.25)",
  "rgba(234, 179, 8, 0.3)",
  "rgba(20, 184, 166, 0.25)",
];

// Opaque enough to read over any run's own tint, with an underline so the
// extent is legible where the tint alone would not be.
const HOVER_COLOR = "rgba(253, 224, 71, 0.9)";
const HOVER_UNDERLINE = "#b45309";
const FOCUS_COLOR = "rgba(239, 68, 68, 0.4)";

/**
 * Hover paint via CSS Custom Highlight (one registration, many ranges) so a hover does not rebuild markup.
 * Fallback: class on covered runs. `::highlight()` rules live here because unregistered names warn at build.
 */
const HEX_HOVER_HIGHLIGHT = "cq-hex-hover";
/** Other pinned instances: fill, no outline, under the hover. */
const HEX_PIN_OTHER_HIGHLIGHT = "cq-hex-pin-other";
const PIN_OTHER_COLOR = "rgba(168, 85, 247, 0.14)";
// Class names used when the Highlight API is skipped; styled in CSS.
const HEX_HOVER_CLASS = "hex-hover-highlight";
const HEX_PIN_OTHER_CLASS = "hex-pin-other-highlight";

/** Skip the Highlight API on Safari: it accepts ranges but paints nothing here. */
function paintsHighlightsAsClasses(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /AppleWebKit\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
}

let hexHighlights: { hover: Highlight; pinOther: Highlight } | null | undefined;
function sharedHighlights(): { hover: Highlight; pinOther: Highlight } | null {
  if (hexHighlights !== undefined) return hexHighlights;
  if (
    typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights ||
    paintsHighlightsAsClasses()
  ) {
    hexHighlights = null;
  } else {
    const hover = new Highlight();
    const pinOther = new Highlight();
    hover.priority = 2;
    pinOther.priority = 1;
    CSS.highlights.set(HEX_HOVER_HIGHLIGHT, hover);
    CSS.highlights.set(HEX_PIN_OTHER_HIGHLIGHT, pinOther);
    const style = document.createElement("style");
    style.textContent =
      `.editable-hex-view::highlight(${HEX_HOVER_HIGHLIGHT}) { background-color: ${HOVER_COLOR}; color: #111827; text-decoration: underline; text-decoration-color: ${HOVER_UNDERLINE}; text-decoration-thickness: 2px; }\n` +
      `.editable-hex-view::highlight(${HEX_PIN_OTHER_HIGHLIGHT}) { background-color: ${PIN_OTHER_COLOR}; }`;
    document.head.appendChild(style);
    hexHighlights = { hover, pinOther };
  }
  return hexHighlights;
}
const sharedHoverHighlight = (): Highlight | null => sharedHighlights()?.hover ?? null;
const sharedPinOtherHighlight = (): Highlight | null => sharedHighlights()?.pinOther ?? null;

const NO_POSITIONS: ReadonlyArray<CborPosition> = [];

/** Node location as a parent link. Hover text (`array → map → uint8`) is spelled on demand so depth does not square the cost. */
interface NodePlace {
  name: string;
  parent: NodePlace | null;
}

/** A place deeper than this is spelled out with its middle elided. */
const PLACE_NAMES_SHOWN = 8;

/** `array → map → uint8`. Deep places show first and last levels and a count. */
function placeText(place: NodePlace): string {
  const names: string[] = [];
  for (let at: NodePlace | null = place; at; at = at.parent) names.push(at.name);
  names.reverse();
  if (names.length <= PLACE_NAMES_SHOWN) return names.join(" → ");
  const head = names.slice(0, 4).join(" → ");
  const tail = names.slice(-3).join(" → ");
  const hidden = (names.length - 7).toLocaleString("en-US");
  return `${head} → … ${hidden} more … → ${tail}`;
}

interface HighlightedSpan {
  start: number;
  end: number;
  colorIndex: number;
  label: string; // CBOR type label for tooltip
  place: NodePlace;
  oddities?: CborOddity[];
}

interface HexContextMenuState {
  x: number;
  y: number;
  charPosition: number; // Position in hex string (char index)
  selectedText: string; // Currently selected text
  chunkPosition: CborPosition | null; // The CBOR chunk at this position
}

export interface ExtraErrorSpan {
  offset: number;
  length: number;
  message?: string;
}

export interface EditableHexViewProps {
  value: string;
  onChange: (value: string) => void;
  hexValue: string;
  cborData: CborValue | CborPartialValue | null;
  /** Hovered byte extent, painted over the document rather than into markup. */
  hoverPosition?: CborPosition | null;
  /** Extra hover extents (schema instances), one highlight of many ranges. */
  hoverPositions?: ReadonlyArray<CborPosition>;
  focusPosition: CborPosition | null;
  errorLocation?: CborErrorLocation | null;
  /** Extra byte ranges to mark as error (e.g. CDDL byte_spans). */
  extraErrorSpans?: ExtraErrorSpan[];
  /** Soft "linked from elsewhere" highlight — blue, not red. */
  linkedSpans?: ExtraErrorSpan[];
  /** Pinned bytes (purple). Wins over `linkedSpans` on overlap. */
  pinnedSpans?: ExtraErrorSpan[];
  /** Other pin instances, painted over markup like hover so stepping does not rebuild. */
  pinnedOtherSpans?: ExtraErrorSpan[];
  onHoverPath?: (path: string | null) => void;
  /** Byte offset of the run under the pointer (that node's header), or `null`. A run stays one node even inside a multi-node region. */
  onHoverByte?: (byteOffset: number | null) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onShowInTree?: (position: CborPosition) => void;
  /**
   * Right-click on a hex byte → fired with that byte's offset (in bytes,
   * not chars) and this panel's menu actions. Suppresses the default menu when wired; the host owns the menu.
   */
  onContextMenuPin?: (byteOffset: number, actions: PanelMenuAction[]) => void;
}

// Color for the byte(s) where the CBOR parser reported an error.
const ERROR_COLOR = "rgba(239, 68, 68, 0.35)";
// Color for "linked from CDDL editor" highlight (bridge between panels).
const LINKED_COLOR = "rgba(59, 130, 246, 0.32)";
// Color for a pinned cross-panel selection — matches the CDDL editor's pin.
const PINNED_COLOR = "rgba(168, 85, 247, 0.35)";

// Format value for display (same logic as CborTreeView)
function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") return String(val);
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (val instanceof Uint8Array || (Array.isArray(val) && val.every(v => typeof v === "number"))) {
    const arr = val instanceof Uint8Array ? Array.from(val) : val as number[];
    return arr.map(b => b.toString(16).padStart(2, "0")).join("");
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

type AnyNode = CborValue | CborPartialValue;

function getTypeLabel(value: AnyNode): string {
  if (!("type" in value) || typeof value.type !== "string") {
    return "value";
  }

  const rawValue = (value as { value?: unknown }).value;

  switch (value.type) {
    // Complex types
    case "Array": {
      const count = value.items === "Indefinite" ? "∞" : value.items;
      return `array (${count} items)`;
    }
    case "Map": {
      const count = value.items === "Indefinite" ? "∞" : value.items;
      return `map (${count} entries)`;
    }
    case "Tag":
      return `tag #${value.tag}`;
    case "IndefiniteLengthString":
      return `text (indefinite, ${value.chunks.filter(c => !("type" in c) || c.type !== "Break").length} chunks)`;
    case "IndefiniteLengthBytes":
      return `bytes (indefinite, ${value.chunks.filter(c => !("type" in c) || c.type !== "Break").length} chunks)`;
    
    // Simple types (CborSimpleType)
    case "Null": return "null";
    case "Undefined": return "undefined";
    case "Bool": return `bool: ${formatValue(rawValue)}`;
    case "U8": return `uint8: ${formatValue(rawValue)}`;
    case "U16": return `uint16: ${formatValue(rawValue)}`;
    case "U32": return `uint32: ${formatValue(rawValue)}`;
    case "U64": return `uint64: ${formatValue(rawValue)}`;
    case "I8": return `nint8: ${formatValue(rawValue)}`;
    case "I16": return `nint16: ${formatValue(rawValue)}`;
    case "I32": return `nint32: ${formatValue(rawValue)}`;
    case "I64": return `nint64: ${formatValue(rawValue)}`;
    case "Int": return `bigint: ${formatValue(rawValue)}`;
    case "F16": return `float16: ${formatValue(rawValue)}`;
    case "F32": return `float32: ${formatValue(rawValue)}`;
    case "F64": return `float64: ${formatValue(rawValue)}`;
    case "Bytes": {
      const hex = formatValue(rawValue);
      return `bytes (${hex.length / 2} bytes)`;
    }
    case "String": {
      const str = formatValue(rawValue);
      const preview = str.length > 30 ? str.slice(0, 30) + "..." : str;
      return `text: ${preview}`;
    }
    case "Simple": return `simple(${formatValue(rawValue)})`;
    case "Break": return "break";
    default: return String((value as { type: string }).type).toLowerCase();
  }
}

// Get short type name for path display
function getShortTypeName(value: AnyNode): string {
  if (!("type" in value) || typeof value.type !== "string") return "?";
  
  switch (value.type) {
    case "Array": return "array";
    case "Map": return "map";
    case "Tag": return `tag#${value.tag}`;
    case "IndefiniteLengthString": return "tstr~";
    case "IndefiniteLengthBytes": return "bytes~";
    case "Null": return "null";
    case "Undefined": return "undefined";
    case "Bool": return "bool";
    case "U8": return "uint8";
    case "U16": return "uint16";
    case "U32": return "uint32";
    case "U64": return "uint64";
    case "I8": return "nint8";
    case "I16": return "nint16";
    case "I32": return "nint32";
    case "I64": return "nint64";
    case "Int": return "bigint";
    case "F16": return "float16";
    case "F32": return "float32";
    case "F64": return "float64";
    case "Bytes": return "bytes";
    case "String": return "tstr";
    case "Simple": return "simple";
    case "Break": return "break";
    default: return String((value as { type: string }).type).toLowerCase();
  }
}

function mergeOddities(a?: CborOddity[], b?: CborOddity[]): CborOddity[] | undefined {
  if (!a?.length) return b?.length ? b : undefined;
  if (!b?.length) return a;
  return [...a, ...b];
}

function oddityKindsSummary(oddities: CborOddity[]): string {
  return Array.from(new Set(oddities.map(o => o.kind))).join(", ");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Node children in document order (map key/value pairs, tag payload, string chunks). */
function childNodes(value: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  if ("values" in value && Array.isArray(value.values)) {
    if ("type" in value && value.type === "Map") {
      for (const item of value.values as { key?: AnyNode; value?: AnyNode }[]) {
        if (item.key) out.push(item.key);
        if (item.value) out.push(item.value);
      }
    } else {
      for (const item of value.values as AnyNode[]) out.push(item);
    }
  }
  if ("value" in value && typeof value.value === "object" && value.value !== null) {
    out.push(value.value as AnyNode);
  }
  if ("chunks" in value && Array.isArray(value.chunks)) {
    for (const chunk of value.chunks) out.push(chunk);
  }
  return out;
}

/** Every node in document order, with its place. Explicit stack: decoder depth would overflow the call stack. */
function walkNodes(root: AnyNode, visit: (node: AnyNode, place: NodePlace) => void): void {
  if (!root || typeof root !== "object") return;
  const stack: Array<{ node: AnyNode; place: NodePlace }> = [
    { node: root, place: { name: getShortTypeName(root), parent: null } },
  ];
  while (stack.length > 0) {
    const { node, place } = stack.pop()!;
    visit(node, place);
    const children = childNodes(node);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (!child || typeof child !== "object") continue;
      stack.push({ node: child, place: { name: getShortTypeName(child), parent: place } });
    }
  }
}

function collectPositions(
  value: AnyNode,
  spans: HighlightedSpan[],
  colorCounter: { value: number },
): void {
  walkNodes(value, (node, place) => {
    const posInfo = node.position_info;
    if (posInfo && typeof posInfo.offset === "number" && typeof posInfo.length === "number") {
      spans.push({
        start: posInfo.offset * 2,
        end: (posInfo.offset + posInfo.length) * 2,
        colorIndex: colorCounter.value % CBOR_COLORS.length,
        label: getTypeLabel(node),
        place,
        oddities: node.oddities,
      });
      colorCounter.value++;
    }
  });
}

// Find the smallest (most specific) chunk containing a given hex character position
function findChunkAtPosition(charPos: number, cborData: AnyNode | null): CborPosition | null {
  if (!cborData) return null;

  // Convert char position to byte position
  const bytePos = Math.floor(charPos / 2);

  let best: CborPosition | null = null;
  walkNodes(cborData, (node) => {
    const position = node.position_info;
    if (!position || typeof position.offset !== "number" || typeof position.length !== "number") return;
    const start = position.offset;
    const end = position.offset + position.length;
    if (bytePos < start || bytePos >= end) return;
    if (!best || position.length < best.length) best = position;
  });
  return best;
}

/** What the hex view paints its document from. */
export interface HexMarkupInput {
  hexValue: string;
  cborData: AnyNode | null;
  focusPosition: CborPosition | null;
  errorLocation?: CborErrorLocation | null;
  extraErrorSpans?: ExtraErrorSpan[];
  linkedSpans?: ExtraErrorSpan[];
  pinnedSpans?: ExtraErrorSpan[];
}

export interface HexMarkup {
  html: string;
  /** The place of the node whose run starts at each `data-pos`. */
  places: Map<number, NodePlace>;
}

/** Byte ranges that keep their own colour under hover (current pin, errors, focus). Other pin instances are not occluders — cutting around each would cost one cut per instance. */
export function hoverOccludersFor(input: {
  pinnedSpans?: ReadonlyArray<HexOccluder>;
  errorLocation?: CborErrorLocation | null;
  extraErrorSpans?: ReadonlyArray<HexOccluder>;
  focusPosition?: CborPosition | null;
}): HexOccluder[] {
  const out: HexOccluder[] = [];
  if (input.pinnedSpans) for (const s of input.pinnedSpans) out.push(s);
  if (input.errorLocation) out.push(input.errorLocation);
  if (input.extraErrorSpans) for (const s of input.extraErrorSpans) out.push(s);
  if (input.focusPosition) out.push(input.focusPosition);
  return out;
}

/** What one hex character is painted as. */
interface CharPaint {
  /** First character of the node's run, or `-1` if none. Shared by both hex digits of one byte. */
  nodeStart: number;
  colorIndex: number;
  label: string;
  place: NodePlace | null;
  oddities?: CborOddity[];
  isFocus: boolean;
  isError: boolean;
  isLinked: boolean;
  linkedTone?: "linked" | "pinned";
  errorMessage?: string;
  linkedMessage?: string;
}

/** Highlighted-region id: `0` outside every region, equal for two characters of one region. */
function regionKey(paint: CharPaint | undefined): number {
  if (!paint) return 0;
  return (paint.isError ? 1 : 0)
    | (paint.isFocus ? 2 : 0)
    | (paint.isLinked ? (paint.linkedTone === "pinned" ? 8 : 4) : 0);
}

function hasOddity(paint: CharPaint | undefined): boolean {
  return !!(paint?.oddities && paint.oddities.length > 0);
}

/** Whether two characters belong to one run: same node, same region, same oddity flag. */
function sameRun(a: CharPaint | undefined, b: CharPaint | undefined): boolean {
  return regionKey(a) === regionKey(b)
    && (a?.nodeStart ?? -1) === (b?.nodeStart ?? -1)
    && hasOddity(a) === hasOddity(b);
}

/**
 * Hex markup: one `<span data-pos>` per node, plus one element per highlighted region.
 * Regions wrap several nodes so the outline is continuous; inner runs stay per-node so `data-pos` names the node under the pointer.
 */
export function buildHexMarkup(input: HexMarkupInput): HexMarkup {
  const { hexValue, cborData, focusPosition, errorLocation, extraErrorSpans, linkedSpans, pinnedSpans } = input;
  const places = new Map<number, NodePlace>();
  if (!hexValue) return { html: "", places };
  if (!cborData && !errorLocation && !(extraErrorSpans && extraErrorSpans.length > 0) && !(linkedSpans && linkedSpans.length > 0) && !(pinnedSpans && pinnedSpans.length > 0)) {
    return { html: "", places };
  }

  const spans: HighlightedSpan[] = [];
  const colorCounter = { value: 0 };
  if (cborData) collectPositions(cborData, spans, colorCounter);

  const paints = new Map<number, CharPaint>();

  for (const span of spans) {
    for (let i = span.start; i < span.end && i < hexValue.length; i++) {
      const existing = paints.get(i);
      // Mark oddities even if a smaller (inner) span already claimed the base color
      const mergedOddities = mergeOddities(existing?.oddities, span.oddities);
      if (!existing) {
        paints.set(i, { nodeStart: span.start, colorIndex: span.colorIndex, isFocus: false, isError: false, isLinked: false, label: span.label, place: span.place, oddities: mergedOddities });
      } else if (mergedOddities !== existing.oddities) {
        paints.set(i, { ...existing, oddities: mergedOddities });
      }
    }
  }

  /** Paint for a character no node claims, so a region can still cover it. */
  const unclaimed = (): CharPaint => ({
    nodeStart: -1, colorIndex: 0, isFocus: false, isError: false, isLinked: false, label: "", place: null,
  });

  // Apply error highlight — last-wins so it paints over CBOR colors.
  const applyErrorSpan = (offset: number, length: number, message: string) => {
    const startChar = offset * 2;
    const endChar = Math.min(startChar + length * 2, hexValue.length);
    for (let i = startChar; i < endChar && i < hexValue.length; i++) {
      paints.set(i, { ...(paints.get(i) ?? unclaimed()), isError: true, errorMessage: message });
    }
  };
  if (errorLocation) {
    applyErrorSpan(errorLocation.offset, errorLocation.length, errorLocation.message);
  }
  if (extraErrorSpans) {
    for (const span of extraErrorSpans) {
      // length=0 spans are common for "here" markers — highlight 1 byte anyway.
      const len = Math.max(1, span.length);
      applyErrorSpan(span.offset, len, span.message ?? "");
    }
  }

  // Apply "linked" highlight (bridge from another panel — blue, weaker than error). Pinned spans use the same pass second so a pin wins on overlap.
  const applyLinkedSpans = (linked: ExtraErrorSpan[], tone: "linked" | "pinned") => {
    for (const span of linked) {
      const len = Math.max(1, span.length);
      const startChar = span.offset * 2;
      const endChar = Math.min(startChar + len * 2, hexValue.length);
      for (let i = startChar; i < endChar && i < hexValue.length; i++) {
        const existing = paints.get(i) ?? unclaimed();
        paints.set(i, {
          ...existing,
          isLinked: true,
          linkedTone: tone,
          linkedMessage: span.message ?? existing.linkedMessage,
        });
      }
    }
  };
  if (linkedSpans) applyLinkedSpans(linkedSpans, "linked");
  if (pinnedSpans) applyLinkedSpans(pinnedSpans, "pinned");

  // Hover is painted over finished markup, so it never rebuilds it.

  // Apply focus
  if (focusPosition && typeof focusPosition.offset === "number" && typeof focusPosition.length === "number") {
    const start = focusPosition.offset * 2;
    const end = (focusPosition.offset + focusPosition.length) * 2;
    for (let i = start; i < end && i < hexValue.length; i++) {
      paints.set(i, { ...(paints.get(i) ?? unclaimed()), isFocus: true });
    }
  }

  const n = hexValue.length;
  /** The end of the run starting at `from`, within `bound`. */
  const runEnd = (from: number, bound: number): number => {
    const paint = paints.get(from);
    let j = from + 1;
    while (j < bound && sameRun(paint, paints.get(j))) j++;
    return j;
  };
  /** The end of the region starting at `from`. */
  const regionEnd = (from: number): number => {
    const key = regionKey(paints.get(from));
    let j = from + 1;
    while (j < n && regionKey(paints.get(j)) === key) j++;
    return j;
  };
  const oddityTitle = (paint: CharPaint) =>
    `${paint.label}${paint.label ? " — " : ""}non-canonical: ${oddityKindsSummary(paint.oddities!)}`;

  let html = "";
  let i = 0;
  while (i < n) {
    const paint = paints.get(i);
    if (paint?.place) places.set(i, paint.place);

    if (regionKey(paint) === 0) {
      const j = runEnd(i, n);
      const segment = hexValue.slice(i, j);
      const odd = hasOddity(paint);
      if (paint) {
        const title = escapeAttr(odd ? oddityTitle(paint) : paint.label);
        const className = odd ? ' class="hex-oddity"' : "";
        html += `<span${className} style="background-color:${CBOR_COLORS[paint.colorIndex]};border-radius:2px" title="${title}" data-pos="${i}">${segment}</span>`;
      } else {
        html += segment;
      }
      i = j;
      continue;
    }

    const end = regionEnd(i);
    const region = paint!;
    let className: string;
    let backgroundColor: string;
    if (region.isError) {
      className = "hex-error-highlight";
      backgroundColor = ERROR_COLOR;
    } else if (region.isFocus) {
      className = "hex-focus-highlight";
      backgroundColor = FOCUS_COLOR;
    } else {
      className = region.linkedTone === "pinned" ? "hex-pinned-highlight" : "hex-linked-highlight";
      backgroundColor = region.linkedTone === "pinned" ? PINNED_COLOR : LINKED_COLOR;
    }
    const titleText = region.isError
      ? region.errorMessage ?? "CBOR parse error"
      : region.isLinked
      ? region.linkedMessage ?? region.label ?? ""
      : region.label;
    const isFocusStart = region.isFocus && focusPosition && i === focusPosition.offset * 2;
    html += `<span class="${className}" style="background-color:${backgroundColor};border-radius:2px" title="${escapeAttr(titleText)}" data-pos="${i}" data-len="${end - i}"${isFocusStart ? ' data-focus-target="true"' : ""}>`;
    let k = i;
    while (k < end) {
      const inner = paints.get(k)!;
      if (k !== i && inner.place) places.set(k, inner.place);
      const j = runEnd(k, end);
      const segment = hexValue.slice(k, j);
      html += hasOddity(inner)
        ? `<span class="hex-oddity" title="${escapeAttr(oddityTitle(inner))}" data-pos="${k}">${segment}</span>`
        : `<span data-pos="${k}">${segment}</span>`;
      k = j;
    }
    html += "</span>";
    i = end;
  }
  return { html, places };
}

// Save and restore cursor position
function saveSelection(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

/** Selection as `[start, end)` in the editor text; a caret when equal. Outside the editor, treat as a caret at the end. */
export function selectionOffsets(el: HTMLElement): [number, number] {
  const length = (el.textContent || "").length;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return [length, length];
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) {
    return [length, length];
  }
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;
  preRange.setEnd(range.endContainer, range.endOffset);
  const end = preRange.toString().length;
  return [Math.min(start, end), Math.max(start, end)];
}

/** Replace `[start, end)` of `current` with `inserted` and return the new caret. */
export function spliceText(
  current: string,
  start: number,
  end: number,
  inserted: string,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, current.length));
  const to = Math.max(from, Math.min(end, current.length));
  return {
    text: current.slice(0, from) + inserted + current.slice(to),
    caret: from + inserted.length,
  };
}

function restoreSelection(el: HTMLElement, pos: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  
  let charCount = 0;
  const nodeStack: Node[] = [el];
  let node: Node | undefined;
  let foundStart = false;
  
  while (!foundStart && (node = nodeStack.pop())) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textLen = (node.textContent || "").length;
      if (charCount + textLen >= pos) {
        const range = document.createRange();
        range.setStart(node, pos - charCount);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        foundStart = true;
      } else {
        charCount += textLen;
      }
    } else {
      const children = node.childNodes;
      for (let i = children.length - 1; i >= 0; i--) {
        nodeStack.push(children[i]);
      }
    }
  }
}

// Context menu portal with smart positioning
function HexContextMenuPortal({ 
  x, 
  y, 
  onClose, 
  children 
}: { 
  x: number; 
  y: number; 
  onClose: () => void; 
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const frame = requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = x;
      let top = y;

      if (x + menuRect.width > viewportWidth - 10) {
        left = x - menuRect.width;
      }
      if (y + menuRect.height > viewportHeight - 10) {
        top = viewportHeight - menuRect.height - 10;
      }
      if (left < 10) left = 10;
      if (top < 10) top = 10;

      if (left !== x || top !== y) {
        setPosition({ left, top });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [x, y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="hex-context-menu"
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

export default function EditableHexView({
  value,
  onChange,
  hexValue,
  cborData,
  hoverPosition,
  hoverPositions,
  focusPosition,
  errorLocation,
  extraErrorSpans,
  linkedSpans,
  pinnedSpans,
  pinnedOtherSpans,
  onHoverPath,
  onHoverByte,
  onKeyDown,
  onShowInTree,
  onContextMenuPin,
}: EditableHexViewProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const cursorPosRef = useRef<number>(0);
  const isUserTypingRef = useRef<boolean>(false);
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<HexContextMenuState | null>(null);
  
  // Undo/Redo history
  const historyRef = useRef<{ text: string; cursor: number }[]>([{ text: "", cursor: 0 }]);
  const historyIndexRef = useRef<number>(0);
  const isUndoRedoRef = useRef<boolean>(false);
  
  // Store position -> path mapping for hover detection
  const positionPathsRef = useRef<Map<number, NodePlace>>(new Map());

  // Save to history (debounced to avoid saving every keystroke)
  const saveToHistory = useCallback((text: string, cursor: number) => {
    if (isUndoRedoRef.current) return;
    
    const history = historyRef.current;
    const currentIndex = historyIndexRef.current;
    
    // Remove any future history if we're not at the end
    if (currentIndex < history.length - 1) {
      history.splice(currentIndex + 1);
    }
    
    // Don't save if same as last entry
    if (history.length > 0 && history[history.length - 1].text === text) {
      return;
    }
    
    // Add new entry
    history.push({ text, cursor });
    
    // Keep history size reasonable
    if (history.length > 100) {
      history.shift();
    } else {
      historyIndexRef.current = history.length - 1;
    }
  }, []);

  // Handle input
  const handleInput = useCallback(() => {
    if (editorRef.current) {
      // Mark that user is typing (to prevent React from overwriting content)
      isUserTypingRef.current = true;
      // Save cursor position BEFORE triggering state update
      cursorPosRef.current = saveSelection(editorRef.current);
      const text = editorRef.current.textContent || "";
      
      // Save to history
      saveToHistory(text, cursorPosRef.current);
      
      onChange(text);
      // Reset flag after a small delay
      setTimeout(() => {
        isUserTypingRef.current = false;
      }, 0);
    }
  }, [onChange, saveToHistory]);

  // Rewrite the editor text in one write. The editing engine deletes the selection node-by-node, which is one node per chunk and can freeze a deep document.
  const insertText = useCallback((text: string) => {
    const el = editorRef.current;
    if (!el) return;
    const [start, end] = selectionOffsets(el);
    const { text: next, caret } = spliceText(el.textContent || "", start, end, text);
    el.textContent = next;
    restoreSelection(el, caret);
    handleInput();
  }, [handleInput]);

  // Handle paste - get plain text only
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    insertText(e.clipboardData.getData("text/plain"));
  }, [insertText]);

  // Handle keyboard shortcuts (undo/redo)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Undo: Ctrl+Z or Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      const history = historyRef.current;
      const currentIndex = historyIndexRef.current;
      
      if (currentIndex > 0) {
        isUndoRedoRef.current = true;
        historyIndexRef.current = currentIndex - 1;
        const entry = history[currentIndex - 1];
        
        if (editorRef.current) {
          editorRef.current.textContent = entry.text;
          restoreSelection(editorRef.current, entry.cursor);
        }
        onChange(entry.text);
        
        setTimeout(() => {
          isUndoRedoRef.current = false;
        }, 0);
      }
      return;
    }
    
    // Redo: Ctrl+Shift+Z or Cmd+Shift+Z or Ctrl+Y
    if (((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) || 
        ((e.ctrlKey || e.metaKey) && e.key === "y")) {
      e.preventDefault();
      const history = historyRef.current;
      const currentIndex = historyIndexRef.current;
      
      if (currentIndex < history.length - 1) {
        isUndoRedoRef.current = true;
        historyIndexRef.current = currentIndex + 1;
        const entry = history[currentIndex + 1];
        
        if (editorRef.current) {
          editorRef.current.textContent = entry.text;
          restoreSelection(editorRef.current, entry.cursor);
        }
        onChange(entry.text);
        
        setTimeout(() => {
          isUndoRedoRef.current = false;
        }, 0);
      }
      return;
    }
    
    // Pass through to parent handler
    onKeyDown?.(e);
  }, [onChange, onKeyDown]);

  const isEmpty = !value && !hexValue;
  
  // Check if current input matches the decoded hex. Memoised on the text so a hover-only render skips a full pass.
  const normalizedInput = useMemo(() => value.replace(/\s/g, "").toLowerCase(), [value]);
  const inputMatchesHex = hexValue && normalizedInput === hexValue;
  const hasErrorHighlight = !!errorLocation && inputMatchesHex;
  const hasExtraSpans = !!(extraErrorSpans && extraErrorSpans.length > 0) && inputMatchesHex;
  const hasLinkedSpans = !!(linkedSpans && linkedSpans.length > 0) && inputMatchesHex;
  const hasPinnedSpans = !!(pinnedSpans && pinnedSpans.length > 0) && inputMatchesHex;
  const showHighlighted = (cborData || hasErrorHighlight || hasExtraSpans || hasLinkedSpans || hasPinnedSpans) && inputMatchesHex;
  
  // Track last rendered state to detect transitions
  const lastRenderedRef = useRef<{ showHighlighted: boolean; hexValue: string }>({ 
    showHighlighted: false, 
    hexValue: "" 
  });

  // Markup: rebuilt when its inputs change, never for a hover.
  const buildHighlightedHTML = useCallback((): string => {
    const markup = buildHexMarkup({
      hexValue, cborData, focusPosition, errorLocation, extraErrorSpans, linkedSpans, pinnedSpans,
    });
    positionPathsRef.current = markup.places;
    return markup.html;
  }, [cborData, hexValue, focusPosition, errorLocation, extraErrorSpans, linkedSpans, pinnedSpans]);

  const hoverOccluders = useMemo<HexOccluder[]>(
    () => hoverOccludersFor({ pinnedSpans, errorLocation, extraErrorSpans, focusPosition }),
    [pinnedSpans, errorLocation, extraErrorSpans, focusPosition],
  );

  // Combined hover extents. Memoised so an unrelated render keeps the paint callback.
  const hovered = useMemo<ReadonlyArray<CborPosition>>(
    () => hoverPositions ?? (hoverPosition ? [hoverPosition] : NO_POSITIONS),
    [hoverPositions, hoverPosition],
  );

  // Ranges die with the nodes they were built on; remake after every markup rebuild.
  const paintRanges = useCallback((
    highlight: Highlight | null,
    held: React.MutableRefObject<Range[]>,
    heldClass: { ref: React.MutableRefObject<Element[]>; name: string },
    charRanges: () => CharRange[],
  ) => {
    const el = editorRef.current;
    if (!el) return;
    if (highlight) for (const r of held.current) highlight.delete(r);
    held.current = [];
    for (const marked of heldClass.ref.current) marked.classList.remove(heldClass.name);
    heldClass.ref.current = [];
    if (!showHighlighted) return;
    const ranges = charRanges();
    if (ranges.length === 0) return;
    const runs = domRuns(el);
    if (!highlight) {
      const marked: Element[] = [];
      for (const [start, end] of ranges) runElementsIn(el, runs, start, end, marked);
      for (const run of marked) run.classList.add(heldClass.name);
      heldClass.ref.current = marked;
      return;
    }
    for (const [start, end] of ranges) {
      const from = domPointAt(el, runs, start);
      const to = domPointAt(el, runs, end);
      if (!from || !to) continue;
      const range = document.createRange();
      range.setStart(from[0], from[1]);
      range.setEnd(to[0], to[1]);
      highlight.add(range);
      held.current.push(range);
    }
  }, [showHighlighted]);

  const hoverRangesRef = useRef<Range[]>([]);
  const hoverRunsRef = useRef<Element[]>([]);
  const paintHover = useCallback(() => {
    paintRanges(
      sharedHoverHighlight(),
      hoverRangesRef,
      { ref: hoverRunsRef, name: HEX_HOVER_CLASS },
      () => hoverHexCharRangesAll(hovered, hexValue.length, hoverOccluders),
    );
  }, [paintRanges, hovered, hexValue, hoverOccluders]);

  // Other pin instances: cut around the current pin only. Not hover occluders (that would be one cut per instance).
  const otherRangesRef = useRef<Range[]>([]);
  const otherRunsRef = useRef<Element[]>([]);
  const paintOthers = useCallback(() => {
    paintRanges(
      sharedPinOtherHighlight(),
      otherRangesRef,
      { ref: otherRunsRef, name: HEX_PIN_OTHER_CLASS },
      () => pinnedOtherSpans && pinnedOtherSpans.length > 0
        ? hoverHexCharRangesAll(pinnedOtherSpans, hexValue.length, pinnedSpans ?? [])
        : [],
    );
  }, [paintRanges, pinnedOtherSpans, pinnedSpans, hexValue]);

  // Update DOM using useLayoutEffect (runs before paint)
  useLayoutEffect(() => {
    if (!editorRef.current) return;
    
    const last = lastRenderedRef.current;
    const isHighlighted = Boolean(showHighlighted);
    const isFocused = document.activeElement === editorRef.current;
    
    if (isHighlighted) {
      // Render highlighted HTML
      const html = buildHighlightedHTML();
      if (editorRef.current.innerHTML !== html) {
        const cursorPos = isFocused ? saveSelection(editorRef.current) : 0;
        editorRef.current.innerHTML = html;
        if (isFocused) {
          // Restore cursor - use saved position from handleInput if typing, otherwise use local
          const posToRestore = isUserTypingRef.current ? cursorPosRef.current : cursorPos;
          restoreSelection(editorRef.current, posToRestore);
        }
      }
    } else if (last.showHighlighted || (!isFocused && editorRef.current.textContent !== value)) {
      // Plain text. While focused the element is the source of the value, so write it only from outside: leaving markup, or text from elsewhere (share, preset, undo) — including input that never decoded.
      const cursorPos = isFocused ? cursorPosRef.current : 0;
      editorRef.current.textContent = value;
      if (isFocused) {
        restoreSelection(editorRef.current, cursorPos);
      }
    }
    
    lastRenderedRef.current = { showHighlighted: isHighlighted, hexValue };
  }, [showHighlighted, hexValue, focusPosition, value, buildHighlightedHTML]);

  // Paint hover over the markup from the effect above. Runs after that effect so a rebuild gets a repaint in the same commit.
  useLayoutEffect(() => {
    paintOthers();
    paintHover();
  }, [paintOthers, paintHover, buildHighlightedHTML, showHighlighted, value]);
  useEffect(() => () => {
    const highlights = sharedHighlights();
    if (!highlights) return;
    for (const r of hoverRangesRef.current) highlights.hover.delete(r);
    for (const r of otherRangesRef.current) highlights.pinOther.delete(r);
  }, []);

  // Scroll focused bytes into view after the rebuild layout effect, before paint. Not animated: animated scrolls are dropped where the browser does not run them.
  useLayoutEffect(() => {
    if (!focusPosition) return;
    editorRef.current
      ?.querySelector('[data-focus-target="true"]')
      ?.scrollIntoView({ block: "center" });
  }, [focusPosition]);

  // Handle clear
  useEffect(() => {
    if (editorRef.current && value === "" && !showHighlighted) {
      editorRef.current.textContent = "";
    }
  }, [value, showHighlighted]);

  // Hover tooltip for error / oddity spans (native `title` is slow and doesn't
  // reliably show inside contenteditable, so we render our own).
  const [hexHoverTip, setHexHoverTip] = useState<
    | { x: number; y: number; kind: "error" | "oddity"; text: string }
    | null
  >(null);

  // Handle mouse move for path detection. One attribute read per move; no document walk.
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const posAttr = target.getAttribute?.("data-pos") ?? null;

    if (onHoverByte) {
      onHoverByte(posAttr !== null ? parseInt(posAttr, 10) >> 1 : null);
    }

    if (onHoverPath) {
      if (posAttr !== null) {
        const pos = parseInt(posAttr, 10);
        const place = positionPathsRef.current.get(pos);
        onHoverPath(place ? placeText(place) : null);
      } else {
        onHoverPath(null);
      }
    }

    const errEl = target.closest?.(".hex-error-highlight") as HTMLElement | null;
    const oddEl = !errEl ? (target.closest?.(".hex-oddity") as HTMLElement | null) : null;
    if (errEl) {
      setHexHoverTip({ x: e.clientX, y: e.clientY, kind: "error", text: errEl.getAttribute("title") || "" });
    } else if (oddEl) {
      setHexHoverTip({ x: e.clientX, y: e.clientY, kind: "oddity", text: oddEl.getAttribute("title") || "" });
    } else if (hexHoverTip) {
      setHexHoverTip(null);
    }
  }, [onHoverPath, onHoverByte, hexHoverTip]);

  const handleMouseLeave = useCallback(() => {
    onHoverByte?.(null);
    onHoverPath?.(null);
    setHexHoverTip(null);
  }, [onHoverPath, onHoverByte]);

  // Get current selection text
  const getSelectedText = useCallback((): string => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    return selection.toString();
  }, []);

  // Get cursor position in the hex string
  const getCursorCharPosition = useCallback((e: React.MouseEvent): number => {
    const target = e.target as HTMLElement;
    const posAttr = target.getAttribute?.("data-pos");
    if (posAttr !== null) {
      return parseInt(posAttr, 10);
    }
    // Fallback: try to calculate from cursor position
    if (editorRef.current) {
      return saveSelection(editorRef.current);
    }
    return 0;
  }, []);

  // Suppress the browser's "select word on right-click" behavior in
  // contenteditable. Snapshots the live selection on mousedown and restores
  // it on the next animation frame, after the browser has auto-selected.
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 2) return;
    const sel = window.getSelection();
    if (!sel) return;
    const ranges: Range[] = [];
    for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i).cloneRange());
    requestAnimationFrame(() => {
      const s = window.getSelection();
      if (!s) return;
      s.removeAllRanges();
      for (const r of ranges) s.addRange(r);
    });
  }, []);

  // Menu actions with no menu state, so a host can own the menu.
  const copyChunkHex = useCallback((position: CborPosition) => {
    if (!hexValue) return;
    const start = position.offset * 2;
    const end = (position.offset + position.length) * 2;
    navigator.clipboard.writeText(hexValue.slice(start, end));
  }, [hexValue]);

  const copyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const pasteIntoEditor = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (editorRef.current) {
        editorRef.current.focus();
        insertText(text);
      }
    } catch {
      // Clipboard access denied
    }
  }, [insertText]);

  const buildMenuActions = useCallback((
    chunkPosition: CborPosition | null,
    selectedText: string,
  ): PanelMenuAction[] => {
    const actions: PanelMenuAction[] = [];
    if (chunkPosition) {
      actions.push({ id: "copy-chunk", label: "Copy chunk hex", run: () => copyChunkHex(chunkPosition) });
    }
    if (selectedText) {
      actions.push({ id: "copy-selection", label: "Copy selection", run: () => copyText(selectedText) });
    }
    actions.push({ id: "paste", label: "Paste", run: () => { void pasteIntoEditor(); } });
    if (chunkPosition && onShowInTree) {
      actions.push({ id: "show-in-tree", label: "Show in tree", run: () => onShowInTree(chunkPosition) });
    }
    return actions;
  }, [copyChunkHex, copyText, pasteIntoEditor, onShowInTree]);

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const selectedText = getSelectedText();
    const charPosition = getCursorCharPosition(e);
    const chunkPosition = findChunkAtPosition(charPosition, cborData);

    // Host owns the pin menu: hand it this panel's actions instead of a second menu.
    if (onContextMenuPin) {
      onContextMenuPin(Math.floor(charPosition / 2), buildMenuActions(chunkPosition, selectedText));
      return;
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      charPosition,
      selectedText,
      chunkPosition,
    });
  }, [getSelectedText, getCursorCharPosition, cborData, onContextMenuPin, buildMenuActions]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Copy chunk hex
  const handleCopyChunk = useCallback(() => {
    if (contextMenu?.chunkPosition) copyChunkHex(contextMenu.chunkPosition);
    closeContextMenu();
  }, [contextMenu, copyChunkHex, closeContextMenu]);

  // Copy selected text
  const handleCopySelected = useCallback(() => {
    if (contextMenu?.selectedText) copyText(contextMenu.selectedText);
    closeContextMenu();
  }, [contextMenu, copyText, closeContextMenu]);

  // Paste
  const handlePasteFromMenu = useCallback(async () => {
    await pasteIntoEditor();
    closeContextMenu();
  }, [pasteIntoEditor, closeContextMenu]);

  // Show in tree
  const handleShowInTree = useCallback(() => {
    if (contextMenu?.chunkPosition && onShowInTree) {
      onShowInTree(contextMenu.chunkPosition);
    }
    closeContextMenu();
  }, [contextMenu, onShowInTree, closeContextMenu]);

  // Check if we have a valid selection (more than just partial chunk)
  const hasSelection = contextMenu?.selectedText && contextMenu.selectedText.length > 0;
  const hasChunk = contextMenu?.chunkPosition !== null;

  return (
    <div 
      className="editable-hex-container"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {isEmpty && (
        <div className="paste-hint-overlay">
          <svg
            className="paste-hint-icon"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="8" y="2" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M16 4H18C19.1046 4 20 4.89543 20 6V20C20 21.1046 19.1046 22 18 22H6C4.89543 22 4 21.1046 4 20V6C4 4.89543 4.89543 4 6 4H8" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="paste-hint-text">Paste here</span>
          <span className="paste-hint-formats">HEX · Base64</span>
        </div>
      )}
      <div
        ref={editorRef}
        className={`editable-hex-view ${isEmpty ? "is-empty" : ""}`}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        data-placeholder=""
        spellCheck={false}
      />

      {/* Floating tooltip for error / oddity spans */}
      {hexHoverTip && hexHoverTip.text && (
        <div
          className={`hex-info-popup ${hexHoverTip.kind === "error" ? "hex-info-popup-error" : "hex-info-popup-oddity"}`}
          style={{
            position: "fixed",
            left: hexHoverTip.x + 12,
            top: hexHoverTip.y + 14,
            pointerEvents: "none",
          }}
        >
          <div className="hex-info-popup-title">
            {hexHoverTip.kind === "error" ? "Decode error" : "Non-canonical"}
          </div>
          <div className="hex-info-popup-body">{hexHoverTip.text}</div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <HexContextMenuPortal x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu}>
          {hasChunk && (
            <button onClick={handleCopyChunk}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Chunk
            </button>
          )}
          {hasSelection && (
            <button onClick={handleCopySelected}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Selection
            </button>
          )}
          <button onClick={handlePasteFromMenu}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            Paste
          </button>
          {hasChunk && onShowInTree && (
            <button onClick={handleShowInTree}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Show in Tree
            </button>
          )}
        </HexContextMenuPortal>
      )}
    </div>
  );
}
