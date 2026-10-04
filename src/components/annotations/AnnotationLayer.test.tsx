import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnotationCard, statusTag, type AnnotationCardProps } from "./AnnotationLayer";
import {
  anchorOf,
  CARD_CLEARANCE,
  clampOffset,
  dragKey,
  intersectBoxes,
  NO_OFFSET,
  offsetFor,
  overlapArea,
  placeCard,
  TALL_TARGET,
  type Box,
  type CardPlacement,
} from "./cardPlacement";
import { createAnnotationStore, type TabAnnotations } from "@/utils/annotations/store";
import { scrimVisible } from "@/utils/annotations/scrim";

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
      spotlight={true}
      onToggleList={noop}
      onToggleSpotlight={noop}
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

  test("the navigator toggles the spotlight, pressed while it is on", () => {
    const on = card();
    expect(on).toMatch(/<button[^>]*class="cq-ann-nav-btn cq-ann-nav-spot"[^>]*aria-pressed="true"[^>]*aria-label="Spotlight"/);
    expect(on).toContain('title="Spotlight: on"');
    const off = card({ spotlight: false });
    expect(off).toMatch(/aria-pressed="false"[^>]*aria-label="Spotlight"/);
    expect(off).toContain('title="Spotlight: off"');
  });

  test("the toggle is there with a single annotation too", () => {
    const single = card({ state: { ...STATE, annotations: STATE.annotations.slice(0, 1), statuses: STATE.statuses.slice(0, 1) } });
    expect(single).toContain("cq-ann-nav-spot");
    expect(single).not.toContain("cq-ann-nav-list");
  });
});

type Props = { className?: string; onClick?: () => void; children?: ReactNode };

/** Elements of an unrendered tree with class `className`. */
function findByClass(node: ReactNode, className: string): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((n) => findByClass(n, className));
  if (!isValidElement<Props>(node)) return [];
  const own = node.props.className?.split(" ").includes(className) ? [node] : [];
  return [...own, ...findByClass(node.props.children, className)];
}

describe("closing", () => {
  test("only the ✕ in the head closes; there is no Dismiss all", () => {
    const html = card({ listOpen: true });
    expect(html).not.toContain("Dismiss all");
    expect(html).not.toContain("cq-ann-nav-dismiss");
    expect(html).toMatch(/class="cq-ann-card-close"[^>]*title="Close annotations \(Esc\)"[^>]*aria-label="Close annotations \(Esc\)"/);
  });

  test("✕ clears the tab's annotations, so the card, highlights and scrim go", () => {
    const store = createAnnotationStore();
    store.apply("transaction-validator", STATE.annotations);
    const tree = AnnotationCard({
      state: store.get("transaction-validator")!,
      docked: false,
      offscreen: false,
      listOpen: false,
      spotlight: true,
      onToggleList: noop,
      onToggleSpotlight: noop,
      onStep: noop,
      onFocus: noop,
      onDismiss: () => store.dismiss("transaction-validator"),
      onReveal: noop,
    });
    const close = findByClass(tree, "cq-ann-card-close");
    expect(close.length).toBe(1);
    close[0].props.onClick!();
    expect(store.get("transaction-validator")).toBeNull();
    expect(scrimVisible({ active: false, enabled: true, resolved: true, holes: [] })).toBe(false);
  });

  test("the head is the drag handle", () => {
    const html = card();
    expect(html).toMatch(/class="cq-ann-card-head"[^>]*title="Drag to move"/);
    expect(html).toContain("cq-ann-grip");
    expect(card({ dragging: true })).toContain("cq-ann-card-dragging");
  });
});

describe("drag offset", () => {
  const viewport = { width: 1200, height: 800 };
  const size = { width: 340, height: 160 };

  test("applies only to the placement it was made against", () => {
    const drag = { key: dragKey(3, "below"), offset: { x: 40, y: -20 } };
    // every side of the target is the same anchored placement
    expect(offsetFor(drag, dragKey(3, "above"))).toEqual({ x: 40, y: -20 });
    expect(offsetFor(drag, dragKey(3, "left"))).toEqual({ x: 40, y: -20 });
    expect(offsetFor(drag, dragKey(3, "over"))).toEqual({ x: 40, y: -20 });
    // previous, next or a pick from the list is a new focus request
    expect(offsetFor(drag, dragKey(4, "below"))).toBe(NO_OFFSET);
    // docking or undocking
    expect(offsetFor(drag, dragKey(3, "docked"))).toBe(NO_OFFSET);
    expect(offsetFor(null, dragKey(3, "below"))).toBe(NO_OFFSET);
  });

  test("keeps the moved card inside the viewport", () => {
    const at = { top: 100, left: 400 };
    expect(clampOffset(at, { x: 50, y: 30 }, size, viewport)).toEqual({ x: 50, y: 30 });
    expect(clampOffset(at, { x: 5000, y: 5000 }, size, viewport)).toEqual({ x: 1200 - 340 - 8 - 400, y: 800 - 160 - 8 - 100 });
    expect(clampOffset(at, { x: -5000, y: -5000 }, size, viewport)).toEqual({ x: 8 - 400, y: 8 - 100 });
  });

  test("the card may stay where it was placed, inside the margin", () => {
    const edge = { top: 2, left: 3 };
    expect(clampOffset(edge, NO_OFFSET, size, viewport)).toEqual({ x: 0, y: 0 });
    expect(clampOffset(edge, { x: -10, y: -10 }, size, viewport)).toEqual({ x: 0, y: 0 });
  });
});

describe("placeCard", () => {
  const viewport = { width: 1200, height: 800 };
  const size = { width: 340, height: 160 };
  const dock = { top: 50, left: 0, bottom: 800, right: 1200 };
  const screen = { top: 0, left: 0, bottom: 800, right: 1200 };

  function cardAt(p: CardPlacement): Box {
    return { top: p.top, left: p.left, bottom: p.top + size.height, right: p.left + size.width };
  }

  function padded(b: Box): Box {
    return { top: b.top - CARD_CLEARANCE, left: b.left - CARD_CLEARANCE, bottom: b.bottom + CARD_CLEARANCE, right: b.right + CARD_CLEARANCE };
  }

  /** Inside the viewport's margin and clear of the target. */
  function expectBeside(p: CardPlacement, target: Box) {
    const box = cardAt(p);
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(1200 - 8);
    expect(box.bottom).toBeLessThanOrEqual(800 - 8);
    expect(overlapArea(box, padded(intersectBoxes(target, screen)))).toBe(0);
  }

  test("below a row in the middle, lined up with its start", () => {
    const row = { top: 390, left: 300, bottom: 410, right: 900 };
    const p = placeCard(row, screen, dock, size, viewport);
    expect(p).toEqual({ mode: "below", align: "start", top: 420, left: 300 });
    expectBeside(p, row);
  });

  test("above a target at the bottom of the viewport", () => {
    const row = { top: 740, left: 100, bottom: 770, right: 700 };
    const p = placeCard(row, screen, dock, size, viewport);
    expect(p.mode).toBe("above");
    expect(p.top).toBe(740 - 10 - 160);
    expectBeside(p, row);
  });

  test("a card at the right edge: kept inside the viewport above it, or left of a tall one", () => {
    const low = { top: 560, left: 880, bottom: 780, right: 1190 };
    const above = placeCard(low, screen, dock, size, viewport);
    expect(above.mode).toBe("above");
    expect(above.left).toBe(1200 - 340 - 8);
    expectBeside(above, low);
    const tall = { top: 60, left: 880, bottom: 780, right: 1190 };
    const left = placeCard(tall, screen, dock, size, viewport);
    expect(left).toEqual({ mode: "left", align: "start", top: 60, left: 880 - 10 - 340 });
    expectBeside(left, tall);
  });

  test("right or left of a tall narrow target, on the side with more room", () => {
    const column = { top: 100, left: 200, bottom: 700, right: 260 };
    const right = placeCard(column, screen, dock, size, viewport);
    expect(right.mode).toBe("right");
    expect(right.left).toBe(270);
    expectBeside(right, column);
    const onRight = { top: 100, left: 900, bottom: 700, right: 960 };
    const left = placeCard(onRight, screen, dock, size, viewport);
    expect(left.mode).toBe("left");
    expectBeside(left, onRight);
    // A short token is not a column: the card goes below it.
    const token = { top: 100, left: 20, bottom: 100 + TALL_TARGET, right: 40 };
    expect(placeCard(token, screen, dock, size, viewport).mode).toBe("below");
  });

  test("uses the card's measured size", () => {
    const row = { top: 300, left: 300, bottom: 320, right: 900 };
    // A long hint does not fit below or above; the card goes beside the row.
    const p = placeCard(row, screen, dock, { width: 280, height: 480 }, viewport);
    expect(p.mode).toBe("right");
    expect(p.left).toBe(910);
  });

  test("over a target larger than any free side, covering as little of it as it can", () => {
    const wide = { top: 0, left: 0, bottom: 800, right: 1000 };
    const p = placeCard(wide, screen, dock, size, viewport);
    expect(p.mode).toBe("over");
    expect(p.left).toBe(1200 - 340 - 8);
    expect(overlapArea(cardAt(p), padded(wide))).toBe((1008 - 852) * 160);
    const huge = { top: -400, left: -400, bottom: 2000, right: 2000 };
    const q = placeCard(huge, screen, dock, size, viewport);
    expect(q.mode).toBe("over");
    expect(cardAt(q).right).toBeLessThanOrEqual(1192);
    expect(cardAt(q).bottom).toBeLessThanOrEqual(792);
    expect(q.top).toBeGreaterThanOrEqual(8);
    expect(q.left).toBeGreaterThanOrEqual(8);
  });

  test("keeps its side while it still fits, then moves", () => {
    const row = { top: 300, left: 300, bottom: 320, right: 900 };
    expect(placeCard(row, screen, dock, size, viewport).mode).toBe("below");
    const above = placeCard(row, screen, dock, size, viewport, { keep: { mode: "above", align: "start" } });
    expect(above).toEqual({ mode: "above", align: "start", top: 300 - 10 - 160, left: 300 });
    // Scrolled up: no room above any more.
    const scrolled = { top: 120, left: 300, bottom: 140, right: 900 };
    const moved = placeCard(scrolled, screen, dock, size, viewport, { keep: anchorOf(above) });
    expect(moved.mode).toBe("below");
    expectBeside(moved, scrolled);
    // And it stays below on the way back down, though above has more room there.
    const back = { top: 600, left: 300, bottom: 620, right: 900 };
    expect(placeCard(back, screen, dock, size, viewport).mode).toBe("above");
    expect(placeCard(back, screen, dock, size, viewport, { keep: anchorOf(moved) }).mode).toBe("below");
  });

  test("avoids the target's other parts when it can", () => {
    const row = { top: 390, left: 300, bottom: 410, right: 900 };
    const other = { top: 430, left: 300, bottom: 470, right: 700 };
    const p = placeCard(row, screen, dock, size, viewport, { parts: [row, other] });
    expect(p.mode).toBe("above");
    expectBeside(p, row);
    expect(overlapArea(cardAt(p), padded(other))).toBe(0);
    // A kept side that would cover a part gives way.
    const kept = placeCard(row, screen, dock, size, viewport, { parts: [row, other], keep: { mode: "below", align: "start" } });
    expect(overlapArea(cardAt(kept), padded(other))).toBe(0);
  });

  test("only the part its scroll containers show counts", () => {
    const clip = { top: 50, left: 600, bottom: 800, right: 1200 };
    const p = placeCard({ top: 100, left: 300, bottom: 120, right: 900 }, clip, dock, size, viewport);
    expect(p).toEqual({ mode: "below", align: "start", top: 130, left: 600 });
  });

  test("docked at the top of the tab when the target is scrolled away or missing", () => {
    const away = placeCard({ top: 900, left: 640, bottom: 920, right: 900 }, screen, dock, size, viewport);
    expect(away.mode).toBe("docked");
    expect(away.top).toBe(58);
    expect(placeCard(null, null, dock, size, viewport).mode).toBe("docked");
    expect(anchorOf(away)).toBeNull();
  });
});
