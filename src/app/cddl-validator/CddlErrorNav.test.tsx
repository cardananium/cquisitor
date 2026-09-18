import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import CddlErrorNav, { errorNavLabel, type CddlErrorEntry } from "./CddlErrorNav";

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

function entry(over: Partial<CddlErrorEntry> = {}): CddlErrorEntry {
  return { range: [0, 4], message: "type mismatch", errorIndex: 0, ...over };
}

function markup(errors: CddlErrorEntry[], unlisted = 0, current: number | null = null) {
  return renderToStaticMarkup(
    <CddlErrorNav errors={errors} unlisted={unlisted} current={current} onJump={() => {}} />,
  );
}

describe("CddlErrorNav", () => {
  test("renders nothing without errors", () => {
    expect(markup([])).toBe("");
  });

  test("a single mismatch is still reachable — the count chip is a button", () => {
    const html = markup([entry()]);
    expect(html).toContain('<button type="button" class="cq-err-nav-count"');
    expect(html).toContain(">1/1</button>");
    expect(count(html, "disabled")).toBe(2);
  });

  test("the chip carries no noun of its own — the verdict beside it names the list", () => {
    const html = markup([entry(), entry()]);
    expect(html).not.toContain("error");
    expect(html).not.toContain("mismatches");
    expect(html).toContain('aria-label="Show mismatch 1 of 2"');
    expect(html).toContain('title="Previous mismatch"');
    expect(html).toContain('title="Next mismatch"');
  });

  test("the chip is never disabled, even when the arrows are", () => {
    const html = markup([entry()]);
    const chip = html.slice(html.indexOf('class="cq-err-nav-count"'));
    expect(chip.slice(0, chip.indexOf(">"))).not.toContain("disabled");
  });

  test("several mismatches enable the arrows and show the position", () => {
    const html = markup([entry(), entry(), entry()]);
    expect(html).toContain(">1/3</button>");
    expect(count(html, "disabled")).toBe(0);
  });

  test("the chip says what the error is, since it is what the pointer lands on", () => {
    const html = markup([entry({ message: "mismatch at $.age (expected uint) — found tstr" })]);
    const chip = html.slice(html.indexOf('class="cq-err-nav-count"'));
    expect(chip.slice(0, chip.indexOf(">"))).toContain('title="mismatch at $.age (expected uint) — found tstr"');
  });

  test("problems that cannot be stepped to are still counted", () => {
    // Panel caps what it renders and the validator caps what it describes; 3/3 would report the run as complete.
    const html = markup([entry(), entry(), entry()], 397);
    expect(html).toContain(">1/3 of 400</button>");
  });

  test("a run with nothing left out counts only what it lists", () => {
    const html = markup([entry(), entry(), entry()]);
    expect(html).toContain(">1/3</button>");
  });

  test("the chip follows a selection made elsewhere", () => {
    const errors = [0, 1, 2, 3, 4].map(i => entry({ errorIndex: i, message: `mismatch ${i}` }));
    const html = markup(errors, 0, 2);
    expect(html).toContain(">3/5</button>");
    expect(html).toContain('title="mismatch 2"');
    expect(markup(errors)).toContain(">1/5</button>");
  });

  test("a selection past the end of a list that shrank is clamped", () => {
    expect(markup([entry(), entry()], 0, 7)).toContain(">2/2</button>");
  });
});

describe("errorNavLabel", () => {
  test("a list that is everything reads as a position in it", () => {
    expect(errorNavLabel(0, 1, 0)).toEqual({ text: "1/1", ariaLabel: "Show mismatch 1 of 1" });
    expect(errorNavLabel(2, 5, 0)).toEqual({ text: "3/5", ariaLabel: "Show mismatch 3 of 5" });
  });

  test("a list that is not everything says what the run found", () => {
    expect(errorNavLabel(0, 101, 299)).toEqual({
      text: "1/101 of 400",
      ariaLabel: "Show mismatch 1 of 101 listed; 400 found in this run",
    });
  });

  test("one listed mismatch and more behind it still counts them all", () => {
    expect(errorNavLabel(0, 1, 5).text).toBe("1/1 of 6");
  });

  test("a negative or zero remainder is no remainder", () => {
    expect(errorNavLabel(0, 3, 0).text).toBe("1/3");
    expect(errorNavLabel(0, 3, -4).text).toBe("1/3");
  });
});
