import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cbor_to_json, type CborDecodeResult, type CborValue } from "@cardananium/cquisitor-lib";
import { parseSerdeJson } from "@/utils/serdeNumbers";
import CborTreeView, { findPathToPosition, hoverPositionOf, rowSpanAttr, spanAttr } from "./CborTreeView";

// {"name": "Alice", "age": "20"} — map header is 1 byte, whole extent is 19, so the root's two spans differ.
const MAP_HEX = "a2646e616d6565416c69636563616765623230";

function decode(hex: string): CborValue {
  const r = parseSerdeJson<CborDecodeResult>(cbor_to_json(hex));
  if (!r.ok) throw new Error(`fixture did not decode: ${r.error.message}`);
  return r.value;
}

describe("findPathToPosition", () => {
  const root = decode(MAP_HEX);

  test("finds a container by its header span", () => {
    expect(root.position_info).toEqual({ offset: 0, length: 1 });
    expect(findPathToPosition(root, root.position_info!)).toEqual([]);
  });

  test("finds a container by its whole-structure span", () => {
    const struct = root.struct_position_info!;
    expect(struct).toEqual({ offset: 0, length: 19 });
    expect(struct).not.toEqual(root.position_info!);
    expect(findPathToPosition(root, struct)).toEqual([]);
  });

  test("finds nested keys and values", () => {
    const entries = (root as { values: Array<{ key: CborValue; value: CborValue }> }).values;
    expect(findPathToPosition(root, entries[0].key.position_info!)).toEqual(["map[0].key"]);
    expect(findPathToPosition(root, entries[1].value.position_info!)).toEqual(["map[1].value"]);
  });

  test("returns null for a span that belongs to no node", () => {
    expect(findPathToPosition(root, { offset: 3, length: 7 })).toBeNull();
  });
});

describe("what a row carries and reports for the hover link", () => {
  const root = decode(MAP_HEX);
  const entries = (root as { values: Array<{ key: CborValue; value: CborValue }> }).values;

  test("data-span names the header bytes, offset:length, and a container's extent after them", () => {
    expect(spanAttr({ offset: 12, length: 4 })).toBe("12:4");
    expect(rowSpanAttr(root)).toBe("0:1 0:19");
    expect(rowSpanAttr(entries[1].value)).toBe(spanAttr(entries[1].value.position_info!));
    expect(rowSpanAttr(root)!.split(" ")).toContain(spanAttr(hoverPositionOf(root)!));
  });

  test("a container reports its whole extent, a leaf its bytes, a missing half nothing", () => {
    expect(hoverPositionOf(root)).toEqual({ offset: 0, length: 19 });
    expect(hoverPositionOf(entries[0].key)).toEqual(entries[0].key.position_info!);
    expect(hoverPositionOf({ missing: "value" })).toBeNull();
    expect(rowSpanAttr({ missing: "key" })).toBeUndefined();
  });

  test("the reported extent starts where the header does, so both name the same node", () => {
    // Hover and pin both resolve a row by its first byte.
    expect(hoverPositionOf(root)!.offset).toBe(root.position_info!.offset);
  });

  test("the rendered rows carry data-span, the map's and its keys' and values'", () => {
    const html = renderToStaticMarkup(
      createElement(CborTreeView, {
        data: root,
        hexValue: MAP_HEX,
        onHoverPosition: () => {},
        onHighlightAndScroll: () => {},
      }),
    );
    expect(html).toContain('data-span="0:1 0:19"');
    for (const entry of entries) {
      expect(html).toContain(`data-span="${spanAttr(entry.key.position_info!)}"`);
      expect(html).toContain(`data-span="${spanAttr(entry.value.position_info!)}"`);
    }
    expect(html.split("data-span=").length - 1).toBe(1 + entries.length * 2);
  });
});

describe("a pinned row", () => {
  const root = decode(MAP_HEX);
  const entries = (root as { values: Array<{ key: CborValue; value: CborValue }> }).values;
  const render = (props: Partial<Parameters<typeof CborTreeView>[0]>) =>
    renderToStaticMarkup(
      createElement(CborTreeView, {
        data: root,
        hexValue: MAP_HEX,
        onHoverPosition: () => {},
        onHighlightAndScroll: () => {},
        ...props,
      }),
    );
  const ageValue = entries[1].value.position_info!;

  test("is opened on the way down and marked persistently, not pulsed", () => {
    const html = render({ pinnedPosition: ageValue });
    const row = html.slice(html.indexOf(`data-span="${spanAttr(ageValue)}"`) - 200);
    expect(row.slice(0, row.indexOf("data-span"))).toContain("cbor-tree-row-pinned");
    expect(html).not.toContain("cbor-tree-row-highlighted");
    expect(html).not.toContain("cbor-tree-node-highlighted");
    expect(html.split("cbor-tree-row-pinned").length - 1).toBe(1);
  });

  test("a revealed row alone still pulses, and carries no pin", () => {
    const html = render({ highlightedTreePosition: ageValue });
    expect(html).toContain("cbor-tree-row-highlighted");
    expect(html).not.toContain("cbor-tree-row-pinned");
  });

  test("the other instances are never classes of the render", () => {
    const html = render({ pinnedPosition: ageValue });
    expect(html).not.toContain("cbor-tree-row-pinned-other");
  });
});
