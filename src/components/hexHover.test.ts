import { describe, expect, test } from "bun:test";
import { hoverHexCharRanges, hoverHexCharRangesAll, locatePoint, locateRun, runElementsIn, type RunAccessor } from "./hexHover";

describe("hoverHexCharRanges", () => {
  test("a hover with nothing over it is one range of its characters", () => {
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [])).toEqual([[2, 10]]);
  });

  test("a pinned byte inside the hover cuts it in two", () => {
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 2, length: 1 }]))
      .toEqual([[2, 4], [6, 10]]);
  });

  test("a failing byte at the start trims the front", () => {
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 0, length: 2 }]))
      .toEqual([[4, 10]]);
  });

  test("an occluder past the end trims the back, and one beside it trims nothing", () => {
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 4, length: 3 }]))
      .toEqual([[2, 8]]);
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 5, length: 3 }]))
      .toEqual([[2, 10]]);
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 0, length: 1 }]))
      .toEqual([[2, 10]]);
  });

  test("a zero-length occluder still covers one byte", () => {
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 3, length: 0 }]))
      .toEqual([[2, 6], [8, 10]]);
  });

  test("several occluders each take their piece", () => {
    expect(hoverHexCharRanges({ offset: 0, length: 10 }, 100, [
      { offset: 2, length: 1 },
      { offset: 5, length: 2 },
      { offset: 9, length: 5 },
    ])).toEqual([[0, 4], [6, 10], [14, 18]]);
  });

  test("full occlusion leaves nothing", () => {
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 0, length: 9 }])).toEqual([]);
    expect(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 1, length: 4 }])).toEqual([]);
  });

  test("ranges are clamped to the text", () => {
    expect(hoverHexCharRanges({ offset: 3, length: 10 }, 12, [])).toEqual([[6, 12]]);
    expect(hoverHexCharRanges({ offset: 8, length: 2 }, 12, [])).toEqual([]);
    expect(hoverHexCharRanges({ offset: 0, length: 0 }, 12, [])).toEqual([]);
  });
});

describe("locateRun", () => {
  /** Runs at chars 4–8, 10–16 and 20–22, with plain text between them. */
  const runs: RunAccessor = {
    length: 3,
    pos: (i) => [4, 10, 20][i],
    len: (i) => [4, 6, 2][i],
    inner: () => null,
  };

  test("a character inside a run", () => {
    expect(locateRun(runs, 4)).toEqual({ run: 0, inside: true, offset: 0 });
    expect(locateRun(runs, 7)).toEqual({ run: 0, inside: true, offset: 3 });
    expect(locateRun(runs, 15)).toEqual({ run: 1, inside: true, offset: 5 });
    expect(locateRun(runs, 21)).toEqual({ run: 2, inside: true, offset: 1 });
  });

  test("a character in the gap after a run is offset into the text that follows it", () => {
    expect(locateRun(runs, 8)).toEqual({ run: 0, inside: false, offset: 0 });
    expect(locateRun(runs, 9)).toEqual({ run: 0, inside: false, offset: 1 });
    expect(locateRun(runs, 17)).toEqual({ run: 1, inside: false, offset: 1 });
  });

  test("a character before the first run is offset into the leading text", () => {
    expect(locateRun(runs, 0)).toEqual({ run: -1, inside: false, offset: 0 });
    expect(locateRun(runs, 3)).toEqual({ run: -1, inside: false, offset: 3 });
  });

  test("a character past the last run is offset into the trailing text", () => {
    expect(locateRun(runs, 22)).toEqual({ run: 2, inside: false, offset: 0 });
    expect(locateRun(runs, 30)).toEqual({ run: 2, inside: false, offset: 8 });
  });

  test("with no runs everything is leading text", () => {
    const none: RunAccessor = { length: 0, pos: () => 0, len: () => 0, inner: () => null };
    expect(locateRun(none, 5)).toEqual({ run: -1, inside: false, offset: 5 });
  });

  test("agrees with a linear scan over many runs", () => {
    const starts = Array.from({ length: 1000 }, (_, i) => i * 7);
    const many: RunAccessor = { length: starts.length, pos: (i) => starts[i], len: () => 5, inner: () => null };
    for (let c = 0; c < 7 * 1000 + 10; c += 3) {
      let run = -1;
      for (let i = 0; i < starts.length; i++) if (starts[i] <= c) run = i;
      const at = locateRun(many, c);
      expect(at.run).toBe(run);
      if (run >= 0) {
        expect(at.inside).toBe(c < starts[run] + 5);
        expect(at.offset).toBe(at.inside ? c - starts[run] : c - starts[run] - 5);
      }
    }
  });
});

describe("locatePoint", () => {
  /** Runs at 0–2, 2–14 and 16–18; the middle is a region of runs at 2–6, 6–10, 10–14. */
  const nested: RunAccessor = {
    length: 3,
    pos: (i) => [2, 6, 10][i],
    len: () => 4,
    inner: () => null,
  };
  const runs: RunAccessor = {
    length: 3,
    pos: (i) => [0, 2, 16][i],
    len: (i) => [2, 12, 2][i],
    inner: (i) => (i === 1 ? nested : null),
  };

  test("a character in a run of text is that run's", () => {
    expect(locatePoint(runs, 1)).toEqual({ run: 0, inner: -1, inside: true, offset: 1 });
    expect(locatePoint(runs, 17)).toEqual({ run: 2, inner: -1, inside: true, offset: 1 });
  });

  test("a character in a region is located again among the region's runs", () => {
    expect(locatePoint(runs, 2)).toEqual({ run: 1, inner: 0, inside: true, offset: 0 });
    expect(locatePoint(runs, 7)).toEqual({ run: 1, inner: 1, inside: true, offset: 1 });
    expect(locatePoint(runs, 13)).toEqual({ run: 1, inner: 2, inside: true, offset: 3 });
  });

  test("a character after a region is in the text after it, not in its last run", () => {
    expect(locatePoint(runs, 14)).toEqual({ run: 1, inner: -1, inside: false, offset: 0 });
    expect(locatePoint(runs, 15)).toEqual({ run: 1, inner: -1, inside: false, offset: 1 });
    expect(locatePoint(runs, 18)).toEqual({ run: 2, inner: -1, inside: false, offset: 0 });
  });

  test("a region whose runs fall short of it answers with the end of the run before the gap", () => {
    const short: RunAccessor = { length: 1, pos: () => 2, len: () => 4, inner: () => null };
    const holed: RunAccessor = {
      length: 1,
      pos: () => 2,
      len: () => 12,
      inner: () => short,
    };
    expect(locatePoint(holed, 9)).toEqual({ run: 0, inner: 0, inside: true, offset: 4 });
  });

  test("an empty region is read as text", () => {
    const empty: RunAccessor = { length: 0, pos: () => 0, len: () => 0, inner: () => null };
    const holder: RunAccessor = { length: 1, pos: () => 0, len: () => 4, inner: () => empty };
    expect(locatePoint(holder, 3)).toEqual({ run: 0, inner: -1, inside: true, offset: 3 });
  });
});

describe("hoverHexCharRangesAll", () => {
  test("every position's ranges, in order, each cut around the occluders", () => {
    expect(hoverHexCharRangesAll(
      [{ offset: 1, length: 4 }, { offset: 10, length: 2 }],
      100,
      [{ offset: 2, length: 1 }],
    )).toEqual([[2, 4], [6, 10], [20, 24]]);
  });

  test("a position given twice is painted once", () => {
    expect(hoverHexCharRangesAll(
      [{ offset: 1, length: 4 }, { offset: 1, length: 4 }, { offset: 10, length: 2 }],
      100,
      [],
    )).toEqual([[2, 10], [20, 24]]);
  });

  test("one position is the single-position answer; none is nothing", () => {
    expect(hoverHexCharRangesAll([{ offset: 1, length: 4 }], 100, [{ offset: 2, length: 1 }]))
      .toEqual(hoverHexCharRanges({ offset: 1, length: 4 }, 100, [{ offset: 2, length: 1 }]));
    expect(hoverHexCharRangesAll([], 100, [])).toEqual([]);
  });

  test("a hover over the pin's other instances is not cut by them", () => {
    // Other instances are not occluders: only the current pin is, so the hover lights every instance and the current keeps its outline.
    const instances = [{ offset: 2, length: 5 }, { offset: 19, length: 5 }];
    const current = [instances[1]];
    expect(hoverHexCharRangesAll(instances, 100, current)).toEqual([[4, 14]]);
    expect(hoverHexCharRangesAll(instances, 100, [])).toEqual([[4, 14], [38, 48]]);
  });
});

describe("runElementsIn", () => {
  // Same shape as `locatePoint`'s fixture, as elements. Only leaf runs are returned.
  const leaf = (name: string) => ({ name, children: [] as unknown[] });
  const inner = [leaf("r2"), leaf("r6"), leaf("r10")];
  const region = { name: "region", children: inner };
  const top = [leaf("r0"), region, leaf("r16")];
  const root = { children: top } as unknown as HTMLElement;
  const nested: RunAccessor = { length: 3, pos: (i) => [2, 6, 10][i], len: () => 4, inner: () => null };
  const runs: RunAccessor = {
    length: 3,
    pos: (i) => [0, 2, 16][i],
    len: (i) => [2, 12, 2][i],
    inner: (i) => (i === 1 ? nested : null),
  };
  const names = (start: number, end: number) =>
    runElementsIn(root, runs, start, end).map(el => (el as unknown as { name: string }).name);

  test("a range on one run is that run", () => {
    expect(names(0, 2)).toEqual(["r0"]);
    expect(names(16, 18)).toEqual(["r16"]);
  });
  test("a range over a region is the region's runs, not the region", () => {
    expect(names(2, 14)).toEqual(["r2", "r6", "r10"]);
    expect(names(6, 10)).toEqual(["r6"]);
  });
  test("a range across runs and the gap between them takes every run it touches", () => {
    expect(names(1, 17)).toEqual(["r0", "r2", "r6", "r10", "r16"]);
    expect(names(14, 17)).toEqual(["r16"]);
  });
  test("a run cut by the range is taken whole", () => {
    expect(names(7, 8)).toEqual(["r6"]);
  });
  test("an empty range, or one in the gap, takes nothing", () => {
    expect(names(5, 5)).toEqual([]);
    expect(names(14, 16)).toEqual([]);
    expect(names(30, 40)).toEqual([]);
  });
  test("appends to the list it is given", () => {
    const out: Element[] = [];
    runElementsIn(root, runs, 0, 2, out);
    runElementsIn(root, runs, 16, 18, out);
    expect(out.map(el => (el as unknown as { name: string }).name)).toEqual(["r0", "r16"]);
  });
});
