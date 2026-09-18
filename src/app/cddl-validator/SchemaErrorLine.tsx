"use client";

// Schema-error line under the editor toolbar: kind, parser reason, jump-to-span.
// Unresolved names get a second row of chips (one per name, every use site) instead of a single moving error.

import type { CddlValidationResult } from "@cardananium/cquisitor-lib";
import {
  cddlErrorReason,
  groupUnresolvedNames,
  hasCddlSpan,
  schemaErrorGuidance,
  type CddlRange,
  type CddlUnresolvedName,
} from "./cddlError";

export interface SchemaErrorLineProps {
  /** Schema check result — `null` when the checker itself gave up. */
  result: CddlValidationResult | null;
  /** Why the checker gave up, when `result` is null for that. */
  checkerFailure: string | null;
  errorLine: number | null;
  /** Names the schema uses without defining. Empty for every other kind of schema error. */
  unresolvedNames: CddlUnresolvedName[];
  /** True while the schema has been edited since the check that produced these positions. Buttons stop offering to jump. */
  rangesAreStale: boolean;
  onRevealError: () => void;
  /** Scrolls the editor to one occurrence of an undefined name. */
  onRevealRange: (range: CddlRange) => void;
}

const STALE_TITLE = "The schema has been edited since this check ran";
const CHECKER_FAILED_NOTE = "The checker stopped on this schema instead of reporting a parse error in it.";

export default function SchemaErrorLine({
  result,
  checkerFailure,
  errorLine,
  unresolvedNames,
  rangesAreStale,
  onRevealError,
  onRevealRange,
}: SchemaErrorLineProps) {
  // Polite live region: rewriting this on every settled pass must not interrupt typing.
  if (checkerFailure) {
    return (
      <div className="cq-schema-error" role="status">
        <span className="cq-schema-error-kind" title={CHECKER_FAILED_NOTE}>schema checker failed</span>
        <span className="cq-schema-error-reason" title={checkerFailure}>{checkerFailure}</span>
        <div className="cq-schema-error-advice">{CHECKER_FAILED_NOTE}</div>
      </div>
    );
  }
  if (!result || result.valid) return null;

  const error = result.error;
  const groups = groupUnresolvedNames(unresolvedNames);
  const guidance = schemaErrorGuidance(error.kind, {
    names: groups.length,
    occurrences: unresolvedNames.length,
    truncated: error.truncated === true,
  });
  const reason = cddlErrorReason(error.message);
  const advice = guidance.summary ? `${guidance.summary} ${guidance.nextStep}` : guidance.nextStep;
  // No jump button for a whole-document failure (no position) or unresolved names (chips below already jump).
  const line = hasCddlSpan(error.byte_span) && error.kind !== "unresolved_references"
    ? errorLine ?? error.byte_span.line
    : null;

  return (
    <div className="cq-schema-error" role="status">
      <span className="cq-schema-error-kind" title={advice}>
        {error.kind}
      </span>
      <span className="cq-schema-error-reason" title={reason}>{reason}</span>
      {line !== null && (
        <button
          type="button"
          className="cq-schema-error-line"
          onClick={onRevealError}
          disabled={rangesAreStale}
          title={rangesAreStale ? STALE_TITLE : "Show this error in the editor"}
        >
          line {line}
        </button>
      )}
      <div className="cq-schema-error-advice">{advice}</div>
      {groups.length > 0 && (
        <div className="cq-schema-error-todo">
          {groups.map(g => (
            <span key={g.name} className="cq-schema-error-chip">
              Define <code>{g.name}</code>{" "}
              {g.occurrences.map((u, i) => (
                <span key={`${u.range[0]}:${u.range[1]}`}>
                  {i > 0 && " "}
                  <button
                    type="button"
                    className="cq-schema-error-chip-line"
                    onClick={() => onRevealRange(u.range)}
                    disabled={rangesAreStale}
                    title={rangesAreStale ? STALE_TITLE : `Show ${g.name} on line ${u.line}`}
                  >
                    line {u.line}
                  </button>
                </span>
              ))}
            </span>
          ))}
          {error.truncated && (
            <span className="cq-schema-error-chip-more">… the list is not all of them</span>
          )}
        </div>
      )}
    </div>
  );
}
