// Two path schemes are used in this app, both supported here:
//
// 1. Lib-canonical (`$.foo[0]["bar"]`) — emitted by cquisitor-lib's
//    `decoded_path` field. Numeric *map* keys come out as `["0"]` while
//    array indices use bare `[0]`. Used by the CDDL validator's decoded
//    JSON view to bridge with CBOR/CDDL panels.
//
// 2. Dot-joined (`transaction.body.0`) — used by the Transaction
//    Validator's diagnostic locations. No `$` prefix; array indices and
//    string keys are dot-joined alike.

export type JoinKey = (
  parentPath: string,
  key: string | number,
  opts: { isArrayItem: boolean },
) => string;

export type PathsEqual = (a: string, b: string) => boolean;
export type IsAncestor = (ancestor: string, descendant: string) => boolean;

const IDENT_RE = /^[a-zA-Z_][\w-]*$/;

function isIdent(s: string): boolean {
  return IDENT_RE.test(s);
}

function escString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ---------- Lib-canonical scheme ----------

export const libJoinKey: JoinKey = (parentPath, key) => {
  if (typeof key === "number") return `${parentPath}[${key}]`;
  if (isIdent(key)) return `${parentPath}.${key}`;
  return `${parentPath}["${escString(key)}"]`;
};

const LIB_SEG_RE = /\.([^.[\]]+)|\["((?:[^"\\]|\\.)*)"\]|\[(\d+)\]/g;

export function libSplitPath(path: string): string[] {
  const out: string[] = [];
  // Stateful regex — reset before each use.
  LIB_SEG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LIB_SEG_RE.exec(path)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

export const libPathsEqual: PathsEqual = (a, b) => {
  if (a === b) return true;
  const sa = libSplitPath(a);
  const sb = libSplitPath(b);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
};

export const libIsPathAncestor: IsAncestor = (ancestor, descendant) => {
  const sa = libSplitPath(ancestor);
  const sd = libSplitPath(descendant);
  if (sa.length >= sd.length) return false;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sd[i]) return false;
  return true;
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
