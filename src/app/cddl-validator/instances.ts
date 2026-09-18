// Instances of a schema construct: every byte run it matched.
// One schema span can match many map rows (`name: tstr` inside `[+Person]`).
// Schema hover lights the whole group; data hover lights one run. No DOM here.

import type { CborCddlMapEntry, CborPosition } from "@cardananium/cquisitor-lib";
import { spanAttr } from "@/components/CborTreeView";
import type { CborCddlBridge, CborCddlNode } from "./cborCddlBridge";
import type { PinTarget } from "./pinResolvers";
import { PANEL_NAMES } from "./workspaceLayout";

/** Paint cap per link; the count is still the true one. */
export const INSTANCE_PAINT_CAP = 1000;

export const NO_INSTANCES: readonly CborCddlMapEntry[] = [];
export const EMPTY_POSITIONS: readonly CborPosition[] = [];
export const EMPTY_PATHS: readonly string[] = [];

/** What one probe lights and can step through. */
export interface InstanceSet {
  /** Whole group, in document order — count and arrows. */
  readonly instances: readonly CborCddlMapEntry[];
  readonly lit: readonly CborCddlMapEntry[];
  /** Index in `instances`; `-1` for a schema probe, which names the construct. */
  readonly index: number;
}

export const EMPTY_INSTANCE_SET: InstanceSet = { instances: NO_INSTANCES, lit: NO_INSTANCES, index: -1 };

/**
 * Set a probe from `source` lights.
 * Schema lights the whole group; a data panel lights the probed run and keeps the group for the count.
 */
export function instanceSetFor(
  bridge: CborCddlBridge,
  node: CborCddlNode | null,
  source: PinTarget,
): InstanceSet {
  if (!node) return EMPTY_INSTANCE_SET;
  const instances = bridge.instancesOf(node.entry);
  if (source === "cddl") return { instances, lit: instances, index: -1 };
  return {
    instances,
    lit: instances.length === 1 ? instances : [node.entry],
    index: instances.indexOf(node.entry),
  };
}

/** Lit rows as each data panel addresses them. */
export interface InstanceProjection {
  /** Whole extents for hex — the entries' own anchor objects. */
  readonly hexAll: readonly CborPosition[];
  /** Header bytes, how the structural tree names a row. */
  readonly treeAll: readonly CborPosition[];
  readonly decodedAll: readonly string[];
  /** Whether `lit` ran past the paint cap, so the arrays are its head. */
  readonly truncated: boolean;
}

const EMPTY_PROJECTION: InstanceProjection = {
  hexAll: EMPTY_POSITIONS,
  treeAll: EMPTY_POSITIONS,
  decodedAll: EMPTY_PATHS,
  truncated: false,
};

/**
 * `lit` projected onto the three data panels, up to the paint cap. A row
 * the bytes omit is skipped on hex and tree; it still has its decoded row.
 */
export function projectInstances(
  bridge: CborCddlBridge,
  lit: readonly CborCddlMapEntry[],
): InstanceProjection {
  if (lit.length === 0) return EMPTY_PROJECTION;
  const hexAll: CborPosition[] = [];
  const treeAll: CborPosition[] = [];
  const decodedAll: string[] = [];
  const painted = Math.min(lit.length, INSTANCE_PAINT_CAP);
  for (let i = 0; i < painted; i++) {
    const entry = lit[i];
    if (entry.cbor_anchor_span) hexAll.push(entry.cbor_anchor_span);
    if (entry.cbor_byte_span) treeAll.push(entry.cbor_byte_span);
    const path = bridge.node(entry).decodedPath;
    if (path) decodedAll.push(path);
  }
  return { hexAll, treeAll, decodedAll, truncated: painted < lit.length };
}

/** `label` plus how many instances a schema probe lit, or which one a data probe named. One instance adds nothing. */
export function instanceCountLabel(label: string, set: InstanceSet, truncated = false): string {
  const total = set.instances.length;
  if (total <= 1) return label;
  const count = set.index < 0
    ? `${total} instances${truncated ? ` (first ${INSTANCE_PAINT_CAP} painted)` : ""}`
    : `instance ${set.index + 1} of ${total}`;
  return `${label} · ${count}`;
}

// ---------- the pin's current instance ----------

/** Current instance node and its index in the construct's group. */
export interface PinnedInstance {
  readonly node: CborCddlNode;
  readonly instances: readonly CborCddlMapEntry[];
  readonly current: number;
}

/** Pin plus source and the bridge it was made against. A step re-resolves
 *  through that bridge, not a later empty one from a settle in progress. */
export interface PinState extends PinnedInstance {
  readonly source: PinTarget;
  readonly bridge: CborCddlBridge;
  /**
   * Indexes that have been current, in first-visit order. Trees keep the
   * way to each open so a left instance does not fold away with its mark.
   */
  readonly visited: readonly number[];
}

/**
 * Where a fresh pin starts. Schema: group's first row. Data: the run that
 * was pinned, which is in its own group by construction.
 */
export function initialInstanceIndex(
  instances: readonly CborCddlMapEntry[],
  entry: CborCddlMapEntry,
  source: PinTarget,
): number {
  if (source === "cddl") return 0;
  return Math.max(0, instances.indexOf(entry));
}

/** `current` clamped into the pin's group. */
export function currentIndex(pin: PinnedInstance): number {
  return Math.max(0, Math.min(pin.current, pin.instances.length - 1));
}

/** `current` moved by `delta`, wrapping. A group of one stays at `0`; empty has no position. */
export function stepInstance(current: number, delta: number, total: number): number {
  if (total <= 0) return -1;
  return (((current + delta) % total) + total) % total;
}

/**
 * Fresh pin. Schema: the construct, first current, arrows through the rest.
 * Data: the one run under the pointer — group of that run alone.
 */
export function makePin(bridge: CborCddlBridge, node: CborCddlNode, source: PinTarget): PinState {
  const group = bridge.instancesOf(node.entry);
  const instances = source === "cddl" ? group : singleInstance(bridge, node.entry);
  const current = initialInstanceIndex(instances, node.entry, source);
  return { node, source, bridge, instances, current, visited: [current] };
}

// One singleton per entry so the same pin made twice compares equal by identity.
const singles = new WeakMap<CborCddlMapEntry, readonly CborCddlMapEntry[]>();
function singleInstance(bridge: CborCddlBridge, entry: CborCddlMapEntry): readonly CborCddlMapEntry[] {
  const group = bridge.instancesOf(entry);
  if (group.length === 1) return group;
  let own = singles.get(entry);
  if (!own) {
    own = [entry];
    singles.set(entry, own);
  }
  return own;
}

/**
 * Pin with current instance stepped by `delta`. Node is rewritten through
 * the pin's own bridge. A first visit joins `visited`; a return does not.
 */
export function stepPin(pin: PinState, delta: number): PinState {
  const current = stepInstance(currentIndex(pin), delta, pin.instances.length);
  if (current < 0 || current === pin.current) return pin;
  const visited = pin.visited.includes(current) ? pin.visited : [...pin.visited, current];
  return { ...pin, current, visited, node: pin.bridge.node(pin.instances[current]) };
}

/** Visited instances besides the current one, or nothing while the pin is not mirrored. */
export function visitedInstances(pin: PinState | null, enabled: boolean): readonly CborCddlMapEntry[] {
  if (!pin || !enabled || pin.visited.length <= 1) return NO_INSTANCES;
  const current = currentIndex(pin);
  const out: CborCddlMapEntry[] = [];
  for (const index of pin.visited) {
    if (index !== current && index < pin.instances.length) out.push(pin.instances[index]);
  }
  return out;
}

/** Visited instances' header bytes; a row the bytes omit has none. */
export function visitedTreePositions(pin: PinState | null, enabled: boolean): readonly CborPosition[] {
  const out: CborPosition[] = [];
  for (const entry of visitedInstances(pin, enabled)) {
    if (entry.cbor_byte_span) out.push(entry.cbor_byte_span);
  }
  return out.length > 0 ? out : EMPTY_POSITIONS;
}

/** Visited instances' decoded paths, resolved through the pin's own bridge. */
export function visitedDecodedPaths(pin: PinState | null, enabled: boolean): readonly string[] {
  if (!pin) return EMPTY_PATHS;
  const out: string[] = [];
  for (const entry of visitedInstances(pin, enabled)) {
    const path = pin.bridge.node(entry).decodedPath;
    if (path) out.push(path);
  }
  return out.length > 0 ? out : EMPTY_PATHS;
}

/** Instances a pin lights. A data pin's group is that one run. */
export function litPinInstances(pin: PinnedInstance): readonly CborCddlMapEntry[] {
  return pin.instances;
}

/** Pinned group less its current instance, up to the paint cap. */
export function otherInstances(pin: PinnedInstance): readonly CborCddlMapEntry[] {
  const lit = litPinInstances(pin);
  if (lit.length <= 1) return NO_INSTANCES;
  const current = currentIndex(pin);
  const out: CborCddlMapEntry[] = [];
  for (let i = 0; i < lit.length && out.length < INSTANCE_PAINT_CAP; i++) {
    if (i !== current) out.push(lit[i]);
  }
  return out;
}

/** Other instances' header bytes as `data-span` words, or `null` when none. */
export function pinnedOtherTreeKeys(pin: PinnedInstance | null, enabled: boolean): ReadonlySet<string> | null {
  if (!pin || !enabled) return null;
  const keys = new Set<string>();
  for (const entry of otherInstances(pin)) {
    if (entry.cbor_byte_span) keys.add(spanAttr(entry.cbor_byte_span));
  }
  return keys.size > 0 ? keys : null;
}

/** Other instances' decoded paths, or `null` when none. */
export function pinnedOtherDecodedPaths(
  pin: PinnedInstance | null,
  bridge: CborCddlBridge | null,
  enabled: boolean,
): ReadonlySet<string> | null {
  if (!pin || !bridge || !enabled) return null;
  const keys = new Set<string>();
  for (const entry of otherInstances(pin)) {
    const path = bridge.node(entry).decodedPath;
    if (path) keys.add(path);
  }
  return keys.size > 0 ? keys : null;
}

// ---------- the chip in each header ----------

export const STEP_KEYS_HINT = "Alt+, / Alt+.";

export interface InstanceNavText {
  /** `k/N`. */
  text: string;
  title: string;
  canStep: boolean;
}

export interface InstanceNavOptions {
  panel: PinTarget;
  /** The current instance has nothing to show in this panel. */
  byteless?: boolean;
}

/** Chip text for instance `index` of `total` in a panel. */
export function instanceNavLabel(index: number, total: number, opts: InstanceNavOptions): InstanceNavText {
  const k = index + 1;
  const canStep = total > 1;
  let title: string;
  if (total <= 1) {
    title = "the only instance of this construct";
  } else if (opts.byteless) {
    title = `instance ${k} of ${total} has no bytes in the CBOR`;
  } else {
    title = `instance ${k} of ${total}`;
  }
  if (opts.panel === "cddl") {
    title += "; all instances share this schema construct";
  } else if (opts.panel === "decoded" || opts.panel === "tree") {
    title += ` · steps in ${PANEL_NAMES[opts.panel]}`;
  }
  return { text: `${k}/${total}`, title: `${title} (${STEP_KEYS_HINT})`, canStep };
}

// ---------- the keyboard ----------

/** What a keydown listener reads of the event. */
export interface StepKeyEvent {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Alt+Period forward, Alt+Comma back, else nothing.
 * Uses `code` because macOS reports `key` for Option+. as `≥`. Ctrl is refused
 * because AltGr arrives as Ctrl+Alt on Windows and Linux.
 */
export function pinStepKey(e: StepKeyEvent): -1 | 1 | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.code === "Period") return 1;
  if (e.code === "Comma") return -1;
  return null;
}

// ---------- which panel scrolls ----------

/** Pin's current instance, or the selected diagnostic's row. */
export type RevealSubject = "pin" | "diagnostic";

/** Bring something into view: what, which panel asked, and a sequence so
 *  the same panel asking twice is two requests. Subject keeps pin and
 *  diagnostic scrolls apart. */
export interface Reveal {
  readonly target: PinTarget | "all";
  readonly seq: number;
  readonly subject: RevealSubject;
}

export function nextReveal(
  prev: Reveal | null,
  target: PinTarget | "all",
  subject: RevealSubject = "pin",
): Reveal {
  return { target, seq: (prev?.seq ?? 0) + 1, subject };
}

/** Whether a tree scrolls to the row `subject` names: only when it or every
 *  panel was asked for that subject, and only while on screen. Subject is
 *  part of the flag so a pin scroll does not steal a diagnostic reveal. */
export function scrollFlagFor(
  panel: "tree" | "decoded",
  reveal: Reveal | null,
  visible: boolean,
  subject: RevealSubject,
): boolean {
  if (!reveal || reveal.subject !== subject || !visible) return false;
  return reveal.target === panel || reveal.target === "all";
}

// ---------- the DOM pass over rendered rows ----------

/** As much of an element as marking it needs. */
export interface MarkableRow {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  classList: { add(name: string): void; remove(name: string): void };
}

const NO_ROWS: readonly MarkableRow[] = [];

/** What one pass left on the rows, for the next pass to take off. */
export interface RowMarks {
  readonly rows: readonly MarkableRow[];
  /** Deepest on-screen row above each instance that has no row of its own. */
  readonly holders: readonly MarkableRow[];
}

export const NO_MARKS: RowMarks = { rows: NO_ROWS, holders: NO_ROWS };

/** How much one missing key adds to its holder's count; one without it. */
export type HolderWeight = (key: string) => number;

/**
 * Rendered rows that stand above instances the pane has no row for.
 * `missing` is keys no row named; `weight` is what each counts for.
 */
export type HolderFinder = (
  rows: ArrayLike<MarkableRow>,
  attribute: string,
  missing: readonly string[],
  weight?: HolderWeight,
) => ReadonlyMap<MarkableRow, number>;

/** How a pass marks rows that hold off-screen instances. */
export interface HolderMarks {
  readonly className: string;
  readonly countAttribute: string;
  readonly find: HolderFinder;
  readonly weight?: HolderWeight;
  readonly format?: (count: number) => string;
}

/** Whether an attribute value has a key in `keys`; every key it has goes into `seen`. */
function attrHasKey(value: string, keys: ReadonlySet<string>, seen: Set<string> | null): boolean {
  let found = false;
  let from = 0;
  for (;;) {
    const at = value.indexOf(" ", from);
    const word = at < 0 ? (from === 0 ? value : value.slice(from)) : value.slice(from, at);
    if (keys.has(word)) {
      found = true;
      if (seen) seen.add(word);
      else return true;
    }
    if (at < 0) return found;
    from = at + 1;
  }
}

/**
 * Removes `className` from `previous` and adds it to rows whose `attribute`
 * names a key in `keys`. One read per row. With `holds`, unmatched keys are
 * counted on the row that holds them — only when some key went unmatched.
 * With no `className`, only holders are marked.
 */
export function markLinkedRows(
  previous: RowMarks,
  rows: ArrayLike<MarkableRow>,
  attribute: string,
  keys: ReadonlySet<string> | null,
  className: string | null,
  holds: HolderMarks | null = null,
): RowMarks {
  if (className !== null) {
    for (const row of previous.rows) row.classList.remove(className);
  }
  if (holds) {
    for (const row of previous.holders) {
      row.classList.remove(holds.className);
      row.removeAttribute(holds.countAttribute);
    }
  }
  if (!keys || keys.size === 0) return NO_MARKS;
  const marked: MarkableRow[] = [];
  const seen = holds ? new Set<string>() : null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const value = row.getAttribute(attribute);
    if (value !== null && attrHasKey(value, keys, seen) && className !== null) {
      row.classList.add(className);
      marked.push(row);
    }
  }
  const markedRows = className === null ? NO_ROWS : marked;
  if (!holds || !seen || seen.size === keys.size) return { rows: markedRows, holders: NO_ROWS };
  const missing: string[] = [];
  for (const key of keys) if (!seen.has(key)) missing.push(key);
  const holding: MarkableRow[] = [];
  for (const [row, count] of holds.find(rows, attribute, missing, holds.weight)) {
    row.classList.add(holds.className);
    row.setAttribute(holds.countAttribute, holds.format ? holds.format(count) : String(count));
    holding.push(row);
  }
  return { rows: markedRows, holders: holding };
}

/** Last segment of a lib-format path: `.name`, `["key"]` or `[index]`. */
const LAST_SEGMENT = /(?:\.[^.[\]]+|\["(?:[^"\\]|\\.)*"\]|\[\d+\])$/;

/** `path` less its last segment, or `null` at the root. */
export function parentPath(path: string): string | null {
  const m = LAST_SEGMENT.exec(path);
  return m && m.index > 0 ? path.slice(0, m.index) : null;
}

/**
 * Decoded-tree holders: for each missing path, the nearest ancestor path a
 * row carries. A folded run's row carries the run's last node, so a path
 * under the run finds that row on the way up.
 */
export const decodedHolders: HolderFinder = (rows, attribute, missing, weight) => {
  const byPath = new Map<string, MarkableRow>();
  for (let i = 0; i < rows.length; i++) {
    const value = rows[i].getAttribute(attribute);
    if (value !== null && !byPath.has(value)) byPath.set(value, rows[i]);
  }
  const holders = new Map<MarkableRow, number>();
  for (const path of missing) {
    for (let up = parentPath(path); up !== null; up = parentPath(up)) {
      const row = byPath.get(up);
      if (!row) continue;
      holders.set(row, (holders.get(row) ?? 0) + (weight ? weight(path) : 1));
      break;
    }
  }
  return holders;
};

/** `offset:length` read back, or `null` for anything else. */
function parseSpanAttr(word: string): [number, number] | null {
  const at = word.indexOf(":");
  if (at <= 0) return null;
  const offset = Number(word.slice(0, at));
  const length = Number(word.slice(at + 1));
  return Number.isInteger(offset) && Number.isInteger(length) ? [offset, length] : null;
}

/**
 * Structural-tree holders: for each missing span, the deepest container
 * whose extent (second `data-span` word) covers the bytes. Rows are in
 * document order, so the deepest cover is the last extent that starts at
 * or before the span and reaches past its end.
 */
export const treeHolders: HolderFinder = (rows, attribute, missing, weight) => {
  const starts: number[] = [];
  const ends: number[] = [];
  const owners: MarkableRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const value = rows[i].getAttribute(attribute);
    if (value === null) continue;
    const at = value.indexOf(" ");
    if (at < 0) continue;
    const extent = parseSpanAttr(value.slice(at + 1));
    if (!extent) continue;
    starts.push(extent[0]);
    ends.push(extent[0] + extent[1]);
    owners.push(rows[i]);
  }
  const holders = new Map<MarkableRow, number>();
  for (const key of missing) {
    const span = parseSpanAttr(key);
    if (!span) continue;
    const from = span[0];
    const to = from + span[1];
    // Last extent starting at or before `from`.
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo - 1; i >= 0; i--) {
      if (ends[i] < to) continue;
      holders.set(owners[i], (holders.get(owners[i]) ?? 0) + (weight ? weight(key) : 1));
      break;
    }
  }
  return holders;
};

/** Set the tree pane matches rows against for `positions`. */
export function treeKeys(positions: readonly CborPosition[]): ReadonlySet<string> | null {
  if (positions.length === 0) return null;
  const keys = new Set<string>();
  for (const p of positions) keys.add(spanAttr(p));
  return keys;
}

/** Set the decoded pane matches rows against for `paths`. */
export function pathKeys(paths: readonly string[]): ReadonlySet<string> | null {
  return paths.length === 0 ? null : new Set(paths);
}
