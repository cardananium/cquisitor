import { describe, expect, test } from "bun:test";
import {
  hydrateCddlFromHash,
  readInitialCddlState,
  KEPT_EDITS_MESSAGE,
  type CddlField,
  type CddlHydrationDeps,
  type LoadedPreset,
  type PresetSource,
} from "./CddlValidatorContext";
import type { ParsedCddlShare } from "@/utils/shareLink";
import { CARDANO_PRESETS } from "@/app/cddl-validator/presets";

describe("readInitialCddlState", () => {
  const empty = {
    cddl: "",
    cborInput: "",
    selectedRule: "",
    appAuthoredCddl: null,
    hydrating: false,
    hydratingPreset: null,
  };

  test("no hash opens empty", () => {
    expect(readInitialCddlState("")).toEqual(empty);
  });

  test("another tab's link leaves this one empty", () => {
    expect(readInitialCddlState("#general-cbor?cbor=00")).toEqual(empty);
    expect(readInitialCddlState("#cardano-cbor?v=1&e=b&d=xx").hydrating).toBe(false);
  });

  test("the bare tab hash opens empty", () => {
    expect(readInitialCddlState("#cddl-validator")).toEqual(empty);
  });

  test("plain params are applied on the first render", () => {
    const state = readInitialCddlState("#cddl-validator?cddl=a%20%3D%20int&rule=a&cbor=01");
    expect(state.cddl).toBe("a = int");
    expect(state.selectedRule).toBe("a");
    expect(state.cborInput).toBe("01");
    expect(state.hydrating).toBe(false);
    // Link text is user-owned, not app-authored.
    expect(state.appAuthoredCddl).toBeNull();
  });

  test("a link that names a schema decides the whole document", () => {
    const state = readInitialCddlState("#cddl-validator?cddl=a%20%3D%20int&cbor=01");
    expect(state.cddl).toBe("a = int");
    expect(state.selectedRule).toBe("");
    expect(state.cborInput).toBe("01");
    expect(state.appAuthoredCddl).toBeNull();
  });

  test("an explicitly empty schema is honoured, not filled in", () => {
    const state = readInitialCddlState("#cddl-validator?cddl=&cbor=01");
    expect(state.cddl).toBe("");
    expect(state.selectedRule).toBe("");
  });

  test("cbor with no schema leaves the schema pane empty", () => {
    // Minimal form the share dialog tells third-party tools to build.
    const state = readInitialCddlState("#cddl-validator?cbor=01");
    expect(state).toEqual({ ...empty, cborInput: "01" });
  });

  test("a rule the schemaless link names is kept", () => {
    const state = readInitialCddlState("#cddl-validator?cbor=01&rule=Other");
    expect(state.cddl).toBe("");
    expect(state.selectedRule).toBe("Other");
  });

  test("a preset link is still pending", () => {
    const state = readInitialCddlState("#cddl-validator?preset=conway&cbor=01");
    expect(state.cddl).toBe("");
    expect(state.appAuthoredCddl).toBeNull();
  });

  test("a rich payload that may carry a schema is not stood in for", () => {
    const state = readInitialCddlState("#cddl-validator?v=1&e=b&d=abc&cbor=01");
    expect(state.cddl).toBe("");
    expect(state.appAuthoredCddl).toBeNull();
  });

  test("a preset link announces the load instead of standing in for it", () => {
    const state = readInitialCddlState("#cddl-validator?preset=conway&rule=transaction&cbor=01");
    expect(state.cddl).toBe("");
    expect(state.hydrating).toBe(true);
    expect(state.hydratingPreset).toBe("conway");
    expect(state.selectedRule).toBe("transaction");
  });

  test("a rich payload is pending until it is decoded", () => {
    const state = readInitialCddlState("#cddl-validator?v=1&e=b&d=abc");
    expect(state.cddl).toBe("");
    expect(state.hydrating).toBe(true);
    expect(state.hydratingPreset).toBeNull();
  });
});

/** Records hydration writes; tests can flip `edited` mid-run. */
function harness(deps: Partial<CddlHydrationDeps> = {}) {
  const edited: Record<CddlField, boolean> = { cddl: false, cbor: false, rule: false };
  const wrote: {
    cddl?: string;
    cbor?: string;
    rule?: string;
    appAuthored?: string;
    preset?: PresetSource;
    hydratingPreset: (string | null)[];
    hydrating?: boolean;
    error?: string;
  } = { hydratingPreset: [] };
  const state = { cancelled: false };
  const sink = {
    edited: (field: CddlField) => edited[field],
    cancelled: () => state.cancelled,
    setCddl: (v: string) => { wrote.cddl = v; },
    setCborInput: (v: string) => { wrote.cbor = v; },
    setSelectedRule: (v: string) => { wrote.rule = v; },
    setAppAuthoredCddl: (v: string) => { wrote.appAuthored = v; },
    setPresetSource: (v: PresetSource) => { wrote.preset = v; },
    setHydratingPreset: (v: string | null) => { wrote.hydratingPreset.push(v); },
    setHydrating: (v: boolean) => { wrote.hydrating = v; },
    setHydrationError: (v: string) => { wrote.error = v; },
  };
  const run = (hash: string) =>
    hydrateCddlFromHash(hash, sink, {
      parseShare: async () => ({}),
      loadPreset: async () => preset("transaction = int"),
      ...deps,
    });
  return { edited, wrote, state, run };
}

const CONWAY = CARDANO_PRESETS.find(p => p.id === "conway")!;

/** Conway preset metadata with whatever schema text the test wants to watch. */
function preset(text: string): LoadedPreset {
  return { text, label: CONWAY.label, rootRule: CONWAY.rootRule };
}

describe("hydrateCddlFromHash", () => {
  test("the built-in dependency reaches the preset table and the bundled schema", async () => {
    // Provider imports that table dynamically; this is the only place the wiring is exercised.
    const h = harness();
    await hydrateCddlFromHash("#cddl-validator?preset=conway", {
      edited: () => false,
      cancelled: () => false,
      setCddl: (v) => { h.wrote.cddl = v; },
      setCborInput: () => {},
      setSelectedRule: (v) => { h.wrote.rule = v; },
      setAppAuthoredCddl: () => {},
      setPresetSource: (v) => { h.wrote.preset = v; },
      setHydratingPreset: () => {},
      setHydrating: (v) => { h.wrote.hydrating = v; },
      setHydrationError: (v) => { h.wrote.error = v; },
    });
    expect(h.wrote.error).toBeUndefined();
    expect(h.wrote.cddl).toContain("transaction =");
    expect(h.wrote.rule).toBe(CONWAY.rootRule);
    expect(h.wrote.preset).toEqual({ id: "conway", label: CONWAY.label });
  });

  test("a preset link with no rule validates against the preset's root rule", async () => {
    const h = harness({ loadPreset: async () => preset("conway text") });
    await h.run("#cddl-validator?preset=conway&cbor=deadbeef");
    expect(h.wrote.cddl).toBe("conway text");
    // Without this the era schema's first rule (`block`) stands in.
    expect(h.wrote.rule).toBe(CONWAY.rootRule);
    expect(h.wrote.rule).not.toBe("block");
    expect(h.wrote.preset).toEqual({ id: "conway", label: CONWAY.label });
    expect(h.wrote.hydrating).toBe(false);
  });

  test("a rule the link names is not replaced by the preset's own", async () => {
    const h = harness();
    await h.run("#cddl-validator?preset=conway&rule=block&cbor=deadbeef");
    // Plain query param is already on screen from the first render.
    expect(h.wrote.rule).toBeUndefined();
  });

  test("a rule inside the payload outranks the preset's own", async () => {
    const h = harness({
      parseShare: async () => ({ preset: "conway", rule: "block" }),
    });
    await h.run("#cddl-validator?v=1&e=b&d=abc");
    expect(h.wrote.rule).toBe("block");
    expect(h.wrote.hydratingPreset).toEqual(["conway", null]);
  });

  test("an unknown preset id reports the failure and picks no rule", async () => {
    const h = harness({
      loadPreset: async () => { throw new Error("Unknown preset: nope"); },
    });
    await h.run("#cddl-validator?preset=nope");
    expect(h.wrote.error).toBe("Unknown preset: nope");
    expect(h.wrote.cddl).toBeUndefined();
    expect(h.wrote.rule).toBeUndefined();
    expect(h.wrote.hydrating).toBe(false);
  });

  test("a schema typed while the preset downloads is kept, not typed over", async () => {
    let release!: (loaded: LoadedPreset) => void;
    const h = harness({ loadPreset: () => new Promise<LoadedPreset>(r => { release = r; }) });
    const done = h.run("#cddl-validator?preset=conway&cbor=deadbeef");
    h.edited.cddl = true;
    release(preset("conway text"));
    await done;
    expect(h.wrote.cddl).toBeUndefined();
    expect(h.wrote.appAuthored).toBeUndefined();
    expect(h.wrote.preset).toBeUndefined();
    expect(h.wrote.rule).toBeUndefined();
    expect(h.wrote.error).toBe(KEPT_EDITS_MESSAGE);
    expect(h.wrote.hydrating).toBe(false);
  });

  test("fields the reader left alone are still hydrated", async () => {
    let release!: (parsed: ParsedCddlShare) => void;
    const h = harness({ parseShare: () => new Promise<ParsedCddlShare>(r => { release = r; }) });
    const done = h.run("#cddl-validator?v=1&e=b&d=abc");
    h.edited.cbor = true;
    release({ cddl: "a = int", cbor: "01", rule: "a" });
    await done;
    expect(h.wrote.cddl).toBe("a = int");
    expect(h.wrote.rule).toBe("a");
    expect(h.wrote.cbor).toBeUndefined();
    expect(h.wrote.error).toBe(KEPT_EDITS_MESSAGE);
  });

  test("a failure to load is reported over a kept edit", async () => {
    let release!: (reason: Error) => void;
    const h = harness({ loadPreset: () => new Promise<LoadedPreset>((_, rej) => { release = rej; }) });
    const done = h.run("#cddl-validator?preset=conway");
    h.edited.cddl = true;
    release(new Error("Network offline"));
    await done;
    expect(h.wrote.error).toBe("Network offline");
  });

  test("an unmount mid-download writes nothing further", async () => {
    let release!: (loaded: LoadedPreset) => void;
    const h = harness({ loadPreset: () => new Promise<LoadedPreset>(r => { release = r; }) });
    const done = h.run("#cddl-validator?preset=conway");
    h.state.cancelled = true;
    release(preset("conway text"));
    await done;
    expect(h.wrote.cddl).toBeUndefined();
    expect(h.wrote.hydrating).toBeUndefined();
    expect(h.wrote.hydratingPreset).toEqual([]);
  });

  test("a hash for another tab, or one with nothing to restore, does nothing", async () => {
    const h = harness();
    await h.run("#general-cbor?preset=conway");
    await h.run("#cddl-validator");
    await h.run("#cddl-validator?cddl=a%20%3D%20int&rule=a");
    expect(h.wrote).toEqual({ hydratingPreset: [] });
  });
});
