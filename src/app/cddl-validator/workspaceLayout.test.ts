import { describe, expect, test } from "bun:test";
import type { SerializedDockview } from "dockview";
import {
  ALL_PANELS,
  DEFAULT_PRESET,
  NO_MOVE_TARGET_REASON,
  PANEL_NAMES,
  PRESETS,
  STORAGE_KEY,
  STORED_VERSION,
  describeGroup,
  groupMenuModel,
  isPanelId,
  layoutSignature,
  parseLayout,
  presetById,
  presetOf,
  readStoredLayout,
  serializeLayout,
  writeStoredLayout,
  type LayoutBuilder,
  type PanelId,
  type Placement,
} from "./workspaceLayout";

type Leaf = { type: "leaf"; data: { views: string[]; activeView?: string; id: string }; size?: number };
type Branch = { type: "branch"; data: (Leaf | Branch)[]; size?: number };
const leaf = (...views: string[]): Leaf => ({ type: "leaf", data: { views, activeView: views[0], id: views.join("-") } });
const branch = (...data: (Leaf | Branch)[]): Branch => ({ type: "branch", data });
const layoutOf = (root: Leaf | Branch, panels: string[] = [...ALL_PANELS]): SerializedDockview => ({
  grid: { root, width: 1000, height: 800, orientation: "VERTICAL" as never },
  panels: Object.fromEntries(panels.map(p => [p, { id: p, contentComponent: "panel", title: p }])),
});

/** A builder that records what a preset asked for. */
function recorder(): LayoutBuilder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    add(panel: PanelId, placement?: Placement) {
      calls.push(`add ${panel}${placement ? " " + JSON.stringify(placement) : ""}`);
    },
    activate(panel: PanelId) {
      calls.push(`activate ${panel}`);
    },
  };
}

describe("panels", () => {
  test("four panels, each with a name", () => {
    expect(ALL_PANELS).toEqual(["cddl", "hex", "decoded", "tree"]);
    expect(Object.values(PANEL_NAMES)).toEqual(["CDDL schema", "CBOR hex", "Decoded JSON", "CBOR tree"]);
    expect(isPanelId("hex")).toBe(true);
    expect(isPanelId("output")).toBe(false);
    expect(isPanelId(3)).toBe(false);
  });
  test("a group is named by its panels", () => {
    expect(describeGroup(["decoded", "tree"])).toBe("Decoded JSON · CBOR tree");
    expect(describeGroup(["cddl"])).toBe("CDDL schema");
  });
});

describe("presets", () => {
  test("four, the columns first and the default", () => {
    expect(PRESETS.map(p => p.id)).toEqual(["columns", "grid", "classic", "stacked"]);
    expect(DEFAULT_PRESET).toBe("columns");
    expect(presetById("classic").name).toBe("Classic");
    expect(presetById("nope" as never)).toBe(PRESETS[0]);
  });

  test("each places every panel exactly once", () => {
    for (const p of PRESETS) {
      const b = recorder();
      p.build(b);
      const added = b.calls.filter(c => c.startsWith("add ")).map(c => c.split(" ")[1]);
      expect([...added].sort()).toEqual([...ALL_PANELS].sort());
    }
  });

  test("the grid puts each panel in its own box, two by two", () => {
    const b = recorder();
    presetById("grid").build(b);
    expect(b.calls).toEqual([
      "add cddl",
      'add hex {"referencePanel":"cddl","direction":"right"}',
      'add decoded {"direction":"below"}',
      'add tree {"referencePanel":"decoded","direction":"right"}',
    ]);
  });

  test("the classic shares one bottom group between the trees, decoded in front", () => {
    const b = recorder();
    presetById("classic").build(b);
    expect(b.calls.at(-2)).toBe('add tree {"referencePanel":"decoded","direction":"within"}');
    expect(b.calls.at(-1)).toBe("activate decoded");
  });
});

describe("layoutSignature / presetOf", () => {
  test("reads a leaf as its panels and a branch as its children", () => {
    expect(layoutSignature(layoutOf(leaf("cddl", "hex")))).toBe("cddl+hex");
    expect(layoutSignature(layoutOf(branch(leaf("cddl"), leaf("hex"))))).toBe("(cddl|hex)");
    expect(layoutSignature(layoutOf(branch(branch(leaf("cddl"), leaf("hex")), branch(leaf("decoded"), leaf("tree"))))))
      .toBe("((cddl|hex)|(decoded|tree))");
  });

  test("each preset's signature is its own", () => {
    const shapes: Record<string, Leaf | Branch> = {
      grid: branch(branch(leaf("cddl"), leaf("hex")), branch(leaf("decoded"), leaf("tree"))),
      classic: branch(branch(leaf("cddl"), leaf("hex")), leaf("decoded", "tree")),
      columns: branch(leaf("cddl"), leaf("hex"), leaf("decoded", "tree")),
      stacked: branch(leaf("cddl", "hex"), leaf("decoded", "tree")),
    };
    for (const p of PRESETS) expect(presetOf(layoutOf(shapes[p.id]))).toBe(p.id);
    expect(new Set(PRESETS.map(p => p.signature)).size).toBe(PRESETS.length);
  });

  test("the active tab, sizes and ids do not change the shape", () => {
    const l = layoutOf(branch(branch(leaf("cddl"), leaf("hex")), leaf("tree", "decoded")));
    expect(presetOf(l)).toBeNull();
    const m = layoutOf(branch(branch(leaf("cddl"), leaf("hex")), leaf("decoded", "tree")));
    (m.grid.root as Branch).data[1].size = 999;
    ((m.grid.root as Branch).data[1] as Leaf).data.activeView = "tree";
    expect(presetOf(m)).toBe("classic");
  });

  test("a shape that is no preset is nobody's", () => {
    expect(presetOf(layoutOf(branch(leaf("cddl"), branch(leaf("hex"), leaf("decoded")), leaf("tree"))))).toBeNull();
  });
});

describe("serialisation", () => {
  const grid = layoutOf(branch(branch(leaf("cddl"), leaf("hex")), branch(leaf("decoded"), leaf("tree"))));

  test("round-trips under the current version", () => {
    const text = serializeLayout(grid);
    expect(JSON.parse(text).v).toBe(STORED_VERSION);
    expect(parseLayout(text)).toEqual(grid);
  });

  test("rejects what is not a record of this version", () => {
    expect(parseLayout("")).toBeNull();
    expect(parseLayout("not json")).toBeNull();
    expect(parseLayout("[]")).toBeNull();
    expect(parseLayout("null")).toBeNull();
    expect(parseLayout(JSON.stringify({ v: STORED_VERSION - 1, layout: grid }))).toBeNull();
    expect(parseLayout(JSON.stringify({ v: STORED_VERSION }))).toBeNull();
    expect(parseLayout(JSON.stringify({ v: STORED_VERSION, layout: 4 }))).toBeNull();
    expect(parseLayout(JSON.stringify({ v: STORED_VERSION, layout: { panels: grid.panels } }))).toBeNull();
    expect(parseLayout(JSON.stringify({ v: STORED_VERSION, layout: { grid: grid.grid } }))).toBeNull();
  });

  test("rejects a panel table that is not the four panels", () => {
    const missing = layoutOf(branch(leaf("cddl"), leaf("hex"), leaf("decoded")), ["cddl", "hex", "decoded"]);
    expect(parseLayout(serializeLayout(missing))).toBeNull();
    const extra = layoutOf(grid.grid.root as Branch, [...ALL_PANELS, "other"]);
    expect(parseLayout(serializeLayout(extra))).toBeNull();
    const renamed = layoutOf(grid.grid.root as Branch, ["cddl", "hex", "decoded", "trees"]);
    expect(parseLayout(serializeLayout(renamed))).toBeNull();
  });

  test("rejects floating and popped-out groups", () => {
    expect(parseLayout(serializeLayout({ ...grid, floatingGroups: [{} as never] }))).toBeNull();
    expect(parseLayout(serializeLayout({ ...grid, popoutGroups: [{} as never] }))).toBeNull();
    expect(parseLayout(serializeLayout({ ...grid, floatingGroups: [] }))).toEqual({ ...grid, floatingGroups: [] });
  });

  test("storage: a good record is read, anything else is nothing, and writes go under the key", () => {
    const fake = (value: string | null) => {
      const store: Record<string, string> = value === null ? {} : { [STORAGE_KEY]: value };
      return {
        store,
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
      };
    };
    expect(readStoredLayout(fake(serializeLayout(grid)))).toEqual(grid);
    expect(readStoredLayout(fake("garbage"))).toBeNull();
    expect(readStoredLayout(fake(null))).toBeNull();
    expect(readStoredLayout(null)).toBeNull();
    const hostile = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    expect(readStoredLayout(hostile)).toBeNull();
    expect(() => writeStoredLayout(hostile, grid)).not.toThrow();
    const s = fake(null);
    writeStoredLayout(s, grid);
    expect(s.store[STORAGE_KEY]).toBe(serializeLayout(grid));
  });
});

describe("groupMenuModel", () => {
  const groups = [
    { id: "a", panels: ["cddl"] as PanelId[] },
    { id: "b", panels: ["hex"] as PanelId[] },
    { id: "c", panels: ["decoded", "tree"] as PanelId[] },
  ];

  test("for a panel sharing a group", () => {
    const m = groupMenuModel("decoded", groups, "classic", false);
    expect(m.panelName).toBe("Decoded JSON");
    expect(m.moveTargets).toEqual([{ groupId: "a", name: "CDDL schema" }, { groupId: "b", name: "CBOR hex" }]);
    expect(m.splitRight).toEqual({ enabled: true, reason: null });
    expect(m.splitBelow).toEqual({ enabled: true, reason: null });
    expect(m.maximized).toBe(false);
    expect(m.presets.map(p => `${p.id}${p.current ? "*" : ""}`)).toEqual(["columns", "grid", "classic*", "stacked"]);
    expect(m.reset).toEqual({ enabled: true, reason: null });
  });

  test("for a panel alone in its group", () => {
    const m = groupMenuModel("cddl", groups, null, true);
    expect(m.moveTargets).toEqual([{ groupId: "b", name: "CBOR hex" }, { groupId: "c", name: "Decoded JSON · CBOR tree" }]);
    expect(m.splitRight).toEqual({ enabled: false, reason: "This panel is already alone in its group" });
    expect(m.maximized).toBe(true);
    expect(m.presets.every(p => !p.current)).toBe(true);
  });

  test("in the default layout the reset has nothing to do", () => {
    const m = groupMenuModel("hex", groups, DEFAULT_PRESET, false);
    expect(m.reset).toEqual({ enabled: false, reason: "This is already the default layout" });
  });

  test("with every panel in one group there is nowhere to move", () => {
    const m = groupMenuModel("tree", [{ id: "a", panels: [...ALL_PANELS] }], null, false);
    expect(m.moveTargets).toEqual([]);
    expect(NO_MOVE_TARGET_REASON).toContain("split one out");
  });
});
