import { describe, expect, test } from "bun:test";
import {
  cborDiagnostics,
  type CborPosition,
  type CborDiagnostic,
} from "@cardananium/cquisitor-lib";
import { NO_TREE_DIAGNOSTICS } from "@/components/treeDiagnostics";
import { createCborCddlBridge, EMPTY_CBOR_CDDL_MAP, type CborCddlBridge } from "./cborCddlBridge";
import {
  diagnosticDecodedRows,
  diagnosticPosition,
  diagnosticTreeRows,
  toTreeDiagnostic,
} from "./diagnosticRows";
import { mapOf, validateCborOf } from "./libForTests";

const PERSON_CDDL = "Person = {name: tstr, age: uint}\nPersons = [+Person]\n";
// [{"name":"Alice","age":"20"}] — `age` is a text string, not a uint.
const LEAF_HEX = "81a2646e616d6565416c69636563616765623230";
// [{"name":"Alice","age":20},{"name":"Bob","age":31}]
const TWO_PERSONS_HEX = "82a2646e616d6565416c6963656361676514a2646e616d6563426f6263616765181f";
// {"name":"Alice"}
const NO_AGE_HEX = "a1646e616d6565416c696365";

/** The run's diagnostics; a valid or refused run fails the calling test. */
function diagnosticsOf(hex: string, cddl: string, rule: string): CborDiagnostic[] {
  const outcome = validateCborOf(hex, cddl, rule);
  if (!outcome || !outcome.ok || outcome.result.valid) {
    throw new Error(`expected ${rule} to report mismatches over ${hex}`);
  }
  return cborDiagnostics(outcome.result.error);
}

function bridgeOf(hex: string, cddl: string, rule: string): CborCddlBridge {
  return createCborCddlBridge(mapOf(hex, cddl, rule), cddl);
}

function handBuilt(over: Partial<CborDiagnostic> = {}): CborDiagnostic {
  return {
    kind: "nesting_too_deep",
    message: "the document nests deeper than the walker follows",
    expected: null,
    path: "$[0][0]",
    cddlRange: null,
    byteSpans: [],
    anchorSpans: [],
    ...over,
  };
}

const ROOT_MAP: CborPosition = { offset: 0, length: 1 };

describe("diagnosticPosition", () => {
  test("the value's bytes, else the structure's, else the root header for the root", () => {
    const byte = { offset: 17, length: 3 };
    const anchor = { offset: 1, length: 19 };
    expect(diagnosticPosition(handBuilt({ byteSpans: [byte], anchorSpans: [anchor] }), ROOT_MAP)).toBe(byte);
    expect(diagnosticPosition(handBuilt({ anchorSpans: [anchor] }), ROOT_MAP)).toBe(anchor);
    expect(diagnosticPosition(handBuilt({ path: "$" }), ROOT_MAP)).toBe(ROOT_MAP);
    expect(diagnosticPosition(handBuilt({ path: "$" }), null)).toBeNull();
    expect(diagnosticPosition(handBuilt(), ROOT_MAP)).toBeNull();
    expect(diagnosticPosition(handBuilt({ path: null }), ROOT_MAP)).toBeNull();
  });
});

describe("toTreeDiagnostic", () => {
  test("carries the run's fields, the shortened path and the one-liner", () => {
    const [d] = diagnosticsOf(LEAF_HEX, PERSON_CDDL, "Persons");
    const placed = toTreeDiagnostic(d, 3, ROOT_MAP);
    expect(placed).toEqual({
      index: 3,
      kind: "mismatch",
      expected: "uint",
      message: d.message,
      path: "$[0].age",
      pathLabel: "$[0].age",
      position: { offset: 17, length: 3 },
      title: `mismatch at $[0].age (expected uint) — ${d.message}`,
      held: false,
    });
  });

  test("a long path is shortened for the label and kept whole in the path", () => {
    const path = "$" + ".a".repeat(200);
    const placed = toTreeDiagnostic(handBuilt({ path }), 0, null);
    expect(placed.path).toBe(path);
    expect(placed.pathLabel).toContain("segments");
    expect(placed.pathLabel!.length).toBeLessThan(path.length);
    expect(toTreeDiagnostic(handBuilt({ path: null }), 0, null).pathLabel).toBeNull();
  });
});

describe("over real library output", () => {
  test("a leaf mismatch lands on the value's bytes and on its decoded row", () => {
    const diagnostics = diagnosticsOf(LEAF_HEX, PERSON_CDDL, "Persons");
    expect(diagnostics).toHaveLength(1);
    const tree = diagnosticTreeRows(diagnostics, ROOT_MAP);
    expect([...tree.keys()]).toEqual(["17:3"]);
    expect(tree.get("17:3")).toMatchObject([{ index: 0, kind: "mismatch", expected: "uint", held: false }]);

    const decoded = diagnosticDecodedRows(diagnostics, bridgeOf(LEAF_HEX, PERSON_CDDL, "Persons"), ROOT_MAP);
    expect([...decoded.keys()]).toEqual(["$[0].age"]);
    expect(decoded.get("$[0].age")).toMatchObject([{ index: 0, kind: "mismatch", held: false }]);
  });

  test("a root mismatch lands on the root's header and on the decoded root", () => {
    const diagnostics = diagnosticsOf(TWO_PERSONS_HEX, PERSON_CDDL, "Person");
    expect(diagnostics[0].path).toBe("$");
    const tree = diagnosticTreeRows(diagnostics, ROOT_MAP);
    expect(tree.get("0:1")).toMatchObject([{ index: 0, kind: "mismatch", path: "$", held: false }]);

    const decoded = diagnosticDecodedRows(diagnostics, bridgeOf(TWO_PERSONS_HEX, PERSON_CDDL, "Person"), ROOT_MAP);
    expect(decoded.get("$")).toMatchObject([{ index: 0, kind: "mismatch", held: false }]);
  });

  test("an unexpected member lands on its own entry, key first, not on the map header", () => {
    // {"name":"Alice","age":30} against a Person with no `age`.
    const hex = "a2646e616d6565416c69636563616765181e";
    const cddl = "Person = {name: tstr}\n";
    const diagnostics = diagnosticsOf(hex, cddl, "Person");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ path: "$.age", message: 'unexpected key "age"' });
    // Key span, then value span; the map header is nowhere in it.
    expect(diagnostics[0].byteSpans).toEqual([{ offset: 12, length: 4 }, { offset: 16, length: 2 }]);
    const tree = diagnosticTreeRows(diagnostics, ROOT_MAP);
    expect([...tree.keys()]).toEqual(["12:4"]);
    const decoded = diagnosticDecodedRows(diagnostics, bridgeOf(hex, cddl, "Person"), ROOT_MAP);
    expect(decoded.has("$")).toBe(false);
    expect([...decoded.keys()]).toHaveLength(1);
  });

  test("a missing member is a `generic` diagnostic on the map that lacks it, naming the key it wanted", () => {
    const diagnostics = diagnosticsOf(NO_AGE_HEX, PERSON_CDDL, "Person");
    expect(diagnostics[0]).toMatchObject({ kind: "generic", path: "$", expected: '"age"' });
    expect(diagnostics[0].message).toContain("age");
    const tree = diagnosticTreeRows(diagnostics, ROOT_MAP);
    expect(tree.get("0:1")).toMatchObject([{ index: 0, kind: "generic", held: false }]);

    const decoded = diagnosticDecodedRows(diagnostics, bridgeOf(NO_AGE_HEX, PERSON_CDDL, "Person"), ROOT_MAP);
    expect(decoded.get("$")).toMatchObject([{ index: 0, kind: "generic", held: false }]);
  });

  test("a numeric map key is spelled the decoded tree's way", () => {
    const cddl = "T = {1: uint}\n";
    const diagnostics = diagnosticsOf("a1016178", cddl, "T");
    expect(diagnostics[0].path).toBe("$[1]");
    const decoded = diagnosticDecodedRows(diagnostics, bridgeOf("a1016178", cddl, "T"), ROOT_MAP);
    expect([...decoded.keys()]).toEqual(['$["1"]']);
    expect(decoded.get('$["1"]')).toMatchObject([{ index: 0, path: "$[1]", held: false }]);
  });

  test("a tag's item, transparent to the CBOR path, sits under the decoded wrapper", () => {
    const cddl = "S = #6.258([* uint])\n";
    const diagnostics = diagnosticsOf("d9010282016161", cddl, "S");
    expect(diagnostics[0].path).toBe("$[1]");
    const decoded = diagnosticDecodedRows(diagnostics, bridgeOf("d9010282016161", cddl, "S"), { offset: 0, length: 3 });
    expect([...decoded.keys()]).toEqual(['$["@value"][1]']);
  });

  describe("a CBOR path that names more than one node", () => {
    const KEYED_CDDL = "root = {* k => uint, ? 0: tstr, ? 1: uint}\nk = [* uint]\n";
    const uintHex = (n: number) =>
      n < 24 ? n.toString(16).padStart(2, "0") : "18" + n.toString(16).padStart(2, "0");

    test("the value under a key too long to write out, named by its position, is the value's", () => {
      // {0: "a", [0, 1, …, 199]: "x"}: the key's rendering passes the bound, so
      // the validator names the entry `$[1]`, which is also the key's item 1.
      const longKey = "98c8" + Array.from({ length: 200 }, (_, i) => uintHex(i)).join("");
      const hex = "a2" + "006161" + longKey + "6178";
      const diagnostics = diagnosticsOf(hex, KEYED_CDDL, "root");
      expect(diagnostics.map(d => d.path)).toEqual(["$[1]"]);
      const decoded = diagnosticDecodedRows(diagnostics, bridgeOf(hex, KEYED_CDDL, "root"), ROOT_MAP);
      expect([...decoded.keys()]).toEqual(['$["@entries"][1].value']);
      expect(decoded.get('$["@entries"][1].value')).toMatchObject([{ index: 0, held: false }]);
    });

    test("an entry the validator cannot name, `[...]`, is not the text key \"...\"", () => {
      // {1: 5, "zzz…" (2000 bytes): "x", "...": 7}: the long key sits at
      // position 1, which reads as integer key 1, so the validator names the
      // entry `$[...]`. The key renders past the 1024 bytes the library
      // writes out, so the path stays `$[...]`; the library still singles
      // the entry out, so the spans are its value's.
      const cddl = "root = {* tstr => uint, ? 1: uint}\n";
      const longKey = "z".repeat(2000);
      const longText = "7907d0" + "7a".repeat(2000);
      const hex = "a3" + "0105" + longText + "6178" + "632e2e2e" + "07";
      const diagnostics = diagnosticsOf(hex, cddl, "root");
      expect(diagnostics.map(d => d.path)).toEqual(["$[...]"]);
      // Map header, `1: 5`, the key's 3-byte header and its 2000 bytes.
      expect(diagnostics[0].byteSpans).toEqual([{ offset: 1 + 2 + 3 + 2000, length: 2 }]);
      const decoded = diagnosticDecodedRows(diagnostics, bridgeOf(hex, cddl, "root"), ROOT_MAP);
      expect([...decoded.keys()]).toEqual([`$.${longKey}`]);
    });

    test("an entry `[...]` the library cannot single out sits on the map, not on the text key \"...\"", () => {
      // {1: 5, 2: 6, "aaa…" (300 bytes): "x", "bbb…" (300 bytes): 8, "...": 7}:
      // both long keys pass the validator's bound, and the one at position 2,
      // which reads as integer key 2, is `$[...]`. Two keys could be that
      // entry, so its spans are the map's.
      const cddl = "root = {* tstr => uint, ? 1: uint, ? 2: uint}\n";
      const longA = "79012c" + "61".repeat(300);
      const longB = "79012c" + "62".repeat(300);
      const hex = "a5" + "0105" + "0206" + longA + "6178" + longB + "08" + "632e2e2e" + "07";
      const diagnostics = diagnosticsOf(hex, cddl, "root");
      expect(diagnostics.map(d => d.path)).toEqual(["$[...]"]);
      expect(diagnostics[0].byteSpans).toEqual([ROOT_MAP]);
      const decoded = diagnosticDecodedRows(diagnostics, bridgeOf(hex, cddl, "root"), ROOT_MAP);
      expect([...decoded.keys()]).toEqual(["$"]);
    });

    test("the value under integer key 1 is not item 1 of the composite key beside it", () => {
      // {1: "a", [5, 6]: 7}
      const hex = "a2" + "016161" + "820506" + "07";
      const diagnostics = diagnosticsOf(hex, KEYED_CDDL, "root");
      expect(diagnostics.map(d => d.path)).toEqual(["$[1]"]);
      const decoded = diagnosticDecodedRows(diagnostics, bridgeOf(hex, KEYED_CDDL, "root"), ROOT_MAP);
      expect([...decoded.keys()]).toEqual(['$["@entries"][0].value']);
    });
  });

  test("several diagnostics keep the run's order within a row and across rows", () => {
    const cddl = "thing = [* int]\n";
    // [1, "a", "b"]
    const diagnostics = diagnosticsOf("830161616162", cddl, "thing");
    expect(diagnostics.map(d => d.path)).toEqual(["$[1]", "$[2]"]);
    const tree = diagnosticTreeRows(diagnostics, ROOT_MAP);
    expect([...tree.keys()]).toEqual(["2:2", "4:2"]);
    expect(tree.get("2:2")![0].index).toBe(0);
    expect(tree.get("4:2")![0].index).toBe(1);
    const decoded = diagnosticDecodedRows(diagnostics, bridgeOf("830161616162", cddl, "thing"), ROOT_MAP);
    expect([...decoded.keys()]).toEqual(["$[1]", "$[2]"]);
  });
});

describe("diagnostics the map has no row for", () => {
  const persons = () => bridgeOf(LEAF_HEX, PERSON_CDDL, "Persons");

  test("one with no bytes is absent from the tree and held by its deepest known ancestor", () => {
    const diagnostics = [handBuilt()];
    expect(diagnosticTreeRows(diagnostics, ROOT_MAP)).toBe(NO_TREE_DIAGNOSTICS);
    const decoded = diagnosticDecodedRows(diagnostics, persons(), ROOT_MAP);
    expect([...decoded.keys()]).toEqual(["$[0]"]);
    expect(decoded.get("$[0]")).toMatchObject([
      { index: 0, kind: "nesting_too_deep", path: "$[0][0]", held: true, position: null },
    ]);
  });

  test("one at the root with no bytes falls back to the root header, and is the root's own", () => {
    const diagnostics = [handBuilt({ path: "$" })];
    const tree = diagnosticTreeRows(diagnostics, ROOT_MAP);
    expect([...tree.keys()]).toEqual(["0:1"]);
    expect(tree.get("0:1")).toMatchObject([{ index: 0, held: false, position: ROOT_MAP }]);
    const decoded = diagnosticDecodedRows(diagnostics, persons(), ROOT_MAP);
    expect(decoded.get("$")).toMatchObject([{ index: 0, held: false }]);
    // Without the root header the tree has nowhere to put it.
    expect(diagnosticTreeRows(diagnostics, null)).toBe(NO_TREE_DIAGNOSTICS);
  });

  test("one whose path the map does not spell is placed by the byte it blames", () => {
    const d = handBuilt({ kind: "mismatch", path: "$.h'0102'", byteSpans: [{ offset: 17, length: 3 }] });
    const decoded = diagnosticDecodedRows([d], persons(), ROOT_MAP);
    expect([...decoded.keys()]).toEqual(["$[0].age"]);
    expect(decoded.get("$[0].age")).toMatchObject([{ index: 0, held: false }]);
    expect([...diagnosticTreeRows([d], ROOT_MAP).keys()]).toEqual(["17:3"]);
  });

  test("one whose path names a row its bytes do not meet is placed by the byte it blames", () => {
    // `$[0].name` exists, but the blamed bytes are `age`'s value.
    const d = handBuilt({ kind: "mismatch", path: "$[0].name", byteSpans: [{ offset: 17, length: 3 }] });
    const decoded = diagnosticDecodedRows([d], persons(), ROOT_MAP);
    expect([...decoded.keys()]).toEqual(["$[0].age"]);
    // With no bytes to disagree, the path decides.
    const pathOnly = diagnosticDecodedRows([handBuilt({ kind: "mismatch", path: "$[0].name" })], persons(), ROOT_MAP);
    expect([...pathOnly.keys()]).toEqual(["$[0].name"]);
  });

  test("one with no path and no bytes is placed nowhere", () => {
    const d = handBuilt({ path: null });
    expect(diagnosticTreeRows([d], ROOT_MAP)).toBe(NO_TREE_DIAGNOSTICS);
    expect(diagnosticDecodedRows([d], persons(), ROOT_MAP)).toBe(NO_TREE_DIAGNOSTICS);
  });

  test("an own and a held placement share a row, in run order", () => {
    const own = handBuilt({ kind: "mismatch", path: "$[0]", byteSpans: [{ offset: 1, length: 1 }] });
    const decoded = diagnosticDecodedRows([own, handBuilt()], persons(), ROOT_MAP);
    expect(decoded.get("$[0]")).toMatchObject([{ index: 0, held: false }, { index: 1, held: true }]);
  });
});

describe("the empty bridge", () => {
  test("places nothing in the decoded tree while the structural tree still has its rows", () => {
    const diagnostics = diagnosticsOf(LEAF_HEX, PERSON_CDDL, "Persons");
    const empty = createCborCddlBridge(EMPTY_CBOR_CDDL_MAP);
    expect(diagnosticDecodedRows(diagnostics, empty, ROOT_MAP)).toBe(NO_TREE_DIAGNOSTICS);
    expect([...diagnosticTreeRows(diagnostics, ROOT_MAP).keys()]).toEqual(["17:3"]);
  });

  test("no diagnostics is no rows on either side", () => {
    expect(diagnosticTreeRows([], ROOT_MAP)).toBe(NO_TREE_DIAGNOSTICS);
    expect(diagnosticDecodedRows([], bridgeOf(LEAF_HEX, PERSON_CDDL, "Persons"), ROOT_MAP)).toBe(NO_TREE_DIAGNOSTICS);
  });
});

describe("stability", () => {
  test("the maps are rebuilt per call, so identity is the host's to keep", () => {
    const diagnostics = diagnosticsOf(LEAF_HEX, PERSON_CDDL, "Persons");
    const bridge = bridgeOf(LEAF_HEX, PERSON_CDDL, "Persons");
    const a = diagnosticTreeRows(diagnostics, ROOT_MAP);
    const b = diagnosticTreeRows(diagnostics, ROOT_MAP);
    expect(a).not.toBe(b);
    expect(a.get("17:3")).not.toBe(b.get("17:3"));
    expect(a.get("17:3")).toEqual(b.get("17:3"));
    const c = diagnosticDecodedRows(diagnostics, bridge, ROOT_MAP);
    const d = diagnosticDecodedRows(diagnostics, bridge, ROOT_MAP);
    expect(c).not.toBe(d);
    expect(c.get("$[0].age")).toEqual(d.get("$[0].age"));
  });
});
