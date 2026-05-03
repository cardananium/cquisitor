// Thin, defensive wrappers around the cquisitor-lib functions used by the
// CDDL validator. They:
//
//  1. Run the result through `convertSerdeNumbers` so callers see plain
//     `number`s instead of `{$serde_json::private::Number: "..."}` boxes.
//  2. Translate `throw` into a clean `null` / `[]`. Many of these
//     functions throw on partial input (mid-typing CDDL, hex changing,
//     unknown rule, etc.); none of those should crash the editor.
//
// Use these from React memos so the rest of the app code is free of
// `try { ... } catch { return null }` boilerplate.

import {
  cbor_to_json,
  validate_cddl,
  validate_cbor_against_cddl,
  decode_cbor_against_cddl,
  cddl_outline,
  cddl_format,
  cddl_symbol_at,
  cddl_references,
  map_cbor_to_cddl,
  type CborDecodeResult,
  type CddlValidationResult,
  type CborValidationResult,
  type CborCddlMapEntry,
  type CddlOutlineEntry,
  type CddlSymbolAtResult,
  type CddlReferencesResult,
} from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";

export function safeCborToJson(hex: string): CborDecodeResult | null {
  if (!hex) return null;
  try {
    const raw = cbor_to_json(hex);
    return convertSerdeNumbers(raw) as CborDecodeResult;
  } catch {
    return null;
  }
}

export function safeValidateCddl(cddl: string): CddlValidationResult | null {
  if (!cddl.trim()) return null;
  try {
    const raw = validate_cddl(cddl);
    return convertSerdeNumbers(raw) as CddlValidationResult;
  } catch {
    return null;
  }
}

export function safeValidateCborAgainstCddl(
  hex: string,
  cddl: string,
  rule: string,
): CborValidationResult | null {
  if (!hex || !cddl.trim() || !rule.trim()) return null;
  try {
    const raw = validate_cbor_against_cddl(hex, cddl, rule);
    return convertSerdeNumbers(raw) as CborValidationResult;
  } catch {
    return null;
  }
}

export type DecodedAgainstSchema =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function safeDecodeCborAgainstCddl(
  hex: string,
  cddl: string,
  rule: string,
): DecodedAgainstSchema | null {
  if (!hex || !cddl.trim() || !rule.trim()) return null;
  try {
    const raw = decode_cbor_against_cddl(hex, cddl, rule);
    return { ok: true, value: convertSerdeNumbers(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function safeMapCborToCddl(
  hex: string,
  cddl: string,
  rule: string,
): CborCddlMapEntry[] {
  if (!hex || !cddl.trim() || !rule.trim()) return [];
  try {
    const raw = map_cbor_to_cddl(hex, cddl, rule);
    return convertSerdeNumbers(raw) as CborCddlMapEntry[];
  } catch {
    return [];
  }
}

export function safeOutline(cddl: string): CddlOutlineEntry[] {
  if (!cddl.trim()) return [];
  try {
    const raw = cddl_outline(cddl);
    return convertSerdeNumbers(raw) as CddlOutlineEntry[];
  } catch {
    return [];
  }
}

export function safeReferences(cddl: string, name: string): CddlReferencesResult | null {
  if (!cddl.trim() || !name) return null;
  try {
    const raw = cddl_references(cddl, name);
    return convertSerdeNumbers(raw) as CddlReferencesResult;
  } catch {
    return null;
  }
}

export function safeSymbolAt(cddl: string, byteOffset: number): CddlSymbolAtResult | null {
  if (!cddl) return null;
  try {
    const raw = cddl_symbol_at(cddl, byteOffset);
    return convertSerdeNumbers(raw) as CddlSymbolAtResult;
  } catch {
    return null;
  }
}

/** Returns `null` when the CDDL is invalid (which is when the lib throws). */
export function safeFormat(cddl: string): string | null {
  if (!cddl.trim()) return null;
  try {
    return cddl_format(cddl);
  } catch {
    return null;
  }
}
