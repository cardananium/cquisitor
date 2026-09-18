// Panel names, layout presets, localStorage persistence, and the group menu model.
// The docking component owns the live layout; this module builds, stores, and reads it.

import type { DockviewApi, SerializedDockview, SerializedGridObject } from "dockview";

export type PanelId = "cddl" | "hex" | "decoded" | "tree";

export const ALL_PANELS: readonly PanelId[] = ["cddl", "hex", "decoded", "tree"];

export function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && (ALL_PANELS as readonly string[]).includes(value);
}

/** Display name for each panel. */
export const PANEL_NAMES: Readonly<Record<PanelId, string>> = {
  cddl: "CDDL schema",
  hex: "CBOR hex",
  decoded: "Decoded JSON",
  tree: "CBOR tree",
};

/** Component id every panel is rendered with. */
export const PANEL_COMPONENT = "panel";

/** Group label: panel names joined with ·. */
export function describeGroup(panels: readonly PanelId[]): string {
  return panels.map(p => PANEL_NAMES[p]).join(" · ");
}

// ---------------------------------------------------------------------------
// Presets

export type PresetId = "grid" | "classic" | "columns" | "stacked";

/** Where a panel goes: beside another, or against an edge of the whole. */
export type Placement =
  | { referencePanel: PanelId; direction: "left" | "right" | "above" | "below" | "within" }
  | { direction: "left" | "right" | "above" | "below" };

/** Docking API subset a preset uses, so tests can pass a recorder. */
export interface LayoutBuilder {
  add(panel: PanelId, placement?: Placement): void;
  /** Make `panel` its group's active tab. */
  activate(panel: PanelId): void;
}

export interface Preset {
  id: PresetId;
  name: string;
  /** How the arrangement reads once built — see `layoutSignature`. */
  signature: string;
  build(b: LayoutBuilder): void;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "columns",
    name: "Columns",
    signature: "(cddl|hex|decoded+tree)",
    build(b) {
      b.add("cddl");
      b.add("hex", { direction: "right" });
      b.add("decoded", { direction: "right" });
      b.add("tree", { referencePanel: "decoded", direction: "within" });
      b.activate("decoded");
    },
  },
  {
    id: "grid",
    name: "Grid",
    signature: "((cddl|hex)|(decoded|tree))",
    build(b) {
      b.add("cddl");
      b.add("hex", { referencePanel: "cddl", direction: "right" });
      b.add("decoded", { direction: "below" });
      b.add("tree", { referencePanel: "decoded", direction: "right" });
    },
  },
  {
    id: "classic",
    name: "Classic",
    signature: "((cddl|hex)|decoded+tree)",
    build(b) {
      b.add("cddl");
      b.add("hex", { referencePanel: "cddl", direction: "right" });
      b.add("decoded", { direction: "below" });
      b.add("tree", { referencePanel: "decoded", direction: "within" });
      b.activate("decoded");
    },
  },
  {
    id: "stacked",
    name: "Stacked",
    signature: "(cddl+hex|decoded+tree)",
    build(b) {
      b.add("cddl");
      b.add("hex", { referencePanel: "cddl", direction: "within" });
      b.add("decoded", { direction: "below" });
      b.add("tree", { referencePanel: "decoded", direction: "within" });
      b.activate("cddl");
      b.activate("decoded");
    },
  },
];

/** Default layout: schema, hex, and the two trees in three columns. Reset restores this. */
export const DEFAULT_PRESET: PresetId = "columns";

export function presetById(id: PresetId): Preset {
  return PRESETS.find(p => p.id === id) ?? PRESETS[0];
}

/** Builder over the docking API. Titles match the tabs so the overflow list and screen readers use the same names. */
export function apiBuilder(api: DockviewApi): LayoutBuilder {
  return {
    add(panel, placement) {
      api.addPanel({ id: panel, component: PANEL_COMPONENT, title: PANEL_NAMES[panel], position: placement });
    },
    activate(panel) {
      api.getPanel(panel)?.api.setActive();
    },
  };
}

/** Empty the layout and build `preset` in it. */
export function applyPreset(api: DockviewApi, id: PresetId): void {
  api.clear();
  presetById(id).build(apiBuilder(api));
}

// ---------------------------------------------------------------------------
// Readings of a serialised layout

type GridNode = SerializedGridObject<{ views: string[] }>;

/**
 * Layout shape as one string: leaf panels joined by `+`, children by `|` in parentheses.
 * Sizes, ids, and the active tab are omitted, so a resized or retabbed preset still matches.
 */
export function layoutSignature(layout: SerializedDockview): string {
  const walk = (node: GridNode): string => {
    if (node.type === "leaf") return (node.data as { views: string[] }).views.join("+");
    return `(${(node.data as GridNode[]).map(walk).join("|")})`;
  };
  return walk(layout.grid.root as GridNode);
}

/** Preset matching this layout's shape, if any. */
export function presetOf(layout: SerializedDockview): PresetId | null {
  const signature = layoutSignature(layout);
  return PRESETS.find(p => p.signature === signature)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Persistence

export const STORAGE_KEY = "cquisitor_cddl_layout";

/** Stored-form version. Bump when the shape or default changes so older records fall back to the default. */
export const STORED_VERSION = 4;

/** The `Storage` methods the layout needs, so tests can pass a fake. */
export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function serializeLayout(layout: SerializedDockview): string {
  return JSON.stringify({ v: STORED_VERSION, layout });
}

/**
 * Layout from a stored record, or `null` if the version, grid, or exact four-panel table is wrong.
 * Records with floating or popout groups are also rejected.
 */
export function parseLayout(text: string): SerializedDockview | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as { v?: unknown; layout?: unknown };
  if (record.v !== STORED_VERSION) return null;
  const layout = record.layout;
  if (typeof layout !== "object" || layout === null) return null;
  const l = layout as Partial<SerializedDockview>;
  if (typeof l.grid !== "object" || l.grid === null || typeof l.grid.root !== "object") return null;
  if (typeof l.panels !== "object" || l.panels === null) return null;
  const panels = Object.keys(l.panels);
  if (panels.length !== ALL_PANELS.length || !ALL_PANELS.every(p => panels.includes(p))) return null;
  if (l.floatingGroups && l.floatingGroups.length > 0) return null;
  if (l.popoutGroups && l.popoutGroups.length > 0) return null;
  return layout as SerializedDockview;
}

export function readStoredLayout(storage: LayoutStorage | null | undefined): SerializedDockview | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? null : parseLayout(raw);
  } catch {
    return null;
  }
}

export function writeStoredLayout(storage: LayoutStorage | null | undefined, layout: SerializedDockview): void {
  try {
    storage?.setItem(STORAGE_KEY, serializeLayout(layout));
  } catch {
    // Private mode or quota: lose the saved arrangement only.
  }
}

export function browserStorage(): LayoutStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The group menu's model

export interface MenuItemState {
  enabled: boolean;
  /** The title shown when disabled. */
  reason: string | null;
}

export interface GroupMenuModel {
  panel: PanelId;
  panelName: string;
  /** Every other group, named by the panels it holds. */
  moveTargets: { groupId: string; name: string }[];
  splitRight: MenuItemState;
  splitBelow: MenuItemState;
  maximized: boolean;
  presets: { id: PresetId; name: string; current: boolean }[];
  reset: MenuItemState;
}

export const NO_MOVE_TARGET_REASON = "Every panel is in this group — split one out first";

const ENABLED: MenuItemState = { enabled: true, reason: null };
const disabled = (reason: string): MenuItemState => ({ enabled: false, reason });

/** Offers for the group holding `panel`, given the other groups, current preset, and whether it is maximized. */
export function groupMenuModel(
  panel: PanelId,
  groups: readonly { id: string; panels: readonly PanelId[] }[],
  current: PresetId | null,
  maximized: boolean,
): GroupMenuModel {
  const own = groups.find(g => g.panels.includes(panel));
  const alone = (own?.panels.length ?? 1) === 1;
  const split = alone ? disabled("This panel is already alone in its group") : ENABLED;
  return {
    panel,
    panelName: PANEL_NAMES[panel],
    moveTargets: groups
      .filter(g => g !== own)
      .map(g => ({ groupId: g.id, name: describeGroup(g.panels) })),
    splitRight: split,
    splitBelow: split,
    maximized,
    presets: PRESETS.map(p => ({ id: p.id, name: p.name, current: current === p.id })),
    reset: current === DEFAULT_PRESET ? disabled("This is already the default layout") : ENABLED,
  };
}
