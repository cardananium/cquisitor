import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TxPathMarksProvider, spotlightUnitClass, useTxPathMark, useTxPathSpotlight } from "./TxPathMarks";
import type { AnnotationMark } from "@/utils/annotations/marks";

const MARKS: ReadonlyMap<string, AnnotationMark> = new Map([
  ["transaction.body.outputs.0", { severity: "error", indices: [0], focused: true }],
]);

describe("spotlightUnitClass", () => {
  const targets = ["transaction.body.outputs.0"];

  test("every unit is weighed; one inside a target or holding one says so", () => {
    expect(spotlightUnitClass("transaction.body.outputs.0", targets, true)).toBe("cq-dim-unit");
    expect(spotlightUnitClass("transaction.body.outputs.0.amount", targets, true)).toBe("cq-dim-unit cq-ann-in");
    expect(spotlightUnitClass("transaction.body.outputs", targets, true)).toBe("cq-dim-unit cq-ann-holder");
    expect(spotlightUnitClass("transaction.body", targets, true)).toBe("cq-dim-unit cq-ann-holder");
    expect(spotlightUnitClass("transaction.body.outputs.1", targets, true)).toBe("cq-dim-unit");
    expect(spotlightUnitClass(undefined, targets, true)).toBe("cq-dim-unit");
  });

  test("nothing while the spotlight is off", () => {
    expect(spotlightUnitClass("transaction.body.outputs", targets, false)).toBe("");
  });
});

function Probe({ path }: { path?: string }) {
  const mark = useTxPathMark(path);
  const spotlight = useTxPathSpotlight();
  return (
    <div className={mark.className} {...mark.attrs} data-part={mark.partClassName} data-spotlight={String(spotlight)} />
  );
}

const render = (path: string | undefined, spotlight: boolean, marks = MARKS) =>
  renderToStaticMarkup(
    <TxPathMarksProvider marks={marks} spotlight={spotlight}>
      <Probe path={path} />
    </TxPathMarksProvider>,
  );

describe("useTxPathMark under the spotlight", () => {
  test("a target keeps its mark and is a unit", () => {
    expect(render("transaction.body.outputs.0", true)).toContain(
      'class="cq-ann cq-ann-error cq-ann-focused cq-ann-at-0 cq-dim-unit" data-tx-path="transaction.body.outputs.0"',
    );
  });

  test("a section holding the target is a holder; its header is a unit of its own", () => {
    const html = render("transaction.body.outputs", true);
    expect(html).toContain('class="cq-dim-unit cq-ann-holder"');
    expect(html).toContain('data-part="cq-dim-unit"');
    expect(html).toContain('data-spotlight="true"');
  });

  test("off, or with no marks, the classes are what they were", () => {
    expect(render("transaction.body.outputs", false)).toContain('class="" data-tx-path="transaction.body.outputs" data-part="" data-spotlight="false"');
    expect(render("transaction.body.outputs.0", false)).toContain('class="cq-ann cq-ann-error cq-ann-focused cq-ann-at-0"');
    expect(render("transaction.body.outputs", true, new Map())).toContain('data-spotlight="false"');
  });
});
