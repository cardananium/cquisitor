// Worker request handling, independent of `self` so tests can stub the library and postMessage.

import { convertSerdeNumbers } from "../../utils/serdeNumbers";
import {
  answersInJsonText,
  isLibFunction,
  type LibErrorPayload,
  type LibRequest,
  type LibResponse,
} from "./protocol";

export type LibModule = Record<string, unknown>;

/** Wasm trap: the instance is poisoned and must not be reused. */
function isTrap(error: unknown): boolean {
  if (typeof WebAssembly !== "undefined" && typeof WebAssembly.RuntimeError === "function") {
    if (error instanceof WebAssembly.RuntimeError) return true;
  }
  return error instanceof Error && error.name === "RuntimeError";
}

/** Stack overflow inside wasm leaves the instance's stack pointer unrestored, so later calls trap. */
function isStackOverflow(error: unknown): boolean {
  return error instanceof RangeError;
}

export function errorPayload(error: unknown): LibErrorPayload {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    fatal: isTrap(error) || isStackOverflow(error),
  };
}

/** The reply to one request: the library's answer, or why there is none. */
export async function answer(
  request: LibRequest,
  loadLib: () => Promise<LibModule>,
): Promise<LibResponse> {
  const { id, gen } = request;
  try {
    if (!isLibFunction(request.fn)) {
      throw new Error(`${String(request.fn)} is not a callable library function`);
    }
    const lib = await loadLib();
    const impl = lib[request.fn];
    if (typeof impl !== "function") {
      throw new Error(`The library does not export ${request.fn}`);
    }
    const raw = (impl as (...a: unknown[]) => unknown)(...request.args);
    if (answersInJsonText(request.fn)) {
      // Post JSON text: a deep object would fail structured clone.
      if (typeof raw !== "string") {
        throw new Error(`The library answered ${request.fn} with something other than JSON text`);
      }
      return { id, gen, ok: true, json: raw };
    }
    // Convert numbers here so the page thread does not walk the result.
    return { id, gen, ok: true, value: convertSerdeNumbers(raw) };
  } catch (error) {
    return { id, gen, ok: false, error: errorPayload(error) };
  }
}

/**
 * Post a reply. If structured clone fails, post a `result_not_transferable` error instead of letting the page hang until the watchdog.
 */
export function reply(response: LibResponse, post: (message: LibResponse) => void): void {
  try {
    post(response);
  } catch (error) {
    const { id, gen } = response;
    post({
      id,
      gen,
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message:
          "The library answered, but the answer could not be handed to the page: " +
          (error instanceof Error ? error.message : String(error)),
        fatal: false,
        kind: "result_not_transferable",
      },
    });
  }
}
