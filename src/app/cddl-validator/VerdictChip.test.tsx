import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import VerdictChip from "./VerdictChip";
import type { CborDiagnostic } from "./cddlError";
import type { Verdict } from "./verdict";

const head: CborDiagnostic = {
  kind: "mismatch",
  message: "expected type uint",
  expected: "uint",
  path: "$.age",
  cddlRange: [10, 14],
  byteSpans: [{ offset: 4, length: 2 }],
  anchorSpans: [],
};

function markup(verdict: Verdict, open = false) {
  return renderToStaticMarkup(<VerdictChip verdict={verdict} open={open} onToggle={() => {}} />);
}

describe("VerdictChip", () => {
  test("nothing for a run with no verdict", () => {
    expect(markup({ kind: "none" })).toBe("");
  });

  test("a match is a note, not a button — there is nothing to list", () => {
    const html = markup({ kind: "valid", rule: "Person" });
    expect(html).toContain('class="cq-verdict cq-verdict-valid"');
    expect(html).toContain('role="status"');
    expect(html).toContain("✓ matches <code>Person</code>");
    expect(html).toContain('aria-label="CBOR matches Person"');
    expect(html).not.toContain("<button");
  });

  test("mismatches are a red button counting them, with the head as the tooltip", () => {
    const html = markup({ kind: "mismatches", count: 3, head });
    expect(html).toContain('<button type="button" class="cq-verdict cq-verdict-invalid"');
    expect(html).toContain(">✗ 3 mismatches</button>");
    expect(html).toContain('title="mismatch at $.age (expected uint) — expected type uint"');
    expect(html).toContain('aria-label="3 mismatches — show the list"');
  });

  test("one mismatch is singular", () => {
    const html = markup({ kind: "mismatches", count: 1, head });
    expect(html).toContain(">✗ 1 mismatch</button>");
    expect(html).toContain('aria-label="1 mismatch — show the list"');
  });

  test("a refusal is a button labelled with its kind, the reason as its tooltip", () => {
    const html = markup({ kind: "refused", label: "nesting_too_deep", message: "too deep" });
    expect(html).toContain(">✗ nesting_too_deep</button>");
    expect(html).toContain('title="too deep"');
    expect(html).toContain('aria-label="nesting_too_deep — show the list"');
  });

  test("aria-expanded follows the list, and the button names it only while it is there", () => {
    const closed = markup({ kind: "mismatches", count: 3, head }, false);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("aria-controls");
    const open = markup({ kind: "mismatches", count: 3, head }, true);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-controls="cq-mismatch-drawer"');
    expect(open).toContain('aria-label="3 mismatches — hide the list"');
  });
});
