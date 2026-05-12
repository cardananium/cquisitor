// Helpers for normalizing pasted hex / base64 blobs. Pastes commonly arrive
// wrapped across multiple lines (column-formatted dumps, trailing carriage
// returns, PEM-style 64-char-per-line base64). Neither encoding includes
// meaningful internal whitespace, so we strip it before validating.

export function stripWhitespace(input: string): string {
  return input.replace(/\s+/g, "");
}

// Caller should pass whitespace-stripped input.
export function isValidHex(input: string): boolean {
  if (input.length === 0) return false;
  return /^[0-9a-fA-F]+$/.test(input);
}

// Strict base64 check: format, length-mod-4, and round-trip equality.
// Caller should pass whitespace-stripped input.
export function isValidBase64(input: string): boolean {
  if (input.length === 0) return false;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input)) return false;
  if (input.length % 4 !== 0) return false;
  try {
    const decoded = Buffer.from(input, "base64");
    return decoded.length > 0 && Buffer.from(decoded).toString("base64") === input;
  } catch {
    return false;
  }
}

export function base64ToHex(input: string): string {
  return Buffer.from(input, "base64").toString("hex");
}

// Normalize a pasted hex/base64 blob into hex. Unrecognized input is
// returned stripped so the downstream parser produces a sensible error.
export function normalizeHexOrBase64(input: string): { hex: string; wasBase64: boolean } {
  const normalized = stripWhitespace(input);
  if (isValidHex(normalized)) return { hex: normalized, wasBase64: false };
  if (isValidBase64(normalized)) return { hex: base64ToHex(normalized), wasBase64: true };
  return { hex: normalized, wasBase64: false };
}
