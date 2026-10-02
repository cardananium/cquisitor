// Library failures that are the tool's own limits, not findings about the
// data: nesting past a decoder's supported depth, or a host stack that ran
// out. Panels word them as "not examined" so a refusal never reads as a
// verdict on the input.

import { isStackOverflow, libErrorMessage } from "@cardananium/cquisitor-lib";

/** Leads every sentence for input left unexamined on an implementation limit. */
export const NOT_EXAMINED_PREFIX = "Not examined:";

/** Trails every such sentence. */
export const IMPLEMENTATION_LIMIT_NOTE = "This is an implementation limit of the tool, not a finding about the data.";

const NESTING_REFUSAL =
  /CBOR nesting is deeper than the supported limit of ([\d,]+) levels( for [^.;)]+)?(; native scripts do not count toward it and may nest up to ([\d,]+) levels)?/;
const STACK_OVERFLOW = /Maximum call stack size exceeded|too much recursion|RangeError/;

/** A nesting refusal's parts: its bound, the decoder it names, and the native-script bound it exempts. */
export interface NestingRefusal {
  limit: number;
  decoder: string | null;
  /** Set when native scripts do not count toward `limit`: the depth they may nest to. */
  nativeScriptLimit: number | null;
}

/** The limit a nesting refusal names, the decoder it names, and any native-script exemption; `null` for any other failure. */
export function nestingRefusalOf(message: string): NestingRefusal | null {
  const match = NESTING_REFUSAL.exec(message);
  if (!match) return null;
  return {
    limit: Number(match[1].replace(/,/g, "")),
    decoder: match[2]?.trim() ?? null,
    nativeScriptLimit: match[4] ? Number(match[4].replace(/,/g, "")) : null,
  };
}

/** True when `message` states an implementation limit rather than a finding. */
export function isImplementationLimitMessage(message: string): boolean {
  return message.startsWith(NOT_EXAMINED_PREFIX) || nestingRefusalOf(message) !== null || STACK_OVERFLOW.test(message);
}

/**
 * The sentence a panel shows for a failed library call. A refusal on nesting
 * depth or a stack overflow reads "Not examined: … implementation limit";
 * every other failure keeps the library's own sentence.
 */
export function limitAwareErrorMessage(error: unknown): string {
  const message = libErrorMessage(error);
  const nesting = nestingRefusalOf(message);
  if (nesting) {
    const what = nesting.decoder ? ` ${nesting.decoder}` : "";
    const exemption = nesting.nativeScriptLimit !== null
      ? ` (native scripts do not count toward it and may nest up to ${nesting.nativeScriptLimit.toLocaleString("en-US")} levels)`
      : "";
    return `${NOT_EXAMINED_PREFIX} the input nests deeper than the supported limit of `
      + `${nesting.limit.toLocaleString("en-US")} levels${what}${exemption}. ${IMPLEMENTATION_LIMIT_NOTE}`;
  }
  if (isStackOverflow(error) || STACK_OVERFLOW.test(message)) {
    return `${NOT_EXAMINED_PREFIX} the library ran out of stack reading this input, most likely `
      + `because it nests too deep. ${IMPLEMENTATION_LIMIT_NOTE}`;
  }
  return message;
}
