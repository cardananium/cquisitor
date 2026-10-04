import { describe, expect, test } from "bun:test";
import {
  HOLE_PADDING,
  HOLE_RADIUS,
  SPOTLIGHT_STORAGE_KEY,
  clipToContainers,
  createSpotlightStore,
  focusedHoles,
  holeAround,
  readSpotlightEnabled,
  sameHoles,
  scrimVisible,
  writeSpotlightEnabled,
  type Box,
  type PreferenceStorage,
  type ScrimHole,
} from "./scrim";

const VIEWPORT = { width: 1000, height: 800 };

function box(top: number, left: number, bottom: number, right: number): Box {
  return { top, left, bottom, right };
}

describe("clipToContainers", () => {
  test("a part is cut to every scroll container around it", () => {
    const panel = box(100, 0, 400, 500);
    const page = box(0, 0, 300, 1000);
    expect(clipToContainers(box(250, 10, 350, 200), [panel, page])).toEqual(box(250, 10, 300, 200));
  });

  test("a part scrolled out of its panel is not visible", () => {
    expect(clipToContainers(box(450, 10, 470, 200), [box(100, 0, 400, 500)])).toBeNull();
    expect(clipToContainers(box(390, 10, 400, 200), [box(100, 0, 390, 500)])).toBeNull();
  });

  test("without containers the part stands as it is", () => {
    expect(clipToContainers(box(1, 2, 3, 4), [])).toEqual(box(1, 2, 3, 4));
  });
});

describe("holeAround", () => {
  test("padded on every side with rounded corners", () => {
    expect(holeAround(box(100, 200, 120, 400), VIEWPORT)).toEqual({
      x: 200 - HOLE_PADDING,
      y: 100 - HOLE_PADDING,
      width: 200 + 2 * HOLE_PADDING,
      height: 20 + 2 * HOLE_PADDING,
      radius: HOLE_RADIUS,
    });
  });

  test("kept inside the viewport", () => {
    expect(holeAround(box(0, 0, 10, 10), VIEWPORT)).toEqual({ x: 0, y: 0, width: 14, height: 14, radius: HOLE_RADIUS });
    expect(holeAround(box(900, 10, 950, 20), VIEWPORT)).toBeNull();
  });

  test("a thin part gets a radius no larger than half its height", () => {
    const hole = holeAround(box(10, 10, 11, 100), VIEWPORT, 0);
    expect(hole?.radius).toBe(0.5);
  });
});

describe("focusedHoles", () => {
  const panel = box(100, 0, 400, 1000);

  test("only the focused annotation's parts make holes", () => {
    const parts = [
      { index: 0, box: box(150, 10, 170, 100), clips: [panel] },
      { index: 1, box: box(200, 10, 220, 100), clips: [panel] },
      { index: 1, box: box(300, 500, 320, 600), clips: [] },
    ];
    expect(focusedHoles(parts, 1, VIEWPORT).map((h) => h.y)).toEqual([196, 296]);
    expect(focusedHoles(parts, 0, VIEWPORT)).toHaveLength(1);
    expect(focusedHoles(parts, 2, VIEWPORT)).toEqual([]);
  });

  test("a part out of its panel makes no hole, the others still do", () => {
    const parts = [
      { index: 0, box: box(500, 10, 520, 100), clips: [panel] },
      { index: 0, box: box(150, 10, 170, 100), clips: [panel] },
    ];
    expect(focusedHoles(parts, 0, VIEWPORT)).toHaveLength(1);
  });
});

describe("scrimVisible", () => {
  const hole: ScrimHole = { x: 0, y: 0, width: 10, height: 10, radius: 5 };
  const shown = { active: true, enabled: true, resolved: true, holes: [hole] };

  test("shown with annotations, the toggle on, the target resolved and on screen", () => {
    expect(scrimVisible(shown)).toBe(true);
  });

  test("hidden when any of those is missing: never a dark page with nothing lit", () => {
    expect(scrimVisible({ ...shown, active: false })).toBe(false);
    expect(scrimVisible({ ...shown, enabled: false })).toBe(false);
    expect(scrimVisible({ ...shown, resolved: false })).toBe(false);
    expect(scrimVisible({ ...shown, holes: [] })).toBe(false);
  });
});

describe("sameHoles", () => {
  const a: ScrimHole = { x: 10, y: 20, width: 30, height: 40, radius: 6 };

  test("moves under half a pixel leave the mask alone", () => {
    expect(sameHoles([a], [{ ...a, x: 10.4, height: 40.5 }])).toBe(true);
  });

  test("larger moves or a different number of holes redraw it", () => {
    expect(sameHoles([a], [{ ...a, y: 20.6 }])).toBe(false);
    expect(sameHoles([a], [a, a])).toBe(false);
    expect(sameHoles([], [])).toBe(true);
  });
});

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

describe("the spotlight preference", () => {
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
  });

  test("a store whose storage throws still toggles for the page", () => {
    const store = createSpotlightStore(() => throwingStorage);
    expect(store.enabled()).toBe(true);
    store.setEnabled(false);
    expect(store.enabled()).toBe(false);
  });
});
