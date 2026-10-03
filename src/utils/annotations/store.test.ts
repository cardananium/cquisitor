import { describe, expect, test } from "bun:test";
import { createAnnotationStore, stepFocus, type CquisitorAnnotation } from "./store";

const ann = (path: string, severity?: CquisitorAnnotation["severity"]): CquisitorAnnotation => ({
  target: { kind: "tx_path", path },
  ...(severity ? { severity } : {}),
});

const THREE = [ann("transaction.body.fee"), ann("transaction.body.outputs.0"), ann("transaction.body.inputs.1")];

describe("stepFocus", () => {
  test("wraps at both ends", () => {
    expect(stepFocus(0, 1, 3)).toBe(1);
    expect(stepFocus(2, 1, 3)).toBe(0);
    expect(stepFocus(0, -1, 3)).toBe(2);
    expect(stepFocus(1, -4, 3)).toBe(0);
  });

  test("is 0 with nothing to step through", () => {
    expect(stepFocus(5, 1, 0)).toBe(0);
  });
});

describe("annotation store", () => {
  test("a link's annotations start waiting, focused where the link says", () => {
    const store = createAnnotationStore();
    store.apply("transaction-validator", THREE, 1, "84a4");
    const state = store.get("transaction-validator")!;
    expect(state.focus).toBe(1);
    expect(state.statuses.map((s) => s.state)).toEqual(["waiting", "waiting", "waiting"]);
    expect(store.get("general-cbor")).toBeNull();
  });

  test("a focus past the list clamps to its last entry; a malformed one is 0", () => {
    const store = createAnnotationStore();
    store.apply("general-cbor", THREE, 9);
    expect(store.get("general-cbor")!.focus).toBe(2);
    store.apply("general-cbor", THREE, -1);
    expect(store.get("general-cbor")!.focus).toBe(0);
    store.apply("general-cbor", THREE, 1.5);
    expect(store.get("general-cbor")!.focus).toBe(0);
  });

  test("an empty list clears the tab", () => {
    const store = createAnnotationStore();
    store.apply("general-cbor", THREE);
    store.apply("general-cbor", []);
    expect(store.get("general-cbor")).toBeNull();
  });

  test("next / previous wrap, and every focus request bumps the sequence", () => {
    const store = createAnnotationStore();
    store.apply("cddl-validator", THREE, 2);
    const seq0 = store.get("cddl-validator")!.focusSeq;
    store.step("cddl-validator", 1);
    expect(store.get("cddl-validator")!.focus).toBe(0);
    store.step("cddl-validator", -1);
    expect(store.get("cddl-validator")!.focus).toBe(2);
    store.focus("cddl-validator", 2);
    const state = store.get("cddl-validator")!;
    expect(state.focus).toBe(2);
    expect(state.focusSeq).toBe(seq0 + 3);
  });

  test("statuses are kept per target and an unchanged report does not notify", () => {
    const store = createAnnotationStore();
    store.apply("general-cbor", THREE);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    const report = [{ state: "resolved" as const }, { state: "not_found" as const, note: "gone" }, { state: "waiting" as const }];
    store.setStatuses("general-cbor", report);
    store.setStatuses("general-cbor", report.map((s) => ({ ...s })));
    expect(calls).toBe(1);
    expect(store.get("general-cbor")!.statuses[1]).toEqual({ state: "not_found", note: "gone" });
    // A report for a different list (stale) is ignored.
    store.setStatuses("general-cbor", [{ state: "resolved" }]);
    expect(calls).toBe(1);
    off();
  });

  test("dismiss clears the tab and notifies", () => {
    const store = createAnnotationStore();
    store.apply("general-cbor", THREE);
    let calls = 0;
    store.subscribe(() => calls++);
    store.dismiss("general-cbor");
    expect(store.get("general-cbor")).toBeNull();
    expect(calls).toBe(1);
    store.dismiss("general-cbor");
    expect(calls).toBe(1);
  });

  test("replacing the input dismisses only after the link's input was on screen", () => {
    const store = createAnnotationStore();
    store.apply("general-cbor", THREE, 0, "a1");
    // The input state has not caught up with the link yet.
    store.noteInput("general-cbor", "");
    expect(store.get("general-cbor")).not.toBeNull();
    store.noteInput("general-cbor", "a1");
    expect(store.get("general-cbor")!.inputSeen).toBe(true);
    store.noteInput("general-cbor", "a1");
    expect(store.get("general-cbor")).not.toBeNull();
    store.noteInput("general-cbor", "a2");
    expect(store.get("general-cbor")).toBeNull();
  });

  test("without an input key the input never dismisses", () => {
    const store = createAnnotationStore();
    store.apply("cddl-validator", THREE, 0, null);
    store.noteInput("cddl-validator", "x");
    store.noteInput("cddl-validator", "y");
    expect(store.get("cddl-validator")).not.toBeNull();
  });
});
