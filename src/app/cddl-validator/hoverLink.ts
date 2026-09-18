// Hover link: one store per validator, written by the panel under the pointer.
// Resolve only when probe primitives change; notify only when paint would change.
// A new bridge, schema, or document drops the link. Tree rows light their own
// bytes even without a map; other panels need the map. No React here.

import type { CborCddlMapEntry, CborPosition } from "@cardananium/cquisitor-lib";
import type { CborCddlBridge, CborCddlNode, EntryRole } from "./cborCddlBridge";
import type { OverlayMark } from "./cddlOverlay";
import {
  EMPTY_INSTANCE_SET,
  EMPTY_PATHS,
  instanceCountLabel,
  instanceSetFor,
  projectInstances,
  type InstanceSet,
} from "./instances";
import {
  PRIORITY_LINKED,
  projectNode,
  resolveProbe,
  type HoverProbe,
  type NodeProjection,
  type PinTarget,
} from "./pinResolvers";

export type { HoverProbe };

export type HoverSource = PinTarget;

/** Node projection plus lit instances as each data panel addresses them.
 *  Schema links put every instance of the construct in the arrays. */
export interface LinkProjection extends NodeProjection {
  readonly hexAll: readonly CborPosition[];
  readonly treeAll: readonly CborPosition[];
  readonly decodedAll: readonly string[];
}

/** What every panel paints while the pointer rests on a linked position. */
export interface HoverLink {
  readonly source: HoverSource;
  /** Same object a pin of this position would hold; `null` for a tree row the map does not cover. */
  readonly node: CborCddlNode | null;
  /** Schema text `projection.cddl` is a range in — the text on screen when the link was made. */
  readonly cddlSource: string;
  readonly projection: LinkProjection;
  /** Construct's whole group — the bridge's own array, never a copy. */
  readonly instances: readonly CborCddlMapEntry[];
  /** Index of the probed run; `-1` for a schema link, which names the construct. */
  readonly instanceIndex: number;
}

export interface HoverLinkStore {
  /** Bridge, schema text, and document later probes resolve against. Any of the three changing drops the link and the probe. */
  setContext(bridge: CborCddlBridge, cddlSource: string, document?: string): void;
  hoverHex(byteOffset: number): void;
  hoverTree(position: CborPosition): void;
  hoverCddl(charOffset: number): void;
  hoverDecoded(path: string, role: EntryRole): void;
  /** Pointer left `source`. A leave from a panel that is not holding the pointer changes nothing. */
  leave(source: HoverSource): void;
  get(): HoverLink | null;
  subscribe(listener: () => void): () => void;
}

export type ProbeResolver = (bridge: CborCddlBridge, probe: HoverProbe) => CborCddlNode | null;

/**
 * Tree row as the panels paint it: hex and tree light the row's own position;
 * schema and decoded show what the map found for its first byte, or nothing.
 */
export function projectTreeRow(
  node: CborCddlNode | null,
  position: CborPosition,
  set: InstanceSet = EMPTY_INSTANCE_SET,
): LinkProjection {
  const mapped = node ? projectNode(node) : null;
  const own = [position];
  return {
    cddl: mapped?.cddl ?? null,
    hex: position,
    tree: position,
    decoded: mapped?.decoded ?? null,
    label: mapped ? instanceCountLabel(mapped.label, set) : "",
    hexAll: own,
    treeAll: own,
    decodedAll: mapped?.decoded ? [mapped.decoded] : EMPTY_PATHS,
  };
}

/** Node as the panels paint it for a probe that lit `set`. */
export function projectLink(bridge: CborCddlBridge, node: CborCddlNode, set: InstanceSet): LinkProjection {
  const own = projectNode(node);
  const all = projectInstances(bridge, set.lit);
  return {
    ...own,
    label: instanceCountLabel(own.label, set, all.truncated),
    hexAll: all.hexAll,
    treeAll: all.treeAll,
    decodedAll: all.decodedAll,
  };
}

export function createHoverLinkStore(resolve: ProbeResolver = resolveProbe): HoverLinkStore {
  let bridge: CborCddlBridge | null = null;
  let cddlSource = "";
  let hexDocument = "";
  // Last probe primitives: compared before anything is allocated.
  let lastSource: HoverSource | null = null;
  let lastA: number | string = -1;
  let lastB: number | string = -1;
  let link: HoverLink | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const clear = () => {
    if (link === null) return;
    link = null;
    notify();
  };

  const settle = (source: HoverSource, probe: HoverProbe) => {
    const node = bridge ? resolve(bridge, probe) : null;
    if (probe.source === "tree") {
      // The row's own bytes, whatever the map found: a container whose key
      // the map skipped still lights that key, not the wrapper it was filed under.
      const set = bridge ? instanceSetFor(bridge, node, source) : EMPTY_INSTANCE_SET;
      link = {
        source,
        node,
        cddlSource,
        projection: projectTreeRow(node, probe.position, set),
        instances: set.instances,
        instanceIndex: set.index,
      };
      notify();
      return;
    }
    if (!node || !bridge) {
      clear();
      return;
    }
    // Same row from the same panel paints the same thing everywhere.
    if (link && link.source === source && link.node?.entry === node.entry) return;
    const set = instanceSetFor(bridge, node, source);
    link = {
      source,
      node,
      cddlSource,
      projection: projectLink(bridge, node, set),
      instances: set.instances,
      instanceIndex: set.index,
    };
    notify();
  };

  const forget = () => {
    lastSource = null;
    lastA = -1;
    lastB = -1;
  };

  return {
    setContext(nextBridge, nextCddl, nextDocument = "") {
      if (nextBridge === bridge && nextCddl === cddlSource && nextDocument === hexDocument) return;
      bridge = nextBridge;
      cddlSource = nextCddl;
      hexDocument = nextDocument;
      forget();
      clear();
    },
    hoverHex(byteOffset) {
      if (lastSource === "hex" && lastA === byteOffset) return;
      lastSource = "hex";
      lastA = byteOffset;
      lastB = -1;
      settle("hex", { source: "hex", byteOffset });
    },
    hoverTree(position) {
      if (lastSource === "tree" && lastA === position.offset && lastB === position.length) return;
      lastSource = "tree";
      lastA = position.offset;
      lastB = position.length;
      settle("tree", { source: "tree", position });
    },
    hoverCddl(charOffset) {
      if (lastSource === "cddl" && lastA === charOffset) return;
      lastSource = "cddl";
      lastA = charOffset;
      lastB = -1;
      settle("cddl", { source: "cddl", charOffset });
    },
    hoverDecoded(path, role) {
      if (lastSource === "decoded" && lastA === path && lastB === role) return;
      lastSource = "decoded";
      lastA = path;
      lastB = role;
      settle("decoded", { source: "decoded", path, role });
    },
    leave(source) {
      if (lastSource !== source) return;
      forget();
      clear();
    },
    get: () => link,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Hover link as the schema editor paints it, at hover priority so pin, error
 * and mismatch still show through. Nothing unless the link's offsets are in
 * the text the editor is showing. The editor's own echo carries no message.
 */
export function hoverEditorMark(link: HoverLink | null, value: string): OverlayMark | null {
  if (!link || link.cddlSource !== value) return null;
  const range = link.projection.cddl;
  if (!range) return null;
  return {
    range,
    className: "cddl-editor-linked-mark",
    message: link.source === "cddl" ? null : link.projection.label,
    priority: PRIORITY_LINKED,
  };
}
