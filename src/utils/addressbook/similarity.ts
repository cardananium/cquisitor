// Lookalike detection for addresses and credentials.
//
// An address-poisoning attack grinds a key or a script until its bech32 string
// starts or ends like a string the viewer trusts. Every wallet and explorer
// shortens an address to its two ends, so the attack has to match only those
// ends. The same holds for a credential shown in hex.
//
// The thresholds below are 25 bits for bech32 and 32 bits for hex:
//   * One bech32 character carries 5 bits, so 5 characters carry 25 bits.
//   * The last 6 characters of a bech32 string are its checksum, so a shared
//     tail is a checksum collision. The attacker still only grinds 2^25 for
//     5 characters, because the checksum follows from the rest of the string.
//   * One hex character carries 4 bits, so 8 characters carry 32 bits.
// A false alarm needs the same bits to agree by chance: about 1 in 33 million
// per bech32 comparison. The check therefore reports a run that is cheap to
// grind, and still almost never fires on unrelated strings.

import type { MatchRun } from "./types";

/**
 * Characters of the bech32 data part that the address header fixes.
 *
 * The first data character carries the address type and the network bits, and
 * the second carries the rest of the header byte plus 2 bits of the hash. Every
 * mainnet base address therefore agrees on them, so they are discounted before
 * a leading run counts.
 */
export const HEADER_CHARS = 2;

/** Bech32 characters a run needs, after the header discount. */
export const MIN_RUN = 5;

/** Hex characters a credential run needs. */
export const MIN_HEX_RUN = 8;

export function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

export function commonSuffixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Index of the bech32 separator, or -1 when the string carries none.
 * The data part excludes `1`, so the last `1` separates it from the prefix.
 */
export function bech32SeparatorIndex(value: string): number {
  return value.lastIndexOf("1");
}

/** Two runs cannot claim the same characters; shorten the tail until they do not. */
function clampRuns(prefix: number, suffix: number, shortest: number): MatchRun {
  const tail = Math.max(0, Math.min(suffix, shortest - prefix));
  return { prefix, suffix: tail };
}

/**
 * Non-null when two different bech32 strings start or end alike.
 *
 * The runs are counted on the whole strings, so a caller can mark the matching
 * characters it shows. Strings with unequal prefixes (a different network, or
 * an address against a reward account) are never compared: the shown prefix
 * already tells them apart.
 */
export function addressLookalike(a: string, b: string): MatchRun | null {
  if (!a || !b || a === b) return null;
  const sep = bech32SeparatorIndex(a);
  if (sep < 1 || sep !== bech32SeparatorIndex(b)) return null;
  const hrpLength = sep + 1;
  if (a.slice(0, hrpLength) !== b.slice(0, hrpLength)) return null;

  const dataA = a.slice(hrpLength);
  const dataB = b.slice(hrpLength);
  const shortest = Math.min(dataA.length, dataB.length);
  const runs = clampRuns(
    commonPrefixLength(dataA, dataB),
    commonSuffixLength(dataA, dataB),
    shortest,
  );
  const informative = Math.max(0, runs.prefix - HEADER_CHARS);
  if (informative < MIN_RUN && runs.suffix < MIN_RUN) return null;
  return { prefix: runs.prefix > 0 ? hrpLength + runs.prefix : 0, suffix: runs.suffix };
}

/** Non-null when two different hex strings start or end alike. */
export function hexLookalike(a: string, b: string): MatchRun | null {
  if (!a || !b || a === b) return null;
  const runs = clampRuns(
    commonPrefixLength(a, b),
    commonSuffixLength(a, b),
    Math.min(a.length, b.length),
  );
  if (runs.prefix < MIN_HEX_RUN && runs.suffix < MIN_HEX_RUN) return null;
  return runs;
}

/**
 * Bucket key for the leading characters of an address, or null when the string
 * is too short to key. Two addresses share the key exactly when they agree on
 * the prefix, the header, and the first `MIN_RUN` informative characters, so a
 * bucket hit is the candidate filter that `addressLookalike` then confirms.
 */
export function addressPrefixKey(address: string): string | null {
  const sep = bech32SeparatorIndex(address);
  if (sep < 1) return null;
  const end = sep + 1 + HEADER_CHARS + MIN_RUN;
  if (address.length < end) return null;
  return address.slice(0, end);
}

/** Bucket key for the trailing characters of an address. */
export function addressSuffixKey(address: string): string | null {
  const sep = bech32SeparatorIndex(address);
  if (sep < 1 || address.length - sep - 1 < MIN_RUN) return null;
  return address.slice(-MIN_RUN);
}

export function hexPrefixKey(hex: string): string | null {
  return hex.length >= MIN_HEX_RUN ? hex.slice(0, MIN_HEX_RUN) : null;
}

export function hexSuffixKey(hex: string): string | null {
  return hex.length >= MIN_HEX_RUN ? hex.slice(-MIN_HEX_RUN) : null;
}

/**
 * How strong a run is, for choosing between two lookalikes. An address run
 * counts from the first informative character, so the prefix and the header
 * are discounted; `compared` is either of the two addresses the run came from.
 */
export function runScore(run: MatchRun, compared: string, field: "address" | "cred"): number {
  const discount =
    field === "address" ? bech32SeparatorIndex(compared) + 1 + HEADER_CHARS : 0;
  return Math.max(Math.max(0, run.prefix - discount), run.suffix);
}
