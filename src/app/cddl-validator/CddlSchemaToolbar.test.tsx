import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import CddlSchemaToolbar, { type ActivePreset } from "./CddlSchemaToolbar";
import { RootSuggestionNote } from "./CddlValidationPanel";
import { CARDANO_PRESETS, LEDGER_REV_SHORT } from "./presets";

function markup(over: {
  activePreset?: ActivePreset | null;
  presetLoading?: string | null;
  rightSlot?: ReactNode;
  ruleNames?: string[];
  schemaIsValid?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <CddlSchemaToolbar
      ruleNames={over.ruleNames ?? ["Person"]}
      effectiveRule="Person"
      selectedRule="Person"
      schemaIsValid={over.schemaIsValid}
      onRulePick={() => {}}
      presetLoading={over.presetLoading ?? null}
      activePreset={over.activePreset ?? null}
      onLoadPreset={() => {}}
      rightSlot={over.rightSlot}
    />,
  );
}

/** The label of the option a native select is showing. */
function selectedOption(html: string): string {
  const picker = html.slice(html.indexOf('class="cddl-preset-picker"'));
  const marked = picker.indexOf("selected=");
  if (marked === -1) return "";
  const open = picker.lastIndexOf("<option", marked);
  const text = picker.slice(picker.indexOf(">", marked) + 1, picker.indexOf("</option>", marked));
  expect(open).toBeLessThan(marked);
  return text;
}

describe("CddlSchemaToolbar preset picker", () => {
  test("offers every era, and says which ones ship with the app", () => {
    const html = markup();
    for (const p of CARDANO_PRESETS) {
      expect(html).toContain(`value="${p.id}"`);
      expect(html).toContain(p.bundled ? `${p.label} (bundled)` : `>${p.label}<`);
    }
  });

  test("names the commit the schemas are pinned to", () => {
    expect(markup()).toContain(`pinned to ${LEDGER_REV_SHORT}`);
  });

  test("with no preset loaded the picker reads as an action", () => {
    expect(selectedOption(markup())).toBe("load preset…");
  });

  test("a loaded preset stays selected instead of snapping back", () => {
    // Only place that says which schema is in the editor.
    const html = markup({ activePreset: { id: "conway", label: "Conway", edited: false } });
    expect(selectedOption(html)).toBe("Conway (bundled)");
  });

  test("an edited preset is named as edited, not silently still selected", () => {
    const html = markup({ activePreset: { id: "conway", label: "Conway", edited: true } });
    expect(selectedOption(html)).toBe("Conway (edited)");
  });

  test("a load in flight names the era being fetched and locks the picker", () => {
    const html = markup({
      presetLoading: "mary",
      activePreset: { id: "conway", label: "Conway", edited: false },
    });
    expect(selectedOption(html)).toBe("loading mary…");
    const picker = html.slice(html.indexOf('class="cddl-preset-picker"'));
    expect(picker.slice(0, picker.indexOf("</select>"))).toContain("disabled");
  });
});

describe("CddlSchemaToolbar right slot", () => {
  test("carries the offer of another root in its compact form, after the buttons", () => {
    const html = markup({
      rightSlot: (
        <RootSuggestionNote
          suggestions={{ matches: ["Persons"], checked: 1, total: 1, pending: false, checkTheRest: () => {} }}
          onRulePick={() => {}}
          compact
        />
      ),
    });
    expect(html).toContain('class="cddl-root-suggestion cddl-root-suggestion-compact"');
    expect(html).toContain(">Validate against Persons</button>");
    expect(html.indexOf('class="cq-flex-grow"')).toBeLessThan(html.indexOf("cddl-root-suggestion-compact"));
    expect(html.indexOf('class="cddl-preset-picker"')).toBeLessThan(html.indexOf("cddl-root-suggestion-compact"));
  });

  test("nothing of the slot without an offer", () => {
    expect(markup()).not.toContain("cq-flex-grow");
  });
});

describe("CddlSchemaToolbar with no root to offer", () => {
  const NOTE = "This schema declares no rule that can be a validation root";

  test("a schema that parses and declares only group or generic rules says so", () => {
    const html = markup({ ruleNames: [], schemaIsValid: true });
    expect(html).toContain('<span class="cddl-toolbar-note" role="status">' + NOTE);
    expect(html).toContain("without generic parameters.</span>");
    // Fallback input carries the same reason, not that nothing parsed.
    expect(html).toContain('placeholder="no root rule"');
    expect(html).not.toContain("No rules parsed out of this schema yet");
  });

  test("a schema that has not parsed keeps the wording that is true for it", () => {
    const html = markup({ ruleNames: [], schemaIsValid: false });
    expect(html).not.toContain(NOTE);
    expect(html).toContain('placeholder="root rule"');
    expect(html).toContain("No rules parsed out of this schema yet");
  });

  test("a schema with a root says nothing of it", () => {
    expect(markup({ schemaIsValid: true })).not.toContain("cddl-toolbar-note");
  });
});
