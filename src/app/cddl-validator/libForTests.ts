// Library called on the calling thread. Tests only; the app uses the worker transport.
// Wrappers in `cddlValidatorLib.ts` are async; this keeps assertions synchronous for pure projections of library output.

import {
  cddl_outline,
  cddl_symbol_at,
  map_cbor_to_cddl,
  validate_cbor_against_cddl,
  validate_cddl,
  type CborCddlMap,
  type CborCddlMapResult,
  type CborValidationResult,
  type CddlOutlineEntry,
  type CddlSymbolAtResult,
  type CddlValidationResult,
} from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers, parseSerdeJson } from "@/utils/serdeNumbers";
import type { CborValidationOutcome, CddlSchemaOutcome } from "./cddlValidatorLib";

// ---------- documents ----------

export const PERSON_RULE = "Person";

export const PERSON_SCHEMA = `; CDDL schema — edit me.
Person = {
  name: tstr,
  age: uint,
  ? nickname: tstr,
}
`;

/** `{"name": "Alice", "age": 30, "nickname": "Ali"}` — matches PERSON_SCHEMA. */
export const PERSON_DOC_HEX =
  "a3646e616d6565416c69636563616765181e686e69636b6e616d6563416c69";

/** A transaction that validates against the Conway `transaction` rule. */
export const CONWAY_TX_HEX =
  "84a400828258203b0eb1cf5f6b3a1d0e7a1b0f8c3d2e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3008258207c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f030182a200583901d9d0e2b0e9f3b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9011a0016e360a2005839011a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708101821a007da647a1581c0f5560dbc05282e05507aedb02d823d9d9f0e583cce579b81f9d1cd8a144534e454b182a021a0002b7d1031a07f3d043a100818258205c3f6f6a2a51b1d1b0a0aa1e8b0e3e2a1d4c5b6a7988796a5b4c3d2e1f0a9b8c5840b1a2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901f2e3d4c5b6a798807162534435261708f9e0d1c2b3a49586776859403122130f5f6";

export function outlineOf(cddl: string): CddlOutlineEntry[] {
  if (!cddl.trim()) return [];
  try {
    return convertSerdeNumbers(cddl_outline(cddl)) as CddlOutlineEntry[];
  } catch {
    return [];
  }
}

/**
 * Map for `hex`. A walk the library refuses is thrown, naming the kind — an empty map would pass as "nothing mapped".
 */
export function mapOf(hex: string, cddl: string, rule: string): CborCddlMap {
  const result = parseSerdeJson<CborCddlMapResult>(map_cbor_to_cddl(hex, cddl, rule));
  if (!result.ok) {
    throw new Error(`map_cbor_to_cddl refused ${rule}: ${result.error.kind} — ${result.error.message}`);
  }
  return result.value;
}

/** Shaped like `safeValidateCddl`'s outcome so a test reads the same whichever it was given. */
export function validateCddlOf(cddl: string): CddlSchemaOutcome | null {
  if (!cddl.trim()) return null;
  try {
    return { ok: true, result: convertSerdeNumbers(validate_cddl(cddl)) as CddlValidationResult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function validateCborOf(
  hex: string,
  cddl: string,
  rule: string,
): CborValidationOutcome | null {
  if (!hex || !cddl.trim() || !rule.trim()) return null;
  try {
    return {
      ok: true,
      result: parseSerdeJson<CborValidationResult>(validate_cbor_against_cddl(hex, cddl, rule)),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function symbolAtOf(cddl: string, byteOffset: number): CddlSymbolAtResult | null {
  if (!cddl) return null;
  try {
    return convertSerdeNumbers(cddl_symbol_at(cddl, byteOffset)) as CddlSymbolAtResult;
  } catch {
    return null;
  }
}
