import { describe, expect, test } from "bun:test";
import { cbor_to_json, type CborDecodeResult, type CborValue } from "@cardananium/cquisitor-lib";
import { parseSerdeJson } from "@/utils/serdeNumbers";
import { buildHexMarkup, hoverOccludersFor, spliceText, type HexMarkupInput } from "./EditableHexView";

describe("spliceText", () => {
  test("replaces the selected run and puts the caret after what was inserted", () => {
    expect(spliceText("8105", 2, 4, "0a0b")).toEqual({ text: "810a0b", caret: 6 });
  });

  test("a caret inserts without removing anything", () => {
    expect(spliceText("8105", 2, 2, "ff")).toEqual({ text: "81ff05", caret: 4 });
  });

  test("selecting the whole document replaces it whole", () => {
    const whole = "81".repeat(10_000) + "05";
    const next = "81".repeat(10_000) + "06";
    expect(spliceText(whole, 0, whole.length, next)).toEqual({ text: next, caret: next.length });
  });

  test("offsets past the text are read as its end", () => {
    expect(spliceText("8105", 10, 20, "ff")).toEqual({ text: "8105ff", caret: 6 });
    expect(spliceText("8105", 3, 1, "ff")).toEqual({ text: "810ff5", caret: 5 });
  });
});

// {"name": "Alice", "age": 30, "nickname": "Ali"}: map header at byte 0, then nodes at 1, 6, 12, 16, 18, 27 — 31 bytes.
const PERSON_HEX = "a3646e616d6565416c696365636167651 81e686e69636b6e616d6563416c69".replace(/\s/g, "");
const NODE_STARTS = [0, 2, 12, 24, 32, 36, 54];

function decode(hex: string): CborValue {
  const r = parseSerdeJson<CborDecodeResult>(cbor_to_json(hex));
  if (!r.ok) throw new Error(`fixture did not decode: ${r.error.message}`);
  return r.value;
}

/** One rendered element: attributes, text, and children. */
interface Rendered {
  attrs: Record<string, string>;
  text: string;
  children: Rendered[];
}

/** Parse builder markup (`<span>` and text only). */
function parse(html: string): Rendered {
  const root: Rendered = { attrs: {}, text: "", children: [] };
  const stack = [root];
  const tag = /<span((?:\s+[\w-]+="[^"]*")*)\s*>|<\/span>|([^<]+)/g;
  for (const m of html.matchAll(tag)) {
    const top = stack[stack.length - 1];
    if (m[0] === "</span>") {
      stack.pop();
    } else if (m[2] !== undefined) {
      top.text += m[2];
    } else {
      const attrs: Record<string, string> = {};
      for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      const el: Rendered = { attrs, text: "", children: [] };
      top.children.push(el);
      stack.push(el);
    }
  }
  for (const el of walk(root)) el.text = el.text || el.children.map(c => c.text).join("");
  return root;
}

function* walk(el: Rendered): Generator<Rendered> {
  for (const c of el.children) yield* walk(c);
  yield el;
}

const runsOf = (el: Rendered) => el.children.filter(c => "data-pos" in c.attrs);
const posOf = (el: Rendered) => Number(el.attrs["data-pos"]);

function markup(over: Partial<HexMarkupInput> = {}) {
  return buildHexMarkup({ hexValue: PERSON_HEX, cborData: decode(PERSON_HEX), focusPosition: null, ...over });
}

describe("buildHexMarkup", () => {
  test("with nothing highlighted, one run per node, and each names its first character", () => {
    const doc = parse(markup().html);
    expect(runsOf(doc).map(posOf)).toEqual(NODE_STARTS);
    expect(doc.text).toBe(PERSON_HEX);
    for (const run of runsOf(doc)) expect(run.children).toEqual([]);
  });

  test("the places are those of the runs", () => {
    const { places } = markup();
    expect([...places.keys()]).toEqual(NODE_STARTS);
    expect(places.get(0)?.name).toBe("map");
    expect(places.get(2)?.name).toBe("tstr");
    expect(places.get(2)?.parent).toBe(places.get(0)!);
  });

  test("a pinned container is one region holding a run per node it covers", () => {
    const doc = parse(markup({ pinnedSpans: [{ offset: 0, length: 31, message: "Pinned: map at $" }] }).html);
    expect(doc.children.length).toBe(1);
    const region = doc.children[0];
    expect(region.attrs.class).toBe("hex-pinned-highlight");
    expect(region.attrs.title).toBe("Pinned: map at $");
    expect(region.attrs["data-pos"]).toBe("0");
    expect(region.attrs["data-len"]).toBe(String(PERSON_HEX.length));
    // Inner runs keep per-node `data-pos`, so a pointer on the age key names byte 12, not the region's 0.
    expect(runsOf(region).map(posOf)).toEqual(NODE_STARTS);
    expect(region.text).toBe(PERSON_HEX);
    for (const run of runsOf(region)) expect(run.attrs.style).toBeUndefined();
  });

  test("a diagnostic across several nodes does the same, and starts and ends on their bytes", () => {
    // Bytes 12..18: age key and value, plus the first byte of the next key.
    const doc = parse(markup({ extraErrorSpans: [{ offset: 12, length: 7, message: "expected tstr" }] }).html);
    const region = doc.children.find(c => c.attrs.class === "hex-error-highlight")!;
    expect(region.attrs.title).toBe("expected tstr");
    expect(region.attrs["data-pos"]).toBe("24");
    expect(region.attrs["data-len"]).toBe("14");
    expect(runsOf(region).map(posOf)).toEqual([24, 32, 36]);
    expect(runsOf(region).map(r => r.text)).toEqual(["63616765", "181e", "68"]);
    expect(runsOf(doc).map(posOf)).toEqual([0, 2, 12, 24, 38, 54]);
    expect(runsOf(doc)[4].text).toBe(PERSON_HEX.slice(38, 54));
  });

  test("a non-canonical node keeps its mark inside a region", () => {
    const plain = parse(markup().html);
    const odd = runsOf(plain).filter(r => r.attrs.class === "hex-oddity");
    expect(odd.length).toBeGreaterThan(0);
    const doc = parse(markup({ pinnedSpans: [{ offset: 0, length: 31 }] }).html);
    const inner = runsOf(doc.children[0]).filter(r => r.attrs.class === "hex-oddity");
    expect(inner.map(posOf)).toEqual(odd.map(posOf));
    expect(inner.map(r => r.attrs.title)).toEqual(odd.map(r => r.attrs.title));
  });

  test("the focus flash marks its region as the scroll target", () => {
    const doc = parse(markup({ focusPosition: { offset: 12, length: 4 } }).html);
    const region = doc.children.find(c => c.attrs.class === "hex-focus-highlight")!;
    expect(region.attrs["data-focus-target"]).toBe("true");
    expect(runsOf(region).map(posOf)).toEqual([24]);
  });

  test("regions of different kinds abut without merging, and a pin wins over a link", () => {
    const doc = parse(markup({
      linkedSpans: [{ offset: 1, length: 11 }],
      pinnedSpans: [{ offset: 6, length: 6 }],
      extraErrorSpans: [{ offset: 12, length: 4 }],
    }).html);
    expect(doc.children.map(c => `${c.attrs.class ?? ""}@${posOf(c)}`)).toEqual([
      "hex-oddity@0",
      "hex-linked-highlight@2",
      "hex-pinned-highlight@12",
      "hex-error-highlight@24",
      "@32",
      "@36",
      "@54",
    ]);
  });

  test("a region over bytes no node claims is one run", () => {
    const doc = parse(buildHexMarkup({
      hexValue: "0102", cborData: null, focusPosition: null,
      errorLocation: { offset: 0, length: 2, kind: "unexpected_eof", message: "did not decode", path: "$" },
    }).html);
    expect(doc.children.length).toBe(1);
    expect(runsOf(doc.children[0]).map(r => [posOf(r), r.text])).toEqual([[0, "0102"]]);
  });

  test("nothing to paint is no markup", () => {
    expect(buildHexMarkup({ hexValue: "", cborData: null, focusPosition: null }).html).toBe("");
    expect(buildHexMarkup({ hexValue: "0102", cborData: null, focusPosition: null }).html).toBe("");
  });
});

describe("the pin's other instances", () => {
  test("are not in the markup: a step that moves only them leaves it byte-identical", () => {
    // Current instance is a markup region; others are painted over it, so `pinnedOtherSpans` is not a builder input.
    const current = [{ offset: 2, length: 5, message: "Pinned (1/2): tstr at $[0].name" }];
    const before = markup({ pinnedSpans: current }).html;
    const others = [{ offset: 19, length: 5 }];
    const after = markup({ pinnedSpans: current, ...({ pinnedOtherSpans: others } as object) }).html;
    expect(after).toBe(before);
    expect(after).toContain("hex-pinned-highlight");
    expect(after.split("hex-pinned-highlight").length - 1).toBe(1);
  });
});

describe("hoverOccludersFor", () => {
  test("the current pin, the failing bytes and the flash cut the hover; nothing else does", () => {
    const current = [{ offset: 19, length: 5 }];
    const out = hoverOccludersFor({
      pinnedSpans: current,
      errorLocation: { offset: 30, length: 1, kind: "unexpected_eof", path: "$", message: "bad" },
      extraErrorSpans: [{ offset: 40, length: 2 }],
      focusPosition: { offset: 50, length: 1 },
      ...({ pinnedOtherSpans: [{ offset: 2, length: 5 }] } as object),
    });
    expect(out.map(o => o.offset)).toEqual([19, 30, 40, 50]);
    expect(out).not.toContainEqual({ offset: 2, length: 5 });
  });

  test("nothing set is no occluders", () => {
    expect(hoverOccludersFor({})).toEqual([]);
  });
});
