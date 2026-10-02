// Page-wide library backend: one shared worker running the wasm.
// A trap or a runaway pass kills a replaceable worker, not an instance the UI
// holds; the library's worker backend queues, times out and respawns. What is
// the app's: where the worker script is, how long a pass may take, where calls
// go when no worker can be had, the "still working" notice a panel shows
// before a pass is given up on, and how a panel words that deadline.

import {
  createInProcessBackend,
  createWorkerBackend,
  type LibBackend,
  type LibCallOptions as BaseLibCallOptions,
  type WasmFunctionName,
  type WorkerBackend,
  type WorkerBackendTransport,
  type WorkerSource,
} from "@cardananium/cquisitor-lib";

/**
 * How long a call may take before a panel should say it is still working.
 * Measured from when the caller asked, including time spent queued.
 */
export const SOFT_TIMEOUT_MS = 2_000;

/**
 * How long a call may take before it is abandoned, and the worker is killed if it had started.
 * Measured from when the caller asked, including queue wait. Does not run while the module is loading.
 */
export const HARD_TIMEOUT_MS = 10_000;

/**
 * How long to wait for a new worker to report its module loaded.
 * Not a call budget; call watchdogs start only after this phase ends.
 * A load that runs out of time is not retried at once (that would download the
 * wasm again at the same speed): calls go to the in-page fallback meanwhile.
 */
export const MODULE_LOAD_TIMEOUT_MS = 60_000;

/**
 * Extra hard-timeout multiples. `validate_transaction_js` is priced in Plutus execution units, not document size.
 * Multiples of the base, so tests that shorten the base shorten every budget.
 */
const HARD_TIMEOUT_MULTIPLIERS: Partial<Record<WasmFunctionName, number>> = {
  validate_transaction_js: 6,
};

/** The watchdog budget that applies to one call. */
export function hardTimeoutFor(fn: WasmFunctionName, base: number = HARD_TIMEOUT_MS): number {
  return base * (HARD_TIMEOUT_MULTIPLIERS[fn] ?? 1);
}

/** A budget as the panels write it: "10 s", "2.5 s", "300 ms". */
function formatBudget(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1_000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

/**
 * What a panel tells the user about a pass's deadline: one budget of
 * `budgetMs` from when the pass was asked, queue wait included and module
 * load excluded, after which a running pass is abandoned and a waiting one is
 * dropped unstarted. Says "in its worker": the in-page fallback has no deadline.
 */
export function passDeadlineNotice(budgetMs: number = HARD_TIMEOUT_MS): string {
  const budget = formatBudget(budgetMs);
  return (
    `Each pass the library runs in its worker has ${budget} in all, counted from when it was asked: ` +
    `time spent waiting behind earlier passes counts, time spent loading the library does not. ` +
    `A pass not finished by then is abandoned, and one still waiting its turn when too little of that ` +
    `time is left never starts; the panels will say which.`
  );
}

/**
 * Use `new URL(..., import.meta.url)` so the bundler emits the worker chunk with the right base path.
 * The file is also copied as a static asset; nothing loads that copy.
 */
export function spawnLibWorker(): WorkerSource {
  return new Worker(new URL("./cquisitorLib.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Where calls go when the page cannot have a worker: the library on the page's
 * own thread, its wasm fetched on first use. The library's worker backend uses
 * it only when a worker cannot be started or keeps failing to load (the worker
 * chunk is missing or blocked, module workers are unsupported, the wasm does not
 * arrive within `MODULE_LOAD_TIMEOUT_MS`), never for a pass whose worker was
 * killed for its budget, trapped or crashed: that one could not be stopped on
 * the page. Calls it serves have no watchdog. After the library's cooldown the
 * next call tries a worker again.
 */
function inPageFallback(): LibBackend {
  return createInProcessBackend();
}

/**
 * The page's worker backend: the app's budgets over the library's queue,
 * watchdog and respawn, with `inPageFallback` for when no worker can be had.
 * Tests pass their own `spawn`, budgets or `fallback` (`undefined` for none).
 */
export function createLibWorkerBackend(
  options: Partial<WorkerBackendTransport> = {},
): WorkerBackend {
  const base = options.timeoutMs ?? HARD_TIMEOUT_MS;
  return createWorkerBackend({
    spawn: spawnLibWorker,
    loadTimeoutMs: MODULE_LOAD_TIMEOUT_MS,
    fallback: inPageFallback,
    ...options,
    timeoutMs: base,
    timeoutFor: options.timeoutFor ?? (fn => hardTimeoutFor(fn, base)),
  });
}

/** The library's call options plus the notice a panel shows while a pass is still running. */
export interface LibCallOptions extends BaseLibCallOptions {
  /** Called once if the call has not settled after `SOFT_TIMEOUT_MS`, queue wait included. */
  onSlow?: () => void;
}

/**
 * Run `call` with the library's options and fire `onSlow` if it is still
 * running after `SOFT_TIMEOUT_MS`. A call that settles first never reports
 * itself as slow. The library never sees `onSlow`.
 */
export async function withSlowNotice<T>(
  options: LibCallOptions | undefined,
  call: (options: BaseLibCallOptions) => Promise<T>,
  softTimeoutMs: number = SOFT_TIMEOUT_MS,
): Promise<T> {
  if (!options?.onSlow) return call(options ?? {});
  const { onSlow, ...libOptions } = options;
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) onSlow();
  }, softTimeoutMs);
  try {
    return await call(libOptions);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}
