import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import InstanceNav from "./InstanceNav";

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

function markup(props: Partial<Parameters<typeof InstanceNav>[0]> = {}) {
  return renderToStaticMarkup(
    <InstanceNav
      index={0}
      total={1}
      panel="hex"
      onStep={() => {}}
      onReveal={() => {}}
      {...props}
    />,
  );
}

describe("InstanceNav", () => {
  test("renders nothing without a pin", () => {
    expect(markup({ total: 0 })).toBe("");
  });

  test("a construct of one instance has no chip: nothing to step through", () => {
    expect(markup({ index: 0, total: 1 })).toBe("");
  });

  test("a position in a group enables the arrows and names the keys", () => {
    const html = markup({ index: 2, total: 7 });
    expect(html).toContain(">3/7</button>");
    expect(count(html, "disabled")).toBe(0);
    expect(html).toContain('aria-label="Previous instance (Alt+,)"');
    expect(html).toContain('aria-label="Next instance (Alt+.)"');
  });

  test("the chip is never disabled", () => {
    const html = markup({ index: 0, total: 2 });
    const chip = html.slice(html.indexOf('class="cq-inst-nav-count"'));
    expect(chip.slice(0, chip.indexOf(">"))).not.toContain("disabled");
  });

  test("a current instance with no bytes says so", () => {
    expect(markup({ index: 1, total: 3, panel: "tree", byteless: true }))
      .toContain("instance 2 of 3 has no bytes in the CBOR");
  });

  test("a tree panel's chip names the panel it steps in", () => {
    expect(markup({ index: 0, total: 2, panel: "tree" })).toContain("steps in CBOR tree");
    expect(markup({ index: 0, total: 2, panel: "decoded" })).toContain("steps in Decoded JSON");
  });

  test("the editor's chip explains the one span", () => {
    expect(markup({ index: 0, total: 2, panel: "cddl" })).toContain("all instances share this schema construct");
  });
});
