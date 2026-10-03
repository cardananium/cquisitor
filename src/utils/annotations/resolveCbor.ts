// `cbor_span` / `cbor_path` targets against a decoded CBOR tree (`cbor_to_json` nodes).
// Paths use the lib grammar (`$`, `.key`, `["key"]`, `[n]`, `.h'…'`, …); tags are
// transparent, as in every path the lib writes.

import {
  splitCborPath,
  type CborPartialValue,
  type CborPosition,
  type CborValue,
} from "@cardananium/cquisitor-lib";
import type { AnnotationStatus, CquisitorAnnotation } from "./store";
import { annotationClassName, buildMarks, notShownHere, resolvedStatus, type AnnotationMark } from "./marks";

type AnyNode = CborValue | CborPartialValue;

export interface CborNodeHit {
  node: AnyNode;
  /** Whole extent: the container with its contents, or the leaf. */
  extent: CborPosition;
  /** Header bytes — what the structural tree keys its rows by. */
  header: CborPosition;
}

const INTEGER_TYPES = new Set(["U8", "U16", "U32", "U64", "I8", "I16", "I32", "I64", "Int"]);
const FLOAT_TYPES = new Set(["F16", "F32", "F64"]);

function hitOf(node: AnyNode): CborNodeHit | null {
  const header = node.position_info;
  if (!header) return null;
  const extent = ("struct_position_info" in node ? node.struct_position_info : undefined) ?? header;
  return { node, extent, header };
}

function unwrapTags(node: AnyNode): AnyNode | null {
  let at: AnyNode | undefined = node;
  while (at && at.type === "Tag") at = (at as { value?: AnyNode }).value;
  return at ?? null;
}

function unescapeSegment(segment: string): string {
  return segment.replace(/\\(.)/g, "$1");
}

/** Whether a map key is the one a path segment names. */
export function cborKeyMatches(key: AnyNode, segment: string): boolean {
  const value = (key as { value?: unknown }).value;
  if (key.type === "String") return String(value ?? "") === unescapeSegment(segment);
  if (INTEGER_TYPES.has(key.type) || FLOAT_TYPES.has(key.type)) return String(value) === segment;
  if (key.type === "Bytes") return typeof value === "string" && segment.toLowerCase() === `h'${value.toLowerCase()}'`;
  if (key.type === "Bool") return segment === String(value);
  if (key.type === "Null") return segment === "null";
  if (key.type === "Undefined") return segment === "undefined";
  return false;
}

interface MapEntryLike {
  key?: AnyNode;
  value?: AnyNode;
}

function mapEntries(node: AnyNode): MapEntryLike[] {
  if (node.type !== "Map") return [];
  return (node.values as unknown[]).filter(
    (e): e is MapEntryLike => !!e && typeof e === "object" && !("type" in e),
  );
}

/** The node a lib CBOR path names, or null when the document has no such place. */
export function findCborNodeByPath(root: AnyNode | null, path: string): CborNodeHit | null {
  if (!root || !path.trim().startsWith("$")) return null;
  let segments: string[];
  try {
    segments = splitCborPath(path.trim());
  } catch {
    return null;
  }
  let at: AnyNode = root;
  for (const segment of segments) {
    const inner = unwrapTags(at);
    if (!inner) return null;
    let next: AnyNode | undefined;
    if (inner.type === "Array") {
      if (!/^\d+$/.test(segment)) return null;
      next = (inner.values as AnyNode[])[Number(segment)];
    } else if (inner.type === "Map") {
      const entries = mapEntries(inner);
      const byKey = entries.find((e) => e.key && cborKeyMatches(e.key, segment));
      if (byKey) next = byKey.value;
      else if (/^\d+$/.test(segment)) next = entries[Number(segment)]?.value;
    } else {
      return null;
    }
    if (!next) return null;
    at = next;
  }
  return hitOf(at);
}

function childrenOf(node: AnyNode): AnyNode[] {
  switch (node.type) {
    case "Array":
      return node.values as AnyNode[];
    case "Map": {
      const out: AnyNode[] = [];
      for (const e of mapEntries(node)) {
        if (e.key) out.push(e.key);
        if (e.value) out.push(e.value);
      }
      return out;
    }
    case "Tag": {
      const value = (node as { value?: AnyNode }).value;
      return value ? [value] : [];
    }
    case "IndefiniteLengthString":
    case "IndefiniteLengthBytes":
      return node.chunks as AnyNode[];
    default:
      return [];
  }
}

/** The narrowest node whose extent covers the whole of `span`; deeper wins a tie. */
export function findCborNodeBySpan(root: AnyNode | null, span: CborPosition): CborNodeHit | null {
  if (!root) return null;
  const end = span.offset + Math.max(1, span.length);
  let best: CborNodeHit | null = null;
  const stack: AnyNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const hit = hitOf(node);
    if (!hit) continue;
    const { offset, length } = hit.extent;
    if (span.offset < offset || end > offset + length) continue;
    if (!best || length <= best.extent.length) best = hit;
    for (const c of childrenOf(node)) if (c && typeof c === "object") stack.push(c);
  }
  return best;
}

export interface CborTargetResolution {
  status: AnnotationStatus;
  /** Bytes to light in the hex view. */
  hex: CborPosition | null;
  /** Header of the tree row to mark. */
  tree: CborPosition | null;
}

export interface CborDocument {
  root: AnyNode | null;
  /** Whole bytes of input the hex view shows. */
  byteLength: number;
  /** True while input is still being decoded. */
  pending: boolean;
}

const UNSUPPORTED: CborTargetResolution = { status: notShownHere(), hex: null, tree: null };

/** A `cbor_span` / `cbor_path` target against the document; other kinds are `unsupported`. */
export function resolveCborTarget(annotation: CquisitorAnnotation, doc: CborDocument): CborTargetResolution {
  const { target } = annotation;
  if (target.kind !== "cbor_span" && target.kind !== "cbor_path") return UNSUPPORTED;
  if (target.kind === "cbor_span") {
    if (doc.byteLength === 0) {
      return {
        status: doc.pending
          ? { state: "waiting", note: "Waiting for the CBOR to decode." }
          : { state: "not_found", note: "There are no bytes here." },
        hex: null,
        tree: null,
      };
    }
    if (target.offset >= doc.byteLength) {
      return {
        status: { state: "not_found", note: `The input is ${doc.byteLength} bytes; this span starts at byte ${target.offset}.` },
        hex: null,
        tree: null,
      };
    }
    const hex = { offset: target.offset, length: Math.min(target.length, doc.byteLength - target.offset) };
    return { status: resolvedStatus(), hex, tree: findCborNodeBySpan(doc.root, hex)?.header ?? null };
  }
  if (!doc.root) {
    return {
      status: doc.pending
        ? { state: "waiting", note: "Waiting for the CBOR to decode." }
        : { state: "not_found", note: "The CBOR did not decode, so no path can be found in it." },
      hex: null,
      tree: null,
    };
  }
  const hit = findCborNodeByPath(doc.root, target.path);
  return hit
    ? { status: resolvedStatus(), hex: hit.extent, tree: hit.header }
    : { status: { state: "not_found", note: `${target.path} is not in this document.` }, hex: null, tree: null };
}

/** A hex span to paint, with the classes of its mark. */
export interface AnnotatedHexSpan {
  offset: number;
  length: number;
  className: string;
}

export function spanKey(position: CborPosition): string {
  return `${position.offset}:${position.length}`;
}

/** Hex spans in paint order: the focused one last, so it wins an overlap. */
export function hexSpansFor(marks: ReadonlyMap<string, AnnotationMark>): AnnotatedHexSpan[] {
  const out: Array<AnnotatedHexSpan & { focused: boolean }> = [];
  for (const [key, mark] of marks) {
    const [offset, length] = key.split(":").map(Number);
    out.push({ offset, length, className: annotationClassName(mark), focused: mark.focused });
  }
  out.sort((a, b) => Number(a.focused) - Number(b.focused) || b.length - a.length);
  return out.map(({ offset, length, className }) => ({ offset, length, className }));
}

export interface CborMarks {
  hexSpans: AnnotatedHexSpan[];
  /** Tree row classes by `spanAttr` of the row's header. */
  treeRows: Map<string, string>;
  /** Tree rows to keep open. */
  treeOpen: CborPosition[];
}

export function cborMarks(
  resolutions: ReadonlyArray<{ hex: CborPosition | null; tree: CborPosition | null }>,
  annotations: readonly CquisitorAnnotation[],
  focus: number,
): CborMarks {
  const hex: Array<{ key: string; index: number }> = [];
  const tree: Array<{ key: string; index: number }> = [];
  const treeOpen: CborPosition[] = [];
  resolutions.forEach((r, index) => {
    if (r.hex) hex.push({ key: spanKey(r.hex), index });
    if (r.tree) {
      tree.push({ key: spanKey(r.tree), index });
      treeOpen.push(r.tree);
    }
  });
  const treeRows = new Map<string, string>();
  for (const [key, mark] of buildMarks(tree, annotations, focus)) treeRows.set(key, annotationClassName(mark));
  return { hexSpans: hexSpansFor(buildMarks(hex, annotations, focus)), treeRows, treeOpen };
}
