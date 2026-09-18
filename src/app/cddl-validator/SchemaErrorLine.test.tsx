import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CddlValidationResult } from "@cardananium/cquisitor-lib";
import SchemaErrorLine, { type SchemaErrorLineProps } from "./SchemaErrorLine";
import type { CddlUnresolvedName } from "./cddlError";

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

function unresolved(name: string, line: number, at: number): CddlUnresolvedName {
  return { name, line, range: [at, at + name.length] };
}

function props(over: Partial<SchemaErrorLineProps> = {}): SchemaErrorLineProps {
  return {
    result: { valid: true },
    checkerFailure: null,
    errorLine: null,
    unresolvedNames: [],
    rangesAreStale: false,
    onRevealError: () => {},
    onRevealRange: () => {},
    ...over,
  };
}

const markup = (over: Partial<SchemaErrorLineProps> = {}) =>
  renderToStaticMarkup(<SchemaErrorLine {...props(over)} />);

const unresolvedSchema = (truncated = false): Partial<SchemaErrorLineProps> => ({
  result: {
    valid: false,
    error: {
      kind: "unresolved_references",
      message: "missing definition for rule coin",
      byte_span: { offset: 5, length: 4, char_offset: 5, char_length: 4, line: 1 },
      truncated,
    },
  } as CddlValidationResult,
  errorLine: 1,
  unresolvedNames: [unresolved("coin", 1, 5), unresolved("value", 2, 20), unresolved("coin", 3, 40)],
});

/** The first row's tags, before the to-do row when there is one. */
function topRow(html: string): string {
  const at = html.indexOf('class="cq-schema-error-todo"');
  return at === -1 ? html : html.slice(0, at);
}

describe("SchemaErrorLine", () => {
  test("nothing for a schema that checks, or none at all", () => {
    expect(markup()).toBe("");
    expect(markup({ result: null })).toBe("");
  });

  test("a schema naming rules nothing defines reads as a list of rules to define", () => {
    const html = markup(unresolvedSchema());
    expect(html).toContain('class="cq-schema-error-kind"');
    expect(html).toContain(">unresolved_references<");
    // One chip per name, not one per occurrence: `coin` is one rule to write.
    expect(count(html, 'class="cq-schema-error-chip"')).toBe(2);
    expect(html).toContain("Define <code>coin</code>");
    expect(html).toContain("Define <code>value</code>");
    expect(html).toContain(">line 1</button>");
    expect(html).toContain(">line 2</button>");
    expect(html).toContain(">line 3</button>");
    expect(html).toContain('title="Show coin on line 3"');
    // Head span is the first occurrence, which the chips already offer.
    expect(topRow(html)).not.toContain("cq-schema-error-line");
    expect(html).toContain('<div class="cq-schema-error-advice">The schema parses. It uses 2 rules that nothing in it defines, across 3 references. Define each name below');
    expect(html.indexOf("cq-schema-error-advice")).toBeLessThan(html.indexOf("cq-schema-error-todo"));
    expect(html).not.toContain("has to parse before");
  });

  test("a polite live region, since every settled pass rewrites it", () => {
    expect(markup(unresolvedSchema())).toContain('<div class="cq-schema-error" role="status">');
    expect(markup({ result: null, checkerFailure: "x" })).toContain('role="status"');
    expect(markup(unresolvedSchema())).not.toContain('role="alert"');
  });

  test("a stale check keeps the names and disarms the buttons", () => {
    const html = markup({ ...unresolvedSchema(), rangesAreStale: true });
    expect(html).toContain("Define <code>coin</code>");
    expect(count(html, "disabled")).toBe(3);
    expect(html).toContain('title="The schema has been edited since this check ran"');
  });

  test("a capped list of unresolved names says the list is not all of them", () => {
    expect(markup(unresolvedSchema(true))).toContain("the list is not all of them");
    expect(markup(unresolvedSchema(false))).not.toContain("not all of them");
  });

  test("a schema that declares no rules has no place to jump to", () => {
    const html = markup({
      result: {
        valid: false,
        error: { kind: "no_rules", message: "CDDL document defines no rules" },
      } as CddlValidationResult,
    });
    expect(html).toContain(">no_rules<");
    expect(html).toContain("CDDL document defines no rules");
    expect(html).not.toContain("<button");
    const kind = html.slice(html.indexOf('class="cq-schema-error-kind"'));
    expect(kind.slice(0, kind.indexOf(">"))).toContain("Add a type rule");
    expect(html).toContain('<div class="cq-schema-error-advice">The text parses. It just declares no rules');
    expect(html).toContain("then pick it as the root.</div>");
  });

  test("a schema that will not parse offers its line, and keeps the wording that is true for it", () => {
    const html = markup({
      result: {
        valid: false,
        error: {
          kind: "parse_error",
          message: "parsing error: position Position { line: 1, column: 10, range: (9, 10), index: 9 }, msg: expected type value",
          byte_span: { offset: 9, length: 1, char_offset: 9, char_length: 1, line: 1 },
        },
      } as CddlValidationResult,
      errorLine: 1,
    });
    expect(html).toContain(">parse_error<");
    expect(html).toContain('class="cq-schema-error-reason" title="expected type value">expected type value<');
    expect(html).toContain('<button type="button" class="cq-schema-error-line"');
    expect(html).toContain(">line 1</button>");
    expect(html).not.toContain("disabled");
    const kind = html.slice(html.indexOf('class="cq-schema-error-kind"'));
    expect(kind.slice(0, kind.indexOf(">"))).toContain("has to parse before");
    expect(html).toContain('<div class="cq-schema-error-advice">The schema has to parse before any CBOR can be checked against it.</div>');
  });

  test("a stale parse error keeps its line as a disabled button", () => {
    const html = markup({
      result: {
        valid: false,
        error: {
          kind: "parse_error",
          message: "expected type value",
          byte_span: { offset: 9, length: 1, char_offset: 9, char_length: 1, line: 4 },
        },
      } as CddlValidationResult,
      errorLine: 4,
      rangesAreStale: true,
    });
    expect(html).toContain(">line 4</button>");
    expect(count(html, "disabled")).toBe(1);
  });

  test("a checker that gave up is reported with its reason, and what that means", () => {
    const html = markup({ result: null, checkerFailure: "recursion limit reached" });
    expect(html).toContain(">schema checker failed<");
    expect(html).toContain('title="recursion limit reached">recursion limit reached<');
    expect(html).toContain('<div class="cq-schema-error-advice">The checker stopped on this schema instead of reporting a parse error in it.</div>');
  });
});
