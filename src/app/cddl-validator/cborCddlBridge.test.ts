import { describe, expect, test } from "bun:test";
import type { CborCddlMap, CborCddlPathEntry } from "@cardananium/cquisitor-lib";
import { createCborCddlBridge, nameRunAt, preferRole } from "./cborCddlBridge";
import { mapOf as libMapOf } from "./libForTests";

/** Library fold: prefix text + suffix. The lazy resolver must match this. */
function resolvePaths(table: CborCddlPathEntry[]): string[] {
  const out: string[] = [];
  for (const entry of table) {
    out.push((entry.prefix === undefined ? "" : out[entry.prefix]) + entry.suffix);
  }
  return out;
}

function mapOf(
  cborPaths: CborCddlPathEntry[],
  decodedPaths: CborCddlPathEntry[],
  entries: Array<{ cbor: number; decoded: number; role?: "key" | "value" }>,
): CborCddlMap {
  return {
    cbor_paths: cborPaths,
    decoded_paths: decodedPaths,
    entries: entries.map(e => ({
      cbor_path: e.cbor,
      decoded_path: e.decoded,
      entry_role: e.role ?? "value",
    })),
  };
}

describe("path table resolution", () => {
  const table: CborCddlPathEntry[] = [
    { suffix: "$" },
    { prefix: 0, suffix: ".body" },
    { prefix: 1, suffix: "[0]" },
    { prefix: 2, suffix: '["outputs"]' },
    { prefix: 3, suffix: ".coin" },
  ];

  test("a row resolves to the chain above it", () => {
    const bridge = createCborCddlBridge(mapOf(table, table, [{ cbor: 4, decoded: 4 }]));
    expect(bridge.node(bridge.entries[0]).cborPath).toBe('$.body[0]["outputs"].coin');
  });

  test("every row agrees with the documented fold", () => {
    const expected = resolvePaths(table);
    const bridge = createCborCddlBridge(
      mapOf(table, table, table.map((_, i) => ({ cbor: i, decoded: i }))),
    );
    expect(bridge.entries.map(e => bridge.node(e).cborPath)).toEqual(expected);
  });

  test("resolving a deep row first still resolves a shallow one after it", () => {
    // Ask order must not change the answer; the resolver caches as it walks.
    const bridge = createCborCddlBridge(
      mapOf(table, table, [{ cbor: 4, decoded: 4 }, { cbor: 1, decoded: 1 }]),
    );
    expect(bridge.node(bridge.entries[0]).cborPath).toBe('$.body[0]["outputs"].coin');
    expect(bridge.node(bridge.entries[1]).cborPath).toBe("$.body");
  });

  test("a prefix is a text prefix, not necessarily a whole segment", () => {
    const shared: CborCddlPathEntry[] = [
      { suffix: "$.a" },
      { prefix: 0, suffix: "ge" },
    ];
    const bridge = createCborCddlBridge(mapOf(shared, shared, [{ cbor: 1, decoded: 1 }]));
    expect(bridge.node(bridge.entries[0]).cborPath).toBe("$.age");
  });

  test("an index the table does not have resolves to nothing", () => {
    const bridge = createCborCddlBridge(mapOf(table, table, []));
    const stray = { cbor_path: 99, decoded_path: -1, entry_role: "value" as const };
    expect(bridge.node(stray).cborPath).toBe("");
    expect(bridge.node(stray).decodedPath).toBe("");
  });

  test("a prefix that does not point backwards terminates instead of looping", () => {
    // A prefix that does not name an earlier row is treated as suffix-only.
    const broken: CborCddlPathEntry[] = [
      { prefix: 0, suffix: "$" },
      { prefix: 2, suffix: ".b" },
      { prefix: 1, suffix: ".a" },
    ];
    const bridge = createCborCddlBridge(
      mapOf(broken, broken, broken.map((_, i) => ({ cbor: i, decoded: i }))),
    );
    expect(bridge.entries.map(e => bridge.node(e).cborPath)).toEqual(["$", ".b", ".b.a"]);
  });
});

describe("decoded-path lookup", () => {
  const decoded: CborCddlPathEntry[] = [
    { suffix: "$" },
    { prefix: 0, suffix: ".m" },
    { prefix: 1, suffix: '["0"]' },
  ];
  const bridge = createCborCddlBridge(
    mapOf(decoded, decoded, [
      { cbor: 0, decoded: 0 },
      { cbor: 1, decoded: 1, role: "key" },
      { cbor: 1, decoded: 1, role: "value" },
      { cbor: 2, decoded: 2 },
    ]),
  );

  test("a numeric map key and an array index name the same segment", () => {
    expect(bridge.entriesAtDecodedPath("$.m[0]")).toEqual([bridge.entries[3]]);
    expect(bridge.entriesAtDecodedPath('$.m["0"]')).toEqual([bridge.entries[3]]);
  });

  test("both rows of a map entry come back together", () => {
    expect(bridge.entriesAtDecodedPath("$.m")).toEqual([bridge.entries[1], bridge.entries[2]]);
  });

  test("a path nothing was emitted for has no entries", () => {
    expect(bridge.entriesAtDecodedPath("$.other")).toEqual([]);
  });

  test("the deepest ancestor stands in for a synthetic key", () => {
    expect(bridge.entriesAtDecodedAncestor('$.m["@entries"][1].key'))
      .toEqual([bridge.entries[1], bridge.entries[2]]);
  });

  test("the root stands in when nothing deeper matches", () => {
    expect(bridge.entriesAtDecodedAncestor("$.absent.deeper")).toEqual([bridge.entries[0]]);
  });

  test("a path with no ancestor at all resolves to nothing", () => {
    const rootless = createCborCddlBridge(
      mapOf(decoded, decoded, [{ cbor: 2, decoded: 2 }]),
    );
    expect(rootless.entriesAtDecodedAncestor("$.absent")).toEqual([]);
  });

  test("a row whose suffix extends its prefix's last segment is found at the path it spells", () => {
    // Table shares `$.tx` into `$.tx_hash`: segment is `tx_hash`, not `tx` + `_hash`.
    const shared: CborCddlPathEntry[] = [
      { suffix: "$" },
      { prefix: 0, suffix: ".tx" },
      { prefix: 1, suffix: "_hash" },
      { prefix: 2, suffix: ".x" },
    ];
    const b = createCborCddlBridge(
      mapOf(shared, shared, shared.map((_, i) => ({ cbor: i, decoded: i }))),
    );
    expect(b.entriesAtDecodedPath("$.tx")).toEqual([b.entries[1]]);
    expect(b.entriesAtDecodedPath("$.tx_hash")).toEqual([b.entries[2]]);
    expect(b.entriesAtDecodedPath("$.tx_hash.x")).toEqual([b.entries[3]]);
    expect(b.entriesAtDecodedPath("$.tx.x")).toEqual([]);
    expect(b.entriesAtDecodedAncestor("$.tx_hash.y")).toEqual([b.entries[2]]);
  });
});

describe("cbor-path lookup", () => {
  // CBOR spells a numeric map key `[1]`; decoded spells `["1"]`. A tag is
  // transparent to CBOR paths and a wrapper on decoded ones.
  const cbor: CborCddlPathEntry[] = [
    { suffix: "$" },
    { prefix: 0, suffix: ".m" },
    { prefix: 1, suffix: "[0]" },
  ];
  const decoded: CborCddlPathEntry[] = [
    { suffix: "$" },
    { prefix: 0, suffix: '["@value"]' },
    { prefix: 1, suffix: ".m" },
    { prefix: 2, suffix: '["0"]' },
  ];
  const bridge = createCborCddlBridge(
    mapOf(cbor, decoded, [
      { cbor: 0, decoded: 0 },
      { cbor: 0, decoded: 1 },
      { cbor: 1, decoded: 2, role: "key" },
      { cbor: 1, decoded: 2, role: "value" },
      { cbor: 2, decoded: 3 },
    ]),
  );

  test("a numeric map key and an array index name the same segment", () => {
    expect(bridge.entriesAtCborPath("$.m[0]")).toEqual([bridge.entries[4]]);
    expect(bridge.entriesAtCborPath('$.m["0"]')).toEqual([bridge.entries[4]]);
  });

  test("the root finds every row filed at the root", () => {
    expect(bridge.entriesAtCborPath("$")).toEqual([bridge.entries[0], bridge.entries[1]]);
  });

  test("both rows of a map entry come back together", () => {
    expect(bridge.entriesAtCborPath("$.m")).toEqual([bridge.entries[2], bridge.entries[3]]);
  });

  test("a path nothing was emitted for has no entries", () => {
    expect(bridge.entriesAtCborPath("$.other")).toEqual([]);
    expect(bridge.entriesAtCborPath("$.m[0].deeper")).toEqual([]);
  });

  test("the deepest ancestor stands in for a path the map never filed", () => {
    expect(bridge.entriesAtCborAncestor("$.m.x.y")).toEqual([bridge.entries[2], bridge.entries[3]]);
    expect(bridge.entriesAtCborAncestor("$.absent.deeper")).toEqual([bridge.entries[0], bridge.entries[1]]);
  });

  test("a path with no ancestor at all resolves to nothing", () => {
    const rootless = createCborCddlBridge(mapOf(cbor, decoded, [{ cbor: 2, decoded: 3 }]));
    expect(rootless.entriesAtCborAncestor("$.absent")).toEqual([]);
  });

  test("the two indexes answer for their own table, whichever is asked first", () => {
    // Indexes are lazy; lookup order must not change either answer.
    const cborFirst = createCborCddlBridge(mapOf(cbor, decoded, [{ cbor: 2, decoded: 3 }]));
    expect(cborFirst.entriesAtCborPath("$.m[0]")).toEqual([cborFirst.entries[0]]);
    expect(cborFirst.entriesAtDecodedPath('$["@value"].m[0]')).toEqual([cborFirst.entries[0]]);
    expect(cborFirst.entriesAtDecodedPath("$.m[0]")).toEqual([]);
    const decodedFirst = createCborCddlBridge(mapOf(cbor, decoded, [{ cbor: 2, decoded: 3 }]));
    expect(decodedFirst.entriesAtDecodedPath('$["@value"].m["0"]')).toEqual([decodedFirst.entries[0]]);
    expect(decodedFirst.entriesAtCborPath("$.m[0]")).toEqual([decodedFirst.entries[0]]);
    expect(decodedFirst.entriesAtCborPath('$["@value"].m[0]')).toEqual([]);
  });
});

describe("a map ten thousand levels deep", () => {
  // One row per level, as for `[[[…]]]` against `x = [a: x] / uint`.
  const depth = 10_000;
  const table: CborCddlPathEntry[] = [{ suffix: "$" }];
  for (let i = 1; i <= depth; i++) table.push({ prefix: i - 1, suffix: ".a" });
  const bridge = createCborCddlBridge(
    mapOf(table, table, table.map((_, i) => ({ cbor: i, decoded: i }))),
  );
  const deepest = "$" + ".a".repeat(depth);

  test("the index is built from the suffixes, and the deepest path finds its row", () => {
    const t0 = performance.now();
    expect(bridge.entriesAtDecodedPath(deepest)).toEqual([bridge.entries[depth]]);
    expect(bridge.entriesAtDecodedPath("$" + ".a".repeat(depth / 2))).toEqual([bridge.entries[depth / 2]]);
    expect(bridge.entriesAtDecodedAncestor(deepest + '["@tag"]')).toEqual([bridge.entries[depth]]);
    // Well inside a frame: a quadratic index would take seconds and gigabytes.
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("the CBOR-path index is built the same way, under the same bound", () => {
    const t0 = performance.now();
    expect(bridge.entriesAtCborPath(deepest)).toEqual([bridge.entries[depth]]);
    expect(bridge.entriesAtCborPath("$" + ".a".repeat(depth / 2))).toEqual([bridge.entries[depth / 2]]);
    expect(bridge.entriesAtCborAncestor(deepest + ".b")).toEqual([bridge.entries[depth]]);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("resolving the deepest row costs its own path, not every path above it", () => {
    const t0 = performance.now();
    expect(bridge.node(bridge.entries[depth]).decodedPath).toBe(deepest);
    expect(bridge.node(bridge.entries[1]).cborPath).toBe("$.a");
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("preferRole", () => {
  const entries = [
    { cbor_path: 0, decoded_path: 0, entry_role: "key" as const },
    { cbor_path: 0, decoded_path: 0, entry_role: "value" as const },
  ];

  test("the clicked role wins", () => {
    expect(preferRole(entries, "key")).toBe(entries[0]);
    expect(preferRole(entries, "value")).toBe(entries[1]);
  });

  test("falls back to what the library did emit", () => {
    expect(preferRole([entries[1]], "key")).toBe(entries[1]);
    expect(preferRole([], "value")).toBeNull();
  });
});

describe("over a real map", () => {
  const PERSON_CDDL = "Person = {\n  name: tstr,\n  age: uint,\n}\n";
  const PERSON_HEX = "a2646e616d6565416c69636563616765623230";

  test("the resolver agrees with the documented fold on both tables", () => {
    const map = libMapOf(PERSON_HEX, PERSON_CDDL, "Person");
    const bridge = createCborCddlBridge(map);
    const cbor = resolvePaths(map.cbor_paths);
    const decoded = resolvePaths(map.decoded_paths);
    for (const entry of map.entries) {
      const node = bridge.node(entry);
      expect(node.cborPath).toBe(cbor[entry.cbor_path]);
      expect(node.decodedPath).toBe(decoded[entry.decoded_path]);
    }
  });

  test("a path the library emitted finds its own entries again", () => {
    const bridge = createCborCddlBridge(libMapOf(PERSON_HEX, PERSON_CDDL, "Person"));
    for (const entry of bridge.entries) {
      const found = bridge.entriesAtDecodedPath(bridge.node(entry).decodedPath);
      expect(found).toContain(entry);
    }
  });

  test("a CBOR path the library emitted finds its own entries again", () => {
    const bridge = createCborCddlBridge(libMapOf(PERSON_HEX, PERSON_CDDL, "Person"));
    for (const entry of bridge.entries) {
      const found = bridge.entriesAtCborPath(bridge.node(entry).cborPath);
      expect(found).toContain(entry);
    }
  });

  test("a tag is transparent to CBOR paths and a wrapper on decoded ones", () => {
    // `258([1, "a"])` against a set of uints: CBOR `$[0]`/`$[1]`, decoded under `["@value"]`.
    const bridge = createCborCddlBridge(libMapOf("d9010282016161", "S = #6.258([* uint])\n", "S"));
    const item = preferRole(bridge.entriesAtCborPath("$[1]"), "value")!;
    expect(bridge.node(item).decodedPath).toBe('$["@value"][1]');
    expect(bridge.entriesAtCborPath("$").length).toBeGreaterThanOrEqual(3);
    expect(new Set(bridge.entriesAtCborPath("$").map(e => bridge.node(e).decodedPath)))
      .toEqual(new Set(["$", '$["@tag"]', '$["@value"]']));
  });

  test("a numeric map key is `[1]` on the CBOR side and `[\"1\"]` on the decoded side", () => {
    const bridge = createCborCddlBridge(libMapOf("a1016178", "T = {1: uint}\n", "T"));
    const value = preferRole(bridge.entriesAtCborPath("$[1]"), "value")!;
    expect(value.entry_role).toBe("value");
    expect(bridge.node(value).decodedPath).toBe('$["1"]');
  });
});

describe("instancesOf", () => {
  // Two persons over `[+Person]`: one schema span per construct, one row per person.
  const PERSONS_CDDL = "Person = { name: tstr, age: uint }\nPersons = [+Person]\n";
  // [{"name":"Alice","age":20},{"name":"Bob","age":31}]
  const PERSONS_HEX = "82a2646e616d6565416c6963656361676514a2646e616d6563426f6263616765181f";
  const personsBridge = () => createCborCddlBridge(libMapOf(PERSONS_HEX, PERSONS_CDDL, "Persons"));
  const spanText = (bridge: ReturnType<typeof createCborCddlBridge>, i: number) => {
    const s = bridge.entries[i].cddl_byte_span!;
    return PERSONS_CDDL.slice(s.char_offset, s.char_offset + s.char_length);
  };

  test("groups the entries that share one schema span, in entry order", () => {
    const bridge = personsBridge();
    const e = bridge.entries;
    expect(spanText(bridge, 4)).toBe("name");
    expect(bridge.instancesOf(e[4])).toEqual([e[4], e[10]]);
    expect(spanText(bridge, 5)).toBe("tstr");
    expect(bridge.instancesOf(e[5])).toEqual([e[5], e[11]]);
    expect(spanText(bridge, 2)).toBe("Person");
    expect(bridge.instancesOf(e[2])).toEqual([e[2], e[8]]);
    expect(spanText(bridge, 3)).toBe("{ name: tstr, age: uint }");
    expect(bridge.instancesOf(e[3])).toEqual([e[3], e[9]]);
    // The map type's group is not the rows inside it.
    expect(bridge.instancesOf(e[3])).not.toContain(e[4]);
  });

  test("the same array comes back for every member, and for a member asked twice", () => {
    const bridge = personsBridge();
    const e = bridge.entries;
    expect(bridge.instancesOf(e[4])).toBe(bridge.instancesOf(e[4]));
    expect(bridge.instancesOf(e[10])).toBe(bridge.instancesOf(e[4]));
  });

  test("an entry without a schema span is a group of itself, stable by identity", () => {
    const rows: CborCddlPathEntry[] = [{ suffix: "$" }];
    const bridge = createCborCddlBridge(mapOf(rows, rows, [{ cbor: 0, decoded: 0 }, { cbor: 0, decoded: 0 }]));
    const [a, b] = bridge.entries;
    expect(bridge.instancesOf(a)).toEqual([a]);
    expect(bridge.instancesOf(a)).toBe(bridge.instancesOf(a));
    expect(bridge.instancesOf(b)).toEqual([b]);
  });

  test("a row with a schema span and no bytes is still an instance of its construct", () => {
    // Omitted `age` is a row with a span and no bytes.
    const bridge = createCborCddlBridge(
      libMapOf("a1646e616d656441626379", "Person = {name: tstr, age: uint}", "Person"),
    );
    const missing = bridge.entries.find(e => !e.cbor_byte_span && !e.cbor_anchor_span)!;
    expect(missing).toBeDefined();
    expect(bridge.instancesOf(missing)).toContain(missing);
  });

  test("two bridges over equal maps keep separate groups", () => {
    const a = personsBridge();
    const b = personsBridge();
    expect(a.instancesOf(a.entries[4])).not.toBe(b.instancesOf(b.entries[4]));
    for (const entry of a.instancesOf(a.entries[4])) expect(a.entries).toContain(entry);
  });

  test("an entry from another map is never placed in this map's group", () => {
    const a = personsBridge();
    const b = personsBridge();
    const foreign = b.entries[4];
    const group = a.instancesOf(foreign);
    expect(group).toEqual([foreign]);
    for (const entry of group) expect(a.entries).not.toContain(entry);
  });
});

describe("definitionOffsetFor", () => {
  // `tstr` is used, never defined. `Person` is defined then named in `[+Person]`.
  const CDDL = "Person = { name: tstr, age: Age, ? nick: tstr }\nAge = uint\nPersons = [+Person]\n";
  // [{"name":"Alice","age":20},{"name":"Bob","age":31}]
  const HEX = "82a2646e616d6565416c6963656361676514a2646e616d6563426f6263616765181f";
  const bridge = () => createCborCddlBridge(libMapOf(HEX, CDDL, "Persons"), CDDL);
  const at = (needle: string, from = 0) => CDDL.indexOf(needle, from);

  test("a reference to a rule points at the rule's definition", () => {
    const b = bridge();
    const reference = at("Person]") ;
    expect(b.definitionOffsetFor(reference)).toBe(at("Person ="));
    expect(b.definitionOffsetFor(reference + 5)).toBe(at("Person ="));
    expect(b.definitionOffsetFor(at("Age,"))).toBe(at("Age ="));
  });

  test("the definition itself, and the characters around a name, point nowhere", () => {
    const b = bridge();
    expect(b.definitionOffsetFor(at("Person ="))).toBeNull();
    expect(b.definitionOffsetFor(at("Age ="))).toBeNull();
    expect(b.definitionOffsetFor(at("[+Person"))).toBeNull();
    expect(b.definitionOffsetFor(at("+Person"))).toBeNull();
    expect(b.definitionOffsetFor(at("]"))).toBeNull();
    expect(b.definitionOffsetFor(-1)).toBeNull();
    expect(b.definitionOffsetFor(CDDL.length)).toBeNull();
  });

  test("a prelude type is not defined anywhere, so a use of it is not redirected", () => {
    const b = bridge();
    expect(b.definitionOffsetFor(at("tstr"))).toBeNull();
    expect(b.definitionOffsetFor(at("tstr", at("tstr") + 1))).toBeNull();
    expect(b.definitionOffsetFor(at("uint"))).toBeNull();
  });

  test("a member key that is also a word is not a rule", () => {
    const b = bridge();
    expect(b.definitionOffsetFor(at("name"))).toBeNull();
    expect(b.definitionOffsetFor(at("nick"))).toBeNull();
  });

  test("a bridge built without its text answers for no references", () => {
    const b = createCborCddlBridge(libMapOf(HEX, CDDL, "Persons"));
    expect(b.definitionOffsetFor(at("Person]"))).toBeNull();
  });

  test("a rule the map filed nothing under is not redirected", () => {
    // `Unused` matched nothing, so it has no rows to redirect.
    const cddl = "Person = { name: tstr }\nUnused = [+Person]\nPersons = [+Person]\n";
    const b = createCborCddlBridge(libMapOf(HEX.replace(/6361676514|63616765181f/g, "").replace(/a2/g, "a1"), cddl, "Persons"), cddl);
    expect(b.definitionOffsetFor(cddl.indexOf("Unused"))).toBeNull();
    expect(b.definitionOffsetFor(cddl.lastIndexOf("Person]"))).toBe(0);
  });
});

describe("referenceInstancesAt", () => {
  // `amount` is referenced from map members, an array of them, a positional
  // array, and a choice; `? 3` is absent from the document.
  const CDDL = [
    "doc = {",
    "  1: amount,",
    "  2: amount,",
    "  ? 3: amount,",
    "  4: [* amount],",
    "  5: pair,",
    "  6: money,",
    "}",
    "pair = [amount, amount]",
    "money = amount / [amount, tstr]",
    "amount = uint",
    "",
  ].join("\n");
  // {1: 10, 2: 20, 4: [30, 40], 5: [50, 60], 6: 70}
  const HEX = ["a5", "01", "0a", "02", "14", "04", "82", "181e", "1828", "05", "82", "1832", "183c", "06", "1846"].join("");
  const bridge = () => createCborCddlBridge(libMapOf(HEX, CDDL, "doc"), CDDL);
  const at = (needle: string, inner = needle) => CDDL.indexOf(needle) + needle.indexOf(inner);
  const paths = (b: ReturnType<typeof bridge>, entries: readonly { cbor_path: number }[] | null) =>
    entries === null ? null : entries.map(e => b.node(e as never).cborPath);

  test("a member's type names the instance under that key, not every instance", () => {
    const b = bridge();
    expect(paths(b, b.referenceInstancesAt(at("1: amount", "amount")))).toEqual(['$[1]']);
    expect(paths(b, b.referenceInstancesAt(at("2: amount", "amount")))).toEqual(['$[2]']);
    expect(paths(b, b.referenceInstancesAt(at("5: pair", "pair")))).toEqual(['$[5]']);
  });

  test("a member the document does not have names nothing", () => {
    const b = bridge();
    expect(b.referenceInstancesAt(at("? 3: amount", "amount"))).toEqual([]);
  });

  test("inside an array the instances are that array's elements", () => {
    const b = bridge();
    expect(paths(b, b.referenceInstancesAt(at("[* amount]", "amount")))).toEqual(['$[4][0]', '$[4][1]']);
    expect(paths(b, b.referenceInstancesAt(at("[amount, amount]", "amount")))).toEqual(['$[5][0]', '$[5][1]']);
  });

  test("a reference in a rule body with no construct around it is scoped to that rule", () => {
    const b = bridge();
    expect(paths(b, b.referenceInstancesAt(at("money = amount", "amount")))).toEqual(['$[6]']);
  });

  test("the definition and non-references answer null, so the whole group applies", () => {
    const b = bridge();
    expect(b.referenceInstancesAt(at("amount = uint"))).toBeNull();
    expect(b.referenceInstancesAt(at("uint"))).toBeNull();
    expect(b.referenceInstancesAt(at("doc = {"))).toBeNull();
    expect(b.referenceInstancesAt(-1)).toBeNull();
    expect(createCborCddlBridge(libMapOf(HEX, CDDL, "doc")).referenceInstancesAt(at("1: amount", "amount"))).toBeNull();
  });

  test("the same site answers the same array; the whole group is the bridge's own", () => {
    const b = bridge();
    const site = at("1: amount", "amount");
    expect(b.referenceInstancesAt(site)).toBe(b.referenceInstancesAt(site + 3));
    const whole = b.referenceInstancesAt(at("[* amount]", "amount"))!;
    expect(whole).not.toBe(b.instancesOf(whole[0]));
    const all = b.instancesOf(whole[0]);
    expect(all.length).toBe(7);
  });

  test("a nested recurrence of the rule is not the reference's", () => {
    // `[* item]` where an item holds items: the elements, not their children.
    const cddl = "doc = [* item]\nitem = { ? 1: [* item], 2: uint }\n";
    // [{1: [{2: 1}], 2: 2}]
    const hex = ["81", "a2", "01", "81", "a1", "02", "01", "02", "02"].join("");
    const b = createCborCddlBridge(libMapOf(hex, cddl, "doc"), cddl);
    expect(paths(b, b.referenceInstancesAt(cddl.indexOf("item]")))).toEqual(["$[0]"]);
    expect(paths(b, b.referenceInstancesAt(cddl.lastIndexOf("item]")))).toEqual(["$[0][1][0]"]);
  });

  test("strings and comments do not split members", () => {
    const cddl = 'doc = { "a, b": amount ; c: d, e\n, 2: amount }\namount = uint\n';
    // {"a, b": 1, 2: 2}
    const hex = ["a2", "64", "612c2062", "01", "02", "02"].join("");
    const b = createCborCddlBridge(libMapOf(hex, cddl, "doc"), cddl);
    expect(paths(b, b.referenceInstancesAt(cddl.indexOf('amount ;')))).toEqual(['$["a, b"]']);
    expect(paths(b, b.referenceInstancesAt(cddl.indexOf('2: amount') + 3))).toEqual(['$[2]']);
  });
});

describe("referenceSiteOf", () => {
  const CDDL = [
    "doc = {",
    "  1: amount,",
    "  2: amount,",
    "  4: [* amount],",
    "  5: pair,",
    "  6: money,",
    "  7: items,",
    "}",
    "pair = [amount, amount]",
    "money = amount / [amount, tstr]",
    "items = [* item]",
    "item = [label : amount, ? note : tstr]",
    "amount = uint",
    "",
  ].join("\n");
  // {1: 10, 2: 20, 4: [30, 40], 5: [50, 60], 6: [70, "x"], 7: [[80]]}
  const HEX = ["a6", "01", "0a", "02", "14", "04", "82", "181e", "1828", "05", "82", "1832", "183c",
    "06", "82", "1846", "6178", "07", "81", "81", "1850"].join("");
  const bridge = () => createCborCddlBridge(libMapOf(HEX, CDDL, "doc"), CDDL);
  const rowOf = (b: ReturnType<typeof bridge>, path: string, rule: string) =>
    b.entries.find(e => e.rule_name === rule && b.node(e).cborPath === path)!;
  const text = (r: [number, number] | null) => r && CDDL.slice(r[0], r[1]);
  const around = (r: [number, number] | null, n: number) => r && CDDL.slice(r[0] - n, r[1]);

  test("a map member's value is reached from the type after its key", () => {
    const b = bridge();
    expect(around(b.referenceSiteOf(rowOf(b, "$[1]", "amount")), 3)).toBe("1: amount");
    expect(around(b.referenceSiteOf(rowOf(b, "$[2]", "amount")), 3)).toBe("2: amount");
    expect(around(b.referenceSiteOf(rowOf(b, "$[5]", "pair")), 3)).toBe("5: pair");
  });

  test("an array element is reached from inside the array", () => {
    const b = bridge();
    expect(around(b.referenceSiteOf(rowOf(b, "$[4][0]", "amount")), 3)).toBe("[* amount");
    expect(around(b.referenceSiteOf(rowOf(b, "$[4][1]", "amount")), 3)).toBe("[* amount");
    expect(around(b.referenceSiteOf(rowOf(b, "$[5][0]", "amount")), 1)).toBe("[amount");
    expect(around(b.referenceSiteOf(rowOf(b, "$[7][0]", "item")), 3)).toBe("[* item");
  });

  test("a rule reached through another rule's body is found in that body", () => {
    const b = bridge();
    // 6 is the array alternative of `money`; the row still belongs to `money`, then `amount`.
    expect(around(b.referenceSiteOf(rowOf(b, "$[6]", "money")), 3)).toBe("6: money");
    expect(around(b.referenceSiteOf(rowOf(b, "$[6].amount", "amount")), 1)).toBe("[amount");
  });

  test("a labelled array member is reached from its type, not its label", () => {
    const b = bridge();
    const site = b.referenceSiteOf(rowOf(b, "$[7][0].label", "amount"));
    expect(text(site)).toBe("amount");
    expect(CDDL.slice(site![0] - 8, site![0])).toBe("label : ");
  });

  test("the root and prelude uses have no site of their own", () => {
    const b = bridge();
    expect(b.referenceSiteOf(rowOf(b, "$", "doc"))).toBeNull();
    expect(b.referenceSiteOf(rowOf(b, "$[1]", "uint"))).toBeNull();
    expect(b.referenceSiteOf(b.entries.find(e => e.entry_role === "key")!)).toBeNull();
    expect(createCborCddlBridge(libMapOf(HEX, CDDL, "doc")).referenceSiteOf(rowOf(b, "$[1]", "amount"))).toBeNull();
  });

  test("the answer for a row is the same object each time", () => {
    const b = bridge();
    const row = rowOf(b, "$[1]", "amount");
    expect(b.referenceSiteOf(row)).toBe(b.referenceSiteOf(row));
  });
});

describe("nameRunAt", () => {
  test("covers the RFC 8610 name characters around the offset", () => {
    const text = "a = my-rule.v2 / $ext@x";
    expect(nameRunAt(text, 4)).toEqual([4, 14]);
    expect(nameRunAt(text, 13)).toEqual([4, 14]);
    expect(nameRunAt(text, 17)).toEqual([17, 23]);
    expect(nameRunAt(text, 0)).toEqual([0, 1]);
  });
  test("is null off a name", () => {
    const text = "a = b";
    expect(nameRunAt(text, 1)).toBeNull();
    expect(nameRunAt(text, 2)).toBeNull();
    expect(nameRunAt(text, -1)).toBeNull();
    expect(nameRunAt(text, 5)).toBeNull();
  });
});
