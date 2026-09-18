// Root CBOR kinds a rule can accept, read from schema text (and of a decoded document).
// Over-approximation: a set may be too wide or `null` (admits all), but never
// omit a kind the rule accepts. Unsure cases return `null`.

import type { CddlOutlineEntry } from "@cardananium/cquisitor-lib";

/** The tags a decoded node is named under, paired with their numbers. */
const NAMED_TAGS: ReadonlyArray<[string, number]> = [
  ["DateTime", 0],
  ["Timestamp", 1],
  ["PosBignum", 2],
  ["NegBignum", 3],
  ["Decimal", 4],
  ["Bigfloat", 5],
  ["ToBase64Url", 21],
  ["ToBase64", 22],
  ["ToBase16", 23],
  ["Cbor", 24],
  ["Uri", 32],
  ["Base64Url", 33],
  ["Base64", 34],
  ["Regex", 35],
  ["Mime", 36],
];

/** Number a decoded node's tag name stands for, or `null` if the decoder does not produce it. */
export function tagNumberOf(name: string): number | null {
  const named = NAMED_TAGS.find(([n]) => n === name);
  if (named) return named[1];
  const m = /^Unassigned\((\d+)\)$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** Root kind of a decoded document, or `null` for an unknown node type (admits every rule). */
export function cborRootKind(decoded: { type: string; tag?: string } | null): string | null {
  if (!decoded) return null;
  switch (decoded.type) {
    case "Map":
      return "map";
    case "Array":
      return "array";
    case "Tag": {
      const n = typeof decoded.tag === "string" ? tagNumberOf(decoded.tag) : null;
      return n === null ? "tag" : `tag:${n}`;
    }
    case "String":
    case "IndefiniteLengthString":
      return "text";
    case "Bytes":
    case "IndefiniteLengthBytes":
      return "bytes";
    case "U8":
    case "U16":
    case "U32":
    case "U64":
      return "uint";
    case "I8":
    case "I16":
    case "I32":
    case "I64":
    case "Int":
      return "nint";
    case "F16":
    case "F32":
    case "F64":
      return "float";
    case "Bool":
      return "bool";
    // The validator reads an undefined value as null.
    case "Null":
    case "Undefined":
      return "null";
    case "Simple":
      return "simple";
    default:
      return null;
  }
}

/** Whether a rule with these kinds may accept a document of this kind. */
export function rootKindsAdmit(kinds: ReadonlyArray<string> | null, kind: string | null): boolean {
  if (kinds === null || kind === null) return true;
  if (kind === "tag") return kinds.some(k => k === "tag" || k.startsWith("tag:"));
  if (kind.startsWith("tag:")) return kinds.includes(kind) || kinds.includes("tag");
  return kinds.includes(kind);
}

// ---------- the prelude ----------

const INT: ReadonlyArray<string> = ["uint", "nint"];
const NUMBER: ReadonlyArray<string> = ["uint", "nint", "float"];

/** Prelude names (RFC 8610 Appendix D) by kinds the validator admits.
 *  `any` / `undefined` are absent (unknown). `tdate`, `time`, `uri`, `b64url`
 *  also name the untagged kinds the validator accepts; other tagged names do not. */
const PRELUDE: Readonly<Record<string, ReadonlyArray<string>>> = {
  uint: ["uint"],
  nint: ["nint"],
  int: INT,
  bstr: ["bytes"],
  bytes: ["bytes"],
  tstr: ["text"],
  text: ["text"],
  tdate: ["tag:0", "text"],
  time: ["tag:1", ...NUMBER],
  number: NUMBER,
  biguint: ["tag:2"],
  bignint: ["tag:3"],
  bigint: ["tag:2", "tag:3"],
  integer: ["uint", "nint", "tag:2", "tag:3"],
  unsigned: ["uint", "tag:2"],
  decfrac: ["tag:4"],
  bigfloat: ["tag:5"],
  eb64url: ["tag:21"],
  eb64legacy: ["tag:22"],
  eb16: ["tag:23"],
  "encoded-cbor": ["tag:24"],
  uri: ["tag:32", "text"],
  b64url: ["tag:33", "text"],
  b64legacy: ["tag:34"],
  regexp: ["tag:35"],
  "mime-message": ["tag:36"],
  "cbor-any": ["tag:55799"],
  float16: ["float"],
  float32: ["float"],
  float64: ["float"],
  "float16-32": ["float"],
  "float32-64": ["float"],
  float: ["float"],
  false: ["bool"],
  true: ["bool"],
  bool: ["bool"],
  nil: ["null"],
  null: ["null"],
};

/** Every name the prelude table answers for. */
export const PRELUDE_NAMES: ReadonlyArray<string> = Object.keys(PRELUDE);

/** `#0` … `#5` by major type; `#6` is any tag, `#7` is left unknown. */
const MAJOR_KINDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "0": ["uint"],
  "1": ["nint"],
  "2": ["bytes"],
  "3": ["text"],
  "4": ["array"],
  "5": ["map"],
  "6": ["tag"],
};

// ---------- tokens ----------

type TokenKind = "ident" | "text" | "bytes" | "number" | "major" | "ctl" | "punct";

interface Token {
  kind: TokenKind;
  text: string;
}

const IDENT = /^[A-Za-z@_][A-Za-z0-9@_$]*(?:[-.][A-Za-z0-9@_$]+)*/;
const NUMBER_LITERAL = /^-?(?:0x[0-9A-Fa-f]+(?:\.[0-9A-Fa-f]+)?(?:p[+-]?\d+)?|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/;
const MAJOR = /^#(?:\d(?:\.\d+)?)?/;
const PUNCT = ["//=", "/=", "//", "...", "..", "=>", "=", "/", "{", "}", "[", "]", "(", ")", "<", ">", ",", ":", "?", "*", "+", "^", "&", "~", "$$", "$"];

/** Index just past the quoted literal opening at `i`, or -1 if it never closes. */
function literalEnd(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === quote) return j + 1;
  }
  return -1;
}

/**
 * Rule text as tokens, comments dropped. `null` when a token cannot be
 * bounded (unclosed literal, unknown character) — guessing would misplace a bracket.
 */
export function tokenizeCddl(text: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === ";") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = literalEnd(text, i);
      if (end === -1) return null;
      out.push({ kind: c === '"' ? "text" : "bytes", text: text.slice(i, end) });
      i = end;
      continue;
    }
    const rest = text.slice(i);
    if (c === "#") {
      const m = MAJOR.exec(rest)!;
      out.push({ kind: "major", text: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === "." && /[A-Za-z]/.test(text[i + 1] ?? "")) {
      const m = IDENT.exec(rest.slice(1))!;
      out.push({ kind: "ctl", text: `.${m[0]}` });
      i += 1 + m[0].length;
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      const after = text[i + ident[0].length];
      // `h'…'`, `b64'…'` and `h"…"` are byte strings, not a name plus a string.
      if ((after === "'" && (ident[0] === "h" || ident[0] === "b64")) || (after === '"' && ident[0] === "h")) {
        const end = literalEnd(text, i + ident[0].length);
        if (end === -1) return null;
        out.push({ kind: "bytes", text: text.slice(i, end) });
        i = end;
        continue;
      }
      out.push({ kind: "ident", text: ident[0] });
      i += ident[0].length;
      continue;
    }
    const number = NUMBER_LITERAL.exec(rest);
    if (number) {
      out.push({ kind: "number", text: number[0] });
      i += number[0].length;
      continue;
    }
    const punct = PUNCT.find(p => rest.startsWith(p));
    if (!punct) return null;
    out.push({ kind: "punct", text: punct });
    i += punct.length;
  }
  return out;
}

// ---------- reading a type ----------

const OPENERS: Readonly<Record<string, string>> = { "{": "}", "[": "]", "(": ")", "<": ">" };

/** Index of the bracket closing the one at `open`, or -1. */
function closerOf(tokens: ReadonlyArray<Token>, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "punct") continue;
    if (t.text in OPENERS) {
      stack.push(OPENERS[t.text]);
    } else if (stack.length > 0 && t.text === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Type choices of a type expression, split on `/`. `null` if brackets do not
 *  balance or a group choice sits at the top. */
function splitChoices(tokens: ReadonlyArray<Token>): Token[][] | null {
  const parts: Token[][] = [];
  let current: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "punct" && t.text in OPENERS) {
      const close = closerOf(tokens, i);
      if (close === -1) return null;
      current.push(...tokens.slice(i, close + 1));
      i = close;
      continue;
    }
    if (t.kind === "punct" && (t.text === "}" || t.text === "]" || t.text === ")" || t.text === ">")) return null;
    if (t.kind === "punct" && t.text === "/") {
      parts.push(current);
      current = [];
      continue;
    }
    if (t.kind === "punct" && t.text === "//") return null;
    current.push(t);
  }
  parts.push(current);
  return parts;
}

/** Whether the rest after a type's head leaves its kind alone (empty, or a
 *  control operator — the controller is not read). */
function tailIsNarrowing(rest: ReadonlyArray<Token>): boolean {
  return rest.length === 0 || rest[0].kind === "ctl";
}

/** A range: ends may differ in sign and may be floats, so both integer kinds plus float. */
function rangeKinds(rest: ReadonlyArray<Token>): ReadonlyArray<string> | null {
  // `..` or `...`, then the upper bound, then nothing.
  if (rest.length !== 2) return null;
  const upper = rest[1];
  if (upper.kind !== "number" && upper.kind !== "ident") return null;
  return NUMBER;
}

function isRangeOp(t: Token | undefined): boolean {
  return t !== undefined && t.kind === "punct" && (t.text === ".." || t.text === "...");
}

function numberKinds(literal: string): ReadonlyArray<string> {
  const negative = literal.startsWith("-");
  if (/^-?0x/.test(literal)) return NUMBER;
  if (/[.eE]/.test(literal)) return ["float"];
  // `-0` is the integer zero, which is unsigned on the wire.
  return negative ? INT : ["uint"];
}

interface Reader {
  outline: ReadonlyArray<CddlOutlineEntry>;
  source: string;
  /** Names on the resolution path; a cycle answers unknown. */
  visited: Set<string>;
}

/** Kinds one type choice (a `type1`) admits. */
function choiceKinds(tokens: ReadonlyArray<Token>, reader: Reader): ReadonlyArray<string> | null {
  if (tokens.length === 0) return null;
  const head = tokens[0];
  const rest = tokens.slice(1);
  switch (head.kind) {
    case "punct": {
      if (head.text === "{" || head.text === "[") {
        const close = closerOf(tokens, 0);
        if (close === -1 || !tailIsNarrowing(tokens.slice(close + 1))) return null;
        return [head.text === "{" ? "map" : "array"];
      }
      return null;
    }
    case "text":
      return tailIsNarrowing(rest) ? ["text"] : null;
    case "bytes":
      return tailIsNarrowing(rest) ? ["bytes"] : null;
    case "number":
      if (isRangeOp(rest[0])) return rangeKinds(rest);
      return tailIsNarrowing(rest) ? numberKinds(head.text) : null;
    case "major": {
      const m = /^#(\d)?(?:\.(\d+))?$/.exec(head.text);
      if (!m || m[1] === undefined) return null;
      let after = rest;
      if (after[0]?.kind === "punct" && after[0].text === "(") {
        const close = closerOf(tokens, 1);
        if (close === -1) return null;
        after = tokens.slice(close + 1);
      }
      if (!tailIsNarrowing(after)) return null;
      if (m[1] === "6") return [m[2] === undefined ? "tag" : `tag:${Number(m[2])}`];
      if (m[2] !== undefined) return null;
      return MAJOR_KINDS[m[1]] ?? null;
    }
    case "ident": {
      if (rest[0]?.kind === "punct" && rest[0].text === "<") return null;
      if (isRangeOp(rest[0])) return rangeKinds(rest);
      if (!tailIsNarrowing(rest)) return null;
      return nameKinds(head.text, reader);
    }
    default:
      return null;
  }
}

/** Kinds a name admits: schema rule first, else prelude — validator order. */
function nameKinds(name: string, reader: Reader): ReadonlyArray<string> | null {
  const entries = reader.outline.filter(e => e.name === name);
  if (entries.length === 0) return PRELUDE[name] ?? null;
  if (entries.length > 1 || entries.some(e => e.is_alternate || e.kind !== "type")) return null;
  if (reader.visited.has(name)) return null;
  reader.visited.add(name);
  const kinds = entryKinds(entries[0], reader);
  reader.visited.delete(name);
  return kinds;
}

/** Rule text after its `=`, as tokens. */
function bodyTokens(entry: CddlOutlineEntry, source: string): Token[] | null {
  const span = entry.span;
  if (!span) return null;
  const tokens = tokenizeCddl(source.slice(span.char_offset, span.char_offset + span.char_length));
  if (!tokens) return null;
  // Name then `=`. Generics or `/=` put something else second; those are not followed.
  if (tokens.length < 2 || tokens[1].kind !== "punct" || tokens[1].text !== "=") return null;
  return tokens.slice(2);
}

function entryKinds(entry: CddlOutlineEntry, reader: Reader): ReadonlyArray<string> | null {
  const body = bodyTokens(entry, reader.source);
  if (!body) return null;
  const choices = splitChoices(body);
  if (!choices) return null;
  const union = new Set<string>();
  for (const choice of choices) {
    const kinds = choiceKinds(choice, reader);
    if (!kinds) return null;
    for (const k of kinds) union.add(k);
  }
  return [...union];
}

/**
 * Kinds the type rule `name` can accept at the root, or `null` when the
 * schema does not settle it. `source` must be the text `outline` came from.
 */
export function ruleRootKinds(
  name: string,
  outline: ReadonlyArray<CddlOutlineEntry>,
  source: string,
): string[] | null {
  const kinds = nameKinds(name, { outline, source, visited: new Set() });
  // A name the schema does not declare is not a rule, whatever the prelude says.
  if (!outline.some(e => e.name === name)) return null;
  return kinds === null ? null : [...kinds];
}
