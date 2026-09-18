"use client";

// Diagnostic badge and caption as a tree row shows them.
// Shared by the structural CBOR tree and the decoded JSON tree; placements come from the validator.
// Neither component uses hooks: rows are memoised on props.

import type { CborPosition } from "@cardananium/cquisitor-lib";

/** One diagnostic placed on one row. */
export interface TreeDiagnostic {
  /** Index into the run's list of diagnostics. */
  readonly index: number;
  readonly kind: string;
  /** The type the validator wanted, when it named one. */
  readonly expected: string | null;
  readonly message: string;
  /** The CBOR path the run blamed. */
  readonly path: string | null;
  /** `path` shortened for a caption; the whole path stays in `title`. */
  readonly pathLabel: string | null;
  /** Bytes the structural tree keys the row by; `null` if the run named none. */
  readonly position: CborPosition | null;
  /** The one-line description, for the badge's tooltip. */
  readonly title: string;
  /** Placement is on an ancestor because the blamed path has no row. Decoded tree only. */
  readonly held: boolean;
}

/** Placements keyed by `spanAttr(position)` or decoded path. */
export type TreeDiagnosticRows = ReadonlyMap<string, readonly TreeDiagnostic[]>;

export const NO_TREE_DIAGNOSTICS: TreeDiagnosticRows = new Map();

/** The first row carrying diagnostic `index`, with the placement itself. */
export function placementOf(
  rows: TreeDiagnosticRows | null | undefined,
  index: number | null | undefined,
): { key: string; diagnostic: TreeDiagnostic } | null {
  if (!rows || index === null || index === undefined) return null;
  for (const [key, list] of rows) {
    for (const diagnostic of list) {
      if (diagnostic.index === index) return { key, diagnostic };
    }
  }
  return null;
}

/** The entry of `list` that is diagnostic `selected`, if it is there. */
export function selectedIn(
  list: readonly TreeDiagnostic[],
  selected: number | null | undefined,
): TreeDiagnostic | null {
  if (selected === null || selected === undefined) return null;
  return list.find(d => d.index === selected) ?? null;
}

/** Next badge selection: first if none selected, next after selected, then `null` (toggle). */
export function nextSelection(list: readonly TreeDiagnostic[], selected: number | null): number | null {
  if (list.length === 0) return null;
  if (selected === null) return list[0].index;
  const at = list.findIndex(d => d.index === selected);
  if (at < 0) return list[0].index;
  return at + 1 < list.length ? list[at + 1].index : null;
}

export function holdsLabel(n: number): string {
  return `holds ${n} mismatch${n === 1 ? "" : "es"}`;
}

/** Badge label: kind, count, or held-mismatch wording. */
export function badgeText(list: readonly TreeDiagnostic[]): string {
  const own = list.filter(d => !d.held);
  if (own.length === 0) return `⚠ ${holdsLabel(list.length)}`;
  return list.length === 1 ? `✗ ${list[0].kind}` : `✗ ${list.length}`;
}

export function badgeTitle(list: readonly TreeDiagnostic[]): string {
  return list.map(d => d.title).join("\n");
}

/** Accessible name; the visible text may be only a count. */
export function badgeLabel(list: readonly TreeDiagnostic[]): string {
  const own = list.filter(d => !d.held);
  if (own.length === 0) return holdsLabel(list.length);
  if (list.length > 1) return `${list.length} mismatches on this row`;
  const kind = list[0].kind;
  return kind === "mismatch" ? kind : `${kind} mismatch`;
}

export interface DiagnosticBadgeProps {
  diagnostics: readonly TreeDiagnostic[];
  /** The index selected in the run, when it is one of this row's. */
  selected: number | null;
  onSelect?: (index: number | null) => void;
  className: string;
}

/** Flag chip at the end of a row. Click cycles this row's diagnostics, then off. */
export function DiagnosticBadge({ diagnostics, selected, onSelect, className }: DiagnosticBadgeProps) {
  const allHeld = diagnostics.every(d => d.held);
  return (
    <button
      type="button"
      className={allHeld ? `${className} ${className}-holds` : className}
      title={badgeTitle(diagnostics)}
      aria-label={badgeLabel(diagnostics)}
      aria-pressed={selected !== null}
      onClick={e => {
        e.stopPropagation();
        onSelect?.(nextSelection(diagnostics, selected));
      }}
    >
      {badgeText(diagnostics)}
    </button>
  );
}

export interface DiagnosticCaptionProps {
  diagnostic: TreeDiagnostic;
  className: string;
  /** Flash the diagnostic's bytes in the hex view. */
  onRevealBytes?: (position: CborPosition) => void;
}

/** Block under the selected diagnostic: kind, expected type, message, optional bytes link. */
export function DiagnosticCaption({ diagnostic, className, onRevealBytes }: DiagnosticCaptionProps) {
  const { kind, expected, message, pathLabel, position, held } = diagnostic;
  return (
    <div className={className}>
      <div className={`${className}-head`}>
        <span className={`${className}-kind`}>{kind}</span>
        {held && pathLabel ? <> at <code>{pathLabel}</code></> : null}
        {expected ? <> · expected <code>{expected}</code></> : null}
      </div>
      <div className={`${className}-message`}>{message}</div>
      {position && position.length > 0 && onRevealBytes && (
        <button
          type="button"
          className={`${className}-link`}
          onClick={e => {
            e.stopPropagation();
            onRevealBytes(position);
          }}
        >
          show bytes
        </button>
      )}
    </div>
  );
}
