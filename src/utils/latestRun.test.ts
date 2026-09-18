import { describe, expect, test } from "bun:test";
import { createRunGate } from "./latestRun";

describe("createRunGate", () => {
  test("the only run there has been is the current one", () => {
    const begin = createRunGate();
    expect(begin()()).toBe(true);
  });

  test("starting another run retires the one before it", () => {
    const begin = createRunGate();
    const first = begin();
    const second = begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  test("a retired run stays retired however long it takes to come back", async () => {
    // Slow first, fast second: the slow answer must stay retired.
    const begin = createRunGate();
    const slow = begin();
    const fast = begin();
    await Promise.resolve();
    expect(fast()).toBe(true);
    expect(slow()).toBe(false);
    // Finishing still does not restore it.
    expect(fast()).toBe(true);
  });

  test("the slower run does not overwrite what the newer one put on screen", async () => {
    const begin = createRunGate();
    const panel: { onScreen: string | null } = { onScreen: null };
    const publish = (isCurrent: () => boolean, value: string) => {
      if (isCurrent()) panel.onScreen = value;
    };

    // Two overlapping re-validations; they finish in reverse start order.
    const withOneWitness = begin();
    const withTwoWitnesses = begin();
    await Promise.resolve();
    publish(withTwoWitnesses, "two witnesses");
    publish(withOneWitness, "one witness");

    expect(panel.onScreen).toBe("two witnesses");
  });

  test("state only a live run may own is released by whatever supersedes it", async () => {
    // Superseding a spinner-owning run must clear the flag; the old run can no longer write it.
    let isLoading = false;
    const begin = createRunGate(() => {
      isLoading = false;
    });

    const validating = begin();
    isLoading = true;
    begin();

    await Promise.resolve();
    if (validating()) isLoading = false;
    expect(isLoading).toBe(false);
  });

  test("the run that wants the flag still has it", () => {
    let isLoading = false;
    const begin = createRunGate(() => {
      isLoading = false;
    });
    const isCurrent = begin();
    isLoading = true;
    expect(isLoading).toBe(true);
    if (isCurrent()) isLoading = false;
    expect(isLoading).toBe(false);
  });

  test("the release happens before the new run's token exists", () => {
    // Otherwise a run could see itself superseded by its own start.
    const seen: boolean[] = [];
    let previous: (() => boolean) | null = null;
    const begin = createRunGate(() => {
      if (previous) seen.push(previous());
    });
    previous = begin();
    begin();
    expect(seen).toEqual([true]);
  });

  test("two gates do not retire each other's runs", () => {
    const a = createRunGate();
    const b = createRunGate();
    const first = a();
    b();
    expect(first()).toBe(true);
  });
});
