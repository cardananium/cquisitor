import { describe, expect, test } from "bun:test";
import {
  DIM_CLASS,
  SPOTLIGHT_STORAGE_KEY,
  createSpotlightStore,
  litRows,
  markOrDimClass,
  overlapsAny,
  readSpotlightEnabled,
  spotlightActive,
  txPathRelation,
  writeSpotlightEnabled,
  type PreferenceStorage,
  type SpotlightRow,
} from "./spotlight";

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: PreferenceStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
};

describe("the dimming preference", () => {
  test("on until turned off, and on when storage is missing or unreadable", () => {
    expect(readSpotlightEnabled(memoryStorage())).toBe(true);
    expect(readSpotlightEnabled(null)).toBe(true);
    expect(readSpotlightEnabled(throwingStorage)).toBe(true);
    expect(readSpotlightEnabled(memoryStorage({ [SPOTLIGHT_STORAGE_KEY]: "false" }))).toBe(false);
    expect(readSpotlightEnabled(memoryStorage({ [SPOTLIGHT_STORAGE_KEY]: "true" }))).toBe(true);
  });

  test("written under its own key; a storage that throws loses only the write", () => {
    const storage = memoryStorage();
    writeSpotlightEnabled(storage, false);
    expect(storage.data).toEqual({ cquisitor_ann_dim: "false" });
    writeSpotlightEnabled(storage, true);
    expect(storage.data).toEqual({ cquisitor_ann_dim: "true" });
    expect(() => writeSpotlightEnabled(throwingStorage, false)).not.toThrow();
    expect(() => writeSpotlightEnabled(null, false)).not.toThrow();
  });

  test("the store reads storage once, keeps the choice, and tells subscribers", () => {
    const storage = memoryStorage({ [SPOTLIGHT_STORAGE_KEY]: "false" });
    let reads = 0;
    const store = createSpotlightStore(() => {
      reads++;
      return storage;
    });
    expect(reads).toBe(0);
    expect(store.enabled()).toBe(false);
    expect(store.enabled()).toBe(false);
    expect(reads).toBe(1);

    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.setEnabled(true);
    expect(store.enabled()).toBe(true);
    expect(storage.data[SPOTLIGHT_STORAGE_KEY]).toBe("true");
    expect(calls).toBe(1);
    store.setEnabled(true);
    expect(calls).toBe(1);
    unsubscribe();
    store.setEnabled(false);
    expect(calls).toBe(1);
    expect(storage.data[SPOTLIGHT_STORAGE_KEY]).toBe("false");

    // A fresh page reads what was kept.
    expect(createSpotlightStore(() => storage).enabled()).toBe(false);
  });

  test("a store whose storage throws still toggles for the page", () => {
    const store = createSpotlightStore(() => throwingStorage);
    expect(store.enabled()).toBe(true);
    store.setEnabled(false);
    expect(store.enabled()).toBe(false);
  });
});

describe("spotlightActive", () => {
  test("a view dims only with dimming on and a resolved target in it", () => {
    expect(spotlightActive(true, 1)).toBe(true);
    expect(spotlightActive(true, 0)).toBe(false);
    expect(spotlightActive(false, 3)).toBe(false);
  });
});

describe("txPathRelation", () => {
  const targets = ["transaction.body.outputs.0", "transaction.body.fee"];

  test("the target itself, a part of it, and an element holding it", () => {
    expect(txPathRelation("transaction.body.outputs.0", targets)).toBe("target");
    expect(txPathRelation("transaction.body.outputs.0.amount", targets)).toBe("inside");
    expect(txPathRelation("transaction.body.outputs", targets)).toBe("holder");
    expect(txPathRelation("transaction.body", targets)).toBe("holder");
  });

  test("siblings and look-alike prefixes are unrelated", () => {
    expect(txPathRelation("transaction.body.outputs.1", targets)).toBe("none");
    expect(txPathRelation("transaction.body.inputs.0", targets)).toBe("none");
    expect(txPathRelation("transaction.body.outputs.01", targets)).toBe("none");
    expect(txPathRelation("transaction.body.fe", targets)).toBe("none");
    expect(txPathRelation("transaction.witness_set", targets)).toBe("none");
    expect(txPathRelation("transaction.body.outputs.0", [])).toBe("none");
  });

  test("inside one target wins over holding another", () => {
    expect(txPathRelation("transaction.body.outputs", ["transaction.body", "transaction.body.outputs.3"])).toBe("inside");
  });
});

/** Rows in walk order, from `[depth, kind, path]`. */
function rows(spec: Array<[number, SpotlightRow["kind"], string]>): SpotlightRow[] {
  return spec.map(([depth, kind, path]) => ({ depth, kind, path }));
}

// {
//   a: { x: 1, y: [2] },
//   b: 3,
// }
const TREE = rows([
  [0, "open", "$"],
  [1, "open", "$.a"],
  [2, "leaf", "$.a.x"],
  [2, "open", "$.a.y"],
  [3, "leaf", "$.a.y[0]"],
  [2, "closing", "$.a.y"],
  [1, "closing", "$.a"],
  [1, "leaf", "$.b"],
  [0, "closing", "$"],
]);
const pathsOf = (lit: boolean[]) => TREE.filter((_, i) => lit[i]).map((r) => `${r.kind === "closing" ? "/" : ""}${r.path}`);

describe("litRows", () => {
  test("a container target lights its whole subtree and its closing row, not its ancestors or siblings", () => {
    const lit = litRows(TREE, (r) => r.path === "$.a");
    expect(pathsOf(lit)).toEqual(["$.a", "$.a.x", "$.a.y", "$.a.y[0]", "/$.a.y", "/$.a"]);
  });

  test("a leaf target lights only itself", () => {
    expect(pathsOf(litRows(TREE, (r) => r.path === "$.b"))).toEqual(["$.b"]);
  });

  test("a target inside another adds nothing; separate targets each light their own", () => {
    expect(pathsOf(litRows(TREE, (r) => r.path === "$.a" || r.path === "$.a.y"))).toEqual(
      pathsOf(litRows(TREE, (r) => r.path === "$.a")),
    );
    expect(pathsOf(litRows(TREE, (r) => r.path === "$.a.x" || r.path === "$.b"))).toEqual(["$.a.x", "$.b"]);
  });

  test("the root as target lights every row; no target lights none", () => {
    expect(litRows(TREE, (r) => r.path === "$").every(Boolean)).toBe(true);
    expect(litRows(TREE, () => false).some(Boolean)).toBe(false);
  });

  test("a closed container target lights itself only, and the walk goes on after it", () => {
    const flat = rows([
      [0, "open", "root"],
      [1, "closed", "root.0"],
      [1, "leaf", "root.1"],
    ]);
    expect(litRows(flat, (r) => r.path === "root.0")).toEqual([false, true, false]);
  });

  test("trees without closing rows: the subtree ends at the first row back at the target's depth", () => {
    const flat = rows([
      [0, "open", "root"],
      [1, "open", "root.0"],
      [2, "leaf", "root.0.0"],
      [1, "leaf", "root.1"],
    ]);
    expect(litRows(flat, (r) => r.path === "root.0")).toEqual([false, true, true, false]);
  });
});

describe("overlapsAny", () => {
  test("half-open ranges: touching is not overlapping", () => {
    expect(overlapsAny(0, 4, [[4, 8]])).toBe(false);
    expect(overlapsAny(8, 9, [[4, 8]])).toBe(false);
    expect(overlapsAny(3, 5, [[4, 8]])).toBe(true);
    expect(overlapsAny(5, 6, [[4, 8]])).toBe(true);
    expect(overlapsAny(0, 20, [[4, 8]])).toBe(true);
    expect(overlapsAny(0, 4, [])).toBe(false);
    expect(overlapsAny(10, 12, [[0, 2], [11, 30]])).toBe(true);
  });
});

describe("markOrDimClass", () => {
  test("a marked item keeps its mark; an unmarked one dims only under the spotlight", () => {
    const mark = { severity: "error" as const, indices: [1], focused: true };
    expect(markOrDimClass(mark, true)).toBe("cq-ann cq-ann-error cq-ann-focused cq-ann-at-1");
    expect(markOrDimClass(undefined, true)).toBe(DIM_CLASS);
    expect(markOrDimClass(undefined, false)).toBe("");
  });
});
