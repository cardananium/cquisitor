// Size ceiling for a single library call.
// Decoder allocation is unbounded and a wasm trap is permanent for that instance.
// Timeouts cannot cover it: the allocation is one synchronous call.

/** Largest input, in UTF-8 bytes, any single library call will accept. */
export const MAX_LIB_INPUT_BYTES = 2 * 1024 * 1024;

/** Max decompressed share-link payload. Higher than the call budget: validator links also carry chain context. */
export const MAX_SHARE_PAYLOAD_BYTES = 8 * 1024 * 1024;

/**
 * UTF-8 length of `text` without allocating an encoded copy.
 * Stops once `text.length` already exceeds `limit` (UTF-8 is never shorter than UTF-16).
 */
export function utf8ByteLength(text: string, limit = Number.POSITIVE_INFINITY): number {
  if (text.length > limit) return text.length;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      // Surrogate pair: one 4-byte code point; skip the low half.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Summed UTF-8 size of string arguments — the only large ones the decoder walks. */
export function argumentByteLength(args: readonly unknown[], limit?: number): number {
  let total = 0;
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    total += utf8ByteLength(arg, limit);
    if (limit !== undefined && total > limit) return total;
  }
  return total;
}

/** Human-readable byte count. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** `null` if `bytes` fits, otherwise a message that names both the size and the limit. */
export function overBudgetMessage(
  bytes: number,
  limit: number,
  subject = "This input",
): string | null {
  if (bytes <= limit) return null;
  return (
    `${subject} is ${formatByteSize(bytes)}, over the ${formatByteSize(limit)} limit. ` +
    `A document that size can exhaust the decoder's memory before it produces ` +
    `anything, so it is refused rather than attempted.`
  );
}
