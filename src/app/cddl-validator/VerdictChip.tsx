"use client";

// Hex-strip verdict: a match note, or a red button that opens the mismatch list.

import type { Ref } from "react";
import { describeDiagnostic } from "./cddlError";
import { verdictChipText, type Verdict } from "./verdict";

export interface VerdictChipProps {
  verdict: Verdict;
  /** Whether the list the chip opens is showing. */
  open: boolean;
  onToggle: () => void;
  /** Button ref so the host can restore focus when the list closes. */
  buttonRef?: Ref<HTMLButtonElement>;
}

export default function VerdictChip({ verdict, open, onToggle, buttonRef }: VerdictChipProps) {
  if (verdict.kind === "none") return null;
  if (verdict.kind === "valid") {
    return (
      <span
        className="cq-verdict cq-verdict-valid"
        role="status"
        aria-label={`CBOR matches ${verdict.rule}`}
        title={`This CBOR matches ${verdict.rule}`}
      >
        ✓ matches <code>{verdict.rule}</code>
      </span>
    );
  }
  const what = verdict.kind === "mismatches"
    ? `${verdict.count} mismatch${verdict.count === 1 ? "" : "es"}`
    : verdict.label;
  return (
    <button
      type="button"
      ref={buttonRef}
      className="cq-verdict cq-verdict-invalid"
      aria-expanded={open}
      aria-controls={open ? "cq-mismatch-drawer" : undefined}
      /* Tooltip is the error; the label says what clicking does. */
      title={verdict.kind === "mismatches" ? describeDiagnostic(verdict.head) : verdict.message}
      aria-label={`${what} — ${open ? "hide" : "show"} the list`}
      onClick={onToggle}
    >
      {verdictChipText(verdict)}
    </button>
  );
}
