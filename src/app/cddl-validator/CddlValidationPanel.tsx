"use client";

// Validation-run cards: mismatches, root-rule offers, walk refusals, and thrown calls.
// The mismatch drawer and decoded pane reuse the same refusal card; the toolbar uses the compact root offer.

import { useEffect, useRef, useState } from "react";
import type { CborPosition } from "@cardananium/cquisitor-lib";
import {
  abbreviatePath,
  cddlErrorReason,
  describeDiagnosticCoverage,
  implementationLimitNote,
  isRootMismatch,
  type CborDiagnostic,
} from "./cddlError";
import type { WalkRefusal } from "./cddlValidatorLib";

// Messages include a rendering of the failed value; clamp so large containers do not push the fields off-screen.
const MESSAGE_CLAMP = 400;

function ErrorMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= MESSAGE_CLAMP) {
    return <div className="cddl-error-card-message">{text}</div>;
  }
  return (
    <div className="cddl-error-card-message">
      {expanded ? text : `${text.slice(0, MESSAGE_CLAMP)}…`}{" "}
      <button
        type="button"
        className="cddl-error-more-btn"
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? "show less" : `show all ${text.length} characters`}
      </button>
    </div>
  );
}

function SpanChips({
  spans,
  anchor,
  onReveal,
}: {
  spans: CborPosition[];
  anchor?: boolean;
  onReveal: (span: CborPosition) => void;
}) {
  return (
    <>
      {spans.map((s, i) => (
        <code
          key={`${s.offset}:${s.length}:${i}`}
          className={`cddl-span-chip${anchor ? " cddl-span-chip-anchor" : ""}`}
          onClick={() => onReveal(s)}
          title="Show these bytes in the hex panel"
        >
          {s.offset}..{s.offset + s.length}
        </code>
      ))}
    </>
  );
}

function DiagnosticCard({
  diagnostic,
  index,
  selected,
  onSelect,
  onRevealBytes,
}: {
  diagnostic: CborDiagnostic;
  index: number;
  selected: boolean;
  onSelect: (index: number) => void;
  onRevealBytes: (span: CborPosition) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const d = diagnostic;
  // A bound reached is a stop, not a finding; the message names the bound, this note explains the rest.
  const limitNote = implementationLimitNote(d.kind);
  return (
    <div
      ref={ref}
      className={`cddl-error-card${selected ? " cddl-error-card-current" : ""}`}
      onClick={() => onSelect(index)}
    >
      <div className="cddl-error-card-head">
        <span className="cddl-error-card-kind">{d.kind}</span>
        {d.path && (
          <code className="cddl-error-card-path" title={d.path}>{abbreviatePath(d.path)}</code>
        )}
      </div>
      <ErrorMessage text={d.message} />
      {limitNote && <div className="cddl-error-card-note">{limitNote}</div>}
      {(d.expected || d.byteSpans.length > 0 || d.anchorSpans.length > 0) && (
        <dl className="cddl-error-card-fields">
          {d.expected && (
            <>
              <dt>expected</dt>
              <dd><code>{d.expected}</code></dd>
            </>
          )}
          {d.byteSpans.length > 0 && (
            <>
              <dt>byte spans</dt>
              <dd><SpanChips spans={d.byteSpans} onReveal={onRevealBytes} /></dd>
            </>
          )}
          {d.anchorSpans.length > 0 && (
            <>
              <dt>anchors</dt>
              <dd><SpanChips spans={d.anchorSpans} anchor onReveal={onRevealBytes} /></dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

/** Result of sweeping other roots — see `useRootSuggestions`. */
export interface RootSuggestionsView {
  matches: string[];
  checked: number;
  total: number;
  pending: boolean;
  checkTheRest: () => void;
}

/** Matching roots shown as buttons before the rest are a count. */
const MAX_OFFERED_ROOTS = 5;

/**
 * Note under a root-level mismatch: other rules that accept this CBOR, offered but not applied.
 * `compact` is the same note as one line, for the toolbar beside the current rule.
 */
export function RootSuggestionNote({
  suggestions,
  onRulePick,
  compact = false,
}: {
  suggestions: RootSuggestionsView;
  onRulePick: (rule: string) => void;
  compact?: boolean;
}) {
  const { matches, checked, total, pending, checkTheRest } = suggestions;
  const className = compact ? "cddl-root-suggestion cddl-root-suggestion-compact" : "cddl-root-suggestion";
  const offered = matches.slice(0, MAX_OFFERED_ROOTS);
  const unoffered = matches.length - offered.length;
  let matchesLine = null;
  if (matches.length === 1) {
    matchesLine = (
      <div className="cddl-root-suggestion-line">
        This CBOR matches <code>{matches[0]}</code>.{" "}
        <button
          type="button"
          className="cddl-root-suggestion-switch"
          onClick={() => onRulePick(matches[0])}
        >
          Validate against {matches[0]}
        </button>
      </div>
    );
  } else if (matches.length > 1) {
    matchesLine = (
      <div className="cddl-root-suggestion-line">
        This CBOR matches{" "}
        {offered.map((rule, i) => (
          <span key={rule}>
            {i > 0 && ", "}
            <button
              type="button"
              className="cddl-root-suggestion-btn"
              onClick={() => onRulePick(rule)}
              title={`Validate against ${rule}`}
            >
              <code>{rule}</code>
            </button>
          </span>
        ))}
        {unoffered > 0 && ` and ${unoffered} more`}
        {" — click one to validate against it."}
      </div>
    );
  }
  if (pending) {
    return (
      <div className={className} role="status">
        <div className="cddl-root-suggestion-line">
          Looking for a rule this CBOR matches… ({checked} of {total})
        </div>
        {matchesLine}
      </div>
    );
  }
  const stoppedShort = checked < total;
  return (
    <div className={className}>
      {matchesLine}
      {matches.length === 0 && !stoppedShort && (
        <div className="cddl-root-suggestion-line">
          {total === 0
            ? "No other root rule in this schema accepts this CBOR."
            : `No other root rule in this schema accepts this CBOR (${total} checked).`}
        </div>
      )}
      {stoppedShort && (
        <div className="cddl-root-suggestion-line">
          {matches.length === 0
            ? `None of the ${checked} root rules checked so far accepts this CBOR, of ${total} that could.`
            : `${checked} of ${total} root rules checked so far.`}{" "}
          <button type="button" className="cddl-root-suggestion-switch" onClick={checkTheRest}>
            Check the rest
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Card for a walk the library refused (decode or bridge map), or a validator head error with the same kind+message fields.
 * `walker` names the call when no library kind came back (`call_failed`).
 */
export function WalkRefusalCard({
  refusal,
  walker,
}: {
  refusal: Pick<WalkRefusal, "message"> & { kind: string };
  walker: string;
}) {
  if (refusal.kind === "call_failed") {
    return (
      <div className="cddl-error-card">
        <div className="cddl-error-card-head">
          <span className="cddl-error-card-kind">{walker} failed</span>
        </div>
        <ErrorMessage text={refusal.message} />
        <div className="cddl-error-card-note">
          The {walker} stopped on this input instead of returning a result.
        </div>
      </div>
    );
  }
  const limitNote = implementationLimitNote(refusal.kind);
  return (
    <div className="cddl-error-card">
      <div className="cddl-error-card-head">
        <span className="cddl-error-card-kind">{refusal.kind}</span>
      </div>
      <ErrorMessage text={cddlErrorReason(refusal.message)} />
      {limitNote && <div className="cddl-error-card-note">{limitNote}</div>}
    </div>
  );
}

/** Validator threw instead of answering: the transport's reason. */
export function ValidatorErrorCard({ error }: { error: string }) {
  return (
    <div className="cddl-error-card">
      <div className="cddl-error-card-head">
        <span className="cddl-error-card-kind">validator error</span>
      </div>
      <ErrorMessage text={error} />
      <div className="cddl-error-card-note">
        The validator stopped on this input instead of returning a result.
      </div>
    </div>
  );
}

export interface MismatchListProps {
  diagnostics: CborDiagnostic[];
  /** Described mismatches the list's own cap left out. */
  hiddenDiagnostics: number;
  /** Mismatches the validator counted without describing. */
  undescribedDiagnostics?: number;
  selectedIndex: number | null;
  onSelectDiagnostic: (index: number) => void;
  onRevealBytes: (span: CborPosition) => void;
  /** Other-root sweep, shown only under a head mismatch at `$`. */
  rootSuggestions?: RootSuggestionsView | null;
  /** Switches the root — same path as the toolbar picker. */
  onRulePick?: (rule: string) => void;
}

/**
 * Run mismatches as cards: head first, the rest behind a disclosure, then a coverage note when a cap hid some.
 */
export function MismatchList({
  diagnostics,
  hiddenDiagnostics,
  undescribedDiagnostics = 0,
  selectedIndex,
  onSelectDiagnostic,
  onRevealBytes,
  rootSuggestions = null,
  onRulePick,
}: MismatchListProps) {
  // One piece of state behind `<details open>`. Computing `open` from a toggle that does not write back desynchronises the two.
  const [restOpen, setRestOpen] = useState(() => selectedIndex !== null && selectedIndex > 0);
  // Selecting a mismatch below the head has to reveal it. Compared during render so there is no second pass.
  const [lastSelected, setLastSelected] = useState(selectedIndex);
  if (lastSelected !== selectedIndex) {
    setLastSelected(selectedIndex);
    if (selectedIndex !== null && selectedIndex > 0 && !restOpen) setRestOpen(true);
  }

  if (diagnostics.length === 0) return null;

  const [head, ...rest] = diagnostics;
  const coverage = describeDiagnosticCoverage({
    shown: diagnostics.length,
    hidden: hiddenDiagnostics,
    undescribed: undescribedDiagnostics,
  });

  return (
    <div className="cddl-error-list">
      <DiagnosticCard
        diagnostic={head}
        index={0}
        selected={selectedIndex === 0}
        onSelect={onSelectDiagnostic}
        onRevealBytes={onRevealBytes}
      />
      {/* Only under a refusal of the root item: a deeper mismatch means the root fitted. */}
      {rootSuggestions && onRulePick && isRootMismatch(head) && (
        <RootSuggestionNote suggestions={rootSuggestions} onRulePick={onRulePick} />
      )}
      {rest.length > 0 && (
        <details
          className="cddl-error-more"
          open={restOpen}
          onToggle={e => setRestOpen(e.currentTarget.open)}
        >
          <summary className="cddl-error-more-summary">
            {rest.length} more mismatch{rest.length === 1 ? "" : "es"} in the same run
          </summary>
          <div className="cddl-error-list">
            {rest.map((d, i) => (
              <DiagnosticCard
                key={`${d.kind}:${d.path ?? ""}:${i}`}
                diagnostic={d}
                index={i + 1}
                selected={selectedIndex === i + 1}
                onSelect={onSelectDiagnostic}
                onRevealBytes={onRevealBytes}
              />
            ))}
          </div>
        </details>
      )}
      {coverage && <div className="cddl-error-card-note">{coverage}</div>}
    </div>
  );
}
