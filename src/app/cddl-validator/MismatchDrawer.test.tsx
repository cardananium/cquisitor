import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import MismatchDrawer, { escapeCloses, type MismatchDrawerProps } from "./MismatchDrawer";
import type { CborDiagnostic } from "./cddlError";
import type { CborValidationOutcome } from "./cddlValidatorLib";

const LIMIT = "CBOR nesting is deeper than the supported limit of 16384 levels";

function diagnostic(over: Partial<CborDiagnostic> = {}): CborDiagnostic {
  return {
    kind: "mismatch",
    message: "expected type uint",
    expected: "uint",
    path: "$.age",
    cddlRange: [10, 14],
    byteSpans: [{ offset: 4, length: 2 }],
    anchorSpans: [],
    ...over,
  };
}

const diagnostics = [diagnostic({ path: "$.a" }), diagnostic({ path: "$.b" }), diagnostic({ path: "$.c" })];
const INVALID: CborValidationOutcome = {
  ok: true,
  result: { valid: false, error: { kind: "mismatch", message: "expected type uint" } },
};

function props(over: Partial<MismatchDrawerProps> = {}): MismatchDrawerProps {
  return {
    verdict: { kind: "mismatches", count: 3, head: diagnostics[0] },
    outcome: INVALID,
    diagnostics,
    hiddenDiagnostics: 0,
    selectedIndex: null,
    onSelectDiagnostic: () => {},
    onRevealBytes: () => {},
    onClose: () => {},
    ...over,
  };
}

const markup = (over: Partial<MismatchDrawerProps> = {}) =>
  renderToStaticMarkup(<MismatchDrawer {...props(over)} />);

describe("MismatchDrawer", () => {
  test("is the region the chip names, titled with the count", () => {
    const html = markup();
    expect(html).toContain('<section id="cq-mismatch-drawer" class="cq-mismatch-drawer" role="region" aria-label="3 mismatches">');
    expect(html).toContain('<span class="cq-mismatch-drawer-title">3 mismatches</span>');
    expect(html).toContain('aria-label="Close the mismatch list"');
  });

  test("one mismatch is singular", () => {
    const html = markup({ verdict: { kind: "mismatches", count: 1, head: diagnostics[0] }, diagnostics: [diagnostics[0]] });
    expect(html).toContain('<span class="cq-mismatch-drawer-title">1 mismatch</span>');
  });

  test("a refusal is titled with its label", () => {
    const html = markup({
      verdict: { kind: "refused", label: "nesting_too_deep", message: LIMIT },
      outcome: { ok: true, result: { valid: false, error: { kind: "nesting_too_deep", message: LIMIT } } },
      diagnostics: [diagnostic({ kind: "nesting_too_deep", message: LIMIT, expected: null, path: "$[0][0]", byteSpans: [] })],
    });
    expect(html).toContain('<span class="cq-mismatch-drawer-title">nesting_too_deep</span>');
    expect(html).toContain('class="cddl-error-card-kind">nesting_too_deep<');
    expect(html).toContain("not a finding about the input");
  });

  test("the body is the list: head card, the rest behind a disclosure", () => {
    const html = markup();
    expect(html).toContain('class="cq-mismatch-drawer-body"');
    expect(html).toContain("$.a");
    expect(html).toContain("2 more mismatches in the same run");
  });

  test("the selected card is marked", () => {
    const html = markup({ selectedIndex: 0 });
    expect(html).toContain("cddl-error-card cddl-error-card-current");
    expect(markup()).not.toContain("cddl-error-card-current");
  });

  test("a refusal with no diagnostics is the walk-refusal card", () => {
    const html = markup({
      verdict: { kind: "refused", label: "group_rule_root", message: "CDDL rule g is a group rule" },
      outcome: { ok: true, result: { valid: false, error: { kind: "group_rule_root", message: "CDDL rule g is a group rule" } } },
      diagnostics: [],
    });
    expect(html).toContain('class="cddl-error-card-kind">group_rule_root<');
    expect(html).toContain("CDDL rule g is a group rule");
  });

  test("a validator that threw is the validator-error card", () => {
    const html = markup({
      verdict: { kind: "refused", label: "validator error", message: "wasm trap: unreachable" },
      outcome: { ok: false, error: "wasm trap: unreachable" },
      diagnostics: [],
    });
    expect(html).toContain('<span class="cq-mismatch-drawer-title">validator error</span>');
    expect(html).toContain('aria-label="validator error"');
    expect(html).toContain('class="cddl-error-card-kind">validator error<');
    expect(html).toContain("wasm trap: unreachable");
    expect(html).toContain("The validator stopped on this input instead of returning a result.");
  });

  // These renders have no window; the decision the listener makes is what is checked.
  test("Escape closes the sheet unless something else took the key", () => {
    expect(escapeCloses({ key: "Escape", defaultPrevented: false })).toBe(true);
    expect(escapeCloses({ key: "Escape", defaultPrevented: true })).toBe(false);
    expect(escapeCloses({ key: "Enter", defaultPrevented: false })).toBe(false);
  });
});
