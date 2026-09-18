// Hex-strip chip and banner readings of a validation run.
// The chip is the document-vs-rule finding; the banner is everything that stopped short of a verdict. Same inputs, so they cannot disagree on the case.

import type { CborDecodeError } from "@cardananium/cquisitor-lib";
import {
  cddlErrorReason,
  implementationLimitNote,
  isImplementationLimit,
  type CborDiagnostic,
} from "./cddlError";
import type { CborValidationOutcome } from "./cddlValidatorLib";

export type Verdict =
  /** No run, or an input that did not get as far as one. */
  | { kind: "none" }
  | { kind: "valid"; rule: string }
  /** Document does not match; `count` is everything the run found, which the list may not show whole. */
  | { kind: "mismatches"; count: number; head: CborDiagnostic }
  /** No verdict: the validator threw, or stopped at a bound. */
  | { kind: "refused"; label: string; message: string };

export interface VerdictInput {
  outcome: CborValidationOutcome | null;
  diagnostics: readonly CborDiagnostic[];
  /** Everything the run found, rendered or not. */
  reportedDiagnostics: number;
  /** Root rule the run was against. */
  rule: string;
  decodeError: CborDecodeError | null;
  decoderFailure: string | null;
}

const NONE: Verdict = { kind: "none" };

/**
 * Verdict the chip shows. Undecodable input is `none` (header and banner already say so).
 * A bound reached is a refusal, not a mismatch count: nothing past the bound was examined.
 */
export function verdictFor(i: VerdictInput): Verdict {
  if (!i.outcome || i.decodeError || i.decoderFailure) return NONE;
  if (!i.outcome.ok) return { kind: "refused", label: "validator error", message: i.outcome.error };
  const result = i.outcome.result;
  if (result.valid) return { kind: "valid", rule: i.rule };
  const head = i.diagnostics[0];
  if (!head) {
    return { kind: "refused", label: result.error.kind, message: cddlErrorReason(result.error.message) };
  }
  if (isImplementationLimit(head.kind)) return { kind: "refused", label: head.kind, message: head.message };
  return { kind: "mismatches", count: Math.max(i.reportedDiagnostics, i.diagnostics.length), head };
}

/** Chip label; empty for a verdict that shows no chip. */
export function verdictChipText(v: Verdict): string {
  switch (v.kind) {
    case "valid":
      return `✓ matches ${v.rule}`;
    case "mismatches":
      return `✗ ${v.count} mismatch${v.count === 1 ? "" : "es"}`;
    case "refused":
      return `✗ ${v.label}`;
    default:
      return "";
  }
}

/** Whether the verdict has a list behind it for the chip to open. */
export function isListable(v: Verdict): v is Extract<Verdict, { kind: "mismatches" | "refused" }> {
  return v.kind === "mismatches" || v.kind === "refused";
}

/** What stopped the run short of a verdict, for the banner above the hex. */
export interface HexRefusal {
  kind: string;
  message: string;
  /** Place in the document, when the refusal names a path below the root. */
  path: string | null;
  /** What reaching a bound means, for the kinds that are one. */
  limitNote: string | null;
  /** What the refusal means for the run, when the kind alone does not say. */
  note: string | null;
}

function belowRoot(path: string | null | undefined): string | null {
  return path && path !== "$" ? path : null;
}

/**
 * Refusal the hex banner announces, in stop order: decode error, decoder gave up, validator gave up, undescribed refusal, or a bound as head diagnostic.
 * `null` when the run reached a verdict.
 */
export function hexRefusalFor(
  i: Pick<VerdictInput, "decodeError" | "decoderFailure" | "outcome" | "diagnostics">,
): HexRefusal | null {
  if (i.decodeError) {
    return {
      kind: i.decodeError.kind,
      message: i.decodeError.message,
      path: belowRoot(i.decodeError.path),
      limitNote: implementationLimitNote(i.decodeError.kind),
      note: "The CBOR has to decode before it can be checked against the schema.",
    };
  }
  if (i.decoderFailure) {
    return {
      kind: "decoder failed",
      message: i.decoderFailure,
      path: null,
      limitNote: null,
      note: "The decoder stopped on this input instead of reporting what was wrong with it.",
    };
  }
  const outcome = i.outcome;
  if (!outcome) return null;
  if (!outcome.ok) {
    return {
      kind: "validator error",
      message: outcome.error,
      path: null,
      limitNote: null,
      note: "The validator stopped on this input instead of returning a result.",
    };
  }
  if (outcome.result.valid) return null;
  const head = i.diagnostics[0];
  if (!head) {
    const error = outcome.result.error;
    return {
      kind: error.kind,
      message: cddlErrorReason(error.message),
      path: null,
      limitNote: implementationLimitNote(error.kind),
      note: null,
    };
  }
  if (isImplementationLimit(head.kind)) {
    return {
      kind: head.kind,
      message: head.message,
      path: belowRoot(head.path),
      limitNote: implementationLimitNote(head.kind),
      note: null,
    };
  }
  return null;
}
