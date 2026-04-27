import type {
  CborDecodeError,
  CborDecodeErrorKind,
} from "@cardananium/cquisitor-lib";

/**
 * UI-friendly projection of a cquisitor-lib CBOR decode error. Derived directly
 * from the structured `CborDecodeError` returned by `cbor_to_json` in
 * beta.47+; no string parsing involved.
 */
export interface CborErrorLocation {
  /** Byte offset (0-indexed) where decoding failed. */
  offset: number;
  /** How many bytes the failure covers (1 when the library only pinned an offset). */
  length: number;
  /** Error kind enum from the library — use for branching, not the message. */
  kind: CborDecodeErrorKind;
  /** Human-readable message from the library. */
  message: string;
  /** Semantic path into the decoded tree (e.g. `$.entries[1].value[0]`). */
  path: string;
}

/**
 * Converts a `CborDecodeError` into something the hex view can highlight.
 * Returns null for errors without a byte position (rare IO fallbacks,
 * hex-syntax errors that don't carry an offset).
 */
export function cborErrorToLocation(
  error: CborDecodeError,
  hexByteLength: number,
): CborErrorLocation | null {
  const base = { kind: error.kind, message: error.message, path: error.path };

  if (error.byte_span) {
    const offset = clampOffset(error.byte_span.offset, hexByteLength);
    const maxLen = Math.max(1, hexByteLength - offset);
    const length = Math.max(1, Math.min(error.byte_span.length, maxLen));
    return { ...base, offset, length };
  }

  if (typeof error.offset === "number") {
    return { ...base, offset: clampOffset(error.offset, hexByteLength), length: 1 };
  }

  return null;
}

function clampOffset(offset: number, hexByteLength: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  if (hexByteLength <= 0) return 0;
  return Math.min(offset, hexByteLength - 1);
}
