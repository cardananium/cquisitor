import { describe, expect, test } from "bun:test";
import { depthBelowMap, flattenTree, rowKeys, type FlatRow, type FlatTreeAdapter } from "./flatten";

/** Plain JSON values: arrays and objects are containers, keys are steps. */
const json: FlatTreeAdapter<unknown> = {
  childrenOf(node) {
    if (Array.isArray(node)) return node.map((v, i) => ({ key: i, node: v, isArrayItem: true }));
    if (node && typeof node === "object") {
      return Object.entries(node as Record<string, unknown>).map(([k, v]) => ({
        key: k, node: v, isArrayItem: false,
      }));
    }
    return [];
  },
  isContainer: (node) => !!node && typeof node === "object",
  childPath: (parent, child) => `${parent}/${child.key}`,
  stepOf: (child) => String(child.key),
};

type Row = FlatRow<unknown>;

const shape = (rows: Row[]) =>
  rows.map((r) => `${" ".repeat(r.depth)}${r.kind}:${r.key ?? "root"}${r.fold ? `×${r.fold.levels}` : ""}`);

function flatten(
  data: unknown,
  opts: Partial<Parameters<typeof flattenTree>[1]> & { expanded?: number; closed?: string[] } = {},
) {
  const closed = new Set(opts.closed ?? []);
  const expanded = opts.expanded ?? 3;
  return flattenTree(data, {
    adapter: json,
    rootPath: "$",
    isOpen: ({ path, depth, onHighlightRoute, chainOpen }) =>
      !closed.has(path) && (chainOpen || onHighlightRoute || depth < expanded),
    ...opts,
  });
}

describe("flattenTree", () => {
  test("lists the rows an open tree shows, in document order, with their depth", () => {
    const { rows, truncated } = flatten({ a: 1, b: [2, { c: 3 }] });
    expect(truncated).toBe(false);
    expect(shape(rows)).toEqual([
      "open:root", " leaf:a", " open:b", "  leaf:0", "  open:1", "   leaf:c",
    ]);
    expect(rows.map((r) => r.path)).toEqual(["$", "$/a", "$/b", "$/b/0", "$/b/1", "$/b/1/c"]);
    expect(rows[3].isArrayItem).toBe(true);
    expect(rows[2].childCount).toBe(2);
  });

  test("a closed container is one row with its child count, and nothing below it", () => {
    const { rows } = flatten({ a: { b: { c: 1 } } }, { expanded: 1 });
    expect(shape(rows)).toEqual(["open:root", " closed:a"]);
    expect(rows[1].childCount).toBe(1);
  });

  test("closing rows follow an open container's children at the container's depth", () => {
    const { rows } = flatten({ a: [1] }, { closingRows: true });
    expect(shape(rows)).toEqual([
      "open:root", " open:a", "  leaf:0", " closing:a", "closing:root",
    ]);
  });

  test("skipRoot shows the root's children at depth 0 and no row for the root", () => {
    const { rows } = flatten({ a: 1, b: 2 }, { skipRoot: true, closingRows: true });
    expect(shape(rows)).toEqual(["leaf:a", "leaf:b"]);
  });

  test("an empty container is a container, not a leaf", () => {
    const { rows } = flatten({ a: [], b: {} });
    expect(rows.slice(1).map((r) => r.kind)).toEqual(["open", "open"]);
    expect(rows[1].childCount).toBe(0);
  });

  test("a highlighted node is found by its route, and the way to it is open", () => {
    const data = { a: { b: { c: { d: 1 } } }, e: 2 };
    const { rows } = flatten(data, { expanded: 0, highlightRoutes: [["a", "b", "c"]] });
    expect(shape(rows)).toEqual(["open:root", " open:a", "  open:b", "   closed:c", " leaf:e"]);
    expect(rows.map((r) => r.isHighlighted)).toEqual([false, false, false, true, false]);
    expect(rows.map((r) => r.onHighlightRoute)).toEqual([true, true, true, false, false]);
  });

  test("a highlighted leaf is highlighted too, and a route to nothing opens nothing", () => {
    const { rows } = flatten({ a: [1, 2] }, { expanded: 0, highlightRoutes: [["a", "1"], ["zz", "y"]] });
    expect(shape(rows)).toEqual(["open:root", " open:a", "  leaf:0", "  leaf:1"]);
    expect(rows[3].isHighlighted).toBe(true);
  });

  test("a route past unmarkedRoutesFrom opens the way and keeps the row, but does not highlight it", () => {
    const data = { a: { b: { c: 1 } }, d: { e: { f: 2 } } };
    const { rows } = flatten(data, {
      expanded: 0, highlightRoutes: [["a", "b", "c"], ["d", "e", "f"]], unmarkedRoutesFrom: 1,
    });
    expect(shape(rows)).toEqual([
      "open:root", " open:a", "  open:b", "   leaf:c", " open:d", "  open:e", "   leaf:f",
    ]);
    expect(rows.map((r) => r.isHighlighted)).toEqual([false, false, false, true, false, false, false]);
    expect(rows.map((r) => r.onHighlightRoute)).toEqual([true, true, true, false, true, true, false]);
  });

  test("an unmarked route's container is a row of its own, unhighlighted", () => {
    const { rows } = flatten({ a: { b: 1 } }, { expanded: 0, highlightRoutes: [["a"]], unmarkedRoutesFrom: 0 });
    expect(shape(rows)).toEqual(["open:root", " closed:a"]);
    expect(rows[1].isHighlighted).toBe(false);
    expect(rows[1].onHighlightRoute).toBe(false);
  });

  test("the row budget stops the walk and says so", () => {
    const { rows, truncated } = flatten({ a: [1, 2, 3, 4, 5] }, { limit: 4 });
    expect(rows.length).toBe(4);
    expect(truncated).toBe(true);
    expect(flatten({ a: [1, 2, 3, 4, 5] }, { limit: 7 }).truncated).toBe(false);
  });
});

describe("chain folding", () => {
  const chain = (levels: number, leaf: unknown = 5) => {
    let node: unknown = leaf;
    for (let i = 0; i < levels; i++) node = { a: node };
    return node;
  };

  test("a run of single-child containers is one row standing for its last node", () => {
    const { rows } = flatten(chain(6), { foldChainsFrom: 3, opensChain: true, closingRows: true });
    expect(shape(rows)).toEqual(["open:a×6", " leaf:a", "closing:a×6"]);
    const fold = rows[0];
    expect(fold.fold?.keys).toEqual(["", "a", "a", "a", "a", "a"]);
    expect(fold.path).toBe("$/a/a/a/a/a");
    expect(fold.foldStartPath).toBe("$");
    expect(fold.dataDepth).toBe(5);
    expect(fold.depth).toBe(0);
    expect(rows[1].depth).toBe(1);
    expect(rows[1].dataDepth).toBe(6);
  });

  test("a run shorter than the threshold is shown level by level", () => {
    const { rows } = flatten(chain(2), { foldChainsFrom: 4, opensChain: true });
    expect(shape(rows)).toEqual(["open:root", " open:a", "  leaf:a"]);
  });

  test("opening a chain opens it to the end without a click per level", () => {
    // Only the root is open by depth; the rest of the run is open because the root's single child inherits its open state.
    const { rows } = flatten(chain(50), { expanded: 1, foldChainsFrom: 3, opensChain: true });
    expect(shape(rows)).toEqual(["open:a×50", " leaf:a"]);
  });

  test("without opensChain the run ends at the first closed level, which is the row", () => {
    const { rows } = flatten(chain(50), { expanded: 2, foldChainsFrom: 2 });
    expect(shape(rows)).toEqual(["closed:a×3"]);
    expect(rows[0].path).toBe("$/a/a");
    expect(rows[0].childCount).toBe(1);
    expect(rows[0].kind).toBe("closed");
  });

  test("a closed node inside the run ends the row there", () => {
    const { rows } = flatten(chain(6), { foldChainsFrom: 2, opensChain: true, closed: ["$/a/a"] });
    expect(shape(rows)).toEqual(["closed:a×3"]);
    expect(rows[0].path).toBe("$/a/a");
  });

  test("a highlighted node breaks the run and keeps its own row", () => {
    const { rows } = flatten(chain(6), {
      foldChainsFrom: 2, opensChain: true, highlightRoutes: [["a", "a", "a"]],
    });
    expect(shape(rows)).toEqual(["open:a×3", " open:a", "  open:a×2", "   leaf:a"]);
    expect(rows[1].isHighlighted).toBe(true);
    expect(rows[1].path).toBe("$/a/a/a");
    expect(rows[0].onHighlightRoute).toBe(true);
    expect(rows[2].path).toBe("$/a/a/a/a/a");
  });

  test("an unmarked route breaks the run too, so the node it names has a row to mark", () => {
    const { rows } = flatten(chain(6), {
      foldChainsFrom: 2, opensChain: true, highlightRoutes: [["a", "a", "a"]], unmarkedRoutesFrom: 0,
    });
    expect(shape(rows)).toEqual(["open:a×3", " open:a", "  open:a×2", "   leaf:a"]);
    expect(rows[1].path).toBe("$/a/a/a");
    expect(rows.some((r) => r.isHighlighted)).toBe(false);
  });

  test("a branch ends the run; the branching node is the row", () => {
    const data = { a: { b: { c: { x: 1, y: 2 } } } };
    const { rows } = flatten(data, { foldChainsFrom: 2, opensChain: true });
    expect(shape(rows)).toEqual(["open:c×4", " leaf:x", " leaf:y"]);
  });

  test("a run a hundred thousand levels deep is walked without a frame per level", () => {
    const depth = 100_000;
    const { rows } = flatten(chain(depth), { foldChainsFrom: 3, opensChain: true });
    expect(shape(rows)).toEqual([`open:a×${depth}`, " leaf:a"]);
    expect(rows[0].path.length).toBe(1 + 2 * (depth - 1));
  });
});

describe("depthBelowMap", () => {
  test("counts the levels below every container, leaves as one", () => {
    const data = { a: { b: [1] }, c: 2, d: [] };
    const map = depthBelowMap(data, json);
    expect(map.get(data)).toBe(3);
    expect(map.get(data.a)).toBe(2);
    expect(map.get(data.a.b)).toBe(1);
    expect(map.get(data.d)).toBe(0);
  });

  test("reaches the rows as depthBelow", () => {
    const data = { a: { b: { c: 1 } } };
    const { rows } = flatten(data, { expanded: 1, depthBelow: depthBelowMap(data, json) });
    expect(rows.map((r) => r.depthBelow)).toEqual([3, 2]);
  });

  test("a hundred thousand levels are measured without a frame per level", () => {
    let node: unknown = 0;
    for (let i = 0; i < 100_000; i++) node = [node];
    expect(depthBelowMap(node, json).get(node as object)).toBe(100_000);
  });
});

describe("rowKeys", () => {
  test("a row's key is its path, made distinct from every other row at that path", () => {
    expect(rowKeys(["$", "$.a", "$.a", "$.b", "$.a"])).toEqual(["0:$", "0:$.a", "1:$.a", "0:$.b", "2:$.a"]);
  });

  test("keys are unique whatever the paths spell, since every key carries its ordinal", () => {
    // A path that happens to spell what another's key would spell.
    const keys = rowKeys(["a", "a", "1:a", "0:a"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("two wire-order entries of one key are two rows at one path, keyed apart", () => {
    // Map in `@entries` form; children listed by key the way the JSON tree lists them.
    const entries: FlatTreeAdapter<unknown> = {
      ...json,
      childrenOf(node) {
        const wire = node && typeof node === "object" && !Array.isArray(node)
          ? (node as { "@entries"?: { key: number; value: unknown }[] })["@entries"]
          : undefined;
        if (Array.isArray(wire)) return wire.map((e) => ({ key: e.key, node: e.value, isArrayItem: false }));
        return json.childrenOf(node);
      },
    };
    const doc = { "@entries": [{ key: 1, value: "a" }, { key: 1, value: "b" }] };
    const { rows } = flattenTree(doc, { adapter: entries, rootPath: "$", isOpen: () => true });
    expect(rows.map((r) => r.path)).toEqual(["$", "$/1", "$/1"]);
    expect(rows.map((r) => r.node)).toEqual([doc, "a", "b"]);
    const keys = rowKeys(rows.map((r) => r.path));
    expect(new Set(keys).size).toBe(rows.length);
  });
});
