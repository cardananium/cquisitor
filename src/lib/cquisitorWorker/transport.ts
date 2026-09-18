// Library call surface: one `call`, plus failures that are not library answers.
// WorkerTransport is abandonable; DirectTransport runs in-process with no watchdog.

import type { LibFunction } from "./protocol";

export interface LibCallOptions {
  /**
   * Called once when the call has run long enough to show a working state.
   * Never called after the call settles.
   */
  onSlow?: () => void;
  /**
   * Aborts a queued call. After dispatch this is a no-op; wasm cannot be interrupted without killing the worker.
   */
  signal?: AbortSignal;
}

export interface LibTransport {
  call<T = unknown>(fn: LibFunction, args: unknown[], options?: LibCallOptions): Promise<T>;
}

/** Input refused before it reached the library, on size. */
export class LibInputTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibInputTooLargeError";
  }
}

/** A pass that ran past the hard limit and was abandoned. */
export class LibTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibTimeoutError";
  }
}

/** The worker died, or never started, so the pass never ran. */
export class LibUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibUnavailableError";
  }
}

/**
 * The library answered, but structured clone of the result failed.
 * Reported so the page does not wait for the watchdog.
 */
export class LibResultNotTransferableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibResultNotTransferableError";
  }
}

/** The caller dropped the call before it was dispatched. */
export class LibAbortedError extends Error {
  constructor(message = "The library call was superseded before it ran.") {
    super(message);
    this.name = "LibAbortedError";
  }
}

export function isLibAbortedError(error: unknown): boolean {
  return error instanceof LibAbortedError;
}

/** True when the throw is a size/timeout/unavailable/clone refusal, not a library answer. */
export function isLibRefusal(error: unknown): boolean {
  return (
    error instanceof LibInputTooLargeError ||
    error instanceof LibTimeoutError ||
    error instanceof LibUnavailableError ||
    error instanceof LibResultNotTransferableError
  );
}

/** The sentence a panel shows for a failure that is not an answer. */
export function libErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
