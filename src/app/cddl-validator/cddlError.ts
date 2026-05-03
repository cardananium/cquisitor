import type {
  CborValidationErrorInfo,
  CddlErrorInfo,
  SourceSpan,
} from "@cardananium/cquisitor-lib";

/** [start, end) char range in the CDDL source for a library byte_span. */
export type CddlRange = [number, number];

function spanToRange(span: SourceSpan | undefined | null): CddlRange | null {
  if (!span) return null;
  // `char_offset`/`char_length` are UTF-16 code units — JS-string-friendly.
  // Available on every CDDL-side span as of beta.53.
  const start = span.char_offset;
  const end = span.char_offset + span.char_length;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return [start, end];
}

/**
 * `cddl_symbol_at(cddl, offset)` is the one entry point that still wants a
 * UTF-8 byte offset. We hand-translate from a textarea selectionStart
 * (UTF-16 code units) before calling.
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
 * CDDL parse-error position in source. Uses `char_offset`/`char_length`
 * directly — no text walking needed.
 */
export function cddlParseErrorRange(error: CddlErrorInfo | undefined | null): CddlRange | null {
  return spanToRange(error?.byte_span);
}

/**
 * CDDL line number for a parse error, when present. Used by the error card.
 */
export function cddlParseErrorLine(error: CddlErrorInfo | undefined | null): number | null {
  return error?.byte_span?.line ?? null;
}

/**
 * Mismatch → CDDL source range.
 */
export function cborErrorOnCddlRange(error: CborValidationErrorInfo | undefined | null): CddlRange | null {
  return spanToRange(error?.cddl_byte_span);
}

/** Friendly one-line message for an error card / tooltip. */
export function describeCborError(err: CborValidationErrorInfo): string {
  const expected = err.expected ? `expected ${err.expected}` : err.kind;
  const at = err.path ? ` at ${err.path}` : "";
  return `${expected}${at} — ${err.message}`;
}
