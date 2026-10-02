// Where each diagnostic sits in the two trees.
// Structural: first byte span, else anchor, else root header. Decoded: CBOR
// path via the bridge when its bytes agree, else bytes, else deepest known
// ancestor (`held`).
// Maps are rebuilt every call; the host memoises.

import {
  abbreviatePath,
  describeDiagnostic,
  type CborCddlMapEntry,
  type CborPosition,
  type CborDiagnostic,
} from "@cardananium/cquisitor-lib";
import { spanAttr } from "@/components/CborTreeView";
import {
  NO_TREE_DIAGNOSTICS,
  type TreeDiagnostic,
  type TreeDiagnosticRows,
} from "@/components/treeDiagnostics";
import { preferRole, type CborCddlBridge } from "./cborCddlBridge";
import { findNodeByCborOffset } from "./pinResolvers";

export type { TreeDiagnostic, TreeDiagnosticRows } from "@/components/treeDiagnostics";

/**
 * Bytes the structural tree names the diagnostic by: own bytes, else the
 * structure around them, else — for a root diagnostic — `rootHeader`.
 */
export function diagnosticPosition(d: CborDiagnostic, rootHeader: CborPosition | null): CborPosition | null {
  return d.byteSpans[0] ?? d.anchorSpans[0] ?? (d.path === "$" ? rootHeader : null);
}

/** Diagnostic `index` of the run as a row carries it. */
export function toTreeDiagnostic(
  d: CborDiagnostic,
  index: number,
  rootHeader: CborPosition | null,
): TreeDiagnostic {
  return {
    index,
    kind: d.kind,
    expected: d.expected,
    message: d.message,
    path: d.path,
    pathLabel: d.path ? abbreviatePath(d.path) : null,
    position: diagnosticPosition(d, rootHeader),
    title: describeDiagnostic(d),
    held: false,
  };
}

function place(rows: Map<string, TreeDiagnostic[]>, key: string, diagnostic: TreeDiagnostic): void {
  const list = rows.get(key);
  if (list) list.push(diagnostic);
  else rows.set(key, [diagnostic]);
}

/**
 * Structural placements, keyed by `spanAttr` of the named position.
 * Diagnostics with no bytes are left out. Order within a row is the run's.
 */
export function diagnosticTreeRows(
  diagnostics: readonly CborDiagnostic[],
  rootHeader: CborPosition | null,
): TreeDiagnosticRows {
  let rows: Map<string, TreeDiagnostic[]> | null = null;
  for (let i = 0; i < diagnostics.length; i++) {
    const placed = toTreeDiagnostic(diagnostics[i], i, rootHeader);
    if (!placed.position) continue;
    place((rows ??= new Map()), spanAttr(placed.position), placed);
  }
  return rows ?? NO_TREE_DIAGNOSTICS;
}

/**
 * Decoded placements, keyed by decoded path as the bridge spells it.
 * CBOR path first, when that row's bytes meet the blamed ones; else the
 * blamed bytes; else the deepest known ancestor (`held`). Empty map: no rows.
 */
export function diagnosticDecodedRows(
  diagnostics: readonly CborDiagnostic[],
  bridge: CborCddlBridge,
  rootHeader: CborPosition | null,
): TreeDiagnosticRows {
  if (bridge.entries.length === 0) return NO_TREE_DIAGNOSTICS;
  let rows: Map<string, TreeDiagnostic[]> | null = null;
  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i];
    const own = ownDecodedPath(bridge, d);
    if (own) {
      place((rows ??= new Map()), own, toTreeDiagnostic(d, i, rootHeader));
      continue;
    }
    const holder = d.path ? decodedPathOf(bridge, bridge.entriesAtCborAncestor(d.path)) : null;
    if (holder) {
      place((rows ??= new Map()), holder, { ...toTreeDiagnostic(d, i, rootHeader), held: true });
    }
  }
  return rows ?? NO_TREE_DIAGNOSTICS;
}

/** Decoded path of the value row among `candidates`, or `null`. */
function decodedPathOf(bridge: CborCddlBridge, candidates: readonly CborCddlMapEntry[]): string | null {
  const entry = preferRole(candidates, "value");
  return entry ? bridge.node(entry).decodedPath || null : null;
}

/** Whether `a` and `b` share a byte; an empty range counts as its first byte. */
function meets(a: CborPosition, b: CborPosition): boolean {
  return a.offset < b.offset + Math.max(b.length, 1) && b.offset < a.offset + Math.max(a.length, 1);
}

/**
 * Whether `entry` can be the node the diagnostic blames: one of them names no
 * bytes, or the entry's extent meets bytes the diagnostic blames (a
 * container's are its header, so an entry inside it does not qualify).
 *
 * A CBOR path can name more than one node. In an `@entries` map the pair, key
 * and value rows carry the map's own path, and the items of a composite key
 * carry `<map>[i]`, while the validator's `<map>[i]` is an integer key, or the
 * entry at position `i` when its key is too long to write out. And paths are
 * compared segment-wise, so the validator's `[...]`, which names no entry, is
 * the text key `"..."`.
 */
function agreesWithBytes(entry: CborCddlMapEntry, d: CborDiagnostic): boolean {
  const extent = entry.cbor_anchor_span;
  if (!extent) return true;
  const blamed = d.byteSpans.length > 0 ? d.byteSpans : d.anchorSpans;
  return blamed.length === 0 || blamed.some(span => meets(extent, span));
}

/**
 * Decoded path of the diagnostic's row: by CBOR path when that row's bytes
 * agree with the diagnostic's, else by the first blamed byte.
 */
function ownDecodedPath(bridge: CborCddlBridge, d: CborDiagnostic): string | null {
  if (d.path) {
    const byPath = decodedPathOf(
      bridge,
      bridge.entriesAtCborPath(d.path).filter(entry => agreesWithBytes(entry, d)),
    );
    if (byPath) return byPath;
  }
  const span = d.byteSpans[0];
  if (span) {
    const node = findNodeByCborOffset(bridge, span.offset);
    if (node && node.decodedPath) return node.decodedPath;
  }
  return null;
}
