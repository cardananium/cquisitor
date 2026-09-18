import { describe, expect, test } from "bun:test";
import type { CborCddlMap, CborCddlMapEntry } from "@cardananium/cquisitor-lib";
import { createCborCddlBridge, type CborCddlBridge, type CborCddlNode } from "./cborCddlBridge";
import { CONWAY_CDDL } from "./conwaySchema";
import {
  EMPTY_PATHS,
  EMPTY_POSITIONS,
  INSTANCE_PAINT_CAP,
  currentIndex,
  initialInstanceIndex,
  instanceCountLabel,
  instanceNavLabel,
  instanceSetFor,
  litPinInstances,
  makePin,
  markLinkedRows,
  NO_MARKS,
  nextReveal,
  otherInstances,
  parentPath,
  pathKeys,
  decodedHolders,
  treeHolders,
  visitedDecodedPaths,
  visitedTreePositions,
  pinStepKey,
  pinnedOtherDecodedPaths,
  pinnedOtherTreeKeys,
  projectInstances,
  scrollFlagFor,
  stepInstance,
  stepPin,
  treeKeys,
  type HolderMarks,
  type MarkableRow,
  type PinState,
  type Reveal,
} from "./instances";
import { CONWAY_TX_HEX, mapOf } from "./libForTests";
import { findNodeByCddlOffset, resolveProbe } from "./pinResolvers";

const PERSONS_CDDL = "Person = { name: tstr, age: uint }\nPersons = [+Person]\n";
// [{"name":"Alice","age":20},{"name":"Bob","age":31}]
const PERSONS_HEX = "82a2646e616d6565416c6963656361676514a2646e616d6563426f6263616765181f";
const personsBridge = () => createCborCddlBridge(mapOf(PERSONS_HEX, PERSONS_CDDL, "Persons"));

/** Char offset of `text`'s first occurrence in the Persons schema. */
const at = (text: string) => PERSONS_CDDL.indexOf(text);

/** `[+Person]` over `n` persons — a construct with `n` instances. */
function personsHex(n: number): string {
  const header = n < 24
    ? (0x80 + n).toString(16).padStart(2, "0")
    : n < 256 ? `98${n.toString(16).padStart(2, "0")}` : `99${n.toString(16).padStart(4, "0")}`;
  // {"name": "Al", "age": 20}
  return header + "a2646e616d6562416c6361676514".repeat(n);
}

const EMPTY_BRIDGE = createCborCddlBridge({ entries: [], cbor_paths: [], decoded_paths: [] });

describe("stepInstance", () => {
  test("wraps at both ends", () => {
    expect(stepInstance(6, 1, 7)).toBe(0);
    expect(stepInstance(0, -1, 7)).toBe(6);
    expect(stepInstance(2, 1, 7)).toBe(3);
    expect(stepInstance(2, -1, 7)).toBe(1);
  });

  test("a group of one stays put; an empty group has no position", () => {
    expect(stepInstance(0, 1, 1)).toBe(0);
    expect(stepInstance(0, -1, 1)).toBe(0);
    expect(stepInstance(0, 1, 0)).toBe(-1);
  });
});

describe("initialInstanceIndex", () => {
  test("a pin from the schema starts at the first instance, whichever entry it resolved to", () => {
    const bridge = personsBridge();
    const group = bridge.instancesOf(bridge.entries[4]);
    expect(initialInstanceIndex(group, bridge.entries[4], "cddl")).toBe(0);
    expect(initialInstanceIndex(group, bridge.entries[10], "cddl")).toBe(0);
  });

  test("a pin from a data panel starts at the run that was pinned", () => {
    const bridge = personsBridge();
    // Byte 20 is inside the second person's `name` key.
    const own = resolveProbe(bridge, { source: "hex", byteOffset: 20 })!;
    expect(own.cborPath).toBe("$[1].name");
    const group = bridge.instancesOf(own.entry);
    expect(group.length).toBe(2);
    for (const source of ["hex", "tree", "decoded"] as const) {
      expect(initialInstanceIndex(group, own.entry, source)).toBe(1);
    }
  });
});

describe("instanceSetFor", () => {
  test("from the schema the whole group lights and nothing is current", () => {
    const bridge = personsBridge();
    const head = findNodeByCddlOffset(bridge, at("name"))!;
    const set = instanceSetFor(bridge, head, "cddl");
    expect(set.instances).toBe(bridge.instancesOf(head.entry));
    expect(set.lit).toBe(set.instances);
    expect(set.instances.length).toBe(2);
    expect(set.index).toBe(-1);
  });

  test("from a data panel the probed run lights alone, with its group for the count", () => {
    const bridge = personsBridge();
    const own = resolveProbe(bridge, { source: "hex", byteOffset: 20 })!;
    const set = instanceSetFor(bridge, own, "hex");
    expect(set.lit).toEqual([own.entry]);
    expect(set.instances).toBe(bridge.instancesOf(own.entry));
    expect(set.index).toBe(1);
  });

  test("a tree row the map does not cover has no set", () => {
    const set = instanceSetFor(personsBridge(), null, "tree");
    expect(set.instances).toEqual([]);
    expect(set.lit).toEqual([]);
    expect(set.index).toBe(-1);
  });
});

describe("projectInstances", () => {
  test("hands the entries' own spans on and skips a row without bytes", () => {
    const bridge = createCborCddlBridge(
      mapOf("a1646e616d656441626379", "Person = {name: tstr, age: uint}", "Person"),
    );
    const missing = bridge.entries.find(e => !e.cbor_byte_span)!;
    const present = bridge.entries.find(e => e.cbor_byte_span && e.entry_role === "value")!;
    const out = projectInstances(bridge, [present, missing]);
    expect(out.hexAll).toEqual([present.cbor_anchor_span!]);
    expect(out.hexAll[0]).toBe(present.cbor_anchor_span!);
    expect(out.treeAll).toEqual([present.cbor_byte_span!]);
    expect(out.treeAll[0]).toBe(present.cbor_byte_span!);
    // The omitted member still has its decoded row.
    expect(out.decodedAll).toEqual([bridge.node(present).decodedPath, bridge.node(missing).decodedPath]);
    expect(out.decodedAll[1]).toBe("$.age");
    expect(out.truncated).toBe(false);
  });

  test("nothing lit is the shared empty projection", () => {
    const out = projectInstances(personsBridge(), []);
    expect(out.hexAll).toBe(EMPTY_POSITIONS);
    expect(out.treeAll).toBe(EMPTY_POSITIONS);
    expect(out.decodedAll).toBe(EMPTY_PATHS);
  });

  test("a construct past the cap paints the cap and counts the whole", () => {
    const n = 5000;
    const bridge = createCborCddlBridge(mapOf(personsHex(n), PERSONS_CDDL, "Persons"));
    const head = findNodeByCddlOffset(bridge, at("name"))!;
    const set = instanceSetFor(bridge, head, "cddl");
    expect(set.instances.length).toBe(n);
    const out = projectInstances(bridge, set.lit);
    expect(out.hexAll.length).toBe(INSTANCE_PAINT_CAP);
    expect(out.treeAll.length).toBe(INSTANCE_PAINT_CAP);
    expect(out.decodedAll.length).toBe(INSTANCE_PAINT_CAP);
    expect(out.truncated).toBe(true);
    expect(instanceCountLabel("x", set, out.truncated)).toBe(`x · ${n} instances (first ${INSTANCE_PAINT_CAP} painted)`);
  });
});

describe("instanceCountLabel", () => {
  test("says how many a schema probe lit, or which one a data probe named", () => {
    const bridge = personsBridge();
    const head = findNodeByCddlOffset(bridge, at("name"))!;
    expect(instanceCountLabel("k", instanceSetFor(bridge, head, "cddl"))).toBe("k · 2 instances");
    const own = resolveProbe(bridge, { source: "hex", byteOffset: 20 })!;
    expect(instanceCountLabel("k", instanceSetFor(bridge, own, "hex"))).toBe("k · instance 2 of 2");
  });

  test("one instance adds nothing", () => {
    const bridge = personsBridge();
    const root = findNodeByCddlOffset(bridge, at("Persons"))!;
    expect(instanceCountLabel("k", instanceSetFor(bridge, root, "cddl"))).toBe("k");
  });
});

describe("litPinInstances", () => {
  // Schema pin: whole group. Data pin: that one run. Asserted for both so a change is deliberate.
  test("a pin from the schema lights all instances", () => {
    const bridge = personsBridge();
    const pin = makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl");
    expect(litPinInstances(pin)).toBe(pin.instances);
    expect(pin.current).toBe(0);
  });

  test("a pin from a data panel is its one run: nothing else lights, nothing to step to", () => {
    const bridge = personsBridge();
    const node = resolveProbe(bridge, { source: "hex", byteOffset: 20 })!;
    const pin = makePin(bridge, node, "hex");
    expect(pin.instances).toEqual([node.entry]);
    expect(litPinInstances(pin)).toBe(pin.instances);
    expect(pin.current).toBe(0);
    expect(bridge.instancesOf(node.entry).length).toBe(2);
    // Same run pinned twice is the same group by identity.
    expect(makePin(bridge, node, "tree").instances).toBe(pin.instances);
  });
});

describe("otherInstances and the panel sets", () => {
  test("every instance but the current, as each tree names its rows", () => {
    const bridge = personsBridge();
    const pin = stepPin(makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl"), 1);
    const others = otherInstances(pin);
    expect(others).toEqual([bridge.entries[4]]);
    expect(pinnedOtherTreeKeys(pin, true)).toEqual(new Set(["2:5"]));
    expect(pinnedOtherDecodedPaths(pin, bridge, true)).toEqual(new Set(["$[0].name"]));
    expect(pinnedOtherTreeKeys(pin, false)).toBeNull();
    expect(pinnedOtherDecodedPaths(pin, bridge, false)).toBeNull();
    expect(pinnedOtherTreeKeys(null, true)).toBeNull();
  });

  test("a group of one has no others", () => {
    const bridge = personsBridge();
    const pin = makePin(bridge, findNodeByCddlOffset(bridge, at("Persons"))!, "cddl");
    expect(otherInstances(pin)).toEqual([]);
    expect(pinnedOtherTreeKeys(pin, true)).toBeNull();
  });
});

describe("instanceNavLabel", () => {
  test("a group of one has nowhere to step", () => {
    const label = instanceNavLabel(0, 1, { panel: "hex" });
    expect(label.text).toBe("1/1");
    expect(label.canStep).toBe(false);
    expect(label.title).toContain("the only instance");
  });

  test("a position in a group", () => {
    const label = instanceNavLabel(2, 7, { panel: "hex" });
    expect(label.text).toBe("3/7");
    expect(label.canStep).toBe(true);
    expect(label.title).toContain("instance 3 of 7");
    expect(label.title).toContain("Alt+, / Alt+.");
  });

  test("a current instance with no bytes says so in the hex and tree", () => {
    for (const panel of ["hex", "tree"] as const) {
      expect(instanceNavLabel(1, 3, { panel, byteless: true }).title).toContain("has no bytes in the CBOR");
    }
  });

  test("the editor's chip explains why one span stands for all", () => {
    expect(instanceNavLabel(1, 3, { panel: "cddl" }).title)
      .toContain("all instances share this schema construct");
  });

  test("a tree panel's chip names the panel it steps in", () => {
    expect(instanceNavLabel(0, 2, { panel: "tree" }).title).toContain("steps in CBOR tree");
    expect(instanceNavLabel(0, 2, { panel: "decoded" }).title).toContain("steps in Decoded JSON");
    expect(instanceNavLabel(0, 2, { panel: "hex" }).title).not.toContain("steps in");
  });
});

describe("pinStepKey", () => {
  const key = (over: Partial<Parameters<typeof pinStepKey>[0]>) => ({
    code: "Period", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...over,
  });

  test("Alt+Period steps forward and Alt+Comma back", () => {
    expect(pinStepKey(key({ code: "Period", altKey: true }))).toBe(1);
    expect(pinStepKey(key({ code: "Comma", altKey: true }))).toBe(-1);
  });

  test("read off the code, so the glyph macOS reports does not matter", () => {
    expect(pinStepKey({ ...key({ code: "Period", altKey: true }), key: "≥" } as never)).toBe(1);
  });

  test("an AltGr chord, a shifted or a command chord, and a plain key are not steps", () => {
    expect(pinStepKey(key({ code: "Period", altKey: true, ctrlKey: true }))).toBeNull();
    expect(pinStepKey(key({ code: "Period", altKey: true, shiftKey: true }))).toBeNull();
    expect(pinStepKey(key({ code: "Period", altKey: true, metaKey: true }))).toBeNull();
    expect(pinStepKey(key({ code: "Period" }))).toBeNull();
    expect(pinStepKey(key({ code: "KeyN", altKey: true }))).toBeNull();
  });
});

describe("reveal and scroll flags", () => {
  test("nextReveal counts up whichever panel asks", () => {
    const first = nextReveal(null, "hex");
    expect(first).toEqual({ target: "hex", seq: 1, subject: "pin" });
    expect(nextReveal(first, "hex")).toEqual({ target: "hex", seq: 2, subject: "pin" });
    expect(nextReveal(first, "all").seq).toBe(2);
  });

  test("a reveal of the selected diagnostic counts on the same sequence", () => {
    const pin = nextReveal(null, "tree");
    const diagnostic = nextReveal(pin, "decoded", "diagnostic");
    expect(diagnostic).toEqual({ target: "decoded", seq: 2, subject: "diagnostic" });
    expect(nextReveal(diagnostic, "all", "pin")).toEqual({ target: "all", seq: 3, subject: "pin" });
  });

  test("a tree scrolls only when it, or everyone, was asked, and only while on screen", () => {
    const reveal = (target: Reveal["target"]): Reveal => ({ target, seq: 1, subject: "pin" });
    expect(scrollFlagFor("tree", reveal("tree"), true, "pin")).toBe(true);
    expect(scrollFlagFor("tree", reveal("all"), true, "pin")).toBe(true);
    expect(scrollFlagFor("tree", reveal("hex"), true, "pin")).toBe(false);
    expect(scrollFlagFor("tree", reveal("decoded"), true, "pin")).toBe(false);
    expect(scrollFlagFor("tree", reveal("tree"), false, "pin")).toBe(false);
    expect(scrollFlagFor("decoded", reveal("decoded"), true, "pin")).toBe(true);
    expect(scrollFlagFor("decoded", reveal("all"), false, "pin")).toBe(false);
    expect(scrollFlagFor("decoded", null, true, "pin")).toBe(false);
  });

  test("the flag for one subject stays down through a reveal of the other", () => {
    // A pinned row scrolls on the pin flag's rise, so a diagnostic reveal must not raise it.
    const diagnostic: Reveal = { target: "all", seq: 2, subject: "diagnostic" };
    expect(scrollFlagFor("tree", diagnostic, true, "pin")).toBe(false);
    expect(scrollFlagFor("tree", diagnostic, true, "diagnostic")).toBe(true);
    const pin: Reveal = { target: "tree", seq: 3, subject: "pin" };
    expect(scrollFlagFor("tree", pin, true, "diagnostic")).toBe(false);
    expect(scrollFlagFor("tree", pin, true, "pin")).toBe(true);
  });
});

describe("stepPin", () => {
  test("moves the current and rewrites the node to it, through the pin's own bridge", () => {
    const bridge = personsBridge();
    const pin = makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl");
    expect(pin.node.cborPath).toBe("$[0].name");
    const next = stepPin(pin, 1);
    expect(next.current).toBe(1);
    expect(next.node.entry).toBe(pin.instances[1]);
    expect(next.node.cborPath).toBe("$[1].name");
    expect(next.node.decodedPath).toBe("$[1].name");
    expect(next.instances).toBe(pin.instances);
    expect(next.bridge).toBe(bridge);
    expect(stepPin(next, 1).current).toBe(0);
    expect(stepPin(pin, -1).current).toBe(1);
  });

  test("never touches the live bridge — an empty one changes nothing", () => {
    const bridge = personsBridge();
    const pin = makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl");
    // Empty live bridge between keystroke and debounce.
    expect(EMPTY_BRIDGE.entries.length).toBe(0);
    const next = stepPin(pin, 1);
    expect(next.node.cborPath).toBe("$[1].name");
    expect(EMPTY_BRIDGE.instancesOf(next.node.entry)).toEqual([next.node.entry]);
  });

  test("a group of one is the same pin", () => {
    const bridge = personsBridge();
    const pin = makePin(bridge, findNodeByCddlOffset(bridge, at("Persons"))!, "cddl");
    expect(stepPin(pin, 1)).toBe(pin);
  });

  test("a current past the end is read as the last", () => {
    const bridge = personsBridge();
    const pin: PinState = { ...makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl"), current: 99 };
    expect(currentIndex(pin)).toBe(1);
    expect(stepPin(pin, 1).current).toBe(0);
  });
});

/** Row as the DOM pass sees it, remembering what was written on it. */
function row(attr: string | null): MarkableRow & { classes: Set<string>; attrs: Map<string, string>; reads: number } {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const r = {
    classes,
    attrs,
    reads: 0,
    getAttribute: (name: string) => {
      if (name !== "data-span" && name !== "data-path") return attrs.get(name) ?? null;
      r.reads++;
      return attr;
    },
    setAttribute: (name: string, value: string) => { attrs.set(name, value); },
    removeAttribute: (name: string) => { attrs.delete(name); },
    classList: { add: (c: string) => { classes.add(c); }, remove: (c: string) => { classes.delete(c); } },
  };
  return r;
}

const HOLDS: HolderMarks = { className: "holds", countAttribute: "data-holds", find: treeHolders };

describe("markLinkedRows", () => {
  test("marks the rows whose attribute names a key, reading each row once", () => {
    const rows = [row("2:5"), row("7:6 1:17"), row("19:5"), row(null), row("24:4")];
    const marked = markLinkedRows(NO_MARKS, rows, "data-span", new Set(["2:5", "1:17", "19:5"]), "lit");
    expect(marked.rows).toEqual([rows[0], rows[1], rows[2]]);
    expect(marked.holders).toEqual([]);
    expect(rows.map(r => r.classes.has("lit"))).toEqual([true, true, true, false, false]);
    for (const r of rows) expect(r.reads).toBe(1);
  });

  test("unmarks the previous set, and reads nothing with no keys", () => {
    const rows = [row("2:5"), row("19:5")];
    const first = markLinkedRows(NO_MARKS, rows, "data-span", new Set(["2:5"]), "lit");
    expect(rows[0].classes.has("lit")).toBe(true);
    const second = markLinkedRows(first, rows, "data-span", new Set(["19:5"]), "lit");
    expect(rows[0].classes.has("lit")).toBe(false);
    expect(rows[1].classes.has("lit")).toBe(true);
    const reads = rows.map(r => r.reads);
    const none = markLinkedRows(second, rows, "data-span", null, "lit");
    expect(none).toBe(NO_MARKS);
    expect(rows[1].classes.has("lit")).toBe(false);
    expect(rows.map(r => r.reads)).toEqual(reads);
  });

  test("a whole-word match only", () => {
    const rows = [row("12:5"), row("2:50")];
    expect(markLinkedRows(NO_MARKS, rows, "data-span", new Set(["2:5"]), "lit").rows).toEqual([]);
  });

  test("an instance with no row is counted on the row that holds it", () => {
    // Closed array 6..34 under a map 0..40; items 8..5 and 20..5 are off screen.
    const rows = [row("0:1 0:40"), row("1:5"), row("6:2 6:34"), row("40:5")];
    const keys = new Set(["1:5", "8:5", "20:5", "40:5", "70:3"]);
    const marks = markLinkedRows(NO_MARKS, rows, "data-span", keys, "lit", HOLDS);
    expect(marks.rows).toEqual([rows[1], rows[3]]);
    // Hidden items land on the closed array, not the map; a span past the document has no holder.
    expect(marks.holders).toEqual([rows[2]]);
    expect(rows[2].classes.has("holds")).toBe(true);
    expect(rows[2].attrs.get("data-holds")).toBe("2");
    expect(rows[0].classes.has("holds")).toBe(false);
  });

  test("the next pass takes the holder cue off again", () => {
    const rows = [row("0:1 0:40"), row("6:2 6:34")];
    const first = markLinkedRows(NO_MARKS, rows, "data-span", new Set(["8:5"]), "lit", HOLDS);
    expect(rows[1].attrs.get("data-holds")).toBe("1");
    const second = markLinkedRows(first, rows, "data-span", new Set(["6:2"]), "lit", HOLDS);
    expect(second.holders).toEqual([]);
    expect(rows[1].classes.has("holds")).toBe(false);
    expect(rows[1].attrs.has("data-holds")).toBe(false);
    expect(rows[1].classes.has("lit")).toBe(true);
    markLinkedRows(second, rows, "data-span", null, "lit", HOLDS);
    expect(rows[1].classes.has("lit")).toBe(false);
  });

  test("with no class only the holders are marked", () => {
    // Pass is for keys no row names; rows that name a key already show it.
    const rows = [row("0:1 0:40"), row("1:5"), row("6:2 6:34"), row("40:5")];
    const keys = new Set(["1:5", "8:5", "20:5"]);
    const marks = markLinkedRows(NO_MARKS, rows, "data-span", keys, null, HOLDS);
    expect(marks.rows).toEqual([]);
    expect(marks.holders).toEqual([rows[2]]);
    expect(rows[1].classes.size).toBe(0);
    expect(rows[2].classes.has("holds")).toBe(true);
    expect(rows[2].attrs.get("data-holds")).toBe("2");
    const next = markLinkedRows(marks, rows, "data-span", new Set(["1:5"]), null, HOLDS);
    expect(next).toEqual({ rows: [], holders: [] });
    expect(rows[2].classes.has("holds")).toBe(false);
    expect(rows[2].attrs.has("data-holds")).toBe(false);
    for (const r of rows) expect(r.classes.size).toBe(0);
  });

  test("a holder count is written through `format`", () => {
    const rows = [row("0:1 0:40"), row("6:2 6:34")];
    const worded: HolderMarks = { ...HOLDS, format: n => `holds ${n} thing${n === 1 ? "" : "s"}` };
    markLinkedRows(NO_MARKS, rows, "data-span", new Set(["8:5"]), "lit", worded);
    expect(rows[1].attrs.get("data-holds")).toBe("holds 1 thing");
    markLinkedRows(NO_MARKS, rows, "data-span", new Set(["8:5", "20:5"]), "lit", worded);
    expect(rows[1].attrs.get("data-holds")).toBe("holds 2 things");
  });

  test("a missing key counts for what it weighs — the diagnostics on the row it names", () => {
    // Two diagnostics on 8..5, one on 20..5; neither row is on screen.
    const rows = [row("0:1 0:40"), row("6:2 6:34")];
    const lists = new Map([["8:5", 2], ["20:5", 1]]);
    const weighted: HolderMarks = {
      ...HOLDS,
      weight: key => lists.get(key) ?? 1,
      format: n => `holds ${n} mismatch${n === 1 ? "" : "es"}`,
    };
    markLinkedRows(NO_MARKS, rows, "data-span", new Set(["8:5"]), null, weighted);
    expect(rows[1].attrs.get("data-holds")).toBe("holds 2 mismatches");
    markLinkedRows(NO_MARKS, rows, "data-span", new Set(["8:5", "20:5"]), null, weighted);
    expect(rows[1].attrs.get("data-holds")).toBe("holds 3 mismatches");
    // Without a weight a key is one.
    markLinkedRows(NO_MARKS, rows, "data-span", new Set(["8:5", "20:5"]), null, HOLDS);
    expect(rows[1].attrs.get("data-holds")).toBe("2");
  });

  test("holders are not looked for while every instance has a row", () => {
    const rows = [row("0:1 0:40"), row("1:5")];
    let asked = 0;
    const holds: HolderMarks = { ...HOLDS, find: (...args) => { asked++; return treeHolders(...args); } };
    markLinkedRows(NO_MARKS, rows, "data-span", new Set(["1:5"]), "lit", holds);
    expect(asked).toBe(0);
    markLinkedRows(NO_MARKS, rows, "data-span", new Set(["1:5", "9:1"]), "lit", holds);
    expect(asked).toBe(1);
  });

  test("the key sets the panes build", () => {
    expect(treeKeys([{ offset: 2, length: 5 }, { offset: 19, length: 5 }])).toEqual(new Set(["2:5", "19:5"]));
    expect(treeKeys([])).toBeNull();
    expect(pathKeys(["$[0]", "$[1]"])).toEqual(new Set(["$[0]", "$[1]"]));
    expect(pathKeys([])).toBeNull();
  });
});

describe("parentPath", () => {
  test("strips one segment of any spelling", () => {
    expect(parentPath('$.transaction_body["1"][1]["1"].coin')).toBe('$.transaction_body["1"][1]["1"]');
    expect(parentPath('$.transaction_body["1"][1]["1"]')).toBe('$.transaction_body["1"][1]');
    expect(parentPath('$.transaction_body["1"][1]')).toBe('$.transaction_body["1"]');
    expect(parentPath('$.transaction_body["1"]')).toBe("$.transaction_body");
    expect(parentPath("$.transaction_body")).toBe("$");
  });

  test("a quoted key keeps its dots, brackets and escapes together", () => {
    expect(parentPath('$.a["b.c[0]"]')).toBe("$.a");
    expect(parentPath('$.a["b\\"c"].d')).toBe('$.a["b\\"c"]');
    expect(parentPath('$.a["b\\"c"]')).toBe("$.a");
  });

  test("the root has no parent", () => {
    expect(parentPath("$")).toBeNull();
    expect(parentPath("")).toBeNull();
  });
});

describe("decodedHolders", () => {
  test("each missing path counts on its nearest ancestor with a row", () => {
    const rows = [row("$"), row("$.body"), row('$.body["1"]'), row('$.body["1"][0]'), row('$.body["2"]')];
    const holders = decodedHolders(rows, "data-path", [
      '$.body["1"][0]["1"]',
      '$.body["1"][1]["1"].coin',
      '$.body["1"][1]["0"]',
      "$.witnesses[0]",
    ]);
    expect(holders.get(rows[3])).toBe(1);
    expect(holders.get(rows[2])).toBe(2);
    expect(holders.get(rows[0])).toBe(1);
    expect(holders.size).toBe(3);
  });

  test("a folded run's row, carrying the run's last path, holds what lies under the run", () => {
    const rows = [row("$"), row("$.a.b.c.d")];
    const holders = decodedHolders(rows, "data-path", ["$.a.b.c.d.e[0]"]);
    expect(holders.get(rows[1])).toBe(1);
    expect(holders.size).toBe(1);
  });

  test("a weighted path adds its weight", () => {
    const rows = [row("$"), row("$.a")];
    const weight = (path: string) => (path === "$.a.b" ? 3 : 1);
    const holders = decodedHolders(rows, "data-path", ["$.a.b", "$.a.c", "$.z"], weight);
    expect(holders.get(rows[1])).toBe(4);
    expect(holders.get(rows[0])).toBe(1);
  });
});

describe("treeHolders", () => {
  test("the deepest container covering the bytes, whatever came before it in the rows", () => {
    // root 0..100; [0] map 1..40 open with closed value array 4..36; [1] map 41..59 closed.
    const rows = [
      row("0:1 0:100"), row("1:1 1:40"), row("2:3"), row("4:2 4:36"), row("41:1 41:19"), row("60:5"),
    ];
    const holders = treeHolders(rows, "data-span", ["10:4", "30:6", "45:2", "70:3", "200:1"]);
    expect(holders.get(rows[3])).toBe(2);
    expect(holders.get(rows[4])).toBe(1);
    // Bytes under no closed row count on the deepest open container; bytes outside every container on nothing.
    expect(holders.get(rows[0])).toBe(1);
    expect(holders.size).toBe(3);
  });

  test("a container with header only, or a leaf, holds nothing", () => {
    const rows = [row("0:1"), row("1:5")];
    expect(treeHolders(rows, "data-span", ["2:2"]).size).toBe(0);
  });

  test("a span the extent ends inside is not held", () => {
    const rows = [row("0:1 0:10")];
    expect(treeHolders(rows, "data-span", ["8:5"]).size).toBe(0);
    expect(treeHolders(rows, "data-span", ["8:2"]).size).toBe(1);
  });

  test("a weighted span adds its weight", () => {
    const rows = [row("0:1 0:40"), row("6:2 6:34")];
    const weight = (key: string) => (key === "8:5" ? 2 : 1);
    const holders = treeHolders(rows, "data-span", ["8:5", "20:5"], weight);
    expect(holders.get(rows[1])).toBe(3);
  });
});

describe("the visited instances of a pin", () => {
  test("a fresh pin has visited its current instance only, so nothing else is kept open", () => {
    const bridge = personsBridge();
    const pin = makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl");
    expect(pin.visited).toEqual([0]);
    expect(visitedTreePositions(pin, true)).toEqual([]);
    expect(visitedDecodedPaths(pin, true)).toEqual([]);
  });

  test("a step adds where it lands; the instance it left stays visited", () => {
    const bridge = personsBridge();
    const pin = makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl");
    const next = stepPin(pin, 1);
    expect(next.visited).toEqual([0, 1]);
    expect(visitedTreePositions(next, true)).toEqual([pin.instances[0].cbor_byte_span!]);
    expect(visitedDecodedPaths(next, true)).toEqual(["$[0].name"]);
    // Back to the first: list unchanged, the other stays visited.
    const back = stepPin(next, 1);
    expect(back.visited).toBe(next.visited);
    expect(visitedDecodedPaths(back, true)).toEqual(["$[1].name"]);
  });

  test("nothing is kept open in a panel the pin is not mirrored to, or for no pin", () => {
    const bridge = personsBridge();
    const next = stepPin(makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl"), 1);
    expect(visitedTreePositions(next, false)).toEqual([]);
    expect(visitedDecodedPaths(next, false)).toEqual([]);
    expect(visitedTreePositions(null, true)).toEqual([]);
    expect(visitedDecodedPaths(null, true)).toEqual([]);
  });

  test("a visited index past the group is ignored", () => {
    const bridge = personsBridge();
    const pin: PinState = { ...makePin(bridge, findNodeByCddlOffset(bridge, at("name"))!, "cddl"), visited: [0, 7] };
    expect(visitedDecodedPaths(pin, true)).toEqual([]);
  });
});

describe("the hover path on the Conway schema with a transaction", () => {
  const conwayBridge = (): CborCddlBridge =>
    createCborCddlBridge(mapOf(CONWAY_TX_HEX, CONWAY_CDDL, "transaction"));

  test("instancesOf hands back one array per group", () => {
    const bridge = conwayBridge();
    for (const entry of bridge.entries) {
      expect(bridge.instancesOf(entry)).toBe(bridge.instancesOf(entry));
      expect(bridge.instancesOf(entry)).toContain(entry);
    }
  });

  test("two thousand schema-side link resolutions, instances included, stay under 20 ms", () => {
    const bridge = conwayBridge();
    const spans = bridge.entries
      .map(e => e.cddl_byte_span)
      .filter((s): s is NonNullable<typeof s> => !!s && s.char_length > 0);
    expect(spans.length).toBeGreaterThan(0);
    // Warm the index once.
    instanceSetFor(bridge, findNodeByCddlOffset(bridge, spans[0].char_offset)!, "cddl");
    const t0 = performance.now();
    let lit = 0;
    for (let i = 0; i < 2000; i++) {
      const span = spans[i % spans.length];
      const node = findNodeByCddlOffset(bridge, span.char_offset)!;
      lit += instanceSetFor(bridge, node, "cddl").lit.length;
    }
    const elapsed = performance.now() - t0;
    expect(lit).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(20);
  });

  test("a hover from the hex on a construct of five hundred instances lights one run", () => {
    const bridge = createCborCddlBridge(mapOf(personsHex(500), PERSONS_CDDL, "Persons"));
    // First byte of the first person's `name` key.
    const first = bridge.entries.find(e => e.entry_role === "key" && bridge.node(e).decodedPath === "$[0].name")!;
    const node = resolveProbe(bridge, { source: "hex", byteOffset: first.cbor_anchor_span!.offset })!;
    expect(node.entry).toBe(first);
    const set = instanceSetFor(bridge, node, "hex");
    expect(set.instances.length).toBe(500);
    const out = projectInstances(bridge, set.lit);
    expect(out.hexAll.length).toBe(1);
    expect(out.hexAll[0]).toBe(node.entry.cbor_anchor_span!);
  });
});

describe("makePin", () => {
  test("captures the group and the bridge the node was resolved against", () => {
    const bridge = personsBridge();
    const node: CborCddlNode = findNodeByCddlOffset(bridge, at("tstr"))!;
    const pin = makePin(bridge, node, "cddl");
    expect(pin.instances).toBe(bridge.instancesOf(node.entry));
    expect(pin.bridge).toBe(bridge);
    expect(pin.source).toBe("cddl");
    expect(pin.node).toBe(node);
  });

  test("an entry without a schema span is a pin of one", () => {
    const map: CborCddlMap = {
      cbor_paths: [{ suffix: "$" }],
      decoded_paths: [{ suffix: "$" }],
      entries: [{ cbor_path: 0, decoded_path: 0, entry_role: "value" } satisfies CborCddlMapEntry],
    };
    const bridge = createCborCddlBridge(map);
    const pin = makePin(bridge, bridge.node(bridge.entries[0]), "hex");
    expect(pin.instances).toEqual([bridge.entries[0]]);
    expect(pin.current).toBe(0);
  });
});
