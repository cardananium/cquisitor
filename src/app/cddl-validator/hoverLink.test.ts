import { describe, expect, test } from "bun:test";
import type { CborCddlMap, CborCddlMapEntry } from "@cardananium/cquisitor-lib";
import { createCborCddlBridge, type CborCddlBridge, type CborCddlNode } from "./cborCddlBridge";
import { createHoverLinkStore, hoverEditorMark, hoverEditorMarks, projectLink, projectTreeRow, type HoverLink } from "./hoverLink";
import { instanceSetFor } from "./instances";
import { mapPassFor, mapForCurrentInput, type CborCddlMapSource } from "./hooks";
import { safeMapCborToCddl } from "./cddlValidatorLib";
import { PERSON_DOC_HEX, PERSON_RULE, PERSON_SCHEMA, mapOf } from "./libForTests";
import { PRIORITY_LINKED, projectNode, resolveProbe, type HoverProbe } from "./pinResolvers";
import { pointerMove, type FrameSlot } from "./CddlEditor";
import { selectEditorLink, selectHexLink, selectTreeLink } from "./hooks";

const PERSON_CDDL = "Person = {\n  name: tstr,\n  age: uint,\n}\n";
// {"name": "Alice", "age": 20}
const PERSON_HEX = "a2646e616d6565416c6963656361676514";

/** Bridge over two rows: the root map and the `age` value inside it. */
function twoRowBridge(): CborCddlBridge {
  const map: CborCddlMap = {
    cbor_paths: [{ suffix: "$" }, { prefix: 0, suffix: ".age" }],
    decoded_paths: [{ suffix: "$" }, { prefix: 0, suffix: ".age" }],
    entries: [
      {
        cbor_path: 0, decoded_path: 0, entry_role: "value", cbor_type: "Map",
        cbor_byte_span: { offset: 0, length: 1 },
        cbor_anchor_span: { offset: 0, length: 17 },
        cddl_byte_span: { offset: 9, length: 30, char_offset: 9, char_length: 30, line: 1 },
      },
      {
        cbor_path: 1, decoded_path: 1, entry_role: "value", cbor_type: "U8",
        cbor_byte_span: { offset: 16, length: 1 },
        cbor_anchor_span: { offset: 16, length: 1 },
        cddl_byte_span: { offset: 32, length: 4, char_offset: 32, char_length: 4, line: 3 },
      },
    ],
  };
  return createCborCddlBridge(map);
}

/** `resolveProbe`, counting how often it ran. */
function countingResolver() {
  const calls: HoverProbe[] = [];
  const resolve = (bridge: CborCddlBridge, probe: HoverProbe) => {
    calls.push(probe);
    return resolveProbe(bridge, probe);
  };
  return { calls, resolve };
}

function subscribed(store: ReturnType<typeof createHoverLinkStore>) {
  const seen: Array<HoverLink | null> = [];
  store.subscribe(() => seen.push(store.get()));
  return seen;
}

describe("createHoverLinkStore", () => {
  test("resolves synchronously, and once per distinct probe", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    const seen = subscribed(store);
    store.setContext(twoRowBridge(), PERSON_CDDL);

    store.hoverHex(16);
    // Answer is there before `hoverHex` returns: no library round trip.
    expect(store.get()?.node?.cborPath).toBe("$.age");
    expect(calls.length).toBe(1);
    expect(seen.length).toBe(1);

    store.hoverHex(16);
    store.hoverHex(16);
    expect(calls.length).toBe(1);
    expect(seen.length).toBe(1);
  });

  test("a different probe that resolves to the same entry notifies nobody", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    const seen = subscribed(store);
    store.setContext(twoRowBridge(), PERSON_CDDL);

    store.hoverHex(2);
    const first = store.get();
    expect(first?.node?.cborPath).toBe("$");
    // Another byte of the same map: resolved again, but the link stands.
    store.hoverHex(5);
    expect(calls.length).toBe(2);
    expect(seen.length).toBe(1);
    expect(store.get()).toBe(first);
  });

  test("the link carries the projection a pin of the same row would paint", () => {
    const store = createHoverLinkStore();
    const bridge = twoRowBridge();
    store.setContext(bridge, PERSON_CDDL);
    store.hoverCddl(32);
    const link = store.get()!;
    expect(link.source).toBe("cddl");
    expect(link.cddlSource).toBe(PERSON_CDDL);
    expect(link.projection).toMatchObject(projectNode(bridge.node(bridge.entries[1])));
    expect(PERSON_CDDL.slice(...link.projection.cddl!)).toBe("uint");
  });

  test("a leave from the panel holding the pointer clears; from any other, nothing", () => {
    const store = createHoverLinkStore();
    const seen = subscribed(store);
    store.setContext(twoRowBridge(), PERSON_CDDL);

    store.hoverTree({ offset: 16, length: 1 });
    expect(seen.length).toBe(1);
    store.leave("hex");
    expect(store.get()).not.toBeNull();
    expect(seen.length).toBe(1);
    store.leave("tree");
    expect(store.get()).toBeNull();
    expect(seen.length).toBe(2);
    // Nothing to clear twice.
    store.leave("tree");
    expect(seen.length).toBe(2);
  });

  test("a tree position is compared by its two numbers, not by identity", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    store.setContext(twoRowBridge(), PERSON_CDDL);
    store.hoverTree({ offset: 0, length: 17 });
    store.hoverTree({ offset: 0, length: 17 });
    expect(calls.length).toBe(1);
    store.hoverTree({ offset: 0, length: 1 });
    expect(calls.length).toBe(2);
  });

  test("a decoded path is compared with its role", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    store.setContext(twoRowBridge(), PERSON_CDDL);
    store.hoverDecoded("$.age", "value");
    store.hoverDecoded("$.age", "value");
    expect(calls.length).toBe(1);
    store.hoverDecoded("$.age", "key");
    expect(calls.length).toBe(2);
  });

  test("the same primitive from another panel is a new probe", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    const seen = subscribed(store);
    store.setContext(twoRowBridge(), PERSON_CDDL);
    store.hoverHex(16);
    store.hoverTree({ offset: 16, length: 1 });
    expect(calls.length).toBe(2);
    // Same entry, but the link says which panel it came from.
    expect(seen.length).toBe(2);
    expect(store.get()?.source).toBe("tree");
  });

  test("a probe that resolves to nothing clears the link", () => {
    const store = createHoverLinkStore();
    const seen = subscribed(store);
    store.setContext(twoRowBridge(), PERSON_CDDL);
    store.hoverHex(16);
    store.hoverHex(400);
    expect(store.get()).toBeNull();
    expect(seen.length).toBe(2);
    store.hoverHex(401);
    expect(seen.length).toBe(2);
  });

  test("before any context, nothing resolves", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    store.hoverHex(0);
    expect(store.get()).toBeNull();
    expect(calls.length).toBe(0);
  });

  test("a listener can unsubscribe", () => {
    const store = createHoverLinkStore();
    store.setContext(twoRowBridge(), PERSON_CDDL);
    let notified = 0;
    const off = store.subscribe(() => notified++);
    store.hoverHex(16);
    off();
    store.leave("hex");
    expect(notified).toBe(1);
  });
});

describe("a tree row is a link on its own", () => {
  test("over an empty bridge, a row lights its own bytes and nothing on the schema side", () => {
    const store = createHoverLinkStore();
    const seen = subscribed(store);
    store.setContext(createCborCddlBridge({ entries: [], cbor_paths: [], decoded_paths: [] }), "Person = {");
    store.hoverTree({ offset: 16, length: 2 });
    const link = store.get()!;
    expect(seen.length).toBe(1);
    expect(link.source).toBe("tree");
    expect(link.node).toBeNull();
    expect(link.projection.hex).toEqual({ offset: 16, length: 2 });
    expect(link.projection.tree).toEqual({ offset: 16, length: 2 });
    expect(link.projection.cddl).toBeNull();
    expect(link.projection.decoded).toBeNull();
    // The editor paints nothing for it.
    expect(hoverEditorMark(link, "Person = {")).toBeNull();
  });

  test("before any context, the same", () => {
    const store = createHoverLinkStore();
    store.hoverTree({ offset: 0, length: 17 });
    expect(store.get()?.projection.hex).toEqual({ offset: 0, length: 17 });
    expect(store.get()?.node).toBeNull();
  });

  test("a row the map covers only through a wider entry keeps its own bytes; the rest is the entry's", () => {
    const store = createHoverLinkStore();
    const bridge = twoRowBridge();
    store.setContext(bridge, PERSON_CDDL);
    // The `age` key: no entry of its own, inside the root map's extent.
    store.hoverTree({ offset: 12, length: 4 });
    const link = store.get()!;
    expect(link.node?.cborPath).toBe("$");
    expect(link.projection.hex).toEqual({ offset: 12, length: 4 });
    expect(link.projection.tree).toEqual({ offset: 12, length: 4 });
    expect(link.projection.decoded).toBe("$");
    expect(link.projection.cddl).toEqual(projectNode(bridge.node(bridge.entries[0])).cddl);
    expect(link.projection.label).toBe(projectNode(bridge.node(bridge.entries[0])).label);
  });

  test("a row the map covers exactly paints as its pin would, at the row's own position", () => {
    const store = createHoverLinkStore();
    const bridge = twoRowBridge();
    store.setContext(bridge, PERSON_CDDL);
    store.hoverTree({ offset: 0, length: 17 });
    const link = store.get()!;
    expect(link.projection).toEqual(projectTreeRow(bridge.node(bridge.entries[0]), { offset: 0, length: 17 }));
    expect(link.projection.hex).toEqual(projectNode(bridge.node(bridge.entries[0])).hex);
  });

  test("two rows under one entry are two links", () => {
    const store = createHoverLinkStore();
    const seen = subscribed(store);
    store.setContext(twoRowBridge(), PERSON_CDDL);
    store.hoverTree({ offset: 1, length: 5 });
    store.hoverTree({ offset: 12, length: 4 });
    expect(seen.length).toBe(2);
    expect(seen[0]?.node?.entry).toBe(seen[1]?.node?.entry);
    expect(seen[0]?.projection.hex).not.toEqual(seen[1]?.projection.hex);
  });

  test("a leave from the tree drops it, and a byte from the hex has no such standing", () => {
    const store = createHoverLinkStore();
    store.setContext(createCborCddlBridge({ entries: [], cbor_paths: [], decoded_paths: [] }), "");
    store.hoverTree({ offset: 16, length: 2 });
    expect(store.get()).not.toBeNull();
    store.leave("tree");
    expect(store.get()).toBeNull();
    store.hoverHex(16);
    expect(store.get()).toBeNull();
  });

  test("a new document over the same empty bridge drops the row", () => {
    const store = createHoverLinkStore();
    const seen = subscribed(store);
    const empty = createCborCddlBridge({ entries: [], cbor_paths: [], decoded_paths: [] });
    store.setContext(empty, "", "a10102");
    store.hoverTree({ offset: 1, length: 1 });
    expect(seen.length).toBe(1);
    store.setContext(empty, "", "820102");
    expect(store.get()).toBeNull();
    expect(seen.length).toBe(2);
    // Same row again is a fresh probe over the new document.
    store.hoverTree({ offset: 1, length: 1 });
    expect(seen.length).toBe(3);
  });
});

describe("setContext", () => {
  test("a new bridge drops the link and forgets the probe", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    const seen = subscribed(store);
    store.setContext(twoRowBridge(), PERSON_CDDL);
    store.hoverHex(16);
    expect(seen.length).toBe(1);

    store.setContext(twoRowBridge(), PERSON_CDDL);
    expect(store.get()).toBeNull();
    expect(seen.length).toBe(2);
    // Same probe resolves again, against the new bridge.
    store.hoverHex(16);
    expect(calls.length).toBe(2);
    expect(store.get()?.node?.cborPath).toBe("$.age");
  });

  test("new schema text over the same bridge does the same", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    const seen = subscribed(store);
    const bridge = twoRowBridge();
    store.setContext(bridge, PERSON_CDDL);
    store.hoverCddl(32);
    store.setContext(bridge, `${PERSON_CDDL}\n`);
    expect(store.get()).toBeNull();
    expect(seen.length).toBe(2);
    store.hoverCddl(32);
    expect(calls.length).toBe(2);
    expect(store.get()?.cddlSource).toBe(`${PERSON_CDDL}\n`);
  });

  test("the same bridge and text again is a no-op", () => {
    const { calls, resolve } = countingResolver();
    const store = createHoverLinkStore(resolve);
    const seen = subscribed(store);
    const bridge = twoRowBridge();
    store.setContext(bridge, PERSON_CDDL);
    store.hoverHex(16);
    store.setContext(bridge, PERSON_CDDL);
    expect(store.get()).not.toBeNull();
    expect(seen.length).toBe(1);
    store.hoverHex(16);
    expect(calls.length).toBe(1);
  });

  test("dropping the link when there is none notifies nobody", () => {
    const store = createHoverLinkStore();
    const seen = subscribed(store);
    store.setContext(twoRowBridge(), PERSON_CDDL);
    store.setContext(twoRowBridge(), PERSON_CDDL);
    expect(seen.length).toBe(0);
  });
});

describe("staleness through the map guard", () => {
  const source = (over: Partial<CborCddlMapSource> = {}): CborCddlMapSource => ({
    cleanHex: PERSON_HEX,
    cddl: PERSON_CDDL,
    rule: "Person",
    schemaIsValid: true,
    ...over,
  });

  /** Store given the guarded bridge for `pass`, what's on screen, and the editor text. */
  function storeFor(pass: ReturnType<typeof mapPassFor>, over: Partial<CborCddlMapSource>, live: string) {
    const store = createHoverLinkStore();
    const view = mapForCurrentInput(pass, source(over), live);
    store.setContext(createCborCddlBridge(view.map), live);
    return store;
  }

  test("a keystroke in the schema silences the hover until the pass catches up", async () => {
    const pass = mapPassFor(source(), await safeMapCborToCddl(PERSON_HEX, PERSON_CDDL, "Person"));
    // The `age` key's header byte.
    const ageKey = 12;

    const settled = storeFor(pass, {}, PERSON_CDDL);
    settled.hoverHex(ageKey);
    const range = settled.get()?.projection.cddl;
    expect(range && PERSON_CDDL.slice(...range)).toBe("age");

    // Comment typed above the rules: the same map would name three characters of that line.
    const typed = `; who\n${PERSON_CDDL}`;
    expect(range && typed.slice(...range)).not.toBe("age");
    const settling = storeFor(pass, {}, typed);
    settling.hoverHex(ageKey);
    expect(settling.get()).toBeNull();

    // Once the pass reading `typed` lands, the same byte names the key again.
    const next = mapPassFor(source({ cddl: typed }), await safeMapCborToCddl(PERSON_HEX, typed, "Person"));
    const caughtUp = storeFor(next, { cddl: typed }, typed);
    caughtUp.hoverHex(ageKey);
    const after = caughtUp.get()?.projection.cddl;
    expect(after && typed.slice(...after)).toBe("age");
  });

  test("the editor refuses a link made over other text, even before the swap", () => {
    // One render between a keystroke and the layout effect that swaps the bridge.
    const bridge = createCborCddlBridge(mapOf(PERSON_HEX, PERSON_CDDL, "Person"));
    const store = createHoverLinkStore();
    store.setContext(bridge, PERSON_CDDL);
    store.hoverHex(12);
    const link = store.get()!;
    expect(hoverEditorMark(link, PERSON_CDDL)).not.toBeNull();
    expect(hoverEditorMark(link, `; who\n${PERSON_CDDL}`)).toBeNull();
  });
});

describe("two reference sites of one rule", () => {
  const cddl = "doc = { 1: coin, 2: coin }\ncoin = uint\n";
  // {1: 10, 2: 20}
  const hex = "a2010a0214";

  test("are two links, each lighting its own member", () => {
    const store = createHoverLinkStore();
    store.setContext(createCborCddlBridge(mapOf(hex, cddl, "doc"), cddl), cddl, hex);
    store.hoverCddl(cddl.indexOf("1: coin") + 3);
    const first = store.get()!;
    expect(first.instances.length).toBe(1);
    expect(selectHexLink(store.get())).toEqual([{ offset: 2, length: 1 }]);
    store.hoverCddl(cddl.indexOf("2: coin") + 3);
    expect(store.get()).not.toBe(first);
    expect(selectHexLink(store.get())).toEqual([{ offset: 4, length: 1 }]);
    // The definition lights both.
    store.hoverCddl(cddl.indexOf("coin = uint"));
    expect(store.get()!.instances.length).toBe(2);
  });
});

describe("hoverEditorMarks", () => {
  const cddl = "doc = { 1: coin, 2: coin }\ncoin = uint\n";
  // {1: 10, 2: 20}
  const hex = "a2010a0214";
  const at = (needle: string) => cddl.indexOf(needle);

  test("a data-panel link marks the definition and the site the schema reaches it from", () => {
    const store = createHoverLinkStore();
    store.setContext(createCborCddlBridge(mapOf(hex, cddl, "doc"), cddl), cddl, hex);
    store.hoverHex(4);
    const marks = hoverEditorMarks(store.get(), cddl);
    expect(marks.map(m => cddl.slice(...m.range))).toEqual(["coin", "coin"]);
    expect(marks.map(m => m.range[0])).toEqual([at("coin = uint"), at("2: coin") + 3]);
    expect(marks[1].className).toBe(marks[0].className);
    expect(marks[1].message).toBe(marks[0].message);
    store.hoverDecoded("$[1]", "value");
    expect(hoverEditorMarks(store.get(), cddl).map(m => m.range[0])).toEqual([at("coin = uint"), at("1: coin") + 3]);
  });

  test("a schema link marks the definition only, and a stale text nothing", () => {
    const store = createHoverLinkStore();
    store.setContext(createCborCddlBridge(mapOf(hex, cddl, "doc"), cddl), cddl, hex);
    store.hoverCddl(at("1: coin") + 3);
    expect(hoverEditorMarks(store.get(), cddl).map(m => m.range[0])).toEqual([at("coin = uint")]);
    expect(hoverEditorMarks(store.get(), cddl + " ")).toEqual([]);
    expect(hoverEditorMarks(null, cddl)).toEqual([]);
  });

  test("a tree row's link carries the site too", () => {
    const store = createHoverLinkStore();
    store.setContext(createCborCddlBridge(mapOf(hex, cddl, "doc"), cddl), cddl, hex);
    store.hoverTree({ offset: 4, length: 1 });
    expect(store.get()!.projection.cddlSite).toEqual([at("2: coin") + 3, at("2: coin") + 7]);
  });
});

describe("the Person document, end to end", () => {
  function bootStore() {
    const store = createHoverLinkStore();
    store.setContext(createCborCddlBridge(mapOf(PERSON_DOC_HEX, PERSON_SCHEMA, PERSON_RULE)), PERSON_SCHEMA, PERSON_DOC_HEX);
    return store;
  }
  const uint = PERSON_SCHEMA.indexOf("uint");
  const inside = uint + 2;
  /** What the editor pane hands the store for what the editor emitted. */
  const fromEditor = (store: ReturnType<typeof bootStore>) => (offset: number | null) =>
    offset === null ? store.leave("cddl") : store.hoverCddl(offset);

  test("a pointer over `uint` in the editor lights its bytes, its row and itself, with no frame", () => {
    const store = bootStore();
    const frame: FrameSlot = { current: null };
    const emit = fromEditor(store);
    // Hit test for a point inside the token; the frame never runs.
    pointerMove(frame, 91, 213, () => emit(inside), () => {}, () => 1);

    const link = selectEditorLink(store.get());
    expect(link?.source).toBe("cddl");
    expect(link?.node?.cborPath).toBe("$.age");
    const hex = selectHexLink(store.get());
    expect(hex).toEqual([{ offset: 16, length: 2 }]);
    expect(PERSON_DOC_HEX.slice(hex[0].offset * 2, (hex[0].offset + hex[0].length) * 2)).toBe("181e");
    expect(selectTreeLink(store.get())).toEqual([{ offset: 16, length: 2 }]);
    // The editor paints the link against the text it holds.
    const mark = hoverEditorMark(link, PERSON_SCHEMA);
    expect(mark && PERSON_SCHEMA.slice(...mark.range)).toBe("uint");
    expect(mark?.message).toBeNull();

    // Leaving the editor unpaints every panel.
    emit(null);
    expect(store.get()).toBeNull();
    expect(selectHexLink(store.get())).toEqual([]);
    expect(selectTreeLink(store.get())).toEqual([]);
    expect(hoverEditorMark(selectEditorLink(store.get()), PERSON_SCHEMA)).toBeNull();
  });

  test("a pointer over the `nickname` key bytes lights the key in the editor", () => {
    const store = bootStore();
    // First byte of the key's header, as the hex view reports it.
    store.hoverHex(18);
    const link = selectEditorLink(store.get());
    const mark = hoverEditorMark(link, PERSON_SCHEMA);
    expect(mark && PERSON_SCHEMA.slice(...mark.range)).toBe("nickname");
    expect(mark?.message).toContain("$.nickname");
    expect(selectTreeLink(store.get())).toEqual([{ offset: 18, length: 9 }]);
    store.leave("hex");
    expect(store.get()).toBeNull();
  });

  test("the editor's link is refused against any other text", () => {
    const store = bootStore();
    fromEditor(store)(inside);
    expect(hoverEditorMark(store.get(), `${PERSON_SCHEMA} `)).toBeNull();
  });
});

describe("hoverEditorMark", () => {
  const bridge = createCborCddlBridge(mapOf(PERSON_HEX, PERSON_CDDL, "Person"));
  const ageValue = bridge.entries
    .map((e: CborCddlMapEntry) => bridge.node(e))
    .find((n: CborCddlNode) => n.cborPath === "$.age" && n.entry.entry_role === "value")!;
  const linkFrom = (source: HoverLink["source"]): HoverLink => {
    const set = instanceSetFor(bridge, ageValue, source);
    return {
      source,
      node: ageValue,
      cddlSource: PERSON_CDDL,
      projection: projectLink(bridge, ageValue, set),
      instances: set.instances,
      instanceIndex: set.index,
    };
  };

  test("paints the construct at the hover priority", () => {
    const mark = hoverEditorMark(linkFrom("hex"), PERSON_CDDL)!;
    expect(mark.className).toBe("cddl-editor-linked-mark");
    expect(mark.priority).toBe(PRIORITY_LINKED);
    expect(PERSON_CDDL.slice(...mark.range)).toBe("uint");
  });

  test("the editor's own echo carries no message; a link from elsewhere names its node", () => {
    expect(hoverEditorMark(linkFrom("cddl"), PERSON_CDDL)?.message).toBeNull();
    expect(hoverEditorMark(linkFrom("tree"), PERSON_CDDL)?.message).toContain("$.age");
  });

  test("nothing for no link", () => {
    expect(hoverEditorMark(null, PERSON_CDDL)).toBeNull();
  });
});

describe("every instance of a schema construct", () => {
  const PERSONS_CDDL = "Person = { name: tstr, age: uint }\nPersons = [+Person]\n";
  // [{"name":"Alice","age":20},{"name":"Bob","age":31}]
  const PERSONS_HEX = "82a2646e616d6565416c6963656361676514a2646e616d6563426f6263616765181f";
  const personsBridge = () => createCborCddlBridge(mapOf(PERSONS_HEX, PERSONS_CDDL, "Persons"));
  const NAME = PERSONS_CDDL.indexOf("name");

  test("a hover from the schema lights every run the construct matched", () => {
    const store = createHoverLinkStore();
    const bridge = personsBridge();
    const seen = subscribed(store);
    store.setContext(bridge, PERSONS_CDDL, PERSONS_HEX);
    store.hoverCddl(NAME);
    const link = store.get()!;
    expect(link.projection.hexAll).toEqual([{ offset: 2, length: 5 }, { offset: 19, length: 5 }]);
    expect(link.projection.treeAll).toEqual([{ offset: 2, length: 5 }, { offset: 19, length: 5 }]);
    expect(link.projection.decodedAll).toEqual(["$[0].name", "$[1].name"]);
    expect(link.instances).toBe(bridge.instancesOf(bridge.entries[4]));
    expect(link.instanceIndex).toBe(-1);
    expect(link.projection.label.endsWith("· 2 instances")).toBe(true);
    expect(seen.length).toBe(1);
    // Next character of the same construct: same head entry, no notification, same link object.
    store.hoverCddl(NAME + 1);
    expect(seen.length).toBe(1);
    expect(store.get()).toBe(link);
    // Arrays are the entries' own span objects, not copies.
    expect(link.projection.hexAll[0]).toBe(bridge.entries[4].cbor_anchor_span!);
  });

  test("a hover from the hex lights its own run and counts its siblings", () => {
    const store = createHoverLinkStore();
    const bridge = personsBridge();
    const seen = subscribed(store);
    store.setContext(bridge, PERSONS_CDDL, PERSONS_HEX);
    store.hoverHex(20);
    const link = store.get()!;
    expect(link.projection.hexAll).toEqual([{ offset: 19, length: 5 }]);
    expect(link.projection.decodedAll).toEqual(["$[1].name"]);
    expect(link.instances.length).toBe(2);
    expect(link.instanceIndex).toBe(1);
    expect(link.projection.label.endsWith("· instance 2 of 2")).toBe(true);
    // First person's key: a new link, at index 0.
    store.hoverHex(3);
    expect(seen.length).toBe(2);
    expect(store.get()!.instanceIndex).toBe(0);
    expect(store.get()!.projection.hexAll).toEqual([{ offset: 2, length: 5 }]);
  });

  test("a tree row lights its own position alone, and knows its place in the group", () => {
    const store = createHoverLinkStore();
    const bridge = personsBridge();
    store.setContext(bridge, PERSONS_CDDL, PERSONS_HEX);
    store.hoverTree({ offset: 19, length: 5 });
    const link = store.get()!;
    expect(link.projection.hexAll).toEqual([{ offset: 19, length: 5 }]);
    expect(link.projection.treeAll).toEqual([{ offset: 19, length: 5 }]);
    expect(link.projection.decodedAll).toEqual(["$[1].name"]);
    expect(link.instanceIndex).toBe(1);
    expect(link.instances.length).toBe(2);
  });

  test("a new bridge drops the link, and the next link's instances are the new bridge's", () => {
    const store = createHoverLinkStore();
    const old = personsBridge();
    store.setContext(old, PERSONS_CDDL, PERSONS_HEX);
    store.hoverCddl(NAME);
    const before = store.get()!;
    expect(before.instances[0]).toBe(old.entries[4]);

    const fresh = personsBridge();
    store.setContext(fresh, PERSONS_CDDL, PERSONS_HEX);
    expect(store.get()).toBeNull();
    store.hoverCddl(NAME);
    const after = store.get()!;
    expect(after.instances[0]).toBe(fresh.entries[4]);
    expect(fresh.entries).toContain(after.instances[0]);
    expect(old.entries).not.toContain(after.instances[0]);
    expect(after.instances).not.toBe(before.instances);

    // A new document over the same empty bridge drops it too.
    const empty = createCborCddlBridge({ entries: [], cbor_paths: [], decoded_paths: [] });
    store.setContext(empty, "", "a10102");
    store.hoverTree({ offset: 1, length: 1 });
    expect(store.get()?.instances).toEqual([]);
    store.setContext(empty, "", "820102");
    expect(store.get()).toBeNull();
  });

  test("the editor's mark is one span for the whole set, and says how many only from elsewhere", () => {
    const store = createHoverLinkStore();
    const bridge = personsBridge();
    store.setContext(bridge, PERSONS_CDDL, PERSONS_HEX);
    store.hoverCddl(NAME);
    const own = hoverEditorMark(store.get(), PERSONS_CDDL)!;
    expect(PERSONS_CDDL.slice(...own.range)).toBe("name");
    expect(own.message).toBeNull();
    store.hoverHex(20);
    const fromHex = hoverEditorMark(store.get(), PERSONS_CDDL)!;
    expect(fromHex.range).toEqual(own.range);
    expect(fromHex.message).toContain("instance 2 of 2");
    expect(fromHex.priority).toBe(PRIORITY_LINKED);
  });
});
