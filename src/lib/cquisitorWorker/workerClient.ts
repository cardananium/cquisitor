// Page-side worker client: serial queue, generation counter, and watchdog.
// One call at a time so the wasm instance's schema cache is shared.
// Call budgets do not run while the worker is still loading wasm.

import {
  isLibFunction,
  isLibLoadedMessage,
  isLibResponse,
  type LibFunction,
  type LibRequest,
} from "./protocol";
import { readJsonAnswer } from "./answers";
import { guardInputBudget } from "./directTransport";
import {
  LibAbortedError,
  LibResultNotTransferableError,
  LibTimeoutError,
  LibUnavailableError,
  type LibCallOptions,
  type LibTransport,
} from "./transport";

/** As much of `Worker` as this client uses — so a test can stand in for one. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

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
 */
export const MODULE_LOAD_TIMEOUT_MS = 60_000;

/**
 * Extra hard-timeout multiples. `validate_transaction_js` is priced in Plutus execution units, not document size.
 * Multiples of the base, so tests that shorten the base shorten every budget.
 */
const HARD_TIMEOUT_MULTIPLIERS: Partial<Record<LibFunction, number>> = {
  validate_transaction_js: 6,
};

/** The watchdog budget that applies to one call. */
export function hardTimeoutFor(fn: LibFunction, base: number = HARD_TIMEOUT_MS): number {
  return base * (HARD_TIMEOUT_MULTIPLIERS[fn] ?? 1);
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`;
}

/** Queue wait below this is omitted from timeout messages. */
const QUEUE_WAIT_WORTH_SAYING_MS = 1_000;

/** Timeout message for a call that ran past its budget. Names queue wait when it was at least `QUEUE_WAIT_WORTH_SAYING_MS`. */
export function abandonedMessage(budgetMs: number, queuedMs: number): string {
  const queued =
    queuedMs >= QUEUE_WAIT_WORTH_SAYING_MS
      ? ` It had already waited ${formatDuration(queuedMs)} for its turn.`
      : "";
  return (
    `The library did not answer within ${formatDuration(budgetMs)}, so this pass was ` +
    `abandoned.${queued} The input is too large or too complex for this operation to finish.`
  );
}

/** Message when the wasm module never loaded, so the call never ran. Does not blame the input. */
export function stillLoadingMessage(budgetMs: number): string {
  return (
    `The library itself was still loading ${formatDuration(budgetMs)} after this was asked ` +
    `for, so this pass never ran. Nothing has been read, so nothing is known about the input.`
  );
}

/** Timeout message when a call expired still queued. Does not blame the input. */
export function neverRanMessage(budgetMs: number): string {
  return (
    `The library was still busy with earlier work ${formatDuration(budgetMs)} after ` +
    `this was asked for, so this pass never ran.`
  );
}

/** Consecutive worker failures before falling back off workers. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** How long to stay off workers after `MAX_CONSECUTIVE_FAILURES`. After this, spawning is retried. */
export const FAILURE_DECAY_MS = 30_000;

interface PendingCall {
  id: number;
  fn: LibFunction;
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onSlow?: () => void;
  signal?: AbortSignal;
  detach?: () => void;
  /** When the caller asked, or when the module finished loading if that was later. */
  enqueuedAt: number;
  /** Dispatch time, or module-load time if later. `null` until a worker is ready. */
  startedAt: number | null;
  softTimer: ReturnType<typeof setTimeout> | null;
  hardTimer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

export interface WorkerTransportOptions {
  spawn: () => WorkerLike;
  softTimeoutMs?: number;
  hardTimeoutMs?: number;
  moduleLoadTimeoutMs?: number;
  failureDecayMs?: number;
  /** In-process transport factory when no worker is available. Built at most once; without it, those calls are rejected. */
  fallback?: () => LibTransport;
}

export class WorkerTransport implements LibTransport {
  private readonly spawn: () => WorkerLike;
  private readonly softMs: number;
  private readonly hardMs: number;
  private readonly loadMs: number;
  private readonly decayMs: number;
  private readonly makeFallback: (() => LibTransport) | null;
  private fallback: LibTransport | null = null;

  private worker: WorkerLike | null = null;
  /** False from spawn until the worker reports the module loaded. */
  private moduleReady = false;
  /** Module-load deadline. Call watchdogs do not run while this is armed. */
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  /** True after a load timeout, so fallback errors name the load, not the input. */
  private moduleLoadTimedOut = false;
  /** Incremented when a worker is discarded, so late messages from it are dropped. */
  private gen = 0;
  private nextId = 1;
  private inFlight: PendingCall | null = null;
  private readonly queue: PendingCall[] = [];
  private consecutiveFailures = 0;
  private lastFailureAt = 0;
  private disposed = false;

  constructor(options: WorkerTransportOptions) {
    this.spawn = options.spawn;
    this.softMs = options.softTimeoutMs ?? SOFT_TIMEOUT_MS;
    this.hardMs = options.hardTimeoutMs ?? HARD_TIMEOUT_MS;
    this.loadMs = options.moduleLoadTimeoutMs ?? MODULE_LOAD_TIMEOUT_MS;
    this.decayMs = options.failureDecayMs ?? FAILURE_DECAY_MS;
    this.makeFallback = options.fallback ?? null;
  }

  call<T = unknown>(fn: LibFunction, args: unknown[], options?: LibCallOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.disposed) {
        reject(new LibUnavailableError("The library worker has been shut down."));
        return;
      }
      if (!isLibFunction(fn)) {
        reject(new Error(`${String(fn)} is not a callable library function`));
        return;
      }
      try {
        guardInputBudget(fn, args);
      } catch (error) {
        reject(error);
        return;
      }
      if (options?.signal?.aborted) {
        reject(new LibAbortedError());
        return;
      }

      const pending: PendingCall = {
        id: this.nextId++,
        fn,
        args,
        resolve: resolve as (value: unknown) => void,
        reject,
        onSlow: options?.onSlow,
        signal: options?.signal,
        enqueuedAt: Date.now(),
        startedAt: null,
        softTimer: null,
        hardTimer: null,
        settled: false,
      };

      const signal = options?.signal;
      if (signal) {
        const onAbort = () => this.dropQueued(pending);
        signal.addEventListener("abort", onAbort);
        pending.detach = () => signal.removeEventListener("abort", onAbort);
      }

      // Soft and hard timers start here, not at dispatch, so queue wait is bounded.
      // Re-armed at dispatch so the run still gets a full budget. Not armed during module load.
      pending.softTimer = setTimeout(() => {
        pending.softTimer = null;
        if (!pending.settled) pending.onSlow?.();
      }, this.softMs);
      if (!this.loadingModule()) this.armBudget(pending);

      this.queue.push(pending);
      this.pump();
    });
  }

  /** Stops the client, destroys the worker, and rejects outstanding calls. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new LibUnavailableError("The library worker has been shut down.");
    const outstanding = this.takeOutstanding();
    this.discardWorker();
    for (const call of outstanding) this.settle(call, error, false);
  }

  // ---------- scheduling ----------

  private pump(): void {
    while (!this.disposed && !this.inFlight && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next || next.settled) continue;

      const worker = this.ensureWorker();
      if (!worker) {
        this.runWithoutWorker(next);
        continue;
      }

      this.inFlight = next;
      next.startedAt = Date.now();
      // Re-arm the run budget, unless still waiting on the module.
      this.clearBudget(next);
      if (!this.loadingModule()) this.armBudget(next);

      const request: LibRequest = { id: next.id, gen: this.gen, fn: next.fn, args: next.args };
      try {
        worker.postMessage(request);
      } catch {
        // postMessage failed (dead worker or clone). Count as a worker failure, not a library answer.
        this.inFlight = null;
        this.clearTimers(next);
        this.recordFailure();
        this.discardWorker();
        this.settle(
          next,
          new LibUnavailableError(
            "The library worker could not be handed this input, so it could not be read.",
          ),
          false,
        );
      }
    }
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker) return this.worker;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      if (Date.now() - this.lastFailureAt < this.decayMs) return null;
      this.consecutiveFailures = 0;
    }
    let worker: WorkerLike;
    try {
      worker = this.spawn();
    } catch {
      this.recordFailure();
      return null;
    }
    const gen = this.gen;
    worker.onmessage = (event) => this.receive(gen, event.data);
    worker.onerror = () =>
      this.workerFailed(
        gen,
        new LibUnavailableError(
          "The library worker stopped unexpectedly, so this input could not be read.",
        ),
      );
    this.worker = worker;
    // Suspend call budgets until the module loads; only the load timer runs.
    this.moduleReady = false;
    this.suspendBudgets();
    this.loadTimer = setTimeout(() => this.loadTimedOut(), this.loadMs);
    return worker;
  }

  /** True while a worker exists but has not said its module is in place. */
  private loadingModule(): boolean {
    return this.worker !== null && !this.moduleReady;
  }

  /** Module loaded: start call budgets, and treat wait as starting now. */
  private moduleLoaded(gen: number): void {
    if (gen !== this.gen || this.disposed || this.moduleReady) return;
    this.moduleReady = true;
    this.moduleLoadTimedOut = false;
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
    const now = Date.now();
    const running = this.inFlight;
    if (running && !running.settled) {
      running.enqueuedAt = now;
      running.startedAt = now;
      this.armBudget(running);
    }
    for (const call of this.queue) {
      call.enqueuedAt = now;
      this.armBudget(call);
    }
  }

  /** Module never loaded. Stop spawning workers for the decay window and serve calls in process. */
  private loadTimedOut(): void {
    if (this.disposed || this.moduleReady) return;
    this.loadTimer = null;
    this.moduleLoadTimedOut = true;
    this.consecutiveFailures = MAX_CONSECUTIVE_FAILURES;
    this.lastFailureAt = Date.now();
    const call = this.inFlight;
    this.inFlight = null;
    this.discardWorker();
    // Requeue the in-flight call; it never ran.
    if (call && !call.settled) {
      call.startedAt = null;
      call.enqueuedAt = Date.now();
      this.queue.unshift(call);
    }
    this.pump();
  }

  // ---------- responses ----------

  private receive(gen: number, data: unknown): void {
    if (gen !== this.gen || this.disposed) return;
    if (isLibLoadedMessage(data)) {
      this.moduleLoaded(gen);
      return;
    }
    if (!isLibResponse(data) || data.gen !== gen) return;
    // An answer means the module is loaded, even if `loaded` was never posted.
    this.moduleLoaded(gen);

    const call = this.inFlight;
    if (!call || call.id !== data.id) return;

    this.inFlight = null;
    this.clearTimers(call);
    this.consecutiveFailures = 0;

    if (data.ok) {
      if ("json" in data) {
        let value: unknown;
        try {
          value = readJsonAnswer(data.json);
        } catch (error) {
          this.settle(
            call,
            new Error(
              "The library's answer could not be read: " +
                (error instanceof Error ? error.message : String(error)),
            ),
            false,
          );
          this.pump();
          return;
        }
        this.settle(call, null, true, value);
      } else {
        this.settle(call, null, true, data.value);
      }
    } else {
      const error =
        data.error.kind === "result_not_transferable"
          ? new LibResultNotTransferableError(data.error.message)
          : Object.assign(new Error(data.error.message), { name: data.error.name });
      this.settle(call, error, false);
      // A trap poisons the wasm instance; drop this worker.
      if (data.error.fatal) this.discardWorker();
    }
    this.pump();
  }

  /** Worker died mid-call. Report that call; do not retry it in process. */
  private workerFailed(gen: number, error: LibUnavailableError): void {
    if (gen !== this.gen || this.disposed) return;
    this.recordFailure();
    this.discardWorker();
    const call = this.inFlight;
    this.inFlight = null;
    if (call) {
      this.clearTimers(call);
      this.settle(call, error, false);
    }
    this.pump();
  }

  /** Hard timeout: kill the worker if this call is in flight; drop it if still queued. */
  private expire(call: PendingCall): void {
    if (call.settled || this.disposed) return;
    if (this.inFlight === call) {
      this.abandon(call);
      return;
    }
    const index = this.queue.indexOf(call);
    if (index < 0) return;
    this.queue.splice(index, 1);
    const budget = hardTimeoutFor(call.fn, this.hardMs);
    this.settle(call, new LibTimeoutError(neverRanMessage(budget)), false);
  }

  /** Kill the worker holding this in-flight call. Drop queued siblings that share its AbortSignal; leave other queued calls for the replacement worker. Nothing is replayed. */
  private abandon(call: PendingCall): void {
    // Do not count this as a worker failure: that would send later calls in-process, which cannot be interrupted.
    const budget = hardTimeoutFor(call.fn, this.hardMs);
    const queued = call.startedAt === null ? 0 : Math.max(0, call.startedAt - call.enqueuedAt);
    const error = new LibTimeoutError(abandonedMessage(budget, queued));
    this.discardWorker();
    this.inFlight = null;
    this.clearTimers(call);
    const siblings: PendingCall[] = [];
    if (call.signal) {
      const kept = this.queue.filter(other => {
        if (other.signal !== call.signal) return true;
        siblings.push(other);
        return false;
      });
      this.queue.splice(0, this.queue.length, ...kept);
    }
    this.settle(call, error, false);
    for (const other of siblings) {
      this.clearTimers(other);
      this.settle(other, error, false);
    }
    this.pump();
  }

  // ---------- degraded operation ----------

  private recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();
    // This was not a module-load timeout.
    this.moduleLoadTimedOut = false;
  }

  /** Run in process when no worker is available. Not counted as in-flight; there is no watchdog. */
  private runWithoutWorker(call: PendingCall): void {
    // Drop the hard timeout; keep the soft "still working" timer.
    this.clearBudget(call);
    if (!this.fallback && this.makeFallback) this.fallback = this.makeFallback();
    const fallback = this.fallback;
    if (!fallback) {
      this.settle(
        call,
        new LibUnavailableError(
          this.moduleLoadTimedOut
            ? stillLoadingMessage(this.loadMs)
            : "The library worker could not be started, so this input could not be read.",
        ),
        false,
      );
      return;
    }
    fallback.call(call.fn, call.args).then(
      value => this.settle(call, null, true, value),
      error => this.settle(call, error, false),
    );
  }

  // ---------- bookkeeping ----------

  private dropQueued(call: PendingCall): void {
    if (call.settled || this.inFlight === call) return;
    const index = this.queue.indexOf(call);
    if (index < 0) return;
    this.queue.splice(index, 1);
    this.settle(call, new LibAbortedError(), false);
  }

  private takeOutstanding(): PendingCall[] {
    const outstanding = this.queue.splice(0, this.queue.length);
    if (this.inFlight) {
      this.clearTimers(this.inFlight);
      outstanding.unshift(this.inFlight);
      this.inFlight = null;
    }
    return outstanding;
  }

  private settle(call: PendingCall, error: unknown, ok: boolean, value?: unknown): void {
    if (call.settled) return;
    call.settled = true;
    this.clearTimers(call);
    call.detach?.();
    if (ok) call.resolve(value);
    else call.reject(error);
  }

  private clearTimers(call: PendingCall): void {
    if (call.softTimer !== null) {
      clearTimeout(call.softTimer);
      call.softTimer = null;
    }
    this.clearBudget(call);
  }

  /** Arm the hard timeout. Same ceiling for queue wait and run; `expire` tells them apart. */
  private armBudget(call: PendingCall): void {
    this.clearBudget(call);
    call.hardTimer = setTimeout(() => this.expire(call), hardTimeoutFor(call.fn, this.hardMs));
  }

  private clearBudget(call: PendingCall): void {
    if (call.hardTimer !== null) {
      clearTimeout(call.hardTimer);
      call.hardTimer = null;
    }
  }

  /** Clear every call's hard timeout while the module is loading. */
  private suspendBudgets(): void {
    if (this.inFlight) this.clearBudget(this.inFlight);
    for (const call of this.queue) this.clearBudget(call);
  }

  private discardWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.gen += 1;
    this.moduleReady = false;
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    try {
      worker.terminate();
    } catch {
      // A worker that cannot be terminated is already gone.
    }
  }
}
