import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import TabNavigation, { TABS, VISIBLE_TABS, isValidHash } from "./TabNavigation";
import { WelcomeFeatures } from "./WelcomeModal";
import { InvalidHashError } from "./UnifiedContent";
import { parseHash } from "@/utils/shareLink";

const navMarkup = () =>
  renderToStaticMarkup(<TabNavigation activeTab="general-cbor" onTabChange={() => {}} />);

describe("tab list", () => {
  test("every tab is a hash the router accepts", () => {
    for (const tab of TABS) {
      expect(isValidHash(tab.id)).toBe(true);
      // Share links append their payload to the tab hash.
      expect(isValidHash(`${tab.id}?v=1`)).toBe(true);
    }
  });

  test("visible tabs are the tabs marked visible, in list order", () => {
    expect(VISIBLE_TABS.map((t) => t.id)).toEqual(
      TABS.filter((t) => t.visible).map((t) => t.id),
    );
  });

  test("every tab carries the copy the welcome card needs", () => {
    for (const tab of TABS) {
      expect(tab.name.length).toBeGreaterThan(0);
      expect(tab.description.length).toBeGreaterThan(0);
      expect(tab.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("the CDDL validator is offered in the tab bar", () => {
    const cddl = TABS.find((t) => t.id === "cddl-validator");
    expect(cddl).toBeDefined();
    expect(cddl!.visible).toBe(true);
    expect(VISIBLE_TABS.some((t) => t.id === "cddl-validator")).toBe(true);
    expect(isValidHash("cddl-validator")).toBe(true);
  });

  test("the JSON viewer is a hash route but not a tab", () => {
    expect(isValidHash("json-viewer")).toBe(true);
    expect(TABS.some((t) => (t.id as string) === "json-viewer")).toBe(false);
  });

  test("an unknown hash is rejected", () => {
    expect(isValidHash("nope")).toBe(false);
  });

  test("share links can be built for every tab", () => {
    // The share-link parser keeps its own list of tabs; a tab missing from it
    // would take its links to the invalid-hash page.
    for (const tab of TABS) {
      expect(parseHash(`#${tab.id}?v=1&e=b&d=x`).tab).toBe(tab.id);
    }
  });
});

describe("the three surfaces render the same tab list", () => {
  test("the nav offers exactly the visible tabs", () => {
    const html = navMarkup();
    for (const tab of TABS) {
      const shown = html.includes(`href="#${tab.id}"`) && html.includes(`>${tab.name}<`);
      expect(shown).toBe(tab.visible);
    }
  });

  test("the invalid-hash fallback offers exactly the visible tabs", () => {
    const html = renderToStaticMarkup(<InvalidHashError invalidHash="nope" />);
    expect(html).toContain("nope");
    for (const tab of TABS) {
      expect(html.includes(`Go to ${tab.name}`)).toBe(tab.visible);
    }
  });

  test("the welcome modal shows a card for exactly the visible tabs", () => {
    const html = renderToStaticMarkup(<WelcomeFeatures />);
    for (const tab of TABS) {
      expect(html.includes(`>${tab.name}<`)).toBe(tab.visible);
      expect(html.includes(tab.accent)).toBe(tab.visible);
    }
  });
});
