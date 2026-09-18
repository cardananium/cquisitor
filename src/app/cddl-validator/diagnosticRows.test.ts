import { describe, expect, test } from "bun:test";
import type { CborPosition } from "@cardananium/cquisitor-lib";
import { NO_TREE_DIAGNOSTICS } from "@/components/treeDiagnostics";
import { createCborCddlBridge, EMPTY_CBOR_CDDL_MAP, type CborCddlBridge } from "./cborCddlBridge";
import { cborDiagnostics, type CborDiagnostic } from "./cddlError";
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

  test("a missing member is a `generic` diagnostic on the map that lacks it", () => {
    const diagnostics = diagnosticsOf(NO_AGE_HEX, PERSON_CDDL, "Person");
    expect(diagnostics[0]).toMatchObject({ kind: "generic", path: "$" });
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
