// Wire format between the page and the wasm worker. No imports from either side.

/**
 * Allowlist of library functions callable across the worker boundary.
 * Unchecked string names would invoke any wasm export, including constructors that cannot be cloned.
 */
export const LIB_FUNCTIONS = [
  "cbor_to_json",
  "validate_cddl",
  "validate_cbor_against_cddl",
  "decode_cbor_against_cddl",
  "cddl_outline",
  "cddl_format",
  "cddl_symbol_at",
  "cddl_references",
  "map_cbor_to_cddl",
  "get_possible_types_for_input",
  "decode_specific_type",
  "get_necessary_data_list_js",
  "validate_transaction_js",
  "get_ref_script_bytes",
  "extract_hashes_from_transaction_js",
  "add_witnesses_to_tx_with_report",
] as const;

export type LibFunction = (typeof LIB_FUNCTIONS)[number];

const LIB_FUNCTION_SET: ReadonlySet<string> = new Set(LIB_FUNCTIONS);

export function isLibFunction(name: unknown): name is LibFunction {
  return typeof name === "string" && LIB_FUNCTION_SET.has(name);
}

/** Document walkers: answer as JSON text because a deep object fails structured clone. */
const JSON_TEXT_FUNCTIONS: ReadonlySet<LibFunction> = new Set<LibFunction>([
  "cbor_to_json",
  "validate_cbor_against_cddl",
  "decode_cbor_against_cddl",
  "map_cbor_to_cddl",
]);

export function answersInJsonText(fn: LibFunction): boolean {
  return JSON_TEXT_FUNCTIONS.has(fn);
}

export interface LibRequest {
  id: number;
  /** Worker generation. Drop replies from a worker that has been replaced. */
  gen: number;
  fn: LibFunction;
  args: unknown[];
}

/** Posted once when wasm load settles (ok or fail). Call budgets must not run before this. */
export interface LibLoadedMessage {
  type: "loaded";
}

export function isLibLoadedMessage(value: unknown): value is LibLoadedMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "loaded"
  );
}

/** Extra error kind: clone failed after the library answered. Reported so the watchdog does not blame the input. */
export type LibErrorKind = "result_not_transferable";

export interface LibErrorPayload {
  name: string;
  message: string;
  /** True for a wasm trap or stack overflow; that instance is poisoned and the worker must be discarded. */
  fatal: boolean;
  kind?: LibErrorKind;
}

export type LibResponse =
  | { id: number; gen: number; ok: true; value: unknown }
  /** The answer as the JSON text the library wrote — see `answersInJsonText`. */
  | { id: number; gen: number; ok: true; json: string }
  | { id: number; gen: number; ok: false; error: LibErrorPayload };

export function isLibResponse(value: unknown): value is LibResponse {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<LibResponse>;
  return typeof m.id === "number" && typeof m.gen === "number" && typeof m.ok === "boolean";
}
