// Two path schemes are used in this app, both supported here:
//
// 1. Lib-canonical (`$.foo[0]["bar"]`) — emitted by cquisitor-lib's
//    `decoded_path` field. Numeric *map* keys come out as `["0"]` while
//    array indices use bare `[0]`. Used by the CDDL validator's decoded
//    JSON view to bridge with CBOR/CDDL panels. The grammar itself lives in
//    the library (`core/cddl/cborPath`); this file adapts it to `PathScheme`.
//
// 2. Dot-joined (`transaction.body.0`) — used by the Transaction
//    Validator's diagnostic locations. No `$` prefix; array indices and
//    string keys are dot-joined alike.

import {
  CBOR_PATH_ROOT,
  cborPathSegment,
  cborPathsEqual,
  isCborPathAncestor,
  joinCborPath,
  splitCborPath,
} from "@cardananium/cquisitor-lib";

export type JoinKey = (
  parentPath: string,
  key: string | number,
  opts: { isArrayItem: boolean },
) => string;

export type PathsEqual = (a: string, b: string) => boolean;
export type IsAncestor = (ancestor: string, descendant: string) => boolean;

/**
 * How a child's path is written and split. `splitPath`/`segmentOf` let a tree follow a highlight one segment per level instead of comparing whole path strings (O(depth²) on deep docs).
 */
export interface PathScheme {
  /** The path of the synthetic root. */
  rootPath: string;
  joinKey: JoinKey;
  /** The segments of a path, root excluded. */
  splitPath(path: string): string[];
  /** The segment `splitPath` yields for `joinKey(parent, key)`. */
  segmentOf(key: string | number): string;
}

// ---------- Lib-canonical scheme ----------

export const libJoinKey: JoinKey = (parentPath, key) => joinCborPath(parentPath, key);

export const libSplitPath = splitCborPath;

export const libPathsEqual: PathsEqual = cborPathsEqual;

export const libIsPathAncestor: IsAncestor = isCborPathAncestor;

/** Key as `libSplitPath` would yield it; quoted-form escapes are kept, never unescaped. */
export const libSegmentOf = cborPathSegment;

export const libPathScheme: PathScheme = {
  rootPath: CBOR_PATH_ROOT,
  joinKey: libJoinKey,
  splitPath: libSplitPath,
  segmentOf: libSegmentOf,
};

// ---------- Dot-joined scheme ----------

export const dotJoinKey: JoinKey = (parentPath, key) => {
  if (parentPath === "") return String(key);
  return `${parentPath}.${key}`;
};

export const dotPathsEqual: PathsEqual = (a, b) => a === b;

export const dotIsPathAncestor: IsAncestor = (ancestor, descendant) => {
  return descendant.startsWith(ancestor + ".");
};

export function dotSplitPath(path: string): string[] {
  return path === "" ? [] : path.split(".");
}

export const dotPathScheme: PathScheme = {
  rootPath: "",
  joinKey: dotJoinKey,
  splitPath: dotSplitPath,
  segmentOf: (key) => String(key),
};
