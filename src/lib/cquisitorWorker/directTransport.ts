// In-process library calls. Used by tests and as fallback when Worker is missing.
// Cannot abandon a pass; enforces the size budget only.

import { MAX_LIB_INPUT_BYTES, argumentByteLength, overBudgetMessage } from "@/utils/inputBudget";
import { readAnswer } from "./answers";
import { isLibFunction, type LibFunction } from "./protocol";
import { LibInputTooLargeError, type LibCallOptions, type LibTransport } from "./transport";

type LibModule = Record<string, unknown>;

/**
 * Per-function input-size ceilings. `validate_transaction_js` includes fetched chain context, not just the tx bytes.
 */
const INPUT_BUDGETS: Partial<Record<LibFunction, number>> = {
  validate_transaction_js: 16 * 1024 * 1024,
};

/** The ceiling that applies to one call. */
export function inputBudgetFor(fn: LibFunction): number {
  return INPUT_BUDGETS[fn] ?? MAX_LIB_INPUT_BYTES;
}

/** Refuse oversized input before it is copied into wasm. Shared by both transports. */
export function guardInputBudget(fn: LibFunction, args: readonly unknown[]): void {
  const limit = inputBudgetFor(fn);
  const bytes = argumentByteLength(args, limit);
  const message = overBudgetMessage(bytes, limit);
  if (message) throw new LibInputTooLargeError(message);
}

/** Do not cache: a held reference would pin real exports over a test stand-in. */
async function loadLib(): Promise<LibModule> {
  return (await import("@cardananium/cquisitor-lib")) as unknown as LibModule;
}

export function createDirectTransport(): LibTransport {
  return {
    async call<T>(fn: LibFunction, args: unknown[], _options?: LibCallOptions): Promise<T> {
      void _options;
      if (!isLibFunction(fn)) throw new Error(`${fn} is not a callable library function`);
      guardInputBudget(fn, args);
      const lib = await loadLib();
      const impl = lib[fn];
      if (typeof impl !== "function") {
        throw new Error(`The library does not export ${fn}`);
      }
      const raw = (impl as (...a: unknown[]) => unknown)(...args);
      // Same parse path as a worker reply, so tests exercise the browser read.
      return readAnswer(fn, raw) as T;
    },
  };
}
