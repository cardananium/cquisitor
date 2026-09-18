// Hooks that drive the CDDL validator.
// Wasm lives in a worker, so each hook is a pure projection of one settled
// pass plus async plumbing that keeps the previous value while the next runs.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  CborCddlMap,
  CborDecodeError,
  CborPartialValue,
  CborValue,
  CddlOutlineEntry,
  CddlValidationResult,
  CborPosition,
  CddlReferencesResult,
  CddlSymbolAtResult,
} from "@cardananium/cquisitor-lib";
import type { CborErrorLocation } from "@/utils/cborError";
import { cborErrorToLocation } from "@/utils/cborError";
import { base64ToHex, looksLikeBase64, stripWhitespace } from "@/utils/inputNormalization";
import { isLibAbortedError, type LibCallOptions } from "@/lib/cquisitorWorker";
import {
  safeCborToJson,
  safeDecodeCborAgainstCddl,
  safeMapCborToCddl,
  safeOutline,
  safeReferences,
  safeSymbolAt,
  safeValidateCborAgainstCddl,
  safeValidateCddl,
  type CborCddlMapOutcome,
  type CborToJsonOutcome,
  type CborValidationOutcome,
  type CddlSchemaOutcome,
  type DecodedAgainstSchema,
  type WalkRefusal,
} from "./cddlValidatorLib";
import {
  cborDiagnostics,
  cborDiagnosticsTruncated,
  cddlErrorRanges,
  cddlParseErrorLine,
  cddlParseErrorRange,
  cddlUnresolvedNames,
  utf16ToByte,
  type CborDiagnostic,
  type CddlRange,
  type CddlUnresolvedName,
} from "./cddlError";
import {
  createCborCddlBridge,
  EMPTY_CBOR_CDDL_MAP,
  type CborCddlBridge,
  type EntryRole,
} from "./cborCddlBridge";
import type { HoverLink, HoverLinkStore } from "./hoverLink";
import { EMPTY_PATHS, EMPTY_POSITIONS } from "./instances";
import {
  declaredRuleNames,
  retainOutline,
  rootRuleNames,
  type OutlineSnapshot,
} from "./ruleSelection";

/** A debounced view of `value` — re-emits `delayMs` after the last change. */
export function useDebouncedString(value: string, delayMs: number): string {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setOut(value), delayMs);
    return () => clearTimeout(h);
  }, [value, delayMs]);
  return out;
}

/** Schema debounce in ms; grows with text length, capped at 600. */
export function settleDelayFor(text: string): number {
  return Math.min(600, 200 + Math.floor(text.length / 50));
}

/** Same idea for arbitrary state. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setOut(value), delayMs);
    return () => clearTimeout(h);
  }, [value, delayMs]);
  return out;
}

// ---------- one asynchronous library pass ----------

export interface LibResource<T> {
  /** Last settled value; kept while the next pass runs. */
  value: T;
  /** True until the current input has a settled value. */
  pending: boolean;
  /** True after the pass has been in flight long enough to report. */
  slow: boolean;
}

interface ResourceState<I, T> {
  /** Input the value was produced for; `null` before the first pass. */
  input: I | null;
  value: T;
}

/**
 * Runs `run` once per `input` and keeps the last value.
 * `input` is compared by identity; a rejected `run` settles on `initial`.
 */
export function useLibResource<I extends object, T>(
  input: I,
  run: (input: I, options: LibCallOptions) => Promise<T>,
  initial: T,
): LibResource<T> {
  const runRef = useRef(run);
  // Captured once: reading `initial` from the closure would retie the pass
  // to an inline identity.
  const initialRef = useRef(initial);
  // Assigned before the input effect so a new pass sees the current `run`.
  useEffect(() => {
    runRef.current = run;
  });

  const [state, setState] = useState<ResourceState<I, T>>(() => ({
    input: null,
    value: initial,
  }));
  const [slowInput, setSlowInput] = useState<I | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    runRef.current(input, {
      signal: controller.signal,
      onSlow: () => {
        if (!cancelled) setSlowInput(input);
      },
    }).then(
      value => {
        if (!cancelled) setState({ input, value });
      },
      error => {
        // Cleanup already set `cancelled`; this abort is that cleanup.
        if (cancelled || isLibAbortedError(error)) return;
        setState({ input, value: initialRef.current });
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [input]);

  const settled = state.input === input;
  return {
    value: state.value,
    pending: !settled,
    slow: !settled && slowInput === input,
  };
}

// ---------- CBOR decoding ----------

export interface UseCborDecodedResult {
  /** Whole-byte hex; empty when the input is not. */
  cleanHex: string;
  /** Structural CBOR; `partial` on parse failure, `null` if no input. */
  decoded: CborValue | CborPartialValue | null;
  /** `null` while decode succeeds. */
  decodeError: CborDecodeError | null;
  /** Decode error as a hex-view location, if it has a position. */
  errorLocation: CborErrorLocation | null;
  /** Set when the decoder gave up instead of reporting a decode error. */
  decoderFailure: string | null;
  /** Set when the input was read as base64 rather than hex. */
  notification: string | null;
  /** True while these fields still describe the previous input. */
  pending: boolean;
  /** True after the pass has been in flight long enough to report. */
  slow: boolean;
}

/** Strip whitespace, accept base64, lowercase hex — same as General CBOR. */
export function normalizeCborInput(rawInput: string): { hex: string; wasBase64: boolean } {
  const stripped = stripWhitespace(rawInput);
  if (!stripped) return { hex: "", wasBase64: false };
  if (looksLikeBase64(stripped)) return { hex: base64ToHex(stripped).toLowerCase(), wasBase64: true };
  return { hex: stripped.toLowerCase(), wasBase64: false };
}

/** `hex` if it is whole bytes; otherwise empty. Downstream works in bytes. */
export function wholeByteHex(hex: string): string {
  return /^[0-9a-f]+$/.test(hex) && hex.length % 2 === 0 ? hex : "";
}

/** What a share link can carry from the CBOR pane, and what it cannot. */
export interface ShareCborState {
  /** Hex for the link; empty when the pane holds nothing usable. */
  hex: string;
  /** Why CBOR is omitted from the link; `null` when it is included. */
  dropped: string | null;
}

const SHARE_DROP_TAIL =
  "A link carries CBOR as bytes, so none of it goes in: this link restores the schema and rule only.";

/** Share-link CBOR from live pane text, not the debounced pass. */
export function shareCborState(rawInput: string): ShareCborState {
  const { hex } = normalizeCborInput(rawInput);
  const whole = wholeByteHex(hex);
  if (whole || !hex) return { hex: whole, dropped: null };
  if (/^[0-9a-f]+$/.test(hex)) {
    return {
      hex: "",
      dropped: `The CBOR pane holds ${hex.length} hex digits — not a whole number of bytes. ${SHARE_DROP_TAIL}`,
    };
  }
  return {
    hex: "",
    dropped: `The CBOR pane holds ${hex.length} characters that are neither hex nor base64. ${SHARE_DROP_TAIL}`,
  };
}

/** One settled decode; input and outcome travel together so they cannot be paired across documents. */
export interface CborDecodePass {
  normalised: { hex: string; wasBase64: boolean };
  outcome: CborToJsonOutcome | null;
}

const EMPTY_CBOR_PASS: CborDecodePass = {
  normalised: { hex: "", wasBase64: false },
  outcome: null,
};

/**
 * Panel view of one settled decode.
 * On a structural error the partial tree is kept.
 */
export function cborDecodedView(
  pass: CborDecodePass,
): Omit<UseCborDecodedResult, "pending" | "slow"> {
  const { hex, wasBase64 } = pass.normalised;
  const notification = wasBase64 ? "Base64 → hex" : null;
  const empty = {
    cleanHex: "",
    decoded: null,
    decodeError: null,
    errorLocation: null,
    decoderFailure: null,
    notification: null,
  };
  if (!hex) return empty;
  // Half-byte input becomes empty `cleanHex`; the decode error explains it.
  const cleanHex = wholeByteHex(hex);
  const outcome = pass.outcome;
  if (!outcome) return { ...empty, cleanHex, notification };
  if (!outcome.ok) {
    return { ...empty, cleanHex, decoderFailure: outcome.error, notification };
  }
  const r = outcome.result;
  if (r.ok) {
    return { ...empty, cleanHex, decoded: r.value, notification };
  }
  return {
    ...empty,
    cleanHex,
    decoded: r.partial ?? null,
    decodeError: r.error,
    errorLocation: cborErrorToLocation(r.error, cleanHex.length / 2),
    notification,
  };
}

/** Decodes CBOR the same way as General CBOR, then runs `cbor_to_json`. */
export function useCborDecoded(rawInput: string): UseCborDecodedResult {
  const normalised = useMemo(() => normalizeCborInput(rawInput), [rawInput]);
  const input = useMemo(() => ({ normalised }), [normalised]);
  const pass = useLibResource<{ normalised: { hex: string; wasBase64: boolean } }, CborDecodePass>(
    input,
    async (i, options) => ({
      normalised: i.normalised,
      outcome: await safeCborToJson(i.normalised.hex, options),
    }),
    EMPTY_CBOR_PASS,
  );
  const view = useMemo(() => cborDecodedView(pass.value), [pass.value]);
  return useMemo(
    () => ({ ...view, pending: pass.pending, slow: pass.slow }),
    [view, pass.pending, pass.slow],
  );
}

// ---------- CDDL schema ----------

/**
 * Whether pass offsets still address the editor text.
 * Compare against live text, not the debounced source — that would always match.
 */
export function cddlOffsetsAreCurrent(source: string, liveCddl: string): boolean {
  return source === liveCddl;
}

export interface UseCddlSchemaResult {
  result: CddlValidationResult | null;
  /** Set when the checker gave up instead of reporting a parse error. */
  checkerFailure: string | null;
  /** Parse-error range; `null` when valid or when ranges do not address the editor. */
  errorRange: CddlRange | null;
  /** Every place the error points at; empty while ranges do not address the editor. */
  errorRanges: CddlRange[];
  /** Undefined names; ranges are only navigable while `rangesAreStale` is false. */
  unresolvedNames: CddlUnresolvedName[];
  errorLine: number | null;
  /** Type rules with no generic params. */
  ruleNames: string[];
  /** Every declared rule name. */
  declaredNames: string[];
  /** Outline the two lists were read from; spans address `outlineSource`. */
  outline: CddlOutlineEntry[];
  /** Schema text the two lists were read from. */
  outlineSource: string;
  /** True while the lists describe earlier text and no in-flight pass will replace them. */
  outlineIsStale: boolean;
  /** True while error positions address a document the editor is no longer showing. */
  rangesAreStale: boolean;
  /** True while every field above describes earlier text. */
  pending: boolean;
  /** True after the pass has been in flight long enough to report. */
  slow: boolean;
}

/** One settled schema pass: the text, the check, and the outline of it. */
export interface CddlSchemaPass {
  source: string;
  outcome: CddlSchemaOutcome | null;
  outline: CddlOutlineEntry[];
}

const EMPTY_OUTLINE: CddlOutlineEntry[] = [];
const EMPTY_SCHEMA_PASS: CddlSchemaPass = { source: "", outcome: null, outline: EMPTY_OUTLINE };

/** Schema-pass view, ignoring whether offsets still match the editor. */
export type CddlSchemaCore = Omit<
  UseCddlSchemaResult,
  "outlineIsStale" | "rangesAreStale" | "pending" | "slow"
>;

const NO_SCHEMA_RANGES: CddlRange[] = [];

/**
 * Same pass with schema positions withheld.
 * Offsets address the text the pass read, not the live editor.
 */
export function schemaViewWithoutRanges(core: CddlSchemaCore): CddlSchemaCore {
  return { ...core, errorRange: null, errorRanges: NO_SCHEMA_RANGES };
}

/** Schema-panel view of one settled pass; split out for tests. */
export function cddlSchemaView(
  outcome: CddlSchemaOutcome | null,
  snapshot: OutlineSnapshot,
): CddlSchemaCore {
  const result = outcome?.ok ? outcome.result : null;
  const checkerFailure = outcome && !outcome.ok ? outcome.error : null;
  const { outline, source } = snapshot;
  const invalid = result && !result.valid ? result.error : null;
  return {
    result,
    checkerFailure,
    errorRange: invalid ? cddlParseErrorRange(invalid) : null,
    errorRanges: invalid ? cddlErrorRanges(invalid) : [],
    unresolvedNames: invalid ? cddlUnresolvedNames(invalid) : [],
    errorLine: invalid ? cddlParseErrorLine(invalid) : null,
    ruleNames: rootRuleNames(outline, source),
    declaredNames: declaredRuleNames(outline),
    outline,
    outlineSource: source,
  };
}

/**
 * Schema-panel view of the text.
 * Parse-error ranges are withheld while the pass text is not the live editor.
 */
export function useCddlSchema(cddl: string, liveCddl: string): UseCddlSchemaResult {
  const input = useMemo(() => ({ cddl }), [cddl]);
  const pass = useLibResource<{ cddl: string }, CddlSchemaPass>(
    input,
    async (i, options) => ({
      source: i.cddl,
      outcome: await safeValidateCddl(i.cddl, options),
      // Both calls read the same text, so the second hits the parse cache.
      outline: await safeOutline(i.cddl, options),
    }),
    EMPTY_SCHEMA_PASS,
  );

  // Render-phase retain: rule list stays in step with the text, no empty frame.
  const [kept, setKept] = useState<OutlineSnapshot>(() => ({
    source: EMPTY_SCHEMA_PASS.source,
    outline: EMPTY_SCHEMA_PASS.outline,
  }));
  const snapshot = retainOutline(kept, pass.value.source, pass.value.outline);
  if (snapshot !== kept) setKept(snapshot);

  // Separate from `pending` so array identity survives the flip; marks key on it.
  const core = useMemo(() => cddlSchemaView(pass.value.outcome, snapshot), [pass.value.outcome, snapshot]);

  const rangesApply = cddlOffsetsAreCurrent(pass.value.source, liveCddl);
  // Memoised on the verdict, not live text — typing must not rebuild the mark list.
  const view = useMemo(
    () => (rangesApply ? core : schemaViewWithoutRanges(core)),
    [core, rangesApply],
  );

  return useMemo(
    () => ({
      ...view,
      // Compared to the pass text, and only after the pass that would refresh it.
      outlineIsStale: !pass.pending && view.outlineSource !== cddl,
      rangesAreStale: !rangesApply,
      pending: pass.pending,
      slow: pass.slow,
    }),
    [view, rangesApply, pass.pending, pass.slow, cddl],
  );
}

// ---------- CBOR ↔ CDDL validation ----------

/** Cap on rendered mismatches; the panel reports how many were left out. */
export const MAX_DIAGNOSTICS = 100;

export interface UseCborValidationResult {
  /** `null` when there is nothing to validate yet. */
  outcome: CborValidationOutcome | null;
  /** Head mismatch plus `additional[]`, deduped and capped. */
  diagnostics: CborDiagnostic[];
  /** How many mismatches the cap left out of `diagnostics`. */
  hiddenDiagnostics: number;
  /** How many the library counted without describing, before this cap. */
  undescribedDiagnostics: number;
  /** Rendered, capped away, and never described. */
  totalDiagnostics: number;
  /** True while these fields describe an earlier input. */
  pending: boolean;
  /** True after the pass has been in flight long enough to report. */
  slow: boolean;
  /** True when the settled pass was reported slow before it answered. */
  wasSlow: boolean;
}

/** One settled validation run; source and outcome travel together. */
export interface CborValidationPass {
  source: string;
  outcome: CborValidationOutcome | null;
  /** Whether the transport reported the run as slow before it answered. */
  slow: boolean;
}

const EMPTY_VALIDATION_PASS: CborValidationPass = { source: "", outcome: null, slow: false };

/**
 * Same mismatches with schema positions withheld.
 * Identity is kept when no row had a range, so the hex panel is not rebuilt.
 */
export function diagnosticsWithoutCddlRanges(
  diagnostics: ReadonlyArray<CborDiagnostic>,
): CborDiagnostic[] {
  if (!diagnostics.some(d => d.cddlRange)) return diagnostics as CborDiagnostic[];
  return diagnostics.map(d => (d.cddlRange ? { ...d, cddlRange: null } : d));
}

/** Diagnostics one settled validation run yields, under both caps. */
export function cborValidationView(
  outcome: CborValidationOutcome | null,
): Omit<UseCborValidationResult, "pending" | "slow" | "wasSlow"> {
  if (!outcome || !outcome.ok || outcome.result.valid) {
    return {
      outcome,
      diagnostics: [],
      hiddenDiagnostics: 0,
      undescribedDiagnostics: 0,
      totalDiagnostics: 0,
    };
  }
  const all = cborDiagnostics(outcome.result.error);
  const undescribedDiagnostics = cborDiagnosticsTruncated(outcome.result.error);
  const diagnostics = all.slice(0, MAX_DIAGNOSTICS);
  const hiddenDiagnostics = Math.max(0, all.length - MAX_DIAGNOSTICS);
  return {
    outcome,
    diagnostics,
    hiddenDiagnostics,
    undescribedDiagnostics,
    totalDiagnostics: diagnostics.length + hiddenDiagnostics + undescribedDiagnostics,
  };
}

/**
 * Validates CBOR against the schema.
 * Schema ranges are withheld while the pass text is not the live editor.
 */
export function useCborValidation(
  cleanHex: string,
  cddl: string,
  rule: string,
  schemaIsValid: boolean,
  liveCddl: string,
): UseCborValidationResult {
  const input = useMemo(
    () => ({ cleanHex, cddl, rule, schemaIsValid }),
    [cleanHex, cddl, rule, schemaIsValid],
  );
  const pass = useLibResource<typeof input, CborValidationPass>(
    input,
    async (i, options) => {
      if (!i.schemaIsValid) return { source: i.cddl, outcome: null, slow: false };
      // Stored on the pass: later UI reads whether *this* document was slow.
      let slow = false;
      const outcome = await safeValidateCborAgainstCddl(i.cleanHex, i.cddl, i.rule, {
        ...options,
        onSlow: () => {
          slow = true;
          options.onSlow?.();
        },
      });
      return { source: i.cddl, outcome, slow };
    },
    EMPTY_VALIDATION_PASS,
  );
  const core = useMemo(() => cborValidationView(pass.value.outcome), [pass.value.outcome]);
  const rangesApply = cddlOffsetsAreCurrent(pass.value.source, liveCddl);
  // Memoised on the verdict, not live text — typing must not rebuild the hex list.
  const diagnostics = useMemo(
    () => (rangesApply ? core.diagnostics : diagnosticsWithoutCddlRanges(core.diagnostics)),
    [core.diagnostics, rangesApply],
  );
  return useMemo(
    () => ({ ...core, diagnostics, pending: pass.pending, slow: pass.slow, wasSlow: pass.value.slow }),
    [core, diagnostics, pass.pending, pass.slow, pass.value.slow],
  );
}

// ---------- Which other root accepts the document ----------

/** Wall-clock budget for one sweep, checked between candidate calls. */
export const ROOT_SWEEP_BUDGET_MS = 1000;

/** Unasked sweep stops after this many candidates. */
export const ROOT_SWEEP_AUTO_CAP = 64;

/** How often a running sweep publishes its count. */
const ROOT_SWEEP_PROGRESS_MS = 100;

/** Accepting roots so far, in candidate order, and how many were checked. */
export interface RootSweepProgress {
  matches: string[];
  checked: number;
}

export const NO_ROOT_SWEEP: RootSweepProgress = { matches: [], checked: 0 };

export interface RootSweepOptions {
  /** Drops candidates not yet dispatched; the in-flight call is finished and discarded. */
  signal?: AbortSignal;
  /** Wall-clock budget, checked before each call after the first. */
  budgetMs: number;
  /** Most candidates this run may check. */
  limit: number;
  /** Running total, at most every `ROOT_SWEEP_PROGRESS_MS`. */
  onProgress?: (progress: RootSweepProgress) => void;
  /** Validation call; tests can stub this. */
  validate?: typeof safeValidateCborAgainstCddl;
  /** Clock; tests can stub this. */
  now?: () => number;
}

/**
 * Validates `hex` against each candidate from `start`, reporting which accept it.
 * Stops on budget, limit, or abort; a non-valid answer is checked, not a match.
 */
export async function sweepRootRules(
  hex: string,
  cddl: string,
  candidates: readonly string[],
  start: RootSweepProgress,
  options: RootSweepOptions,
): Promise<RootSweepProgress> {
  const validate = options.validate ?? safeValidateCborAgainstCddl;
  const now = options.now ?? (() => Date.now());
  const started = now();
  let lastPublished = started;
  const matches = [...start.matches];
  let checked = start.checked;
  let checkedThisRun = 0;
  while (checked < candidates.length && checkedThisRun < options.limit) {
    if (options.signal?.aborted) break;
    if (checkedThisRun > 0 && now() - started >= options.budgetMs) break;
    const rule = candidates[checked];
    let accepted = false;
    try {
      const outcome = await validate(hex, cddl, rule, { signal: options.signal });
      accepted = outcome?.ok === true && outcome.result.valid;
    } catch (error) {
      if (isLibAbortedError(error)) break;
    }
    // Abort after the call: do not count an answer the caller has dropped.
    if (options.signal?.aborted) break;
    checked++;
    checkedThisRun++;
    if (accepted) matches.push(rule);
    if (options.onProgress && now() - lastPublished >= ROOT_SWEEP_PROGRESS_MS) {
      lastPublished = now();
      options.onProgress({ matches: [...matches], checked });
    }
  }
  return { matches, checked };
}

export interface RootSuggestionsResult {
  /** Candidate roots that accept the document, in declaration order, among those checked. */
  matches: string[];
  /** How many candidates have been checked. */
  checked: number;
  /** Candidate count. `checked < total` with `pending` false means the sweep stopped short. */
  total: number;
  /** True while a sweep for the current input is running. */
  pending: boolean;
  /** Resume a sweep that stopped short, with no cap. */
  checkTheRest: () => void;
}

/** What one sweep is for. Compared by identity, like every pass input. */
interface RootSweepInput {
  cleanHex: string;
  cddl: string;
  candidates: string[];
}

interface RootSweepState {
  /** Input `progress` was produced for; `null` when there is none. */
  input: RootSweepInput | null;
  /** Resumption `progress` was produced in — see `useRootSuggestions`. */
  round: number;
  progress: RootSweepProgress;
  /** True while a sweep is running for `input`. */
  running: boolean;
}

const IDLE_ROOT_SWEEP: RootSweepState = {
  input: null,
  round: 0,
  progress: NO_ROOT_SWEEP,
  running: false,
};

/**
 * Which candidates accept the document; see `sweepRootRules`.
 * Runs only while `enabled`; previous matches are not shown for a new input.
 */
export function useRootSuggestions(
  cleanHex: string,
  cddl: string,
  candidates: string[],
  enabled: boolean,
): RootSuggestionsResult {
  const input = useMemo<RootSweepInput | null>(
    () => (enabled ? { cleanHex, cddl, candidates } : null),
    [cleanHex, cddl, candidates, enabled],
  );
  const [state, setState] = useState<RootSweepState>(IDLE_ROOT_SWEEP);
  // `checkTheRest` bumps this; round > 0 means resume, not restart.
  const [round, setRound] = useState(0);
  // Last progress, read by the resume effect without listing state as a dep.
  const progressRef = useRef<RootSweepState>(IDLE_ROOT_SWEEP);

  useEffect(() => {
    if (!input) {
      progressRef.current = IDLE_ROOT_SWEEP;
      return;
    }
    const resume = round > 0 && progressRef.current.input === input;
    const start = resume ? progressRef.current.progress : NO_ROOT_SWEEP;
    const controller = new AbortController();
    const publish = (progress: RootSweepProgress, running: boolean) => {
      const next = { input, round, progress, running };
      progressRef.current = next;
      setState(next);
    };
    sweepRootRules(input.cleanHex, input.cddl, input.candidates, start, {
      signal: controller.signal,
      budgetMs: ROOT_SWEEP_BUDGET_MS,
      limit: resume ? Infinity : ROOT_SWEEP_AUTO_CAP,
      onProgress: progress => {
        if (!controller.signal.aborted) publish(progress, true);
      },
    }).then(progress => {
      if (!controller.signal.aborted) publish(progress, false);
    });
    return () => controller.abort();
  }, [input, round]);

  const checkTheRest = useCallback(() => setRound(r => r + 1), []);

  // Stale input is not an answer; earlier-round progress for this input is.
  const current = state.input === input ? state : IDLE_ROOT_SWEEP;
  const settled = current.input === input && current.round === round;
  const total = input ? input.candidates.length : 0;
  return useMemo(
    () => ({
      matches: current.progress.matches,
      checked: current.progress.checked,
      total,
      pending: input !== null && (!settled || current.running),
      checkTheRest,
    }),
    [current, settled, total, input, checkTheRest],
  );
}

// ---------- Schema-mapped JSON view ----------

/** Schema-labelled decode; skipped while the panel is closed. */
export function useDecodeAgainstSchema(
  cleanHex: string,
  cddl: string,
  rule: string,
  schemaIsValid: boolean,
  enabled = true,
): DecodedAgainstSchema | null {
  const input = useMemo(
    () => ({ cleanHex, cddl, rule, schemaIsValid, enabled }),
    [cleanHex, cddl, rule, schemaIsValid, enabled],
  );
  const pass = useLibResource<typeof input, DecodedAgainstSchema | null>(
    input,
    (i, options) =>
      i.schemaIsValid && i.enabled
        ? safeDecodeCborAgainstCddl(i.cleanHex, i.cddl, i.rule, options)
        : Promise.resolve(null),
    null,
  );
  // Closed or unparseable: drop the previous document's decode immediately.
  return schemaIsValid && enabled ? pass.value : null;
}

// ---------- CBOR ⇄ CDDL bridge map ----------

/** What one settled mapping pass was built from. */
export interface CborCddlMapSource {
  cleanHex: string;
  cddl: string;
  rule: string;
  schemaIsValid: boolean;
}

/** What the panels read from a settled mapping pass. */
export interface CborCddlMapView {
  /** The map, or the empty map when the library built none. */
  map: CborCddlMap;
  /** Why `map` is empty when the library refused the walk; `null` if mapped or nothing was asked. */
  refusal: WalkRefusal | null;
}

/** One settled mapping pass; source and result travel together. */
export interface CborCddlMapPass extends CborCddlMapView {
  source: CborCddlMapSource;
}

const EMPTY_MAP_PASS: CborCddlMapPass = {
  source: { cleanHex: "", cddl: "", rule: "", schemaIsValid: false },
  map: EMPTY_CBOR_CDDL_MAP,
  refusal: null,
};

/**
 * Settles a wrapper outcome into a pass.
 * A refusal reuses the shared empty map so the bridge is not rebuilt.
 */
export function mapPassFor(
  source: CborCddlMapSource,
  outcome: CborCddlMapOutcome | null,
): CborCddlMapPass {
  if (!outcome) return { source, map: EMPTY_CBOR_CDDL_MAP, refusal: null };
  if (outcome.ok) return { source, map: outcome.map, refusal: null };
  return { source, map: EMPTY_CBOR_CDDL_MAP, refusal: outcome.error };
}

/**
 * Map the panels may answer from, or empty if it was not built for the screen.
 * Byte and char offsets from a previous document would pin the wrong spans.
 */
export function mapForCurrentInput(
  pass: CborCddlMapPass,
  current: CborCddlMapSource,
  liveCddl: string,
): CborCddlMapPass {
  const from = pass.source;
  const matches =
    from.cleanHex === current.cleanHex &&
    from.cddl === current.cddl &&
    from.cddl === liveCddl &&
    from.rule === current.rule &&
    from.schemaIsValid === current.schemaIsValid;
  return matches ? pass : EMPTY_MAP_PASS;
}

export interface UseCborCddlMapResult {
  /** Only ever the mapping for the input on screen. */
  bridge: CborCddlBridge;
  /** True while the on-screen mapping is not ready (pass in flight, or schema still settling). */
  pending: boolean;
  /** Why there is no on-screen mapping when the library refused; `null` if mapped, pending, or unasked. */
  refusal: WalkRefusal | null;
}

/**
 * Bridge map for the current CBOR, even when it does not match the schema.
 * Char offsets are withheld while the pass schema is not the live editor.
 */
export function useCborCddlMap(
  cleanHex: string,
  cddl: string,
  rule: string,
  schemaIsValid: boolean,
  liveCddl: string,
): UseCborCddlMapResult {
  const input = useMemo<CborCddlMapSource>(
    () => ({ cleanHex, cddl, rule, schemaIsValid }),
    [cleanHex, cddl, rule, schemaIsValid],
  );
  const pass = useLibResource<CborCddlMapSource, CborCddlMapPass>(
    input,
    async (i, options) =>
      mapPassFor(
        i,
        i.schemaIsValid ? await safeMapCborToCddl(i.cleanHex, i.cddl, i.rule, options) : null,
      ),
    EMPTY_MAP_PASS,
  );
  const view = useMemo(
    () => mapForCurrentInput(pass.value, input, liveCddl),
    [pass.value, input, liveCddl],
  );
  // Memoised on the map: the bridge caches resolved paths.
  const bridge = useMemo(
    () => createCborCddlBridge(view.map, view.source.cddl),
    [view.map, view.source.cddl],
  );
  // Debounce with no pass yet is still "not ready" for a right-click.
  const pending = pass.pending || cddl !== liveCddl;
  return useMemo(
    () => ({ bridge, pending, refusal: view.refusal }),
    [bridge, pending, view.refusal],
  );
}

// ---------- hover link ----------

/**
 * One panel's projection of the hover link.
 * Selectors return objects made once per link so identity compares stay stable.
 */
export function useHoverLink<T>(
  store: HoverLinkStore,
  select: (link: HoverLink | null) => T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(null),
  );
}

// Shared empty arrays so two "no link" reads compare equal by identity.
export const selectHexLink = (link: HoverLink | null): readonly CborPosition[] =>
  link?.projection.hexAll ?? EMPTY_POSITIONS;
export const selectTreeLink = (link: HoverLink | null): readonly CborPosition[] =>
  link?.projection.treeAll ?? EMPTY_POSITIONS;
export const selectDecodedLink = (link: HoverLink | null): readonly string[] =>
  link?.projection.decodedAll ?? EMPTY_PATHS;
// Role is one value per link: a construct's instances are all keys or all values.
export const selectLinkRole = (link: HoverLink | null): EntryRole | null =>
  link?.node?.entry.entry_role ?? null;
export const selectEditorLink = (link: HoverLink | null): HoverLink | null => link;

// ---------- "References" for the symbol under the caret ----------

/** A caret offset together with the schema text it was taken in. */
export interface CaretProbe {
  text: string;
  caret: number | null;
}

/**
 * Caret offset for a reference lookup, or `null` if the probe is stale.
 * A stale offset would highlight the wrong characters.
 */
export function caretForReferences(probe: CaretProbe, currentText: string): number | null {
  return probe.text === currentText ? probe.caret : null;
}

/** True for rule-references, types, and groups; not whitespace, comments, or prelude types. */
export function isHighlightableSymbol(symbol: CddlSymbolAtResult | null): boolean {
  if (!symbol || !symbol.name) return false;
  return symbol.kind === "rule_reference" || symbol.kind === "type" || symbol.kind === "group";
}

/** Char ranges for the symbol's definition and uses. */
export function referenceRangesFrom(
  symbol: CddlSymbolAtResult | null,
  references: CddlReferencesResult | null,
): [number, number][] {
  if (!isHighlightableSymbol(symbol)) return [];
  if (!references) return [];
  const out: [number, number][] = [];
  if (references.definition) {
    out.push([
      references.definition.char_offset,
      references.definition.char_offset + references.definition.char_length,
    ]);
  }
  for (const u of references.uses) {
    out.push([u.char_offset, u.char_offset + u.char_length]);
  }
  return out;
}

const NO_RANGES: [number, number][] = [];

/** The two library calls a reference lookup takes, in order. */
export async function resolveReferenceRanges(
  cddl: string,
  caretOffset: number | null,
  options?: LibCallOptions,
): Promise<[number, number][]> {
  if (caretOffset == null || !cddl) return NO_RANGES;
  // cddl_symbol_at expects UTF-8 bytes, the caret is UTF-16 code units.
  const symbol = await safeSymbolAt(cddl, utf16ToByte(cddl, caretOffset), options);
  // Skip the second call: prelude types and comments have no references.
  if (!isHighlightableSymbol(symbol)) return NO_RANGES;
  const references = await safeReferences(cddl, symbol!.name!, options);
  return referenceRangesFrom(symbol, references);
}

/** Char-range bounds for every place the symbol under the caret is defined or used. */
export function useReferenceRanges(
  cddl: string,
  caretOffset: number | null,
): [number, number][] {
  // Omit schema text when there is no caret: this hook reads live text, and
  // a changing token would re-render on every keystroke.
  const lookupText = caretOffset == null ? null : cddl;
  const input = useMemo(() => ({ lookupText, caretOffset }), [lookupText, caretOffset]);
  const pass = useLibResource<typeof input, [number, number][]>(
    input,
    (i, options) => resolveReferenceRanges(i.lookupText ?? "", i.caretOffset, options),
    NO_RANGES,
  );
  // Drop the previous highlight while pending; a retained one would be stale.
  return pass.pending ? NO_RANGES : pass.value;
}
