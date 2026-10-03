import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnotationCard, statusTag, type AnnotationCardProps } from "./AnnotationLayer";
import { placeCard, TALL_TARGET } from "./cardPlacement";
import type { TabAnnotations } from "@/utils/annotations/store";

const STATE: TabAnnotations = {
  annotations: [
    { target: { kind: "tx_path", path: "transaction.body.outputs.0" }, label: "Change output", hint: "Too little ada.\nAdd 1 ADA.", severity: "error" },
    { target: { kind: "diagnostic", name: "FeeTooSmall" }, hint: "Raise the fee." },
    { target: { kind: "redeemer", tag: "Spend", index: 0 }, severity: "warning" },
  ],
  focus: 0,
  focusSeq: 1,
  statuses: [
    { state: "resolved" },
    { state: "waiting", note: "Waiting for validation." },
    { state: "not_found", note: "No Plutus result for Spend[0]." },
  ],
  inputKey: null,
  inputSeen: false,
};

const noop = () => {};

function card(over: Partial<AnnotationCardProps> = {}) {
  return renderToStaticMarkup(
    <AnnotationCard
      state={STATE}
      docked={false}
      offscreen={false}
      listOpen={false}
      dim={true}
      onToggleList={noop}
      onToggleDim={noop}
      onStep={noop}
      onFocus={noop}
      onDismiss={noop}
      onReveal={noop}
      {...over}
    />,
  );
}

describe("statusTag", () => {
  test("names each unresolved state; a resolved one has none", () => {
    expect(statusTag({ state: "resolved" })).toBeNull();
    expect(statusTag({ state: "not_found" })).toBe("not found here");
    expect(statusTag({ state: "unsupported" })).toBe("not shown on this tab");
    expect(statusTag({ state: "waiting" })).toBe("waiting");
    expect(statusTag(undefined)).toBe("waiting");
  });
});

describe("AnnotationCard", () => {
  test("severity, label, the hint as written, and the navigator", () => {
    const html = card();
    expect(html).toContain("cq-ann-card-error");
    expect(html).toContain(">Error<");
    expect(html).toContain("Change output");
    expect(html).toContain("Too little ada.\nAdd 1 ADA.");
    expect(html).toContain("1 / 3");
    expect(html).toContain("Dismiss all");
    expect(html).not.toContain("cq-ann-card-status");
  });

  test("an unresolved target says why, with its own hint", () => {
    const html = card({ state: { ...STATE, focus: 1 }, docked: true });
    expect(html).toContain("cq-ann-card-docked");
    expect(html).toContain("Waiting</strong> — Waiting for validation.");
    expect(html).toContain("Raise the fee.");
    // No label: the target describes itself; no severity means info.
    expect(html).toContain("Diagnostic FeeTooSmall");
    expect(html).toContain(">Info<");
  });

  test("the list shows every annotation with its status", () => {
    const html = card({ listOpen: true });
    expect(html.match(/cq-ann-list-item/g)?.length).toBe(3);
    expect(html).toContain("not found here");
    expect(html).toContain("cq-ann-list-item current");
  });

  test("a scrolled-away target offers to scroll back", () => {
    expect(card({ offscreen: true })).toContain("Scroll to the target");
  });

  test("the navigator toggles dimming the rest, pressed while it is on", () => {
    const on = card();
    expect(on).toMatch(/<button[^>]*class="cq-ann-nav-btn cq-ann-nav-dim"[^>]*aria-pressed="true"[^>]*aria-label="Dim the rest"/);
    expect(on).toContain('title="Dim the rest: on"');
    const off = card({ dim: false });
    expect(off).toMatch(/aria-pressed="false"[^>]*aria-label="Dim the rest"/);
    expect(off).toContain('title="Dim the rest: off"');
  });

  test("the toggle is there with a single annotation too", () => {
    const single = card({ state: { ...STATE, annotations: STATE.annotations.slice(0, 1), statuses: STATE.statuses.slice(0, 1) } });
    expect(single).toContain("cq-ann-nav-dim");
    expect(single).not.toContain("cq-ann-nav-list");
  });
});

describe("placeCard", () => {
  const viewport = { width: 1200, height: 800 };
  const size = { width: 340, height: 160 };
  const dock = { top: 50, left: 0, bottom: 800, right: 1200 };
  const clip = { top: 50, left: 600, bottom: 800, right: 1200 };

  test("below the target when there is room", () => {
    const p = placeCard({ top: 100, left: 640, bottom: 120, right: 900 }, clip, dock, size, viewport);
    expect(p).toEqual({ mode: "below", top: 126, left: 640 });
  });

  test("above it near the bottom of its panel", () => {
    const p = placeCard({ top: 700, left: 640, bottom: 720, right: 900 }, clip, dock, size, viewport);
    expect(p.mode).toBe("above");
    expect(p.top).toBe(700 - 6 - 160);
  });

  test("kept inside the viewport horizontally", () => {
    const p = placeCard({ top: 100, left: 1100, bottom: 120, right: 1190 }, clip, dock, size, viewport);
    expect(p.left).toBe(1200 - 340 - 8);
  });

  test("in the top corner of a tall target", () => {
    const p = placeCard({ top: 100, left: 640, bottom: 100 + TALL_TARGET + 50, right: 1100 }, clip, dock, size, viewport);
    expect(p).toEqual({ mode: "inside", top: 106, left: 1100 - 340 - 8 });
  });

  test("docked at the top of the tab when the target is scrolled away or missing", () => {
    const away = placeCard({ top: 900, left: 640, bottom: 920, right: 900 }, clip, dock, size, viewport);
    expect(away.mode).toBe("docked");
    expect(away.top).toBe(58);
    expect(placeCard(null, null, dock, size, viewport).mode).toBe("docked");
  });
});
