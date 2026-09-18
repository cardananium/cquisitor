// Page-wide library transport: one shared worker.
// A trap here kills a replaceable worker, not a wasm instance the UI holds.

import { createDirectTransport } from "./directTransport";
import { WorkerTransport, type WorkerLike } from "./workerClient";
import type { LibCallOptions, LibTransport } from "./transport";
import type { LibFunction } from "./protocol";

export type { LibTransport, LibCallOptions } from "./transport";
export {
  LibAbortedError,
  LibInputTooLargeError,
  LibResultNotTransferableError,
  LibTimeoutError,
  LibUnavailableError,
  isLibAbortedError,
  isLibRefusal,
  libErrorMessage,
} from "./transport";
export type { LibFunction } from "./protocol";
export { LIB_FUNCTIONS } from "./protocol";
export { WorkerTransport, type WorkerLike } from "./workerClient";
export { createDirectTransport } from "./directTransport";

/**
 * Use `new URL(..., import.meta.url)` so the bundler emits the worker chunk with the right base path.
 * The file is also copied as a static asset; nothing loads that copy.
 */
function spawnLibWorker(): WorkerLike {
  return new Worker(new URL("./cquisitorLib.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;
}

function createDefaultTransport(): LibTransport {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return createDirectTransport();
  }
  // Fallback in-process if the worker script never loads. That path has no watchdog.
  return new WorkerTransport({ spawn: spawnLibWorker, fallback: createDirectTransport });
}

let transport: LibTransport | null = null;

/** Shared transport, created on first use so unused visits never spawn a worker. */
export function getLibTransport(): LibTransport {
  if (!transport) transport = createDefaultTransport();
  return transport;
}

/** Replaces the transport. For tests; `null` restores the default. */
export function setLibTransport(next: LibTransport | null): void {
  transport = next;
}

export function callLib<T = unknown>(
  fn: LibFunction,
  args: unknown[],
  options?: LibCallOptions,
): Promise<T> {
  return getLibTransport().call<T>(fn, args, options);
}
