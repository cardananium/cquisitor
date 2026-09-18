import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MAX_DIAGNOSTICS,
  NO_ROOT_SWEEP,
  ROOT_SWEEP_AUTO_CAP,
  caretForReferences,
  cborDecodedView,
  cborValidationView,
  cddlOffsetsAreCurrent,
  cddlSchemaView,
  diagnosticsWithoutCddlRanges,
  mapForCurrentInput,
  selectDecodedLink,
  selectEditorLink,
  selectHexLink,
  selectTreeLink,
  useHoverLink,
  mapPassFor,
  schemaViewWithoutRanges,
  settleDelayFor,
  useCborDecoded,
  useCddlSchema,
  useRootSuggestions,
  sweepRootRules,
  normalizeCborInput,
  wholeByteHex,
  shareCborState,
  resolveReferenceRanges,
  referenceRangesFrom,
  type CborDecodePass,
  type CborCddlMapPass,
  type CborCddlMapSource,
  type CddlSchemaCore,
} from "./hooks";
import {
  safeCborToJson,
  safeDecodeCborAgainstCddl,
  safeMapCborToCddl,
  safeOutline,
  safeValidateCborAgainstCddl,
  safeValidateCddl,
} from "./cddlValidatorLib";
import { createCborCddlBridge, EMPTY_CBOR_CDDL_MAP } from "./cborCddlBridge";
import { buildEditorMarks, findNodeByCborOffset } from "./pinResolvers";
import { createHoverLinkStore } from "./hoverLink";
import { normaliseMarks } from "./cddlOverlay";
import { candidateRootRules, resolveRootRule } from "./ruleSelection";
import { cborRootKind } from "./rootKinds";
import { isRootMismatch } from "./cddlError";
import { CONWAY_CDDL } from "./conwaySchema";
import { CONWAY_TX_HEX } from "./libForTests";
import { LibAbortedError } from "@/lib/cquisitorWorker";

// Projections of settled passes, checked against real library output.
// Retention and cancellation live in workerClient.test.ts and the render probes.

/** First server render of a hook; effects do not run. */
function readHook<T>(run: () => T): T {
  const captured: T[] = [];
  function Probe() {
    captured.push(run());
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return captured[captured.length - 1];
}

/** Two consecutive server renders with unchanged arguments. */
function readHookTwice<T>(run: () => T): [T, T] {
  const captured: T[] = [];
  function Probe() {
    const [pass, setPass] = useState(0);
    captured.push(run());
    if (pass === 0) setPass(1);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return [captured[0], captured[1]];
}

/** One settled schema pass, projected the way `useCddlSchema` projects it. */
async function readSchema(cddl: string): Promise<CddlSchemaCore> {
  const outcome = await safeValidateCddl(cddl);
  const outline = await safeOutline(cddl);
  return cddlSchemaView(outcome, { source: cddl, outline });
}

/** Characters the schema editor would underline, clamped as the editor clamps them. */
function paintedErrorText(core: CddlSchemaCore, liveCddl: string): string[] {
  const marks = buildEditorMarks({
    schemaError: core.errorRanges.length > 0 ? { ranges: core.errorRanges, message: "" } : null,
    diagnostics: [],
    selectedDiagnostic: null,
    referenceRanges: [],
    pinnedNode: null,
    pinInCddl: false,
  });
  return normaliseMarks(marks, liveCddl.length).map(m => liveCddl.slice(m.start, m.end));
}

/** One settled decode, projected the way `useCborDecoded` projects it. */
async function readDecoded(rawInput: string) {
  const normalised = normalizeCborInput(rawInput);
  const pass: CborDecodePass = {
    normalised,
    outcome: await safeCborToJson(normalised.hex),
  };
  return cborDecodedView(pass);
}

async function readValidation(hex: string, cddl: string, rule: string, schemaIsValid: boolean) {
  const outcome = schemaIsValid ? await safeValidateCborAgainstCddl(hex, cddl, rule) : null;
  return cborValidationView(outcome);
}

const SCHEMA = `set<a0> = [* a0]
address = (line: tstr, zip: uint)
Person = { name: tstr, tags: set<tstr>, seat: address }
`;

const PERSON_CDDL = "Person = {\n  name: tstr,\n  age: uint,\n}\n";
// {"name": "Alice", "age": 20}
const PERSON_HEX = "a2646e616d6565416c6963656361676514";
// The same map with `age` as a text string — decodes, does not validate.
const MISMATCHING_HEX = "a2646e616d6565416c69636563616765623230";

describe("useCddlSchema", () => {
  test("offers only rules that can be a validation root", async () => {
    const schema = await readSchema(SCHEMA);
    expect(schema.result?.valid).toBe(true);
    expect(schema.ruleNames).toEqual(["Person"]);
    expect(schema.declaredNames).toEqual(["set", "address", "Person"]);
    expect(schema.outlineSource).toBe(SCHEMA);
  });

  test("the rule a vanished pick falls back to is never a generic one", async () => {
    const schema = await readSchema(SCHEMA);
    expect(resolveRootRule(schema.ruleNames, "renamed_away", "")).toBe("Person");
  });

  test("a schema that doesn't parse reports the error without a rule list", async () => {
    const schema = await readSchema("Person = {\n  name: tstr,\n  age: ");
    expect(schema.result?.valid).toBe(false);
    expect(schema.errorLine).toBe(3);
    expect(schema.ruleNames).toEqual([]);
  });

  test("an unresolved reference is pointed at in the source", async () => {
    const schema = await readSchema("Person = [unknown_rule]\n");
    expect(schema.result?.valid).toBe(false);
    if (!schema.result || schema.result.valid) return;
    expect(schema.result.error.kind).toBe("unresolved_references");
    const [start, end] = schema.errorRange!;
    expect("Person = [unknown_rule]\n".slice(start, end)).toContain("unknown_rule");
  });

  test("every unresolved reference is offered, not only the first", async () => {
    const cddl = "Person = [first_missing, second_missing]\n";
    const schema = await readSchema(cddl);
    expect(schema.unresolvedNames.map(u => u.name)).toEqual(["first_missing", "second_missing"]);
    expect(schema.errorRanges.length).toBe(2);
    for (const [start, end] of schema.errorRanges) {
      expect(cddl.slice(start, end)).toContain("missing");
    }
    // errorRange is still the first, for a single "show in editor" jump.
    expect(schema.errorRange).toEqual(schema.errorRanges[0]);
  });

  test("a parse error contributes the one range it pinned", async () => {
    const schema = await readSchema("Person = {");
    expect(schema.unresolvedNames).toEqual([]);
    expect(schema.errorRanges).toEqual([schema.errorRange!]);
  });

  test("blank input has nothing to report", async () => {
    const schema = await readSchema("   ");
    expect(schema.result).toBeNull();
    expect(schema.ruleNames).toEqual([]);
    expect(schema.errorRange).toBeNull();
    expect(schema.errorRanges).toEqual([]);
    expect(schema.unresolvedNames).toEqual([]);
  });

  test("a pass that could not run at all is a reason, not an empty panel", () => {
    const schema = cddlSchemaView(
      { ok: false, error: "The library did not answer within 10 s, so this pass was abandoned." },
      { source: SCHEMA, outline: [] },
    );
    expect(schema.result).toBeNull();
    expect(schema.checkerFailure).toContain("abandoned");
  });

  test("an unchanged schema hands back the same result object", () => {
    // Marks key on this object; a new one per render rebuilds the overlay.
    const [first, second] = readHookTwice(() => useCddlSchema(SCHEMA, SCHEMA));
    expect(second).toBe(first);
    expect(second.ruleNames).toBe(first.ruleNames);
    expect(second.declaredNames).toBe(first.declaredNames);
  });

  test("the first render owes a pass and says so instead of claiming a verdict", () => {
    // First render: pending, not "this schema declares no rules".
    const schema = readHook(() => useCddlSchema(SCHEMA, SCHEMA));
    expect(schema.pending).toBe(true);
    expect(schema.result).toBeNull();
    // Not a stale rule list either.
    expect(schema.outlineIsStale).toBe(false);
    // No pass has read this text, so nothing it says addresses it.
    expect(schema.rangesAreStale).toBe(true);
    expect(schema.errorRanges).toEqual([]);
  });

  // Debounced pass vs live editor: painting stale ranges underlines the wrong chars.
  describe("only ever points at the document on screen", () => {
    const BROKEN = "Person = [missing_rule]\n";
    // Comment typed above the rules; debounce has not fired.
    const TYPED = `; who\n${BROKEN}`;

    test("a keystroke in the schema moves every character the error named", async () => {
      const core = await readSchema(BROKEN);
      const [start, end] = core.errorRange!;
      expect(BROKEN.slice(start, end)).toBe("missing_rule");
      // Same offsets on the typed text underline the wrong characters.
      expect(TYPED.slice(start, end)).not.toBe("missing_rule");
      expect(paintedErrorText(core, BROKEN)).toEqual(["missing_rule"]);
      expect(paintedErrorText(core, TYPED)).toEqual(["on = [missin"]);
    });

    test("so a pass the editor has moved past contributes no positions", async () => {
      const core = await readSchema(BROKEN);
      expect(cddlOffsetsAreCurrent(BROKEN, BROKEN)).toBe(true);
      expect(cddlOffsetsAreCurrent(BROKEN, TYPED)).toBe(false);

      const withheld = schemaViewWithoutRanges(core);
      expect(withheld.errorRange).toBeNull();
      expect(withheld.errorRanges).toEqual([]);
      expect(paintedErrorText(withheld, TYPED)).toEqual([]);
    });

    test("what the check found is not a position and stays", async () => {
      // Names and line stay; only jump ranges are withheld.
      const withheld = schemaViewWithoutRanges(await readSchema(BROKEN));
      expect(withheld.unresolvedNames.map(u => u.name)).toEqual(["missing_rule"]);
      expect(withheld.result?.valid).toBe(false);
      expect(withheld.errorLine).toBe(1);
      expect(withheld.ruleNames).toEqual(["Person"]);
    });

    test("the pass that reads the typed text names it correctly again", async () => {
      const core = await readSchema(TYPED);
      const [start, end] = core.errorRange!;
      expect(TYPED.slice(start, end)).toBe("missing_rule");
      expect(paintedErrorText(core, TYPED)).toEqual(["missing_rule"]);
    });

    test("text the passes have not read yet is not answered for", () => {
      // Compare against live editor text, not the (still empty) debounced input.
      expect(readHook(() => useCddlSchema("", SCHEMA)).rangesAreStale).toBe(true);
      expect(readHook(() => useCddlSchema("", "")).rangesAreStale).toBe(false);
    });

    test("a plain parse error moves the same way", async () => {
      const broken = "Person = {\n  name: tstr,\n  age: \n";
      const core = await readSchema(broken);
      const [start, end] = core.errorRange!;
      expect(broken.slice(start, end)).toBe(":");
      expect(`; who\n${broken}`.slice(start, end)).toBe("\n");
      expect(schemaViewWithoutRanges(core).errorRange).toBeNull();
    });
  });
});

describe("useCborDecoded", () => {
  test("accepts hex pasted across lines and in upper case", async () => {
    const r = await readDecoded("A264 6E61 6D65\n6541 6C69 6365 6361 6765 14\n");
    expect(r.cleanHex).toBe(PERSON_HEX);
    expect(r.decodeError).toBeNull();
    expect(r.decoded).not.toBeNull();
    expect(r.notification).toBeNull();
  });

  test("reads base64 and says so", async () => {
    const r = await readDecoded("omRuYW1lZUFsaWNlY2FnZWIyMA==");
    expect(r.cleanHex).toBe(MISMATCHING_HEX);
    expect(r.notification).toBe("Base64 → hex");
    expect(r.decodeError).toBeNull();
  });

  test("text that is neither hex nor base64 is reported, not swallowed", async () => {
    const r = await readDecoded("not cbor!");
    expect(r.cleanHex).toBe("");
    expect(r.decodeError?.kind).toBe("invalid_hex");
    // No decoded bytes to point at in the hex view.
    expect(r.errorLocation).toBeNull();
    expect(r.decoded).toBeNull();
  });

  test("half a byte is not usable input", async () => {
    const r = await readDecoded("a2646");
    expect(r.cleanHex).toBe("");
    expect(r.decodeError).not.toBeNull();
  });

  test("CBOR that stops early keeps what decoded and says where it stopped", async () => {
    const r = await readDecoded("a26461");
    expect(r.cleanHex).toBe("a26461");
    expect(r.decodeError?.kind).toBe("unexpected_eof");
    expect(r.errorLocation?.offset).toBe(2);
    expect(r.decoded).not.toBeNull();
  });

  test("empty input is not an error", async () => {
    expect(await readDecoded("   ")).toEqual({
      cleanHex: "",
      decoded: null,
      decodeError: null,
      errorLocation: null,
      decoderFailure: null,
      notification: null,
    });
  });

  test("a decoder that gave up is a reason on the panel", () => {
    // Rules out pairing a new document's hex with the previous document's tree.
    const r = cborDecodedView({
      normalised: { hex: PERSON_HEX, wasBase64: false },
      outcome: { ok: false, error: "input is 6.7 MB, over the 2.0 MB limit" },
    });
    expect(r.cleanHex).toBe(PERSON_HEX);
    expect(r.decoded).toBeNull();
    expect(r.decoderFailure).toContain("over the 2.0 MB limit");
  });

  test("the first render shows nothing rather than the wrong tree", () => {
    const r = readHook(() => useCborDecoded(PERSON_HEX));
    expect(r.pending).toBe(true);
    expect(r.decoded).toBeNull();
    expect(r.cleanHex).toBe("");
  });
});

describe("normalizeCborInput / wholeByteHex", () => {
  test("strips whitespace and lowercases hex", () => {
    expect(normalizeCborInput("A264 6E61\n6D65")).toEqual({ hex: "a2646e616d65", wasBase64: false });
  });

  test("reads base64 as base64 but leaves hex-looking input alone", () => {
    expect(normalizeCborInput("omRuYW1lZUFsaWNl")).toEqual({
      hex: "a2646e616d6565416c696365",
      wasBase64: true,
    });
    // "deadbeef" is valid base64 as well as valid hex; hex has to win.
    expect(normalizeCborInput("deadbeef")).toEqual({ hex: "deadbeef", wasBase64: false });
  });

  test("half a byte, or anything that is not hex, is not usable input", () => {
    expect(wholeByteHex("a2646")).toBe("");
    expect(wholeByteHex("not cbor!")).toBe("");
    expect(wholeByteHex("")).toBe("");
    expect(wholeByteHex("a264")).toBe("a264");
  });
});

describe("shareCborState", () => {
  test("whitespace and base64 are carried, not dropped", () => {
    expect(shareCborState("A264 6E61\n6D65")).toEqual({ hex: "a2646e616d65", dropped: null });
    expect(shareCborState("omRuYW1lZUFsaWNl")).toEqual({
      hex: "a2646e616d6565416c696365",
      dropped: null,
    });
  });

  test("an empty pane drops nothing", () => {
    expect(shareCborState("")).toEqual({ hex: "", dropped: null });
    expect(shareCborState("   \n ")).toEqual({ hex: "", dropped: null });
  });

  test("half a byte is named rather than silently left out of the link", () => {
    const state = shareCborState("a2646");
    expect(state.hex).toBe("");
    expect(state.dropped).toContain("5 hex digits");
    expect(state.dropped).toContain("not a whole number of bytes");
  });

  test("a pane that is neither hex nor base64 is named too", () => {
    const state = shareCborState("not cbor!");
    expect(state.hex).toBe("");
    expect(state.dropped).toContain("8 characters");
    expect(state.dropped).toContain("neither hex nor base64");
  });
});

describe("useCborValidation", () => {
  test("says nothing while the schema itself is broken", async () => {
    const r = await readValidation(PERSON_HEX, "Person = {", "Person", false);
    expect(r.outcome).toBeNull();
    expect(r.diagnostics).toEqual([]);
  });

  test("CBOR that matches produces no diagnostics", async () => {
    const r = await readValidation(PERSON_HEX, PERSON_CDDL, "Person", true);
    expect(r.outcome?.ok).toBe(true);
    expect(r.outcome?.ok === true && r.outcome.result.valid).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });

  test("a mismatch points at the field, the bytes and the schema", async () => {
    const r = await readValidation(MISMATCHING_HEX, PERSON_CDDL, "Person", true);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    const head = r.diagnostics[0];
    expect(head.path).toBe("$.age");
    expect(head.byteSpans.length).toBeGreaterThan(0);
    expect(head.cddlRange).not.toBeNull();
    expect(PERSON_CDDL.slice(head.cddlRange![0], head.cddlRange![1]).length).toBeGreaterThan(0);
  });

  test("every failing element of a repeated slot gets its own diagnostic", async () => {
    // [1, "a", "b"] against `[* int]`.
    const r = await readValidation("830161616162", "thing = [* int]\n", "thing", true);
    expect(r.diagnostics.map(d => d.path)).toEqual(["$[1]", "$[2]"]);
    expect(r.hiddenDiagnostics).toBe(0);
  });

  test("a rule the schema does not declare is a reportable outcome", async () => {
    const r = await readValidation(PERSON_HEX, PERSON_CDDL, "NoSuchRule", true);
    expect(r.outcome?.ok).toBe(true);
    expect(r.diagnostics.map(d => d.kind)).toEqual(["missing_rule"]);
  });

  test("a flood of mismatches is capped and the remainder counted", async () => {
    // 200 strings against `[* int]` — one mismatch each.
    const hex = "98c8" + "6161".repeat(200);
    const r = await readValidation(hex, "thing = [* int]\n", "thing", true);
    expect(r.diagnostics.length).toBe(MAX_DIAGNOSTICS);
    expect(r.hiddenDiagnostics).toBe(200 - MAX_DIAGNOSTICS);
    // Library order is arbitrary; the cap must keep the first of the buffer.
    expect(r.diagnostics.map(d => d.path)).toEqual(
      Array.from({ length: MAX_DIAGNOSTICS }, (_, i) => `$[${i}]`),
    );
  });

  test("nothing to validate yet is not an outcome", async () => {
    expect((await readValidation("", PERSON_CDDL, "Person", true)).outcome).toBeNull();
    expect((await readValidation(PERSON_HEX, PERSON_CDDL, "", true)).outcome).toBeNull();
  });

  test("a refused or abandoned pass is carried through as the outcome", () => {
    const r = cborValidationView({ ok: false, error: "this pass was abandoned" });
    expect(r.outcome?.ok).toBe(false);
    expect(r.diagnostics).toEqual([]);
    expect(r.totalDiagnostics).toBe(0);
  });

  // A mismatch is checked against the debounced schema and marked in the live one.
  describe("only ever marks the schema on screen", () => {
    const TYPED = `; who\n${PERSON_CDDL}`;

    test("a keystroke in the schema moves the span the mismatch marked", async () => {
      const r = await readValidation(MISMATCHING_HEX, PERSON_CDDL, "Person", true);
      const [start, end] = r.diagnostics[0].cddlRange!;
      expect(PERSON_CDDL.slice(start, end)).toBe("uint");
      expect(TYPED.slice(start, end)).not.toBe("uint");
    });

    test("so a run the editor has moved past marks nothing", async () => {
      const r = await readValidation(MISMATCHING_HEX, PERSON_CDDL, "Person", true);
      const withheld = diagnosticsWithoutCddlRanges(r.diagnostics);
      expect(withheld.every(d => d.cddlRange === null)).toBe(true);
      expect(buildEditorMarks({
        schemaError: null,
        diagnostics: withheld,
        selectedDiagnostic: null,
        referenceRanges: [],
        pinnedNode: null,
        pinInCddl: false,
      })).toEqual([]);
    });

    test("everything the mismatch says about the CBOR is untouched", async () => {
      // Cards and hex highlights stay: a schema keystroke moves no input byte.
      const r = await readValidation(MISMATCHING_HEX, PERSON_CDDL, "Person", true);
      const withheld = diagnosticsWithoutCddlRanges(r.diagnostics);
      expect(withheld.map(d => d.path)).toEqual(r.diagnostics.map(d => d.path));
      expect(withheld[0].byteSpans).toBe(r.diagnostics[0].byteSpans);
      expect(withheld[0].message).toBe(r.diagnostics[0].message);
    });

    test("a run that pinned no schema span is handed back as it is", async () => {
      // Hex panel repaints from this list; withholding nothing must not copy it.
      const r = await readValidation(PERSON_HEX, PERSON_CDDL, "NoSuchRule", true);
      expect(r.diagnostics.every(d => d.cddlRange === null)).toBe(true);
      expect(diagnosticsWithoutCddlRanges(r.diagnostics)).toBe(r.diagnostics);
    });
  });
});

describe("useCborCddlMap", () => {
  const source = (over: Partial<CborCddlMapSource> = {}): CborCddlMapSource => ({
    cleanHex: PERSON_HEX,
    cddl: PERSON_CDDL,
    rule: "Person",
    schemaIsValid: true,
    ...over,
  });

  /** The map; a refusal fails loudly rather than reading as "nothing mapped". */
  const mapOf = (outcome: Awaited<ReturnType<typeof safeMapCborToCddl>>) => {
    if (!outcome) throw new Error("expected a map, got nothing to map");
    if (!outcome.ok) throw new Error(`expected a map, got ${outcome.error.kind}`);
    return outcome.map;
  };
  const pathsOf = (outcome: Awaited<ReturnType<typeof safeMapCborToCddl>>) => {
    const bridge = createCborCddlBridge(mapOf(outcome));
    return bridge.entries.map(e => bridge.node(e).cborPath);
  };

  test("maps CBOR the schema rejects, so pinning works while they disagree", async () => {
    expect(pathsOf(await safeMapCborToCddl(MISMATCHING_HEX, PERSON_CDDL, "Person"))).toContain("$.age");
  });

  test("input the library refuses is the kind it was refused under, not an empty map", async () => {
    const noRule = await safeMapCborToCddl(PERSON_HEX, PERSON_CDDL, "NoSuchRule");
    expect(noRule?.ok === false && noRule.error.kind).toBe("missing_rule");
    const notHex = await safeMapCborToCddl("zz", PERSON_CDDL, "Person");
    expect(notHex?.ok === false && notHex.error.kind).toBe("call_failed");
  });

  test("a refused pass settles on the one empty map, beside the reason", async () => {
    const refused = mapPassFor(
      source({ rule: "NoSuchRule" }),
      await safeMapCborToCddl(PERSON_HEX, PERSON_CDDL, "NoSuchRule"),
    );
    expect(refused.map).toBe(EMPTY_CBOR_CDDL_MAP);
    expect(refused.refusal?.kind).toBe("missing_rule");
    // Invalid schema: nothing was asked, so neither a map nor a refusal.
    expect(mapPassFor(source({ schemaIsValid: false }), null)).toEqual({
      source: source({ schemaIsValid: false }),
      map: EMPTY_CBOR_CDDL_MAP,
      refusal: null,
    });
  });

  // Mapping settles one pass behind the tree/hex it is asked about.
  describe("only ever answers for the document on screen", () => {
    // {"name": "Bo", "age": 7} — the same rule, different bytes in different
    // places, and three bytes shorter.
    const SHORTER_HEX = "a2646e616d6562426f6361676507";

    /** The map `pass` offers for `over`, with the editor holding `live`. */
    const offered = (
      pass: CborCddlMapPass,
      over: Partial<CborCddlMapSource> = {},
      live?: string,
    ) => {
      const current = source(over);
      return mapForCurrentInput(pass, current, live ?? current.cddl);
    };

    /** A pass settled for `over`, built by the real library. */
    const passFor = async (over: Partial<CborCddlMapSource> = {}) => {
      const from = source(over);
      return mapPassFor(from, await safeMapCborToCddl(from.cleanHex, from.cddl, from.rule));
    };

    test("the previous document's map answers a pin with the wrong node", async () => {
      const previous = createCborCddlBridge(
        mapOf(await safeMapCborToCddl(PERSON_HEX, PERSON_CDDL, "Person")),
      );
      const current = createCborCddlBridge(
        mapOf(await safeMapCborToCddl(SHORTER_HEX, PERSON_CDDL, "Person")),
      );
      // Byte 13 is the age value on screen; in the previous document it was part of the key.
      const right = findNodeByCborOffset(current, 13);
      const wrong = findNodeByCborOffset(previous, 13);
      expect(right?.entry.entry_role).toBe("value");
      expect(wrong?.entry.entry_role).toBe("key");
      // And it answers for bytes the document on screen does not have at all.
      expect(findNodeByCborOffset(current, 16)).toBeNull();
      expect(findNodeByCborOffset(previous, 16)).not.toBeNull();
    });

    test("a map built from anything else is not answered from", async () => {
      const pass = await passFor();
      expect(offered(pass).map.entries.length).toBeGreaterThan(0);
      // Every input of the pass, since each one moves the offsets its entries
      // are made of.
      expect(offered(pass, { cleanHex: SHORTER_HEX }).map.entries).toEqual([]);
      expect(offered(pass, { cddl: `${PERSON_CDDL}\n` }).map.entries).toEqual([]);
      expect(offered(pass, { rule: "Other" }).map.entries).toEqual([]);
      expect(offered(pass, { schemaIsValid: false }).map.entries).toEqual([]);
    });

    test("a keystroke in the schema stops it answering until the pass catches up", async () => {
      // Schema debounce: editor text is ahead of the settled map's offsets.
      const pass = await passFor();
      const typed = `; who\n${PERSON_CDDL}`;
      expect(offered(pass, {}, PERSON_CDDL).map.entries.length).toBeGreaterThan(0);
      expect(offered(pass, {}, typed).map.entries).toEqual([]);
      const next = await passFor({ cddl: typed });
      expect(offered(next, { cddl: typed }, typed).map.entries.length).toBeGreaterThan(0);
    });

    test("refusing hands back the one empty map, so the bridge is not rebuilt", () => {
      // Bridge memoises on map identity; a fresh empty map per render would drop the cache.
      const pass = mapPassFor(source(), null);
      expect(offered(pass, { rule: "Other" })).toBe(offered(pass, { cleanHex: "00" }));
      expect(offered(pass, { rule: "Other" }).map).toBe(EMPTY_CBOR_CDDL_MAP);
    });

    test("a refusal is answered for the input it was given and no other", async () => {
      // A bound the previous document reached says nothing about this one.
      const deep = { cleanHex: "81".repeat(16385) + "00", cddl: "deep = [deep] / uint\n", rule: "deep" };
      const pass = await passFor(deep);
      expect(pass.refusal?.kind).toBe("nesting_too_deep");
      expect(offered(pass, deep).refusal?.kind).toBe("nesting_too_deep");
      expect(offered(pass, deep).map.entries).toEqual([]);
      expect(offered(pass, { ...deep, cleanHex: "00" }).refusal).toBeNull();
      expect(offered(pass, deep, `${deep.cddl}\n`).refusal).toBeNull();
    });
  });
});

describe("useHoverLink", () => {
  test("reads nothing on the server render", () => {
    const store = createHoverLinkStore();
    expect(readHook(() => useHoverLink(store, selectHexLink))).toEqual([]);
    expect(readHook(() => useHoverLink(store, selectEditorLink))).toBeNull();
  });

  test("a pane's selector hands back the same projection for one link", async () => {
    // useSyncExternalStore compares snapshots by identity; a new object per
    // read would re-render on every check.
    const store = createHoverLinkStore();
    const outcome = await safeMapCborToCddl(PERSON_HEX, PERSON_CDDL, "Person");
    if (!outcome?.ok) throw new Error("expected a map");
    store.setContext(createCborCddlBridge(outcome.map), PERSON_CDDL);
    store.hoverHex(12);
    const link = store.get();
    expect(link).not.toBeNull();
    expect(selectHexLink(link)).toBe(selectHexLink(link));
    expect(selectTreeLink(link)).toBe(selectTreeLink(link));
    expect(selectDecodedLink(link)).toBe(selectDecodedLink(link));
    expect(selectEditorLink(link)).toBe(link);
    expect(selectHexLink(link)).toBe(link!.projection.hexAll);
    expect(selectTreeLink(link)).toBe(link!.projection.treeAll);
    expect(selectDecodedLink(link)).toBe(link!.projection.decodedAll);
    // A hover from the hex names one run, and the arrays hold it alone.
    expect(selectHexLink(link)).toEqual([link!.projection.hex!]);
    expect(selectTreeLink(link)).toEqual([link!.projection.tree!]);
    expect(selectDecodedLink(link)).toEqual([link!.projection.decoded!]);
  });

  test("the pane selectors read as one shared empty value with no link", () => {
    // Two reads of "nothing" must be one snapshot, or a pane with no link would re-render.
    expect(selectHexLink(null)).toEqual([]);
    expect(selectHexLink(null)).toBe(selectHexLink(null));
    expect(selectTreeLink(null)).toEqual([]);
    expect(selectTreeLink(null)).toBe(selectTreeLink(null));
    expect(selectDecodedLink(null)).toEqual([]);
    expect(selectDecodedLink(null)).toBe(selectDecodedLink(null));
    expect(selectEditorLink(null)).toBeNull();
  });
});

describe("useDecodeAgainstSchema", () => {
  test("labels the CBOR with the names the schema declares", async () => {
    const decoded = await safeDecodeCborAgainstCddl(PERSON_HEX, PERSON_CDDL, "Person");
    expect(decoded?.ok).toBe(true);
    if (decoded?.ok !== true) return;
    expect(Object.keys(decoded.value as Record<string, unknown>)).toContain("name");
  });

  test("a rule the schema does not declare comes back as a reason with its kind", async () => {
    const decoded = await safeDecodeCborAgainstCddl(PERSON_HEX, PERSON_CDDL, "NoSuchRule");
    expect(decoded?.ok).toBe(false);
    if (decoded?.ok !== false) return;
    expect(decoded.error.kind).toBe("missing_rule");
    expect(decoded.error.message).toContain("does not define a rule");
  });

  test("a document nested past the bound is a reason with its kind, not a blank panel", async () => {
    const decoded = await safeDecodeCborAgainstCddl(
      "81".repeat(16385) + "00",
      "deep = [deep] / uint\n",
      "deep",
    );
    expect(decoded?.ok).toBe(false);
    if (decoded?.ok !== false) return;
    expect(decoded.error.kind).toBe("nesting_too_deep");
    expect(decoded.error.message).toContain("16384");
  });
});

describe("useReferenceRanges", () => {
  const DOC = "Person = { seat: address }\naddress = tstr\n";

  test("the caret on a definition highlights it and every use", async () => {
    const ranges = await resolveReferenceRanges(DOC, DOC.indexOf("address = tstr"));
    expect(ranges.length).toBe(2);
    for (const [start, end] of ranges) expect(DOC.slice(start, end)).toBe("address");
  });

  test("the caret on a use finds the same set", async () => {
    const onUse = await resolveReferenceRanges(DOC, DOC.indexOf("seat: address") + 6);
    const onDefinition = await resolveReferenceRanges(DOC, DOC.indexOf("address = tstr"));
    expect(onUse).toEqual(onDefinition);
  });

  test("prelude types and whitespace are not symbols to highlight", async () => {
    expect(await resolveReferenceRanges(DOC, DOC.indexOf("tstr"))).toEqual([]);
    expect(await resolveReferenceRanges(DOC, DOC.indexOf(" { "))).toEqual([]);
  });

  test("no caret and no document mean no highlight", async () => {
    expect(await resolveReferenceRanges(DOC, null)).toEqual([]);
    expect(await resolveReferenceRanges("", 0)).toEqual([]);
  });

  test("a schema that doesn't parse highlights nothing", async () => {
    expect(await resolveReferenceRanges("Person = {", 0)).toEqual([]);
  });

  test("a lookup the library could not answer highlights nothing", () => {
    // `cddl_references` returning nothing must not leave the definition half-highlighted.
    expect(referenceRangesFrom({ kind: "type", name: "address" } as never, null)).toEqual([]);
  });

  test("a settled probe only counts while it describes the text on screen", () => {
    expect(caretForReferences({ text: DOC, caret: 7 }, DOC)).toBe(7);
    expect(caretForReferences({ text: DOC, caret: 7 }, DOC + "x")).toBeNull();
    expect(caretForReferences({ text: DOC, caret: null }, DOC)).toBeNull();
  });

  test("a probe from an earlier revision highlights nothing at all", async () => {
    // Rather than a range from the old text painted onto the new one.
    const stale = caretForReferences({ text: "old = tstr\n", caret: 0 }, DOC);
    expect(await resolveReferenceRanges(DOC, stale)).toEqual([]);
  });

  test("a caret past a multi-byte comment still finds the rule under it", async () => {
    // Caret is UTF-16; the library wants UTF-8 bytes. Without conversion this lands in the comment.
    const doc = "; кириллица 🦀\nPerson = int\nother = Person\n";
    const ranges = await resolveReferenceRanges(doc, doc.indexOf("Person"));
    expect(ranges.length).toBe(2);
    for (const [start, end] of ranges) expect(doc.slice(start, end)).toBe("Person");
  });
});

describe("sweepRootRules", () => {
  /** Validator that accepts the named rules, records calls, and can answer slowly. */
  function fakeValidator(accepting: string[], delayMs = 0) {
    const calls: string[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const validate: typeof safeValidateCborAgainstCddl = async (_hex, _cddl, rule, options) => {
      calls.push(rule);
      signals.push(options?.signal);
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      return {
        ok: true,
        result: accepting.includes(rule)
          ? { valid: true }
          : { valid: false, error: { kind: "mismatch", message: "expected map { }, got 5" } },
      } as Awaited<ReturnType<typeof safeValidateCborAgainstCddl>>;
    };
    return { validate, calls, signals };
  }

  const CANDIDATES = ["a", "b", "c", "d", "e", "f"];

  test("reports the candidates that accept, in candidate order, and counts every call", async () => {
    const v = fakeValidator(["e", "b"]);
    const r = await sweepRootRules("05", "x = int", CANDIDATES, NO_ROOT_SWEEP, {
      validate: v.validate, budgetMs: 1000, limit: Infinity,
    });
    expect(r).toEqual({ matches: ["b", "e"], checked: 6 });
    expect(v.calls).toEqual(CANDIDATES);
  });

  test("one call per candidate, sequential, each carrying the sweep's signal", async () => {
    const v = fakeValidator([]);
    const controller = new AbortController();
    await sweepRootRules("05", "x = int", CANDIDATES, NO_ROOT_SWEEP, {
      validate: v.validate, budgetMs: 1000, limit: Infinity, signal: controller.signal,
    });
    expect(v.signals.every(s => s === controller.signal)).toBe(true);
  });

  test("stops at the limit and says how far it got", async () => {
    const v = fakeValidator(["f"]);
    const r = await sweepRootRules("05", "x = int", CANDIDATES, NO_ROOT_SWEEP, {
      validate: v.validate, budgetMs: 1000, limit: 4,
    });
    expect(r).toEqual({ matches: [], checked: 4 });
    expect(v.calls).toEqual(["a", "b", "c", "d"]);
  });

  test("resumes from where a previous sweep stopped, keeping what it found", async () => {
    const v = fakeValidator(["a", "f"]);
    const first = await sweepRootRules("05", "x = int", CANDIDATES, NO_ROOT_SWEEP, {
      validate: v.validate, budgetMs: 1000, limit: 2,
    });
    expect(first).toEqual({ matches: ["a"], checked: 2 });
    const rest = await sweepRootRules("05", "x = int", CANDIDATES, first, {
      validate: v.validate, budgetMs: 1000, limit: Infinity,
    });
    expect(rest).toEqual({ matches: ["a", "f"], checked: 6 });
    expect(v.calls).toEqual(CANDIDATES);
  });

  test("stops between calls once the wall budget is spent, never before the first", async () => {
    const v = fakeValidator([]);
    let clock = 0;
    const r = await sweepRootRules("05", "x = int", CANDIDATES, NO_ROOT_SWEEP, {
      validate: async (...args) => {
        clock += 400;
        return v.validate(...args);
      },
      now: () => clock,
      budgetMs: 1000,
      limit: Infinity,
    });
    // 400 after the first, 800 after the second, 1200 after the third — stop between calls.
    expect(r.checked).toBe(3);
    expect(v.calls).toEqual(["a", "b", "c"]);
  });

  test("an abort drops the candidates not yet dispatched", async () => {
    const controller = new AbortController();
    const v = fakeValidator(["c"], 5);
    const sweep = sweepRootRules("05", "x = int", CANDIDATES, NO_ROOT_SWEEP, {
      validate: v.validate, budgetMs: 1000, limit: Infinity, signal: controller.signal,
    });
    // Let the first call dispatch, then abort while it is in flight.
    await new Promise(r => setTimeout(r, 1));
    controller.abort();
    const r = await sweep;
    // In-flight call finishes, its answer is not counted, nothing after it is dispatched.
    expect(v.calls).toEqual(["a"]);
    expect(r).toEqual({ matches: [], checked: 0 });
  });

  test("a call the transport refuses as superseded ends the sweep the same way", async () => {
    const v = fakeValidator([]);
    const r = await sweepRootRules("05", "x = int", CANDIDATES, NO_ROOT_SWEEP, {
      validate: async (hex, cddl, rule, options) => {
        if (rule === "c") throw new LibAbortedError();
        return v.validate(hex, cddl, rule, options);
      },
      budgetMs: 1000,
      limit: Infinity,
    });
    expect(r.checked).toBe(2);
  });

  test("a candidate whose answer never came is checked and not a match", async () => {
    const r = await sweepRootRules("05", "x = int", ["a", "b"], NO_ROOT_SWEEP, {
      validate: async (_hex, _cddl, rule) =>
        rule === "a" ? { ok: false, error: "abandoned" } : null,
      budgetMs: 1000,
      limit: Infinity,
    });
    expect(r).toEqual({ matches: [], checked: 2 });
  });

  test("publishes the running count no more often than the interval", async () => {
    const v = fakeValidator(["a"]);
    let clock = 0;
    const published: number[] = [];
    await sweepRootRules("05", "x = int", CANDIDATES, NO_ROOT_SWEEP, {
      validate: async (...args) => {
        clock += 60;
        return v.validate(...args);
      },
      now: () => clock,
      onProgress: p => published.push(p.checked),
      budgetMs: 10_000,
      limit: Infinity,
    });
    // Every 100 ms of clock, at 60 ms per call: after the 2nd, 4th and 6th.
    expect(published).toEqual([2, 4, 6]);
  });

  test("the automatic cap is where a long schema stops to ask", () => {
    expect(ROOT_SWEEP_AUTO_CAP).toBe(64);
  });
});

describe("root suggestions against the real library", () => {
  const PERSONS_CDDL = "Person = {\n  name: tstr,\n  age: uint,\n  ? nickname: tstr,\n}\nPersons = [+Person]\n";
  // Two Person maps in an array.
  const TWO_PERSONS_HEX =
    "82a3646e616d6565416c69636563616765181e686e69636b6e616d6563416c69"
    + "a3646e616d6565416c69636563616765181e686e69636b6e616d6563416c69";

  /** Candidates from the outline, for the decoded document's kind, minus the refusing rule. */
  async function candidatesFor(hex: string, cddl: string, rule: string): Promise<string[]> {
    const decoded = await readDecoded(hex);
    const outline = await safeOutline(cddl);
    return candidateRootRules(outline, cddl, rule, cborRootKind(decoded.decoded));
  }

  /** True when the settled pass refused the root item itself. */
  async function refusedAtRoot(hex: string, cddl: string, rule: string): Promise<boolean> {
    const r = await readValidation(hex, cddl, rule, true);
    return r.diagnostics.length > 0 && isRootMismatch(r.diagnostics[0]);
  }

  test("an array of persons rooted at Person is offered Persons", async () => {
    expect(await refusedAtRoot(TWO_PERSONS_HEX, PERSONS_CDDL, "Person")).toBe(true);
    const candidates = await candidatesFor(TWO_PERSONS_HEX, PERSONS_CDDL, "Person");
    expect(candidates).toEqual(["Persons"]);
    const r = await sweepRootRules(TWO_PERSONS_HEX, PERSONS_CDDL, candidates, NO_ROOT_SWEEP, {
      budgetMs: 10_000, limit: Infinity,
    });
    expect(r).toEqual({ matches: ["Persons"], checked: 1 });
  });

  test("a document no rule accepts is checked against every candidate and matches none", async () => {
    expect(await refusedAtRoot("05", PERSONS_CDDL, "Person")).toBe(true);
    const candidates = await candidatesFor("05", PERSONS_CDDL, "Person");
    // Persons is an array rule, so an integer is not even tried against it.
    expect(candidates).toEqual([]);
    const r = await sweepRootRules("05", PERSONS_CDDL, candidates, NO_ROOT_SWEEP, {
      budgetMs: 10_000, limit: Infinity,
    });
    expect(r).toEqual({ matches: [], checked: 0 });
  });

  test("a mismatch inside the document is not a refusal at the root", async () => {
    // {"name": "Alice", "age": "20"} fits Person's shape and fails on age.
    expect(await refusedAtRoot(MISMATCHING_HEX, PERSONS_CDDL, "Person")).toBe(false);
  });

  test("a transaction rooted at the transaction body is offered transaction", async () => {
    const tx = CONWAY_TX_HEX;
    expect(await refusedAtRoot(tx, CONWAY_CDDL, "transaction_body")).toBe(true);
    const candidates = await candidatesFor(tx, CONWAY_CDDL, "transaction_body");
    expect(candidates.length).toBeGreaterThan(20);
    expect(candidates.length).toBeLessThanOrEqual(ROOT_SWEEP_AUTO_CAP);
    const r = await sweepRootRules(tx, CONWAY_CDDL, candidates, NO_ROOT_SWEEP, {
      budgetMs: 60_000, limit: Infinity,
    });
    expect(r.matches).toEqual(["transaction"]);
    expect(r.checked).toBe(candidates.length);
  });
});

describe("useRootSuggestions", () => {
  test("the first render owes a sweep and says so", () => {
    const r = readHook(() => useRootSuggestions("05", "x = int", ["a", "b"], true));
    expect(r.pending).toBe(true);
    expect(r.total).toBe(2);
    expect(r.checked).toBe(0);
    expect(r.matches).toEqual([]);
  });

  test("with nothing to sweep for, there is nothing pending", () => {
    const r = readHook(() => useRootSuggestions("05", "x = int", ["a", "b"], false));
    expect(r.pending).toBe(false);
    expect(r.total).toBe(0);
    expect(r.matches).toEqual([]);
  });

  test("an unchanged input hands back the same result object", () => {
    const candidates = ["a"];
    const [first, second] = readHookTwice(() => useRootSuggestions("05", "x = int", candidates, true));
    expect(second).toBe(first);
  });
});

describe("settleDelayFor", () => {
  test("a small schema keeps the short delay", () => {
    expect(settleDelayFor("")).toBe(200);
    expect(settleDelayFor("Person = { name: tstr }")).toBe(200);
  });

  test("a schema that costs more to parse gets longer to settle", () => {
    expect(settleDelayFor("x".repeat(5_000))).toBeGreaterThan(200);
    // Ledger-sized schema: a burst of typing must not queue one pass per keystroke.
    expect(settleDelayFor("x".repeat(25_000))).toBe(600);
  });

  test("the wait is capped", () => {
    expect(settleDelayFor("x".repeat(10_000_000))).toBe(600);
  });

  test("it never goes backwards as the schema grows", () => {
    let prev = 0;
    for (let n = 0; n <= 40_000; n += 1_000) {
      const d = settleDelayFor("x".repeat(n));
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

// Debounce and retention need a DOM renderer (effects don't run under SSR).
// Projections are covered above; transport is in workerClient.test.ts.
test.todo("useDebouncedString re-emits the latest value after the delay", () => {});
test.todo("useDebouncedString cancels a pending emit when the value changes again", () => {});
test.todo("useLibResource keeps the previous value while the next pass runs", () => {});
