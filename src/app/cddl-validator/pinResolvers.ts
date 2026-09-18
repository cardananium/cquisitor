// Probe → node for the four panels. Hover and click share `resolveProbe`.
// Scans use entry spans only; paths are resolved only for the named node.

import type { CborCddlMapEntry, CborPosition } from "@cardananium/cquisitor-lib";
import type { ExtraErrorSpan } from "@/components/EditableHexView";
import {
  preferRole,
  type CborCddlBridge,
  type CborCddlNode,
  type EntryRole,
} from "./cborCddlBridge";
import {
  describeDiagnostic,
  hasCddlSpan,
  walkRefusalNotice,
  type CborDiagnostic,
  type CddlRange,
} from "./cddlError";
import type { OverlayMark } from "./cddlOverlay";
import type { WalkRefusal } from "./cddlValidatorLib";
import { currentIndex, otherInstances, type PinnedInstance } from "./instances";
import { ALL_PANELS, type PanelId } from "./workspaceLayout";

export type { EntryRole };

/** The four panels a pinned node can be mirrored into. */
export type PinTarget = PanelId;

export const ALL_PIN_TARGETS: PinTarget[] = [...ALL_PANELS];

/** What the pin menu knows when a right-click resolved to no node. */
export interface PinMenuNoticeInput {
  schemaIsValid: boolean;
  hasCbor: boolean;
  /** Mapping for the input on screen is not ready yet. */
  mapPending: boolean;
  /** Why the library built no map, when it refused. */
  mapRefusal: WalkRefusal | null;
  /** Map for the input on screen has no entries. */
  mapIsEmpty: boolean;
  rule: string;
}

/**
 * Why there is nothing to pin. Reasons are ordered so each rules out the
 * ones after it. A refused map is said before an empty one, with its kind —
 * "none of this CBOR could be mapped" is only for an empty successful map.
 */
export function pinMenuNotice(input: PinMenuNoticeInput): string {
  if (!input.schemaIsValid) return "The CDDL schema doesn't parse yet, so nothing can be mapped onto it.";
  if (!input.hasCbor) return "Paste CBOR hex to map it against the schema.";
  if (input.mapPending) return "The mapping for this input is still being built.";
  if (input.mapRefusal) return walkRefusalNotice(input.mapRefusal, "The CBOR ⇄ CDDL mapping");
  if (input.mapIsEmpty) {
    return `None of this CBOR could be mapped onto ${input.rule || "the selected rule"}.`;
  }
  return "This position isn't covered by the CBOR ⇄ CDDL mapping.";
}

/** Why a panel has nothing to show for a row, or `null` when it has. */
export type PinTargetBlockers = Record<PinTarget, string | null>;

const NO_BYTES =
  "the schema asks for this and the CBOR does not contain it, so there are no bytes to point at";

/**
 * What each panel can do with `node`.
 * An omitted required member has a schema span and no bytes; decoder wrappers (`@positional`, `@extra`, `@entries`) have the reverse.
 */
export function pinTargetBlockers(node: CborCddlNode | null): PinTargetBlockers {
  if (!node) {
    const none = "there is nothing pinned";
    return { cddl: none, hex: none, decoded: none, tree: none };
  }
  const entry = node.entry;
  return {
    cddl: hasCddlSpan(entry.cddl_byte_span)
      ? null
      : "this row is a decoder wrapper, not something the schema names",
    hex: entry.cbor_anchor_span ? null : NO_BYTES,
    tree: entry.cbor_byte_span ? null : NO_BYTES,
    decoded: node.decodedPath ? null : "the decoder produced no row at this path",
  };
}

// Higher wins on overlap. Pin beats errors and mismatches, which beat hover,
// which beats references.
export const PRIORITY_PINNED = 120;
export const PRIORITY_ERROR = 100;
// Selected mismatch beats its siblings, which beat the hover link.
export const PRIORITY_MISMATCH_CURRENT = 90;
export const PRIORITY_MISMATCH = 80;
export const PRIORITY_MISMATCH_OTHER = 79;
export const PRIORITY_LINKED = 60;
export const PRIORITY_REFERENCE = 40;

function describeNode(node: CborCddlNode): string {
  const role = node.entry.entry_role === "key" ? "key" : "value";
  return `${node.entry.cbor_type ?? "node"} ${role} at ${node.cborPath}`;
}

/**
 * One node as each of the four panels addresses it. Hover and pin on the
 * same entry paint the same span. `hex` is the whole extent; `tree` is the header bytes.
 */
export interface NodeProjection {
  readonly cddl: CddlRange | null;
  readonly hex: CborPosition | null;
  readonly tree: CborPosition | null;
  readonly decoded: string | null;
  /** Type, role, path and the rule that matched, for a tooltip. */
  readonly label: string;
}

export function projectNode(node: CborCddlNode): NodeProjection {
  const entry = node.entry;
  const span = entry.cddl_byte_span;
  const anchor = entry.cbor_anchor_span;
  const header = entry.cbor_byte_span;
  return {
    cddl: hasCddlSpan(span) ? [span.char_offset, span.char_offset + span.char_length] : null,
    hex: anchor ? { offset: anchor.offset, length: anchor.length } : null,
    tree: header ? { offset: header.offset, length: header.length } : null,
    decoded: node.decodedPath || null,
    label: `${describeNode(node)}${entry.rule_name ? ` (rule: ${entry.rule_name})` : ""}`,
  };
}

/** Pointer or click, in the units of the panel it is in. */
export type HoverProbe =
  | { source: "hex"; byteOffset: number }
  | { source: "tree"; position: CborPosition }
  | { source: "cddl"; charOffset: number }
  | { source: "decoded"; path: string; role: EntryRole };

/**
 * Node a probe names. Pin menu and hover both go through this.
 * A tree row is addressed by its first byte so a container is the node
 * itself rather than a child sharing that offset.
 */
export function resolveProbe(bridge: CborCddlBridge, probe: HoverProbe): CborCddlNode | null {
  switch (probe.source) {
    case "hex": return findNodeByCborOffset(bridge, probe.byteOffset);
    case "tree": return findNodeByCborOffset(bridge, probe.position.offset);
    case "cddl": return findNodeByCddlOffset(bridge, probe.charOffset);
    case "decoded": return findNodeByDecodedPath(bridge, probe.path, probe.role);
  }
}

/**
 * Node whose CBOR extent covers `byteOffset`, narrowest first.
 * A row with no CBOR span covers nothing.
 */
export function findNodeByCborOffset(
  bridge: CborCddlBridge,
  byteOffset: number,
): CborCddlNode | null {
  let best: CborCddlMapEntry | null = null;
  let bestLength = Infinity;
  for (const e of bridge.entries) {
    const a = e.cbor_anchor_span;
    if (!a || byteOffset < a.offset || byteOffset >= a.offset + a.length) continue;
    if (a.length < bestLength) {
      bestLength = a.length;
      best = e;
    }
  }
  return best ? bridge.node(best) : null;
}

/**
 * Node whose schema span covers `charOffset`, narrowest first.
 * A character inside a known rule reference is taken as that rule's definition.
 */
export function findNodeByCddlOffset(
  bridge: CborCddlBridge,
  charOffset: number,
): CborCddlNode | null {
  // A pointer on a reference to a rule is a pointer on the rule.
  charOffset = bridge.definitionOffsetFor(charOffset) ?? charOffset;
  let best: CborCddlMapEntry | null = null;
  let bestLength = Infinity;
  for (const e of bridge.entries) {
    const s = e.cddl_byte_span;
    if (!hasCddlSpan(s)) continue;
    if (charOffset < s.char_offset || charOffset >= s.char_offset + s.char_length) continue;
    if (s.char_length < bestLength) {
      bestLength = s.char_length;
      best = e;
    }
  }
  return best ? bridge.node(best) : null;
}

/**
 * Node a decoded-JSON row stands for.
 * Rows under a synthetic decoder key have no entry; the deepest ancestor
 * that does stands in, as its value row.
 */
export function findNodeByDecodedPath(
  bridge: CborCddlBridge,
  decodedPath: string,
  preferredRole: EntryRole = "value",
): CborCddlNode | null {
  const exact = preferRole(bridge.entriesAtDecodedPath(decodedPath), preferredRole);
  if (exact) return bridge.node(exact);
  const ancestor = preferRole(bridge.entriesAtDecodedAncestor(decodedPath), "value");
  return ancestor ? bridge.node(ancestor) : null;
}

/**
 * Alt-click in the schema lights every byte the narrowest covering entries
 * describe. Identical CBOR spans of the same role are emitted once.
 */
export function linkedHexSpansForCddlOffset(
  bridge: CborCddlBridge,
  charOffset: number,
): ExtraErrorSpan[] {
  charOffset = bridge.definitionOffsetFor(charOffset) ?? charOffset;
  const matching = bridge.entries.filter(e => {
    const s = e.cddl_byte_span;
    return hasCddlSpan(s) && charOffset >= s.char_offset && charOffset < s.char_offset + s.char_length;
  });
  if (matching.length === 0) return [];
  // `cddl_byte_span` presence is guaranteed by the filter above.
  const minLength = Math.min(...matching.map(e => e.cddl_byte_span!.char_length));
  const out: ExtraErrorSpan[] = [];
  const seen = new Set<string>();
  for (const e of matching) {
    if (e.cddl_byte_span!.char_length !== minLength) continue;
    const a = e.cbor_anchor_span;
    // A schema position the bytes do not contain has nothing to light up.
    if (!a) continue;
    const key = `${a.offset}:${a.length}:${e.entry_role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ offset: a.offset, length: a.length, message: describeNode(bridge.node(e)) });
  }
  return out;
}

/** `k/N` for the pin's current instance. */
export function pinPosition(pin: PinnedInstance): string {
  return `${currentIndex(pin) + 1}/${pin.instances.length}`;
}

/** Current instance on hex: the one span painted with an outline. */
export function pinnedHexSpans(
  pin: PinnedInstance | null,
  enabled: boolean,
): ExtraErrorSpan[] {
  if (!pin || !enabled) return [];
  const node = pin.node;
  const hex = projectNode(node).hex;
  if (!hex) return [];
  // A group of one has no position worth saying.
  const position = pin.instances.length > 1 ? ` (${pinPosition(pin)})` : "";
  return [{
    offset: hex.offset,
    length: hex.length,
    message: `Pinned${position}: ${node.entry.cbor_type ?? "node"} at ${node.cborPath}`,
  }];
}

/** Other instances on hex — dim, no outline. */
export function pinnedOtherHexSpans(
  pin: PinnedInstance | null,
  enabled: boolean,
): ExtraErrorSpan[] {
  if (!pin || !enabled) return [];
  const out: ExtraErrorSpan[] = [];
  for (const entry of otherInstances(pin)) {
    const a = entry.cbor_anchor_span;
    if (a) out.push({ offset: a.offset, length: a.length });
  }
  return out;
}

export interface EditorMarkInput {
  /** Schema error, and every place it points at. */
  schemaError: { ranges: ReadonlyArray<CddlRange>; message: string } | null;
  diagnostics: ReadonlyArray<CborDiagnostic>;
  selectedDiagnostic: number | null;
  /** Definition + uses of the symbol under the caret. */
  referenceRanges: ReadonlyArray<CddlRange>;
  pinnedNode: CborCddlNode | null;
  pinInCddl: boolean;
  /** Where `pinnedNode` sits among its construct's instances, when known. */
  pinnedInstance?: PinnedInstance | null;
}

/**
 * Highlights the schema editor should paint. Overlap is resolved by priority
 * inside the editor. A shared mismatch span is marked once unless the extra
 * mark is the selected one.
 */
export function buildEditorMarks(input: EditorMarkInput): OverlayMark[] {
  const out: OverlayMark[] = [];

  if (input.schemaError) {
    for (const range of input.schemaError.ranges) {
      out.push({
        range,
        className: "cddl-editor-error-mark",
        message: input.schemaError.message,
        priority: PRIORITY_ERROR,
      });
    }
  }

  const markedRanges = new Set<string>();
  input.diagnostics.forEach((d, i) => {
    if (!d.cddlRange) return;
    const current = i === input.selectedDiagnostic;
    const key = `${d.cddlRange[0]}:${d.cddlRange[1]}`;
    if (markedRanges.has(key) && !current) return;
    markedRanges.add(key);
    out.push({
      range: d.cddlRange,
      className: "cddl-editor-mismatch-mark",
      message: describeDiagnostic(d),
      priority: current
        ? PRIORITY_MISMATCH_CURRENT
        : i === 0 ? PRIORITY_MISMATCH : PRIORITY_MISMATCH_OTHER,
    });
  });

  for (const range of input.referenceRanges) {
    out.push({ range, className: "cddl-editor-reference-mark", priority: PRIORITY_REFERENCE });
  }

  // Synthetic wrapper rows have no CDDL counterpart.
  const pinnedRange = input.pinnedNode && input.pinInCddl ? projectNode(input.pinnedNode).cddl : null;
  if (input.pinnedNode && pinnedRange) {
    const pin = input.pinnedInstance;
    const position = pin ? ` · instance ${pinPosition(pin).replace("/", " of ")}` : "";
    out.push({
      range: pinnedRange,
      className: "cddl-editor-pinned-mark",
      message: `Pinned: ${describeNode(input.pinnedNode)}${position}`,
      priority: PRIORITY_PINNED,
    });
  }

  return out;
}

/**
 * Bytes the hex view should paint as failing. A range is painted once.
 * With a selected diagnostic, only that row contributes (own bytes, then
 * structure). With nothing selected, every diagnostic contributes only its
 * own bytes — unioning root-rule anchors would paint the whole document.
 * A diagnostic with no own bytes still falls back to its anchor.
 */
export function buildExtraErrorSpans(
  diagnostics: ReadonlyArray<CborDiagnostic>,
  selected: number | null = null,
): ExtraErrorSpan[] {
  const focused = selected !== null ? diagnostics[selected] : undefined;
  const rows = focused ? [focused] : diagnostics;
  const spans: ExtraErrorSpan[] = [];
  const seen = new Set<string>();
  for (const d of rows) {
    const message = describeDiagnostic(d);
    const own = focused || d.byteSpans.length === 0
      ? [...d.byteSpans, ...d.anchorSpans]
      : d.byteSpans;
    for (const s of own) {
      const key = `${s.offset}:${s.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spans.push({ offset: s.offset, length: s.length, message });
    }
  }
  return spans;
}
