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
  /**
   * The instances a reference site names, when that is fewer than the
   * construct's whole group: `coin` in `2 : coin` is the coin under key 2,
   * not every coin. Absent for a node reached any other way.
   */
  instances?: readonly CborCddlMapEntry[];
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
  /**
   * Instances of the rule referenced at `charOffset`, scoped to where the
   * reference sits: under the member whose type it is (`2 : coin`), else
   * under the construct enclosing it (`[* transaction_output]`), else under
   * the rule whose body it is in (`value = coin / …`). Only the shallowest
   * matches under that scope count, so a nested recurrence of the same rule
   * is not the reference's. Same array for the same site; `null` when
   * `charOffset` is not a reference the map has entries for.
   */
  referenceInstancesAt(charOffset: number): readonly CborCddlMapEntry[] | null;
  /**
   * Where the schema reaches `entry`'s rule for this instance: the reference
   * in the member that types it (`coin` in `2 : coin`), in the construct
   * holding it (`[* transaction_output]`), or in the rule that names it
   * (`value = coin / …`). `null` for a row filed under no rule, or one the
   * text reaches nowhere the bridge can see.
   */
  referenceSiteOf(entry: CborCddlMapEntry): [number, number] | null;
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

/** One schema construct the map filed rows under: its span, role, and rows. */
interface SpanGroup {
  offset: number;
  end: number;
  role: EntryRole;
  entries: readonly CborCddlMapEntry[];
}

function spanGroupList(groups: Map<number, CborCddlMapEntry[]>): SpanGroup[] {
  const out: SpanGroup[] = [];
  for (const entries of groups.values()) {
    const span = entries[0].cddl_byte_span!;
    out.push({
      offset: span.char_offset,
      end: span.char_offset + span.char_length,
      role: entries[0].entry_role,
      entries,
    });
  }
  return out;
}

const contains = (g: SpanGroup, at: number) => at >= g.offset && at < g.end;

/**
 * Where the member holding `at` starts inside the construct opening at
 * `open`, and whether it has a key before `at`. Members are split by commas
 * at the construct's own depth; strings and comments are skipped.
 */
function memberBefore(text: string, open: number, at: number): { start: number; keyed: boolean } {
  let start = open + 1;
  let keyed = false;
  let depth = 0;
  for (let i = open + 1; i < at; i++) {
    const c = text[i];
    if (c === ";") {
      const eol = text.indexOf("\n", i);
      i = eol < 0 ? at : eol;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < at && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "{" || c === "[" || c === "(" || c === "<") {
      depth++;
    } else if (c === "}" || c === "]" || c === ")" || c === ">") {
      depth--;
    } else if (depth === 0 && c === ",") {
      start = i + 1;
      keyed = false;
    } else if (depth === 0 && (c === ":" || (c === "=" && text[i + 1] === ">"))) {
      keyed = true;
    }
  }
  return { start, keyed };
}

/**
 * Rows of the construct a reference at `at` belongs to: the key of the
 * member it types, else the construct enclosing it. Empty when the member
 * has a key the document never matched; `null` when no construct's span
 * contains `at`.
 */
function enclosingConstruct(
  groups: readonly SpanGroup[],
  text: string,
  at: number,
): readonly CborCddlMapEntry[] | null {
  let outer: SpanGroup | null = null;
  for (const g of groups) {
    if (contains(g, at) && (!outer || g.end - g.offset < outer.end - outer.offset)) outer = g;
  }
  if (!outer) return null;
  const member = memberBefore(text, outer.offset, at);
  // In an array a name before the colon is a label, not a key.
  if (!member.keyed || text[outer.offset] === "[") return outer.entries;
  for (const key of groups) {
    if (key.role === "key" && key.offset >= member.start && key.end <= at) return key.entries;
  }
  return NO_ENTRIES;
}

/** End of the member starting at `from`: its construct's next comma or closing bracket. */
function memberEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === ";") {
      const eol = text.indexOf("\n", i);
      if (eol < 0) return text.length;
      i = eol;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "{" || c === "[" || c === "(" || c === "<") {
      depth++;
    } else if (c === "}" || c === "]" || c === ")" || c === ">") {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && c === ",") {
      return i;
    }
  }
  return text.length;
}

const NAME_RUN = /[A-Za-z0-9@_$.\-]+/g;
// A name that is a member key or label, not a type.
const LABELS = /^\s*(?::|=>)/;

/**
 * The first use of `name` as a type in `text[start, end)`: a whole name run
 * that is not a key or label and not in a comment.
 */
function typeReferenceIn(text: string, start: number, end: number, name: string): [number, number] | null {
  NAME_RUN.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = NAME_RUN.exec(text)) !== null && m.index + name.length <= end) {
    if (m[0] !== name) continue;
    const at = m.index;
    if (LABELS.test(text.slice(at + name.length, at + name.length + 16))) continue;
    const lineStart = text.lastIndexOf("\n", at) + 1;
    if (text.slice(lineStart, at).includes(";")) continue;
    return [at, at + name.length];
  }
  return null;
}

// A rule definition at the start of a line: name, optional generics, `=`, `/=` or `//=`.
const DEFINITION_LINE = /^[ \t]*([A-Za-z@_$][A-Za-z0-9@_$.\-]*)[ \t]*(?:<[^>\n]*>)?[ \t]*(?:\/\/=|\/=|=)/gm;

/** Name of the rule whose definition starts last at or before `at`. */
function enclosingRuleName(text: string, at: number): string | null {
  let name: string | null = null;
  DEFINITION_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEFINITION_LINE.exec(text)) !== null) {
    if (m.index > at) break;
    name = m[1];
  }
  return name;
}

/** Where the definition holding `at` ends: the next definition line, or the text's end. */
function definitionEnd(text: string, at: number): number {
  DEFINITION_LINE.lastIndex = at + 1;
  const m = DEFINITION_LINE.exec(text);
  return m ? m.index : text.length;
}

/** Whether `entry` is filed under a construct's body (`{…}`, `[…]`, `(…)`) rather than a name. */
function isBodyEntry(entry: CborCddlMapEntry, text: string): boolean {
  const span = entry.cddl_byte_span;
  if (entry.rule_name || !hasCddlSpan(span)) return false;
  const c = text[span.char_offset];
  return c === "{" || c === "[" || c === "(";
}

const startsWith = (path: readonly string[], prefix: readonly string[]) =>
  path.length >= prefix.length && prefix.every((s, i) => s === path[i]);

/**
 * `candidates` at or under one of `scopes`, keeping only the shallowest
 * relative depth found, in `candidates`' order.
 */
function shallowestUnder(
  candidates: readonly CborCddlMapEntry[],
  scopes: readonly (readonly string[])[],
  pathOf: (entry: CborCddlMapEntry) => readonly string[],
): CborCddlMapEntry[] {
  let best = Infinity;
  const depths: number[] = [];
  for (const entry of candidates) {
    const path = pathOf(entry);
    let depth = Infinity;
    for (const scope of scopes) {
      if (startsWith(path, scope)) depth = Math.min(depth, path.length - scope.length);
    }
    depths.push(depth);
    if (depth < best) best = depth;
  }
  return best === Infinity ? [] : candidates.filter((_, i) => depths[i] === best);
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
  let groupList: SpanGroup[] | null = null;
  const constructs = () => (groupList ??= spanGroupList(spanIndex()));
  // Built on the first schema-editor probe.
  let definitions: Map<string, number> | null = null;
  const definitionIndex = () => (definitions ??= definitionSpans(entries, cddl));
  // Scoped groups by reference site, so a site asked twice is the same array.
  const references = new Map<number, readonly CborCddlMapEntry[]>();
  const sites = new WeakMap<CborCddlMapEntry, [number, number] | null>();
  const segmentsOf = new WeakMap<CborCddlMapEntry, readonly string[]>();
  const segments = (entry: CborCddlMapEntry): readonly string[] => {
    let own = segmentsOf.get(entry);
    if (!own) {
      own = libSplitPath(cborPath(entry.cbor_path));
      segmentsOf.set(entry, own);
    }
    return own;
  };
  /** Rows at `segments`, in document order — the trie's own array. */
  const rowsAt = (path: readonly string[]): readonly CborCddlMapEntry[] =>
    trieAt(cborIndex(), path)?.entries ?? NO_ENTRIES;
  const siteOf = (entry: CborCddlMapEntry): [number, number] | null => {
    const name = entry.rule_name;
    const span = entry.cddl_byte_span;
    if (!cddl || !name || !hasCddlSpan(span)) return null;
    // A row filed under a use of a prelude type already points at that use.
    if (definitionIndex().get(name) !== span.char_offset) return null;
    let path = segments(entry);
    const rows = rowsAt(path);
    // The rule reached before this one at the same node names it in its body.
    const own = rows.indexOf(entry);
    for (let i = own - 1; i >= 0; i--) {
      const before = rows[i];
      const beforeSpan = before.cddl_byte_span;
      if (before.entry_role !== entry.entry_role || !before.rule_name || !hasCddlSpan(beforeSpan)) continue;
      if (definitionIndex().get(before.rule_name) !== beforeSpan.char_offset) continue;
      const start = beforeSpan.char_offset + beforeSpan.char_length;
      return typeReferenceIn(cddl, start, definitionEnd(cddl, beforeSpan.char_offset), name);
    }
    // Else the member that holds this node, or the construct around it, going up.
    while (path.length > 0) {
      for (const key of rowsAt(path)) {
        const keySpan = key.cddl_byte_span;
        if (key.entry_role !== "key" || !hasCddlSpan(keySpan)) continue;
        const start = keySpan.char_offset + keySpan.char_length;
        return typeReferenceIn(cddl, start, memberEnd(cddl, start), name);
      }
      const parent = path.slice(0, -1);
      for (const row of rowsAt(parent)) {
        if (!isBodyEntry(row, cddl)) continue;
        const body = row.cddl_byte_span!;
        const found = typeReferenceIn(cddl, body.char_offset + 1, body.char_offset + body.char_length, name);
        if (found) return found;
      }
      path = parent;
    }
    return null;
  };
  const scopeOf = (at: number): readonly (readonly string[])[] | null => {
    const construct = enclosingConstruct(constructs(), cddl, at);
    if (construct) return construct.map(segments);
    const rule = enclosingRuleName(cddl, at);
    const definition = rule === null ? undefined : definitionIndex().get(rule);
    if (definition === undefined) return null;
    return (spanIndex().get(spanKey({ char_offset: definition, char_length: rule!.length })) ?? NO_ENTRIES).map(segments);
  };
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
    referenceInstancesAt: (charOffset) => {
      if (!cddl) return null;
      const run = nameRunAt(cddl, charOffset);
      if (!run) return null;
      const name = cddl.slice(run[0], run[1]);
      const definition = definitionIndex().get(name);
      if (definition === undefined || definition === run[0]) return null;
      const known = references.get(run[0]);
      if (known) return known;
      const group = spanIndex().get(spanKey({ char_offset: definition, char_length: name.length })) ?? NO_ENTRIES;
      const scopes = scopeOf(run[0]);
      const scoped = scopes ? shallowestUnder(group, scopes, segments) : group;
      // The whole group is the bridge's own array; a subset is this site's.
      const result = scoped.length === group.length ? group : scoped;
      references.set(run[0], result);
      return result;
    },
    referenceSiteOf: (entry) => {
      const known = sites.get(entry);
      if (known !== undefined) return known;
      const site = siteOf(entry);
      sites.set(entry, site);
      return site;
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
