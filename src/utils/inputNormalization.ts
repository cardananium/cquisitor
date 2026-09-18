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

// Heuristic base64 check that intentionally rejects pure-hex input so we don't
// mis-route hex through a base64 decode. Caller must pass whitespace-stripped
// input. Differs from the strict isValidBase64 above, which considers plain hex
// (e.g. "deadbeef") a valid base64 string.
export function looksLikeBase64(input: string): boolean {
  if (input.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+=*$/.test(input)) return false;
  if (!/[g-zG-Z+/=]/.test(input)) return false;
  try {
    atob(input);
    return true;
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
