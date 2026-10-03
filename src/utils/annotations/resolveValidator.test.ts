import { describe, expect, test } from "bun:test";
import type { CquisitorAnnotation } from "./store";
import {
  closestTxPathElement,
  diagnosticNames,
  resolveValidatorAnnotations,
  txPathExists,
  txViewPath,
  validatorMarks,
  type ValidatorResultLike,
} from "./resolveValidator";
import { annotationClassName, buildMarks, describeTarget } from "./marks";

const DECODED = {
  transaction_hash: "ab",
  transaction: {
    body: {
      fee: "170000",
      inputs: [{ transaction_id: "aa", index: 0 }],
      outputs: [{ address: "addr1", amount: { coin: "1" } }, { address: "addr2", amount: { coin: "2" } }],
    },
    witness_set: {
      redeemers: [{ tag: "Spend", index: 0 }, { tag: "Mint", index: 0 }],
      plutus_data: { elems: [{ int: 1 }] },
    },
  },
};

const RESULT: ValidatorResultLike = {
  errors: [{ error: { FeeTooSmall: { min: 1 } } }, { error: { MissingVKeyWitnesses: {} } }],
  phase2_errors: [{ error: { ScriptFailure: {} } }],
  warnings: [{ warning: { MissingVKeyWitnesses: {} } }],
  phase2_warnings: [{ warning: "BudgetCloseToLimit" }],
  eval_redeemer_results: [
    { tag: "Spend", index: 0 },
    { tag: "Mint", index: BigInt(0) },
  ],
};

const a = (target: CquisitorAnnotation["target"], severity?: CquisitorAnnotation["severity"]): CquisitorAnnotation => ({
  target,
  ...(severity ? { severity } : {}),
});

describe("tx paths", () => {
  test("plutus data sits under `elems` in the views", () => {
    expect(txViewPath("transaction.witness_set.plutus_data.0")).toBe("transaction.witness_set.plutus_data.elems.0");
    expect(txViewPath("transaction.witness_set.plutus_data")).toBe("transaction.witness_set.plutus_data");
    expect(txViewPath("transaction.body.fee")).toBe("transaction.body.fee");
  });

  test("existence walks objects by key and arrays by index", () => {
    expect(txPathExists(DECODED, "transaction.body.outputs.1")).toBe(true);
    expect(txPathExists(DECODED, "transaction.body.outputs.1.amount.coin")).toBe(true);
    expect(txPathExists(DECODED, "transaction.body.outputs.2")).toBe(false);
    expect(txPathExists(DECODED, "transaction.body.outputs.x")).toBe(false);
    expect(txPathExists(DECODED, "transaction.body.mint")).toBe(false);
    expect(txPathExists(DECODED, "")).toBe(false);
  });
});

describe("diagnosticNames", () => {
  test("phase-1 errors, phase-2 errors, phase-1 warnings, phase-2 warnings", () => {
    expect(diagnosticNames(RESULT)).toEqual([
      "FeeTooSmall",
      "MissingVKeyWitnesses",
      "ScriptFailure",
      "MissingVKeyWitnesses",
      "BudgetCloseToLimit",
    ]);
  });
});

describe("resolveValidatorAnnotations", () => {
  const annotations = [
    a({ kind: "tx_path", path: "transaction.body.outputs.0" }, "error"),
    a({ kind: "tx_path", path: "transaction.witness_set.plutus_data.0" }),
    a({ kind: "tx_path", path: "transaction.body.collateral.0" }),
    a({ kind: "diagnostic", index: 2 }),
    a({ kind: "diagnostic", name: "MissingVKeyWitnesses", occurrence: 1 }),
    a({ kind: "diagnostic", name: "MissingVKeyWitnesses", occurrence: 2 }),
    a({ kind: "redeemer", tag: "mint", index: 0 }),
    a({ kind: "redeemer", tag: "Spend", index: 4 }),
    a({ kind: "cbor_span", offset: 0, length: 1 }),
  ];

  test("before decoding, every target waits", () => {
    const r = resolveValidatorAnnotations(annotations, { decoded: null, decoding: true, result: null, validating: false });
    expect(r.slice(0, 8).every((x) => x.status.state === "waiting")).toBe(true);
    expect(r[0].status.note).toContain("decode");
    expect(r[8].status.state).toBe("unsupported");
  });

  test("tx paths resolve on the decoded transaction; validator targets wait for a result", () => {
    const r = resolveValidatorAnnotations(annotations, { decoded: DECODED, decoding: false, result: null, validating: false });
    expect(r.map((x) => x.status.state)).toEqual([
      "resolved", "resolved", "not_found", "waiting", "waiting", "waiting", "waiting", "waiting", "unsupported",
    ]);
    expect(r[1]).toMatchObject({ kind: "tx_path", path: "transaction.witness_set.plutus_data.elems.0" });
    expect(r[3].status.note).toContain("Validate");
  });

  test("a validation in flight says so", () => {
    const r = resolveValidatorAnnotations(annotations, { decoded: DECODED, decoding: false, result: null, validating: true });
    expect(r[3].status).toEqual({ state: "waiting", note: "Validating…" });
  });

  test("once a result arrives, diagnostics and redeemers resolve or are not found", () => {
    const waiting = resolveValidatorAnnotations(annotations, { decoded: DECODED, decoding: false, result: null, validating: false });
    const done = resolveValidatorAnnotations(annotations, { decoded: DECODED, decoding: false, result: RESULT, validating: false });
    expect(waiting[4].status.state).toBe("waiting");
    expect(done[3]).toMatchObject({ kind: "diagnostic", diagnosticIndex: 2, status: { state: "resolved" } });
    // Second MissingVKeyWitnesses is the phase-1 warning, list index 3.
    expect(done[4]).toMatchObject({ kind: "diagnostic", diagnosticIndex: 3, status: { state: "resolved" } });
    expect(done[5]).toMatchObject({ kind: "diagnostic", diagnosticIndex: null, status: { state: "not_found" } });
    // Tag compared without case; a bigint index matches a number.
    expect(done[6]).toMatchObject({ kind: "redeemer", rowIndex: 1, status: { state: "resolved" } });
    expect(done[7]).toMatchObject({ kind: "redeemer", rowIndex: null, status: { state: "not_found" } });
  });

  test("a diagnostic index past the list is not found", () => {
    const [r] = resolveValidatorAnnotations([a({ kind: "diagnostic", index: 5 })], {
      decoded: DECODED, decoding: false, result: RESULT, validating: false,
    });
    expect(r.status.state).toBe("not_found");
  });
});

describe("validatorMarks", () => {
  test("marks land on view paths, list indices and Plutus rows", () => {
    const annotations = [
      a({ kind: "tx_path", path: "transaction.body.outputs.0" }, "warning"),
      a({ kind: "tx_path", path: "transaction.body.outputs.0" }, "error"),
      a({ kind: "diagnostic", index: 0 }),
      a({ kind: "redeemer", tag: "Spend", index: 0 }, "error"),
    ];
    const r = resolveValidatorAnnotations(annotations, { decoded: DECODED, decoding: false, result: RESULT, validating: false });
    const marks = validatorMarks(r, annotations, 2);
    expect(marks.txPaths.get("transaction.body.outputs.0")).toEqual({ severity: "error", indices: [0, 1], focused: false });
    expect(marks.diagnostics.get(0)).toEqual({ severity: "info", indices: [2], focused: true });
    expect(marks.redeemers.get(0)?.severity).toBe("error");
  });
});

describe("marks", () => {
  test("a shared target takes the focused annotation's severity", () => {
    const annotations = [a({ kind: "tx_path", path: "p" }, "error"), a({ kind: "tx_path", path: "p" }, "info")];
    const marks = buildMarks([{ key: "p", index: 0 }, { key: "p", index: 1 }], annotations, 1);
    expect(marks.get("p")).toEqual({ severity: "info", indices: [0, 1], focused: true });
  });

  test("class names carry severity, focus and one anchor class per annotation", () => {
    expect(annotationClassName({ severity: "warning", indices: [1, 4], focused: true }))
      .toBe("cq-ann cq-ann-warning cq-ann-focused cq-ann-at-1 cq-ann-at-4");
    expect(annotationClassName(undefined)).toBe("");
  });

  test("targets describe themselves when there is no label", () => {
    expect(describeTarget({ kind: "redeemer", tag: "Spend", index: 2 })).toBe("Spend[2]");
    expect(describeTarget({ kind: "diagnostic", index: 0 })).toBe("Diagnostic #1");
    expect(describeTarget({ kind: "cddl_rule", name: "coin" })).toBe("Rule coin");
  });
});

describe("closestTxPathElement", () => {
  const el = (path: string) => ({ getAttribute: (name: string) => (name === "data-tx-path" ? path : null) }) as unknown as Element;

  test("picks the element whose path is the longest dotted prefix", () => {
    const body = el("transaction.body");
    const outputs = el("transaction.body.outputs");
    const out1 = el("transaction.body.outputs.1");
    const out10 = el("transaction.body.outputs.10");
    const all = [body, outputs, out10, out1];
    expect(closestTxPathElement(all, "transaction.body.outputs.1.amount.coin")).toBe(out1);
    expect(closestTxPathElement(all, "transaction.body.outputs.10")).toBe(out10);
    expect(closestTxPathElement(all, "transaction.body.fee")).toBe(body);
    expect(closestTxPathElement(all, "transaction.witness_set")).toBeNull();
  });
});
