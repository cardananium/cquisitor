"use client";

// Mismatch list as a sheet along the bottom of the workspace.
// Opened from the hex-strip verdict chip; panels underneath stay usable.

import { useEffect } from "react";
import type { CborValidationOutcome } from "./cddlValidatorLib";
import {
  MismatchList,
  ValidatorErrorCard,
  WalkRefusalCard,
  type MismatchListProps,
} from "./CddlValidationPanel";
import type { Verdict } from "./verdict";

export interface MismatchDrawerProps extends MismatchListProps {
  verdict: Extract<Verdict, { kind: "mismatches" | "refused" }>;
  outcome: CborValidationOutcome | null;
  onClose: () => void;
}

/**
 * True when this keydown should close the sheet: Escape, unless something else already used it.
 * Pin menu and rule-picker list call preventDefault; the schema editor does not, so Escape from a textarea still closes.
 */
export function escapeCloses(e: Pick<KeyboardEvent, "key" | "defaultPrevented">): boolean {
  return e.key === "Escape" && !e.defaultPrevented;
}

export default function MismatchDrawer({
  verdict,
  outcome,
  onClose,
  ...list
}: MismatchDrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (escapeCloses(e)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = verdict.kind === "mismatches"
    ? `${verdict.count} mismatch${verdict.count === 1 ? "" : "es"}`
    : verdict.label;

  let body;
  if (outcome && !outcome.ok) {
    body = <ValidatorErrorCard error={outcome.error} />;
  } else if (list.diagnostics.length === 0 && outcome?.ok && !outcome.result.valid) {
    body = <WalkRefusalCard refusal={outcome.result.error} walker="validator" />;
  } else {
    // Head bound-reached diagnostic is a card in the list, with any siblings.
    body = <MismatchList {...list} />;
  }

  return (
    <section
      id="cq-mismatch-drawer"
      className="cq-mismatch-drawer"
      role="region"
      aria-label={title}
    >
      <div className="cq-mismatch-drawer-head">
        <span className="cq-mismatch-drawer-title">{title}</span>
        <button
          type="button"
          className="cq-mismatch-drawer-close"
          onClick={onClose}
          title="Close the mismatch list"
          aria-label="Close the mismatch list"
        >✕</button>
      </div>
      <div className="cq-mismatch-drawer-body">{body}</div>
    </section>
  );
}
