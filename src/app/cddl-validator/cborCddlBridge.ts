// CBOR ⇄ CDDL map as the four panels use it.
// Path tables store suffix + prefix index, not full strings. Resolve a path
// only for the pinned/hovered node; whole-map scans use spans. Path, instance,
// and definition indexes are built on first use.

import type {
  CborCddlMap,
  CborCddlMapEntry,
  CborCddlPathEntry,
} from "@cardananium/cquisitor-lib";
import { libSplitPath } from "@/components/jsonTree/paths";
import { hasCddlSpan } from "./cddlError";

/** Which of a map entry's two rows a click meant. */
export type EntryRole = "key" | "value";

/** Empty map used when there is nothing to map. */
export const EMPTY_CBOR_CDDL_MAP: CborCddlMap = {
  cbor_paths: [],
  decoded_paths: [],
  entries: [],
};

/** Map entry with both paths resolved. */
export interface CborCddlNode {
  entry: CborCddlMapEntry;
  /** Path into the raw CBOR tree (`$.age`, `$[0]`). */
  cborPath: string;
  /** Path into the labelled JSON `decode_cbor_against_cddl` returns. */
  decodedPath: string;
}

/**
 * Resolves a path-table index, caching only that index. A prefix must name
 * an earlier row or the fold stops; an out-of-range index is `""`.
 */
function makePathResolver(rows: readonly CborCddlPathEntry[]): (index: number) => string {
  const cache = new Map<number, string>();
  return (index: number): string => {
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return "";
    const done = cache.get(index);
    if (done !== undefined) return done;

    const suffixes: string[] = [];
    let cursor: number | undefined = index;
    while (cursor !== undefined) {
      suffixes.push(rows[cursor].suffix);
      const prefix: number | undefined = rows[cursor].prefix;
      cursor = prefix !== undefined && prefix >= 0 && prefix < cursor ? prefix : undefined;
    }
    const text = suffixes.reverse().join("");
    cache.set(index, text);
    return text;
  };
}

/**
 * Path-table trie of segments. Compared segment-wise: the library writes a
 * numeric map key as `["0"]` where the tree writes `[0]`.
 */
interface SegmentNode {
  /** As `libSplitPath` reads it. */
  segment: string;
  /** Raw text of this segment, for a suffix that extends it. */
  raw: string;
  parent: SegmentNode | null;
  children: Map<string, SegmentNode>;
  entries: CborCddlMapEntry[] | null;
}

const LIB_SEG_WITH_RAW = /\.([^.[\]]+)|\["((?:[^"\\]|\\.)*)"\]|\[(\d+)\]/g;

/** `(raw, segment)` for every segment of `text`, as `libSplitPath` splits it. */
function splitWithRaw(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  LIB_SEG_WITH_RAW.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LIB_SEG_WITH_RAW.exec(text)) !== null) {
    out.push([m[0], m[1] ?? m[2] ?? m[3]]);
  }
  return out;
}

function segmentTrie(
  rows: readonly CborCddlPathEntry[],
  entries: readonly CborCddlMapEntry[],
  pathOf: (entry: CborCddlMapEntry) => number,
): SegmentNode {
  const root: SegmentNode = { segment: "", raw: "", parent: null, children: new Map(), entries: null };
  const descend = (from: SegmentNode, pieces: Array<[string, string]>): SegmentNode => {
    let at = from;
    for (const [raw, segment] of pieces) {
      let next = at.children.get(segment);
      if (!next) {
        next = { segment, raw, parent: at, children: new Map(), entries: null };
        at.children.set(segment, next);
      }
      at = next;
    }
    return at;
  };

  const nodeOf: SegmentNode[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const { prefix, suffix } = rows[i];
    const base =
      prefix !== undefined && prefix >= 0 && prefix < i ? nodeOf[prefix] : root;
    // A suffix that starts a segment hangs whole segments off its prefix;
    // one that does not extends the prefix's last segment.
    if (base === root || suffix === "" || suffix.startsWith(".") || suffix.startsWith("[")) {
      nodeOf[i] = descend(base, splitWithRaw(suffix));
    } else {
      nodeOf[i] = descend(base.parent ?? root, splitWithRaw(base.raw + suffix));
    }
  }
  for (const entry of entries) {
    const node = nodeOf[pathOf(entry)];
    if (!node) continue;
    (node.entries ??= []).push(entry);
  }
  return root;
}

const NO_ENTRIES: readonly CborCddlMapEntry[] = [];

/** The node at `segments` under `root`, or `null` when the trie ends first. */
function trieAt(root: SegmentNode, segments: readonly string[]): SegmentNode | null {
  let at: SegmentNode | null = root;
  for (const segment of segments) {
    at = at.children.get(segment) ?? null;
    if (!at) return null;
  }
  return at;
}

/** Entries at the deepest strict ancestor of `segments` that has any. */
function ancestorEntries(root: SegmentNode, segments: readonly string[]): readonly CborCddlMapEntry[] {
  let at: SegmentNode | null = root;
  let found: readonly CborCddlMapEntry[] = at.entries ?? NO_ENTRIES;
  for (let depth = 0; depth < segments.length - 1 && at; depth++) {
    at = at.children.get(segments[depth]) ?? null;
    if (at?.entries) found = at.entries;
  }
  return found;
}

export interface CborCddlBridge {
  /** One row per node visited, in depth-first pre-order. */
  readonly entries: readonly CborCddlMapEntry[];
  /** `entry` with both paths resolved. */
  node(entry: CborCddlMapEntry): CborCddlNode;
  /**
   * Every entry whose decoded path is exactly `path`, segment-wise. A map
   * entry the schema matched contributes both its key row and its value row.
   */
  entriesAtDecodedPath(path: string): readonly CborCddlMapEntry[];
  /**
   * Entries at the deepest strict ancestor of `path` that has any — stand-in
   * for a synthetic decoder key (`@tag`, `@positional`, `@extra`, `@entries[N]…`).
   */
  entriesAtDecodedAncestor(path: string): readonly CborCddlMapEntry[];
  /**
   * Every entry whose CBOR path is exactly `path`, segment-wise (`$[1]` and
   * `$["1"]` are one segment). Tags are transparent, so tag, payload, and
   * tagged value share a path.
   */
  entriesAtCborPath(path: string): readonly CborCddlMapEntry[];
  /** Entries at the deepest strict ancestor of `path` that has any. */
  entriesAtCborAncestor(path: string): readonly CborCddlMapEntry[];
  /**
   * Entries whose schema span is exactly `entry`'s, in document order.
   * Same array for every member; exact span only; a foreign or spanless entry is a group of itself.
   */
  instancesOf(entry: CborCddlMapEntry): readonly CborCddlMapEntry[];
  /**
   * Definition offset of the rule named at `charOffset`, when that character
   * is a reference the map has entries for. `null` on the definition itself,
   * on a non-name, and on a name the map never filed (prelude, unmatched, member key).
   */
  definitionOffsetFor(charOffset: number): number | null;
}

// RFC 8610 §3.1: EALPHA then those, digits, `-` and `.`. The index only
// answers for runs that are names it knows.
const NAME_CHAR = /[A-Za-z0-9@_$.\-]/;

/** The maximal run of name characters around `at`, as `[start, end)`. */
export function nameRunAt(text: string, at: number): [number, number] | null {
  if (at < 0 || at >= text.length || !NAME_CHAR.test(text[at])) return null;
  let start = at;
  while (start > 0 && NAME_CHAR.test(text[start - 1])) start--;
  let end = at + 1;
  while (end < text.length && NAME_CHAR.test(text[end])) end++;
  return [start, end];
}

// After a definition name: optional generics, then `=`, `/=` or `//=`.
// Anything else after a known name is a reference.
const DEFINES = /^\s*(?:<[^>]*>\s*)?(?:\/\/=|\/=|=)/;

/**
 * Rule names the map filed entries under, mapped to the definition-line span
 * those entries carry. Prelude uses are not definitions.
 */
function definitionSpans(entries: readonly CborCddlMapEntry[], text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of entries) {
    const name = entry.rule_name;
    const span = entry.cddl_byte_span;
    if (!name || !hasCddlSpan(span) || out.has(name)) continue;
    if (span.char_length !== name.length) continue;
    const end = span.char_offset + span.char_length;
    if (text.slice(span.char_offset, end) !== name) continue;
    if (!DEFINES.test(text.slice(end, end + 256))) continue;
    out.set(name, span.char_offset);
  }
  return out;
}

/** Pack a schema span into one integer; both numbers fit the schema length. */
function spanKey(span: { char_offset: number; char_length: number }): number {
  return span.char_offset * 4294967296 + span.char_length;
}

function spanGroups(entries: readonly CborCddlMapEntry[]): Map<number, CborCddlMapEntry[]> {
  const groups = new Map<number, CborCddlMapEntry[]>();
  for (const entry of entries) {
    const span = entry.cddl_byte_span;
    if (!hasCddlSpan(span)) continue;
    const key = spanKey(span);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

/** `cddl` is the schema text the map's character offsets address; without it, no references. */
export function createCborCddlBridge(map: CborCddlMap, cddl = ""): CborCddlBridge {
  const entries = map.entries;
  const cborPath = makePathResolver(map.cbor_paths);
  const decodedPath = makePathResolver(map.decoded_paths);

  // Built on the first path lookup.
  let decodedTrie: SegmentNode | null = null;
  const decodedIndex = (): SegmentNode =>
    (decodedTrie ??= segmentTrie(map.decoded_paths, entries, e => e.decoded_path));
  let cborTrie: SegmentNode | null = null;
  const cborIndex = (): SegmentNode =>
    (cborTrie ??= segmentTrie(map.cbor_paths, entries, e => e.cbor_path));

  // Built on the first instances probe.
  let groups: Map<number, CborCddlMapEntry[]> | null = null;
  const spanIndex = () => (groups ??= spanGroups(entries));
  // Built on the first schema-editor probe.
  let definitions: Map<string, number> | null = null;
  const definitionIndex = () => (definitions ??= definitionSpans(entries, cddl));
  // One singleton array per entry so the same entry asked twice is the same array.
  const singletons = new WeakMap<CborCddlMapEntry, readonly CborCddlMapEntry[]>();
  const singleton = (entry: CborCddlMapEntry): readonly CborCddlMapEntry[] => {
    let own = singletons.get(entry);
    if (!own) {
      own = [entry];
      singletons.set(entry, own);
    }
    return own;
  };

  return {
    entries,
    node: (entry) => ({
      entry,
      cborPath: cborPath(entry.cbor_path),
      decodedPath: decodedPath(entry.decoded_path),
    }),
    instancesOf: (entry) => {
      const span = entry.cddl_byte_span;
      if (!hasCddlSpan(span)) return singleton(entry);
      const group = spanIndex().get(spanKey(span));
      // Another map's entry may share a span number and still not belong here.
      return group && group.includes(entry) ? group : singleton(entry);
    },
    definitionOffsetFor: (charOffset) => {
      if (!cddl) return null;
      const run = nameRunAt(cddl, charOffset);
      if (!run) return null;
      const definition = definitionIndex().get(cddl.slice(run[0], run[1]));
      // The definition's own name is not a reference to it.
      return definition === undefined || definition === run[0] ? null : definition;
    },
    entriesAtDecodedPath: (path) =>
      trieAt(decodedIndex(), libSplitPath(path))?.entries ?? NO_ENTRIES,
    entriesAtDecodedAncestor: (path) => ancestorEntries(decodedIndex(), libSplitPath(path)),
    entriesAtCborPath: (path) =>
      trieAt(cborIndex(), libSplitPath(path))?.entries ?? NO_ENTRIES,
    entriesAtCborAncestor: (path) => ancestorEntries(cborIndex(), libSplitPath(path)),
  };
}

/** Clicked role, else whatever the library emitted. Array slots, tag payloads
 *  and roots only ever have a value row. */
export function preferRole(
  candidates: readonly CborCddlMapEntry[],
  role: EntryRole,
): CborCddlMapEntry | null {
  if (candidates.length === 0) return null;
  return candidates.find(e => e.entry_role === role) ?? candidates[0];
}
