// cddl-cat embeds the failing position into the error message as
// `parsing error: position Position { line: L, column: C, range: (S, E),
// index: I }, msg: <reason>`. We pull `range` (char offsets into the CDDL
// source) and the human-readable trailing message so the editor can paint
// the bad span.

export interface CddlErrorPosition {
  range: [number, number];
  line: number;
  column: number;
  /** Just the trailing reason, without the `parsing error: ...` prefix. */
  reason: string;
}

const POSITION_RE =
  /position\s+Position\s*\{\s*line:\s*(\d+)\s*,\s*column:\s*(\d+)\s*,\s*range:\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i;
const REASON_RE = /,\s*msg:\s*([\s\S]+?)\s*$/i;

export function parseCddlErrorPosition(message: string | undefined | null): CddlErrorPosition | null {
  if (!message) return null;
  const m = POSITION_RE.exec(message);
  if (!m) return null;
  const line = parseInt(m[1], 10);
  const column = parseInt(m[2], 10);
  const start = parseInt(m[3], 10);
  const end = parseInt(m[4], 10);
  if (![line, column, start, end].every(Number.isFinite)) return null;
  const reasonMatch = REASON_RE.exec(message);
  const reason = reasonMatch ? reasonMatch[1] : message;
  return { range: [start, end], line, column, reason };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- CDDL navigator ----------
//
// Walks a JSON-like path (`$.age`, `$[0][16]`, mixed) through the CDDL
// source and returns the source range of the leaf that the path points to.
// We don't have a real symbol table from cddl-cat, so we re-tokenise on
// the fly: each rule body is sliced out, parsed into either array
// elements `[a, b, c]` or map entries `{ k: v, k2: v2 }`, and the chosen
// child is either followed via its type reference (jumping into another
// rule) or inspected in-place for the next segment.

type Segment = { kind: "index"; n: number } | { kind: "name"; name: string };

interface ChildEntry {
  /** Display key — field name for `name: type`, or numeric for `<n>: type`. */
  name: string | null;
  numericKey: number | null;
  /** Identifier of the referenced rule, when this child is a bare type ref. */
  typeRef: string | null;
  /** Range of the entry within its enclosing body. */
  start: number;
  end: number;
  /** Range of the value/type expression — used to descend without a typeRef. */
  exprStart: number;
  exprEnd: number;
}

function parsePath(path: string): Segment[] {
  const segs: Segment[] = [];
  const re = /\.([a-zA-Z_][\w-]*)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1]) segs.push({ kind: "name", name: m[1] });
    else segs.push({ kind: "index", n: parseInt(m[2], 10) });
  }
  return segs;
}

interface RuleBody {
  body: string;
  bodyStart: number;
  bodyEnd: number;
  nameStart: number;
  nameEnd: number;
}

function extractRuleBody(cddl: string, ruleName: string): RuleBody | null {
  const re = new RegExp(`(^|\\n)[ \\t]*(${escapeRegex(ruleName)})\\s*=\\s*`, "m");
  const m = re.exec(cddl);
  if (!m) return null;
  const headOffset = m.index + (m[1] ? 1 : 0);
  const nameStart = cddl.indexOf(ruleName, headOffset);
  if (nameStart < 0) return null;
  const nameEnd = nameStart + ruleName.length;
  const bodyStart = m.index + m[0].length;
  // Body of this rule ends at the next top-level rule definition.
  const nextRe = /\n[ \t]*[a-zA-Z_][\w-]*\s*=/g;
  nextRe.lastIndex = bodyStart;
  const next = nextRe.exec(cddl);
  const bodyEnd = next ? next.index : cddl.length;
  return { body: cddl.slice(bodyStart, bodyEnd), bodyStart, bodyEnd, nameStart, nameEnd };
}

/** Find the matching closing bracket at top depth for an opener at `from`. */
function matchBracket(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  let inComment = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inComment) { if (c === "\n") inComment = false; continue; }
    if (c === ";") { inComment = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split `text` (without enclosing brackets) into top-level comma chunks. */
function splitTopComma(text: string): { chunk: string; offset: number }[] {
  const out: { chunk: string; offset: number }[] = [];
  let depth = 0;
  let inComment = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inComment) { if (c === "\n") inComment = false; continue; }
    if (c === ";") { inComment = true; continue; }
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push({ chunk: text.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  out.push({ chunk: text.slice(start), offset: start });
  return out;
}

/** Strip CDDL-level decorators we don't want to highlight (?, *, +, ^). */
function stripDecorators(s: string): string {
  return s.replace(/^[\s?*+^]+/, "").trim();
}

/**
 * Parse the children of a body that begins with `[...]` or `{...}` (after
 * optional whitespace and comments). Returns null when the body is neither
 * an array nor a map.
 */
function parseChildren(body: string, bodyStart: number): { children: ChildEntry[]; container: "array" | "map" } | null {
  // Skip leading whitespace/comments to find the first structural opener.
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === ";") { while (i < body.length && body[i] !== "\n") i++; continue; }
    break;
  }
  const open = body[i];
  if (open !== "[" && open !== "{") return null;
  const close = open === "[" ? "]" : "}";
  const closeIdx = matchBracket(body, i, open, close);
  if (closeIdx < 0) return null;
  const innerStart = i + 1;
  const inner = body.slice(innerStart, closeIdx);
  const chunks = splitTopComma(inner);

  const children: ChildEntry[] = [];
  for (const { chunk, offset } of chunks) {
    const raw = chunk;
    const trimmedLeft = raw.replace(/^\s+/, "");
    const leadWs = raw.length - trimmedLeft.length;
    const trimmed = trimmedLeft.replace(/\s+$/, "");
    if (!trimmed) continue;

    const entryStart = bodyStart + innerStart + offset + leadWs;
    const entryEnd = entryStart + trimmed.length;

    // Match `name : value` or `<n> : value` (CDDL allows numeric keys).
    let name: string | null = null;
    let numericKey: number | null = null;
    let exprText = trimmed;
    let exprStartOffset = 0;
    const colonRe = /^\s*([?*+]\s*)?([a-zA-Z_][\w-]*|\d+)\s*:\s*/;
    const km = colonRe.exec(trimmed);
    if (km) {
      const key = km[2];
      if (/^\d+$/.test(key)) numericKey = parseInt(key, 10);
      else name = key;
      exprStartOffset = km[0].length;
      exprText = trimmed.slice(km[0].length);
    } else {
      // No `:` — bare type or positional element. Strip leading decorator.
      exprText = stripDecorators(trimmed);
      exprStartOffset = trimmed.indexOf(exprText);
      if (exprStartOffset < 0) exprStartOffset = 0;
    }
    const exprStart = entryStart + exprStartOffset;
    const exprEnd = entryEnd;
    const typeRef = /^[a-zA-Z_][\w-]*$/.test(exprText) ? exprText : null;

    children.push({
      name,
      numericKey,
      typeRef,
      start: entryStart - bodyStart,
      end: entryEnd - bodyStart,
      exprStart: exprStart - bodyStart,
      exprEnd: exprEnd - bodyStart,
    });
  }

  return { children, container: open === "[" ? "array" : "map" };
}

/**
 * Heuristic: map a CBOR validation error onto the CDDL source.
 *
 * Walks the JSON path through the schema, descending into rule bodies and
 * following type references when needed. Returns the tightest range that
 * matched. Pure positional paths (`$[0][16]`) work as long as the schema
 * uses array/map containers we can split.
 */
export function locateCborErrorInCddl(
  cddl: string,
  ruleName: string,
  path: string | undefined,
): [number, number] | null {
  if (!cddl || !ruleName) return null;

  const root = extractRuleBody(cddl, ruleName);
  if (!root) return null;

  const segments = parsePath(path ?? "");
  let bestRange: [number, number] = [root.nameStart, root.nameEnd];

  // The "current scope" is whatever expression we're descending into. When we
  // follow a typeRef we also widen back to that rule's full body.
  let scopeBody = root.body;
  let scopeStart = root.bodyStart;
  let scopeEnd = root.bodyEnd;
  // Already-followed rules — guard against cycles like `Foo = Foo / int`.
  const followed = new Set<string>([ruleName]);

  for (const seg of segments) {
    const parsed = parseChildren(scopeBody, scopeStart);
    if (!parsed) break;

    let chosen: ChildEntry | undefined;
    if (seg.kind === "name") {
      chosen = parsed.children.find(c => c.name === seg.name);
    } else {
      // Try positional first (works for arrays + sequential map keys).
      chosen = parsed.children[seg.n];
      // Then by explicit numeric key (for sparse Cardano-style maps).
      if (!chosen || (chosen.numericKey !== null && chosen.numericKey !== seg.n)) {
        const byKey = parsed.children.find(c => c.numericKey === seg.n);
        if (byKey) chosen = byKey;
      }
    }
    if (!chosen) break;

    bestRange = [scopeStart + chosen.start, scopeStart + chosen.end];

    // Descend for the next segment.
    if (chosen.typeRef && !followed.has(chosen.typeRef)) {
      const next = extractRuleBody(cddl, chosen.typeRef);
      if (next) {
        followed.add(chosen.typeRef);
        scopeBody = next.body;
        scopeStart = next.bodyStart;
        scopeEnd = next.bodyEnd;
        continue;
      }
    }
    // Inline expression — keep descending into the value text.
    const inlineStart = scopeStart + chosen.exprStart;
    const inlineEnd = scopeStart + chosen.exprEnd;
    scopeBody = cddl.slice(inlineStart, inlineEnd);
    scopeStart = inlineStart;
    scopeEnd = inlineEnd;
  }

  return bestRange;
}
