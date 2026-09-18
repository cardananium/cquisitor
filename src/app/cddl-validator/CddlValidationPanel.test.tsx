import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MismatchList,
  RootSuggestionNote,
  ValidatorErrorCard,
  WalkRefusalCard,
  type MismatchListProps,
  type RootSuggestionsView,
} from "./CddlValidationPanel";
import type { CborDiagnostic } from "./cddlError";

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

function props(over: Partial<MismatchListProps> = {}): MismatchListProps {
  return {
    diagnostics: [diagnostic({ path: "$.a" }), diagnostic({ path: "$.b" }), diagnostic({ path: "$.c" })],
    hiddenDiagnostics: 0,
    selectedIndex: null,
    onSelectDiagnostic: () => {},
    onRevealBytes: () => {},
    ...over,
  };
}

const markup = (over: Partial<MismatchListProps> = {}) =>
  renderToStaticMarkup(<MismatchList {...props(over)} />);

/** The `<details …>` opening tag, or "" when the panel rendered none. */
function detailsTag(html: string): string {
  const at = html.indexOf("<details");
  return at === -1 ? "" : html.slice(at, html.indexOf(">", at) + 1);
}

describe("MismatchList", () => {
  test("the head mismatch is shown and the rest are behind a disclosure", () => {
    const html = markup();
    expect(html).toContain("$.a");
    expect(html).toContain("2 more mismatches in the same run");
    expect(detailsTag(html)).toContain("cddl-error-more");
    expect(detailsTag(html)).not.toContain("open");
  });

  test("selecting a mismatch below the head opens the disclosure holding it", () => {
    // Collapsed `<details>` also hides the card from scroll.
    expect(detailsTag(markup({ selectedIndex: 2 }))).toContain("open");
    expect(detailsTag(markup({ selectedIndex: 1 }))).toContain("open");
  });

  test("selecting the head leaves the rest collapsed", () => {
    expect(detailsTag(markup({ selectedIndex: 0 }))).not.toContain("open");
  });

  test("a single mismatch has nothing to disclose", () => {
    const html = markup({ diagnostics: [diagnostic()] });
    expect(detailsTag(html)).toBe("");
    expect(html).toContain("$.age");
  });

  test("mismatches the panel's cap left out are counted against the total", () => {
    expect(markup({ hiddenDiagnostics: 100 }))
      .toContain("3 of 103 mismatches shown — 100 more the panel does not list.");
  });

  test("mismatches the validator never described are counted too", () => {
    expect(markup({ undescribedDiagnostics: 199 }))
      .toContain("3 of 202 mismatches shown — 199 the validator counted without describing.");
  });

  test("both caps are reported in one sentence, against one total", () => {
    const html = markup({ hiddenDiagnostics: 100, undescribedDiagnostics: 199 });
    expect(html).toContain(
      "3 of 302 mismatches shown — 100 more the panel does not list,"
      + " and 199 the validator counted without describing.",
    );
  });

  test("a run the panel shows whole says nothing about caps", () => {
    expect(markup()).not.toContain("mismatches shown");
  });

  test("an empty run is nothing to list", () => {
    expect(markup({ diagnostics: [] })).toBe("");
  });
});

describe("ValidatorErrorCard", () => {
  test("names the validator and carries the transport's reason", () => {
    const html = renderToStaticMarkup(<ValidatorErrorCard error="wasm trap: unreachable" />);
    expect(html).toContain('class="cddl-error-card-kind">validator error<');
    expect(html).toContain("wasm trap: unreachable");
    expect(html).toContain("The validator stopped on this input instead of returning a result.");
  });
});

describe("the offer of another root under a mismatch at the root", () => {
  const rootMismatch = diagnostic({
    path: "$",
    message: "expected map { name: tstr, age: uint, ? nickname: tstr }, got array(2 items)",
    expected: "map { name: tstr, age: uint, ? nickname: tstr }",
    byteSpans: [{ offset: 0, length: 1 }],
    anchorSpans: [{ offset: 0, length: 63 }],
  });
  const suggestions = (over: Partial<RootSuggestionsView> = {}): RootSuggestionsView => ({
    matches: [],
    checked: 0,
    total: 0,
    pending: false,
    checkTheRest: () => {},
    ...over,
  });
  const withNote = (view: RootSuggestionsView, over: Partial<MismatchListProps> = {}) =>
    markup({
      diagnostics: [rootMismatch],
      rootSuggestions: view,
      onRulePick: () => {},
      ...over,
    });

  /** Buttons in an element tree, with text and handler — static markup cannot carry the latter. */
  function buttonsOf(node: ReactNode): { text: string; onClick: () => void }[] {
    const out: { text: string; onClick: () => void }[] = [];
    const textOf = (n: ReactNode): string => {
      if (typeof n === "string" || typeof n === "number") return String(n);
      if (!isValidElement(n)) return "";
      const el = n as ReactElement<{ children?: ReactNode }>;
      return Children.toArray(el.props.children).map(textOf).join("");
    };
    const walk = (n: ReactNode) => {
      if (!isValidElement(n)) return;
      const el = n as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
      if (el.type === "button" && el.props.onClick) out.push({ text: textOf(el), onClick: el.props.onClick });
      if (typeof el.type === "function") {
        walk((el.type as (p: unknown) => ReactNode)(el.props));
        return;
      }
      Children.forEach(el.props.children, walk);
    };
    walk(node);
    return out;
  }

  test("one matching root is named, with a button that switches to it", () => {
    const html = withNote(suggestions({ matches: ["Persons"], checked: 1, total: 1 }));
    expect(html).toContain("This CBOR matches <code>Persons</code>.");
    expect(html).toContain(">Validate against Persons</button>");
    expect(html).toContain("got array(2 items)");
    expect(html.indexOf("got array(2 items)")).toBeLessThan(html.indexOf("This CBOR matches"));
  });

  test("the button applies the rule through the picker's own path", () => {
    const picked: string[] = [];
    const buttons = buttonsOf(
      <RootSuggestionNote
        suggestions={suggestions({ matches: ["Persons"], checked: 1, total: 1 })}
        onRulePick={rule => picked.push(rule)}
      />,
    );
    expect(buttons.map(b => b.text)).toEqual(["Validate against Persons"]);
    buttons[0].onClick();
    expect(picked).toEqual(["Persons"]);
  });

  test("several matching roots are each a button, up to five, and the rest a count", () => {
    const matches = ["transaction", "block_body", "a", "b", "c", "d", "e"];
    const html = withNote(suggestions({ matches, checked: 40, total: 40 }));
    expect(html).toContain("This CBOR matches");
    expect(html).toContain("<code>transaction</code>");
    expect(html).toContain("<code>block_body</code>");
    expect(html).toContain("<code>c</code>");
    expect(html).not.toContain("<code>d</code>");
    expect(html).toContain("and 2 more");
    expect(html).toContain("click one to validate against it");
    const picked: string[] = [];
    const buttons = buttonsOf(
      <RootSuggestionNote
        suggestions={suggestions({ matches, checked: 40, total: 40 })}
        onRulePick={rule => picked.push(rule)}
      />,
    );
    expect(buttons.map(b => b.text)).toEqual(["transaction", "block_body", "a", "b", "c"]);
    buttons[1].onClick();
    expect(picked).toEqual(["block_body"]);
  });

  test("no matching root is one plain sentence, with the count checked", () => {
    const html = withNote(suggestions({ matches: [], checked: 34, total: 34 }));
    expect(html).toContain("No other root rule in this schema accepts this CBOR (34 checked).");
    expect(html).not.toContain("<button");
  });

  test("no root to check at all is the same sentence without a count", () => {
    const html = withNote(suggestions({ matches: [], checked: 0, total: 0 }));
    expect(html).toContain("No other root rule in this schema accepts this CBOR.");
    expect(html).not.toContain("checked");
  });

  test("a running sweep says how far it is", () => {
    const html = withNote(suggestions({ matches: [], checked: 12, total: 34, pending: true }));
    expect(html).toContain("Looking for a rule this CBOR matches… (12 of 34)");
    expect(html).not.toContain("No other root rule");
  });

  test("a sweep that stopped short says so and offers the rest", () => {
    const html = withNote(suggestions({ matches: [], checked: 40, total: 117 }));
    expect(html).toContain("None of the 40 root rules checked so far accepts this CBOR, of 117 that could.");
    expect(html).toContain(">Check the rest</button>");
    let resumed = 0;
    const buttons = buttonsOf(
      <RootSuggestionNote
        suggestions={suggestions({ matches: [], checked: 40, total: 117, checkTheRest: () => resumed++ })}
        onRulePick={() => {}}
      />,
    );
    expect(buttons.map(b => b.text)).toEqual(["Check the rest"]);
    buttons[0].onClick();
    expect(resumed).toBe(1);
  });

  test("a sweep that stopped short after a match offers both", () => {
    const html = withNote(suggestions({ matches: ["transaction"], checked: 40, total: 117 }));
    expect(html).toContain("This CBOR matches <code>transaction</code>.");
    expect(html).toContain("40 of 117 root rules checked so far.");
    expect(html).toContain(">Check the rest</button>");
  });

  test("nothing of it under a mismatch inside the document", () => {
    // `$.age` fitted the rule's shape and is wrong in one field — another rule is not the question.
    const html = withNote(suggestions({ matches: ["Persons"], checked: 1, total: 1 }), {
      diagnostics: [diagnostic({ path: "$.age" })],
    });
    expect(html).not.toContain("This CBOR matches");
    expect(html).not.toContain("cddl-root-suggestion");
  });

  test("nothing of it under a bound reached at the root", () => {
    const html = withNote(suggestions({ matches: ["Persons"], checked: 1, total: 1 }), {
      diagnostics: [diagnostic({ path: "$", kind: "nesting_too_deep" })],
    });
    expect(html).not.toContain("cddl-root-suggestion");
  });

  test("nothing of it when no sweep was asked for", () => {
    expect(markup({ diagnostics: [rootMismatch] })).not.toContain("cddl-root-suggestion");
    expect(markup({ diagnostics: [rootMismatch], rootSuggestions: null, onRulePick: () => {} }))
      .not.toContain("cddl-root-suggestion");
  });

  test("the compact form is the same note in one line, for the toolbar", () => {
    const html = renderToStaticMarkup(
      <RootSuggestionNote
        suggestions={suggestions({ matches: ["Persons"], checked: 1, total: 1 })}
        onRulePick={() => {}}
        compact
      />,
    );
    expect(html).toContain('class="cddl-root-suggestion cddl-root-suggestion-compact"');
    expect(html).toContain("This CBOR matches <code>Persons</code>.");
    expect(html).toContain(">Validate against Persons</button>");
    expect(withNote(suggestions({ matches: ["Persons"], checked: 1, total: 1 })))
      .toContain('class="cddl-root-suggestion">');
  });
});

describe("a walk refused at a bound", () => {
  const LIMIT = "CBOR nesting is deeper than the supported limit of 16384 levels";
  const limitDiagnostic = diagnostic({
    kind: "nesting_too_deep",
    message: LIMIT,
    expected: null,
    path: "$[0][0]",
    cddlRange: null,
    byteSpans: [],
    anchorSpans: [],
  });

  test("the validation card names the bound and says it is a limit, not a finding", () => {
    const html = markup({ diagnostics: [limitDiagnostic] });
    expect(html).toContain('class="cddl-error-card-kind">nesting_too_deep<');
    expect(html).toContain(LIMIT);
    expect(html).toContain("not a finding about the input");
    expect(markup()).not.toContain("not a finding about the input");
  });

  test("the decode card reads the same way as the validation card", () => {
    const decode = renderToStaticMarkup(
      <WalkRefusalCard refusal={{ kind: "nesting_too_deep", message: LIMIT }} walker="decoder" />,
    );
    const validation = markup({ diagnostics: [limitDiagnostic] });
    for (const piece of [
      'class="cddl-error-card-kind">nesting_too_deep<',
      `class="cddl-error-card-message">${LIMIT}<`,
      "not a finding about the input",
    ]) {
      expect(decode).toContain(piece);
      expect(validation).toContain(piece);
    }
  });

  test("a refusal that is a finding keeps its kind and message and gets no limit note", () => {
    const html = renderToStaticMarkup(
      <WalkRefusalCard
        refusal={{ kind: "group_rule_root", message: "CDDL rule g is a group rule" }}
        walker="decoder"
      />,
    );
    expect(html).toContain('class="cddl-error-card-kind">group_rule_root<');
    expect(html).toContain("CDDL rule g is a group rule");
    expect(html).not.toContain("not a finding");
  });

  test("a call that did not answer is named as such, with the transport's reason", () => {
    const html = renderToStaticMarkup(
      <WalkRefusalCard
        refusal={{ kind: "call_failed", message: "This input is 6.7 MB, over the 2.0 MB limit." }}
        walker="decoder"
      />,
    );
    expect(html).toContain("decoder failed");
    expect(html).toContain("over the 2.0 MB limit");
    expect(html).toContain("The decoder stopped on this input instead of returning a result.");
    expect(html).not.toContain("call_failed");
  });
});
