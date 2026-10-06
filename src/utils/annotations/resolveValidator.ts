// Transaction-validator targets: `tx_path` against the decoded transaction,
// `diagnostic` against the diagnostics list, `redeemer` against the Plutus rows.

import type { AnnotationStatus, CquisitorAnnotation } from "./store";
import { buildMarks, notShownHere, resolvedStatus, type AnnotationMark } from "./marks";

/** The parts of a validation result the targets name. */
export interface ValidatorResultLike {
  errors: ReadonlyArray<{ error?: unknown }>;
  phase2_errors: ReadonlyArray<{ error?: unknown }>;
  warnings: ReadonlyArray<{ warning?: unknown }>;
  phase2_warnings: ReadonlyArray<{ warning?: unknown }>;
  eval_redeemer_results: ReadonlyArray<{ tag: string; index: number | bigint }>;
}

export interface ValidatorResolveInput {
  /** The decoded transaction (`{ transaction_hash, transaction }`), or null. */
  decoded: unknown;
  /** True while there is input that has not decoded yet. */
  decoding: boolean;
  result: ValidatorResultLike | null;
  /** True while a validation run is in flight. */
  validating: boolean;
}

export type ValidatorResolution =
  | { kind: "tx_path"; status: AnnotationStatus; path: string | null }
  | { kind: "diagnostic"; status: AnnotationStatus; diagnosticIndex: number | null }
  | { kind: "redeemer"; status: AnnotationStatus; rowIndex: number | null }
  | { kind: "other"; status: AnnotationStatus };

/**
 * A validator location as the decoded-transaction views spell it: plutus data sits under `elems`
 * (`witness_set.plutus_data.0` → `witness_set.plutus_data.elems.0`), the votes of a voter under `votes`
 * (`body.voting_procedures.0.1` → `body.voting_procedures.0.votes.1`), and input lists under `body`
 * (the validator's `transaction.inputs.0` → `transaction.body.inputs.0`).
 */
export function txViewPath(path: string): string {
  path = path.replace(/^transaction\.(inputs|reference_inputs)\./, "transaction.body.$1.");
  path = path.replace(/^(transaction\.body\.voting_procedures\.\d+)\.(\d+)(?=\.|$)/, "$1.votes.$2");
  return path.replace(/^(transaction\.witness_set\.plutus_data)\.(\d+)(?=\.|$)/, "$1.elems.$2");
}

/** The decoded transaction keeps withdrawals in an object keyed by reward account; the views and the validator number them. */
const WITHDRAWALS_PATH = "transaction.body.withdrawals";

/** Whether a dotted path names a value inside `root`. */
export function txPathExists(root: unknown, path: string): boolean {
  if (!path) return false;
  let at: unknown = root;
  let walked = "";
  for (const segment of path.split(".")) {
    if (at === null || typeof at !== "object") return false;
    if (Array.isArray(at)) {
      if (!/^\d+$/.test(segment)) return false;
      const i = Number(segment);
      if (i >= at.length) return false;
      at = at[i];
    } else if (walked === WITHDRAWALS_PATH && /^\d+$/.test(segment)) {
      const keys = Object.keys(at);
      if (Number(segment) >= keys.length) return false;
      at = (at as Record<string, unknown>)[keys[Number(segment)]];
    } else {
      if (!Object.prototype.hasOwnProperty.call(at, segment)) return false;
      at = (at as Record<string, unknown>)[segment];
    }
    walked = walked ? `${walked}.${segment}` : segment;
  }
  return true;
}

/** Whether `ancestor` is `path` or a dotted prefix of it. */
export function isTxPathPrefix(ancestor: string, path: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}.`);
}

/** The variant name of a ledger error / warning: its single key, or the string itself. */
export function diagnosticTypeOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1) return keys[0];
  }
  return null;
}

/** Variant names in diagnostics-list order: phase-1 errors, phase-2 errors, phase-1 warnings, phase-2 warnings. */
export function diagnosticNames(result: ValidatorResultLike): (string | null)[] {
  return [
    ...result.errors.map((e) => diagnosticTypeOf(e.error)),
    ...result.phase2_errors.map((e) => diagnosticTypeOf(e.error)),
    ...result.warnings.map((w) => diagnosticTypeOf(w.warning)),
    ...result.phase2_warnings.map((w) => diagnosticTypeOf(w.warning)),
  ];
}

function waitingForValidation(validating: boolean): AnnotationStatus {
  return {
    state: "waiting",
    note: validating
      ? "Validating…"
      : "Waiting for validation — this link carries no context, so run Validate to resolve it.",
  };
}

export function resolveValidatorAnnotations(
  annotations: readonly CquisitorAnnotation[],
  input: ValidatorResolveInput,
): ValidatorResolution[] {
  const names = input.result ? diagnosticNames(input.result) : [];
  return annotations.map(({ target }): ValidatorResolution => {
    switch (target.kind) {
      case "tx_path": {
        if (!input.decoded) {
          return {
            kind: "tx_path",
            path: null,
            status: input.decoding
              ? { state: "waiting", note: "Waiting for the transaction to decode." }
              : { state: "waiting", note: "Paste a transaction to resolve this path." },
          };
        }
        const path = txViewPath(target.path);
        return txPathExists(input.decoded, path)
          ? { kind: "tx_path", path, status: resolvedStatus() }
          : {
              kind: "tx_path",
              path: null,
              status: { state: "not_found", note: `${target.path} is not in this transaction.` },
            };
      }
      case "diagnostic": {
        if (!input.result) {
          return { kind: "diagnostic", diagnosticIndex: null, status: waitingForValidation(input.validating) };
        }
        let index: number | null = null;
        if ("index" in target) {
          index = target.index < names.length ? target.index : null;
        } else {
          const wanted = target.occurrence ?? 0;
          let seen = 0;
          for (let i = 0; i < names.length; i++) {
            if (names[i] !== target.name) continue;
            if (seen === wanted) {
              index = i;
              break;
            }
            seen++;
          }
        }
        return index === null
          ? {
              kind: "diagnostic",
              diagnosticIndex: null,
              status: { state: "not_found", note: "The validation result has no such diagnostic." },
            }
          : { kind: "diagnostic", diagnosticIndex: index, status: resolvedStatus() };
      }
      case "redeemer": {
        if (!input.result) {
          return { kind: "redeemer", rowIndex: null, status: waitingForValidation(input.validating) };
        }
        const tag = target.tag.toLowerCase();
        const row = input.result.eval_redeemer_results.findIndex(
          (r) => String(r.tag).toLowerCase() === tag && Number(r.index) === target.index,
        );
        return row < 0
          ? {
              kind: "redeemer",
              rowIndex: null,
              status: { state: "not_found", note: `No Plutus result for ${target.tag}[${target.index}].` },
            }
          : { kind: "redeemer", rowIndex: row, status: resolvedStatus() };
      }
      default:
        return { kind: "other", status: notShownHere() };
    }
  });
}

export interface ValidatorMarks {
  /** By view path (`txViewPath`). */
  txPaths: Map<string, AnnotationMark>;
  /** By diagnostics-list index. */
  diagnostics: Map<number, AnnotationMark>;
  /** By Plutus results row. */
  redeemers: Map<number, AnnotationMark>;
}

export function validatorMarks(
  resolutions: readonly ValidatorResolution[],
  annotations: readonly CquisitorAnnotation[],
  focus: number,
): ValidatorMarks {
  const paths: Array<{ key: string; index: number }> = [];
  const diags: Array<{ key: number; index: number }> = [];
  const rows: Array<{ key: number; index: number }> = [];
  resolutions.forEach((r, index) => {
    if (r.kind === "tx_path" && r.path !== null) paths.push({ key: r.path, index });
    else if (r.kind === "diagnostic" && r.diagnosticIndex !== null) diags.push({ key: r.diagnosticIndex, index });
    else if (r.kind === "redeemer" && r.rowIndex !== null) rows.push({ key: r.rowIndex, index });
  });
  return {
    txPaths: buildMarks(paths, annotations, focus),
    diagnostics: buildMarks(diags, annotations, focus),
    redeemers: buildMarks(rows, annotations, focus),
  };
}

/** The element showing `path`: the one whose `data-tx-path` is the longest prefix of it. */
export function closestTxPathElement(candidates: ArrayLike<Element>, path: string): Element | null {
  let best: Element | null = null;
  let bestLength = -1;
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    const own = el.getAttribute("data-tx-path");
    if (!own || !isTxPathPrefix(own, path) || own.length <= bestLength) continue;
    best = el;
    bestLength = own.length;
  }
  return best;
}
