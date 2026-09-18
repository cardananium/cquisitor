import { libSplitPath } from "@/components/jsonTree/paths";
import type {
  CborPosition,
  CborValidationErrorInfo,
  CddlErrorInfo,
  SourceSpan,
} from "@cardananium/cquisitor-lib";

/** [start, end) char range in the CDDL source for a library byte_span. */
export type CddlRange = [number, number];

/**
 * True when a span actually points at CDDL source. Absence means the library
 * could not place it; a zero-length span is not a location either.
 */
export function hasCddlSpan(span: SourceSpan | undefined | null): span is SourceSpan {
  return !!span && span.char_length > 0;
}

function spanToRange(span: SourceSpan | undefined | null): CddlRange | null {
  if (!span) return null;
  // `char_offset`/`char_length` are UTF-16 code units — JS-string-friendly.
  // Every CDDL-side span carries them alongside its UTF-8 byte offsets.
  const start = span.char_offset;
  const end = span.char_offset + span.char_length;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return [start, end];
}

/**
 * `cddl_symbol_at` wants a UTF-8 byte offset; textarea `selectionStart` is UTF-16.
 */
export function utf16ToByte(text: string, jsIndex: number): number {
  if (jsIndex <= 0) return 0;
  let bytes = 0;
  let i = 0;
  const stop = Math.min(jsIndex, text.length);
  while (i < stop) {
    const code = text.charCodeAt(i);
    if (code < 0x80) { bytes += 1; i += 1; }
    else if (code < 0x800) { bytes += 2; i += 1; }
    else if (code >= 0xD800 && code <= 0xDBFF) { bytes += 4; i += 2; /* surrogate pair */ }
    else { bytes += 3; i += 1; }
  }
  return bytes;
}

/**
 * CDDL parse-error range from `char_offset`/`char_length`.
 * A whole-schema error has no span, so no range rather than one at character 0.
 */
export function cddlParseErrorRange(error: CddlErrorInfo | undefined | null): CddlRange | null {
  const span = error?.byte_span;
  return hasCddlSpan(span) ? spanToRange(span) : null;
}

/** One name the schema uses that resolves to nothing, ready to render. */
export interface CddlUnresolvedName {
  name: string;
  range: CddlRange;
  line: number;
}

/**
 * Every occurrence of a name that resolves to nothing, in source order.
 * Empty for other schema-error kinds, and for an unresolved name the span walker cannot see.
 */
export function cddlUnresolvedNames(error: CddlErrorInfo | undefined | null): CddlUnresolvedName[] {
  const out: CddlUnresolvedName[] = [];
  for (const u of error?.unresolved ?? []) {
    const range = hasCddlSpan(u.byte_span) ? spanToRange(u.byte_span) : null;
    if (!range) continue;
    out.push({ name: u.name, range, line: u.byte_span.line });
  }
  return out;
}

/** One rule the schema uses without defining, and every place it says it. */
export interface CddlUnresolvedGroup {
  name: string;
  occurrences: CddlUnresolvedName[];
}

/** Unresolved references grouped by name — one entry per rule to define, not per use. */
export function groupUnresolvedNames(
  names: ReadonlyArray<CddlUnresolvedName>,
): CddlUnresolvedGroup[] {
  const out: CddlUnresolvedGroup[] = [];
  const index = new Map<string, CddlUnresolvedGroup>();
  for (const u of names) {
    const at = index.get(u.name);
    if (at) {
      at.occurrences.push(u);
      continue;
    }
    const group: CddlUnresolvedGroup = { name: u.name, occurrences: [u] };
    index.set(u.name, group);
    out.push(group);
  }
  return out;
}

/** What a schema error means and what to do about it. */
export interface SchemaErrorGuidance {
  /** Extra wording beyond the parser's message; `null` when the message says it all. */
  summary: string | null;
  nextStep: string;
}

/**
 * Per-kind wording for the invalid-schema card.
 * Only `parse_error` (and pre-parse refusals like it) failed to parse; the others parsed.
 */
export function schemaErrorGuidance(
  kind: string,
  unresolved?: { names: number; occurrences: number; truncated: boolean },
): SchemaErrorGuidance {
  if (kind === "unresolved_references") {
    const names = unresolved?.names ?? 0;
    const occurrences = unresolved?.occurrences ?? 0;
    const more = unresolved?.truncated ? ", and the list below is not all of them" : "";
    return {
      summary: names > 0
        ? `The schema parses. It uses ${names} rule${names === 1 ? "" : "s"} that nothing in it defines`
          + `, across ${occurrences} reference${occurrences === 1 ? "" : "s"}${more}.`
        : `The schema parses. It uses a rule that nothing in it defines${more}.`,
      nextStep: "Define each name below, or drop the reference that uses it. Nothing else is"
        + " between this schema and a validation run.",
    };
  }
  if (kind === "no_rules") {
    return {
      summary: "The text parses. It just declares no rules — a document of only comments and"
        + " whitespace describes nothing to validate against.",
      nextStep: "Add a type rule (a line of the form `name = …`), then pick it as the root.",
    };
  }
  return {
    summary: null,
    nextStep: "The schema has to parse before any CBOR can be checked against it.",
  };
}

/** Bound kinds: document/schema depth, descent cost, and the validator's work cap. */
export function isImplementationLimit(kind: string): boolean {
  return kind === "nesting_too_deep" || kind === "validation_too_complex";
}

/**
 * Extra card copy for a refusal at a bound. Reaching it means nothing past it was examined.
 * `null` for every other kind — those messages are findings.
 */
export function implementationLimitNote(kind: string): string | null {
  if (!isImplementationLimit(kind)) return null;
  return "An implementation limit, not a finding about the input: nothing past the bound"
    + " was examined, so the input is neither confirmed nor rejected.";
}

/**
 * One sentence for a walk that gave no answer. `subject` names the walk ("The mapping").
 * A refusal includes its kind; a failed call includes only the transport's reason.
 */
export function walkRefusalNotice(
  refusal: { kind: string; message: string },
  subject: string,
): string {
  const message = cddlErrorReason(refusal.message).replace(/\.?\s*$/, ".");
  if (refusal.kind === "call_failed") return `${subject} did not run: ${message}`;
  const note = implementationLimitNote(refusal.kind);
  return `${subject} was refused — ${refusal.kind}: ${message}${note ? ` ${note}` : ""}`;
}

/**
 * Every place in the schema the error points at. One range for most kinds;
 * one per occurrence when the schema names rules nothing defines.
 */
export function cddlErrorRanges(error: CddlErrorInfo | undefined | null): CddlRange[] {
  const unresolved = cddlUnresolvedNames(error);
  if (unresolved.length > 0) return unresolved.map(u => u.range);
  const single = cddlParseErrorRange(error);
  return single ? [single] : [];
}

/** CDDL line number for a parse error, when present. */
export function cddlParseErrorLine(error: CddlErrorInfo | undefined | null): number | null {
  return error?.byte_span?.line ?? null;
}

/** Mismatch → CDDL source range, or none if the library could not place it. */
export function cborErrorOnCddlRange(error: CborValidationErrorInfo | undefined | null): CddlRange | null {
  const span = error?.cddl_byte_span;
  return hasCddlSpan(span) ? spanToRange(span) : null;
}

/**
 * Keep the message as-is, except a parser debug dump in front of the text —
 * `parsing error: position Position { … }, msg: <reason>` — which repeats `byte_span`.
 */
export function cddlErrorReason(message: string | undefined | null): string {
  if (!message) return "";
  const stripped = message.replace(
    /^parsing error:\s*position\s+Position\s*\{[^}]*\}\s*,\s*msg:\s*/i,
    "",
  );
  return stripped.trim() || message.trim();
}

/** One thing that went wrong, ready to render. */
export interface CborDiagnostic {
  /** Library error category (`mismatch`, `input_parse`, `map_cut`, …). */
  kind: string;
  /** Message with the parser's debug dump removed. */
  message: string;
  /** The type the validator wanted, when it named one. */
  expected: string | null;
  /** Semantic path into the CBOR (`$.age`). */
  path: string | null;
  /** Where in the schema, when the library pinned a usable span. */
  cddlRange: CddlRange | null;
  /** Bytes of the value that failed. */
  byteSpans: CborPosition[];
  /** Bytes of the structure containing it. */
  anchorSpans: CborPosition[];
}

/**
 * True when the root item itself was refused — wrong kind or size for the rule —
 * not a match that failed somewhere inside. A bound reached is neither.
 */
export function isRootMismatch(diagnostic: Pick<CborDiagnostic, "kind" | "path">): boolean {
  return diagnostic.kind === "mismatch" && diagnostic.path === "$";
}

/** `input_parse` errors pin a single byte through `offset` instead of a span. */
function offsetSpans(err: CborValidationErrorInfo): CborPosition[] {
  const offset = err.offset;
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) return [];
  return [{ offset, length: 1 }];
}

function toDiagnostic(err: CborValidationErrorInfo): CborDiagnostic {
  const byteSpans = err.byte_spans && err.byte_spans.length > 0 ? err.byte_spans : offsetSpans(err);
  return {
    kind: err.kind,
    message: cddlErrorReason(err.message),
    expected: err.expected ?? null,
    path: err.path ?? null,
    cddlRange: cborErrorOnCddlRange(err),
    byteSpans,
    anchorSpans: err.anchor_spans ?? [],
  };
}

/** Byte a diagnostic blames, for ordering. Rows that name no byte sort last. */
function firstOffset(d: CborDiagnostic): number {
  return d.byteSpans[0]?.offset ?? d.anchorSpans[0]?.offset ?? Number.MAX_SAFE_INTEGER;
}

/** Extent a row blames: containing structure if named, otherwise the failing bytes. */
function extentOf(d: CborDiagnostic): { start: number; end: number } | null {
  const s = d.anchorSpans[0] ?? d.byteSpans[0];
  return s ? { start: s.offset, end: s.offset + s.length } : null;
}

/**
 * For each row, how many others blame a structure that strictly contains it.
 * Side-by-side rows (every element of a repeated slot) get 0 and stay in buffer order.
 */
function enclosingCounts(diagnostics: ReadonlyArray<CborDiagnostic>): number[] {
  const extents = diagnostics.map(extentOf);
  return extents.map((inner, i) => {
    if (!inner) return 0;
    let count = 0;
    for (let j = 0; j < extents.length; j++) {
      if (j === i) continue;
      const outer = extents[j];
      if (!outer) continue;
      const strictlyLarger = outer.end - outer.start > inner.end - inner.start;
      if (strictlyLarger && outer.start <= inner.start && outer.end >= inner.end) count += 1;
    }
    return count;
  });
}

/**
 * Innermost failure first, then buffer order. `additional[]` arrives in neither
 * positional nor stable order; ties fall back to containing structure, then path.
 */
function compareByPosition(
  a: { d: CborDiagnostic; enclosing: number },
  b: { d: CborDiagnostic; enclosing: number },
): number {
  const byDepth = b.enclosing - a.enclosing;
  if (byDepth !== 0) return byDepth;
  const byBytes = firstOffset(a.d) - firstOffset(b.d);
  if (byBytes !== 0) return byBytes;
  const byAnchor = (a.d.anchorSpans[0]?.offset ?? Number.MAX_SAFE_INTEGER)
    - (b.d.anchorSpans[0]?.offset ?? Number.MAX_SAFE_INTEGER);
  if (byAnchor !== 0) return byAnchor;
  const ap = a.d.path ?? "";
  const bp = b.d.path ?? "";
  return ap < bp ? -1 : ap > bp ? 1 : 0;
}

/**
 * Flatten the head error and `additional[]` into one list, ordered by the bytes blamed.
 * Rows collapse only when they describe the same failure at the same place; path distinguishes repeated elements.
 */
export function cborDiagnostics(error: CborValidationErrorInfo | undefined | null): CborDiagnostic[] {
  if (!error) return [];
  return orderedDiagnostics(error);
}

/**
 * How many further mismatches the validator counted and did not describe.
 * Ignoring `additional_truncated` under-reports the run.
 */
export function cborDiagnosticsTruncated(
  error: CborValidationErrorInfo | undefined | null,
): number {
  const dropped = error?.additional_truncated;
  if (typeof dropped !== "number" || !Number.isFinite(dropped) || dropped <= 0) return 0;
  return Math.floor(dropped);
}

function orderedDiagnostics(error: CborValidationErrorInfo): CborDiagnostic[] {
  const out: CborDiagnostic[] = [];
  const seen = new Set<string>();
  for (const err of [error, ...(error.additional ?? [])]) {
    const d = toDiagnostic(err);
    const bytes = d.byteSpans[0] ? `${d.byteSpans[0].offset}:${d.byteSpans[0].length}` : "";
    const key = `${d.kind}|${d.path ?? ""}|${d.cddlRange?.join(":") ?? ""}|${bytes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  // `sort` is stable, so rows the comparison cannot separate keep library order.
  const enclosing = enclosingCounts(out);
  return out
    .map((d, i) => ({ d, enclosing: enclosing[i] }))
    .sort(compareByPosition)
    .map(row => row.d);
}

/** How much of a validation run the panel is actually showing. */
export interface DiagnosticCoverage {
  /** Rows rendered as cards. */
  shown: number;
  /** Rows the validator described that the panel's own cap left out. */
  hidden: number;
  /** Rows the validator counted without describing. */
  undescribed: number;
}

/**
 * One sentence covering both caps, or `null` when neither applies.
 * The panel stops rendering at a hundred rows; the validator may have stopped describing earlier.
 */
export function describeDiagnosticCoverage(c: DiagnosticCoverage): string | null {
  const hidden = Math.max(0, c.hidden);
  const undescribed = Math.max(0, c.undescribed);
  if (hidden === 0 && undescribed === 0) return null;
  const total = c.shown + hidden + undescribed;
  const reasons: string[] = [];
  if (hidden > 0) reasons.push(`${hidden} more the panel does not list`);
  if (undescribed > 0) reasons.push(`${undescribed} the validator counted without describing`);
  return `${c.shown} of ${total} mismatches shown — ${reasons.join(", and ")}.`;
}

/** A path longer than this is shown with its middle elided. */
const PATH_SHOWN_WHOLE = 120;
const PATH_ENDS_KEPT = 48;

/**
 * Path as a card or tooltip shows it: whole while it fits, otherwise both ends
 * plus a segment count. The full path stays available where the caller puts it.
 */
export function abbreviatePath(path: string): string {
  if (path.length <= PATH_SHOWN_WHOLE) return path;
  const segments = libSplitPath(path).length;
  const head = path.slice(0, PATH_ENDS_KEPT);
  const tail = path.slice(-PATH_ENDS_KEPT);
  return `${head} … (${segments.toLocaleString("en-US")} segments) … ${tail}`;
}

/**
 * One-line message for an error mark / tooltip. Includes the expected type —
 * editor marks and hex spans have no card to expand.
 */
export function describeDiagnostic(d: CborDiagnostic): string {
  const at = d.path ? ` at ${abbreviatePath(d.path)}` : "";
  const wanted = d.expected ? ` (expected ${d.expected})` : "";
  return `${d.kind}${at}${wanted} — ${d.message}`;
}
