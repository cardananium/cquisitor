// Wrappers around cquisitor-lib for the CDDL validator.
// Calls go through the worker; throws become empty values or `{ok: false}`.

import type {
  CborDecodeResult,
  CddlValidationResult,
  CborValidationResult,
  CborCddlMap,
  CborCddlMapResult,
  CborCddlWalkError,
  CborCddlWalkErrorKind,
  CborDecodeAgainstCddlResult,
  CddlOutlineEntry,
  CddlSymbolAtResult,
  CddlReferencesResult,
} from "@cardananium/cquisitor-lib";
import { callLib, libErrorMessage, type LibCallOptions } from "@/lib/cquisitorWorker";

export type CborToJsonOutcome =
  | { ok: true; result: CborDecodeResult }
  | { ok: false; error: string };

/**
 * `null` when there is nothing to decode. A throw is the decoder giving up —
 * `{ok: false}` rather than `null`, so a hex panel is never empty without a reason.
 */
export async function safeCborToJson(
  hex: string,
  options?: LibCallOptions,
): Promise<CborToJsonOutcome | null> {
  if (!hex) return null;
  try {
    return { ok: true, result: await callLib<CborDecodeResult>("cbor_to_json", [hex], options) };
  } catch (e) {
    return { ok: false, error: libErrorMessage(e) };
  }
}

export type CddlSchemaOutcome =
  | { ok: true; result: CddlValidationResult }
  | { ok: false; error: string };

/**
 * `null` when there is no schema yet. A parse failure is a result (`valid: false`);
 * a throw is the checker giving up, and every panel below is gated on it.
 */
export async function safeValidateCddl(
  cddl: string,
  options?: LibCallOptions,
): Promise<CddlSchemaOutcome | null> {
  if (!cddl.trim()) return null;
  try {
    return { ok: true, result: await callLib<CddlValidationResult>("validate_cddl", [cddl], options) };
  } catch (e) {
    return { ok: false, error: libErrorMessage(e) };
  }
}

export type CborValidationOutcome =
  | { ok: true; result: CborValidationResult }
  | { ok: false; error: string };

/**
 * `null` when there is nothing to check yet. A throw becomes `{ok: false}`
 * rather than `null` — bad hex and internal failures both need to be shown.
 */
export async function safeValidateCborAgainstCddl(
  hex: string,
  cddl: string,
  rule: string,
  options?: LibCallOptions,
): Promise<CborValidationOutcome | null> {
  if (!hex || !cddl.trim() || !rule.trim()) return null;
  try {
    return {
      ok: true,
      result: await callLib<CborValidationResult>(
        "validate_cbor_against_cddl",
        [hex, cddl, rule],
        options,
      ),
    };
  } catch (e) {
    return { ok: false, error: libErrorMessage(e) };
  }
}

/**
 * Why a schema walk (labelled decode or bridge map) produced no answer.
 * Library refusals keep their `kind`; no answer at all is `call_failed`. Branch on `kind`; `message` is not stable.
 */
export interface WalkRefusal {
  kind: CborCddlWalkErrorKind | "call_failed";
  message: string;
}

function refusedBy(error: CborCddlWalkError): WalkRefusal {
  return { kind: error.kind, message: error.message };
}

function callFailed(e: unknown): WalkRefusal {
  return { kind: "call_failed", message: libErrorMessage(e) };
}

export type DecodedAgainstSchema =
  | { ok: true; value: unknown }
  | { ok: false; error: WalkRefusal };

/**
 * `null` when there is nothing to decode yet. A refused walk and a failed call
 * both come back with a kind, so the panel is never blank without a reason.
 */
export async function safeDecodeCborAgainstCddl(
  hex: string,
  cddl: string,
  rule: string,
  options?: LibCallOptions,
): Promise<DecodedAgainstSchema | null> {
  if (!hex || !cddl.trim() || !rule.trim()) return null;
  try {
    const result = await callLib<CborDecodeAgainstCddlResult>(
      "decode_cbor_against_cddl",
      [hex, cddl, rule],
      options,
    );
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: refusedBy(result.error) };
  } catch (e) {
    return { ok: false, error: callFailed(e) };
  }
}

export type CborCddlMapOutcome =
  | { ok: true; map: CborCddlMap }
  | { ok: false; error: WalkRefusal };

/**
 * `null` when there is nothing to map yet. A refusal keeps its kind rather
 * than becoming an empty map — empty means "nothing lined up", which a bound
 * or missing rule is not.
 */
export async function safeMapCborToCddl(
  hex: string,
  cddl: string,
  rule: string,
  options?: LibCallOptions,
): Promise<CborCddlMapOutcome | null> {
  if (!hex || !cddl.trim() || !rule.trim()) return null;
  try {
    const result = await callLib<CborCddlMapResult>("map_cbor_to_cddl", [hex, cddl, rule], options);
    return result.ok
      ? { ok: true, map: result.value }
      : { ok: false, error: refusedBy(result.error) };
  } catch (e) {
    return { ok: false, error: callFailed(e) };
  }
}

export async function safeOutline(
  cddl: string,
  options?: LibCallOptions,
): Promise<CddlOutlineEntry[]> {
  if (!cddl.trim()) return [];
  try {
    return await callLib<CddlOutlineEntry[]>("cddl_outline", [cddl], options);
  } catch {
    return [];
  }
}

export async function safeReferences(
  cddl: string,
  name: string,
  options?: LibCallOptions,
): Promise<CddlReferencesResult | null> {
  if (!cddl.trim() || !name) return null;
  try {
    return await callLib<CddlReferencesResult>("cddl_references", [cddl, name], options);
  } catch {
    return null;
  }
}

export async function safeSymbolAt(
  cddl: string,
  byteOffset: number,
  options?: LibCallOptions,
): Promise<CddlSymbolAtResult | null> {
  if (!cddl) return null;
  try {
    return await callLib<CddlSymbolAtResult>("cddl_symbol_at", [cddl, byteOffset], options);
  } catch {
    return null;
  }
}

/** Returns `null` when the CDDL is invalid (which is when the lib throws). */
export async function safeFormat(
  cddl: string,
  options?: LibCallOptions,
): Promise<string | null> {
  if (!cddl.trim()) return null;
  try {
    return await callLib<string>("cddl_format", [cddl], options);
  } catch {
    return null;
  }
}

export type FormatOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/** `kind name` for every outlined rule, sorted — identity for "did format change the declarations?". */
async function ruleSignature(cddl: string): Promise<string[]> {
  const outline = await safeOutline(cddl);
  return outline.map(e => `${e.kind} ${e.name}`).sort();
}

/**
 * Formats `cddl` only if the result still parses and declares the same rules.
 * The formatter can drop comments even when accepted; callers should keep the previous text for undo.
 */
export async function formatCddlChecked(cddl: string): Promise<FormatOutcome> {
  const formatted = await safeFormat(cddl);
  if (formatted === null) return { ok: false, reason: "the formatter could not parse this schema" };
  if (formatted === cddl) return { ok: true, text: formatted };

  const check = await safeValidateCddl(formatted);
  if (!check) return { ok: false, reason: "the formatted schema could not be re-checked" };
  if (!check.ok) return { ok: false, reason: `the formatted schema could not be re-checked — ${check.error}` };
  if (!check.result.valid) {
    return {
      ok: false,
      reason: `the formatted schema no longer parses — ${check.result.error.kind}: ${check.result.error.message}`,
    };
  }

  const before = await ruleSignature(cddl);
  const after = await ruleSignature(formatted);
  const lost = before.filter(r => !after.includes(r));
  const gained = after.filter(r => !before.includes(r));
  if (lost.length > 0 || gained.length > 0) {
    const parts: string[] = [];
    if (lost.length > 0) parts.push(`lost ${lost.join(", ")}`);
    if (gained.length > 0) parts.push(`added ${gained.join(", ")}`);
    return { ok: false, reason: `the formatted schema declares different rules — ${parts.join("; ")}` };
  }

  return { ok: true, text: formatted };
}
