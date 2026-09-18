// JSON values through the flat walker: arrays and objects are containers,
// and an object's children are whatever the map adapter says they are.

import type { FlatChild, FlatTreeAdapter } from "../flatTree/flatten";
import type { MapEntry } from "./mapEntries";
import type { PathScheme } from "./paths";

export function jsonAdapter(
  scheme: PathScheme,
  mapEntries: (value: unknown) => MapEntry[],
): FlatTreeAdapter<unknown> {
  return {
    childrenOf(node) {
      if (Array.isArray(node)) {
        return node.map((v, i) => ({ key: i, node: v, isArrayItem: true }));
      }
      if (node !== null && typeof node === "object") {
        return mapEntries(node).map((e) => ({ key: e.key, node: e.value, isArrayItem: false }));
      }
      return [];
    },
    isContainer: (node) => node !== null && typeof node === "object",
    childPath: (parent, child: FlatChild<unknown>) =>
      scheme.joinKey(parent, child.key, { isArrayItem: child.isArrayItem }),
    stepOf: (child) => scheme.segmentOf(child.key),
  };
}
