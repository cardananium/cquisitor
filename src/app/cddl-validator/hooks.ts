// Hooks that drive the CDDL validator. Each one owns one slice of derived
// state — kept small so any single concern can be inspected in isolation
// (and so `CddlValidatorContent` reads as composition rather than a 600-
// line god-component).

import { useEffect, useMemo, useState } from "react";
import type {
  CborCddlMapEntry,
  CborPartialValue,
  CborValidationErrorInfo,
  CborValidationResult,
  CborValue,
  CddlValidationResult,
  CddlOutlineEntry,
  CborPosition,
} from "@cardananium/cquisitor-lib";
import {
  safeCborToJson,
  safeDecodeCborAgainstCddl,
  safeMapCborToCddl,
  safeOutline,
  safeReferences,
  safeSymbolAt,
  safeValidateCborAgainstCddl,
  safeValidateCddl,
  type DecodedAgainstSchema,
} from "./cddlValidatorLib";
import {
  cborErrorOnCddlRange,
  cddlParseErrorLine,
  cddlParseErrorRange,
  describeCborError,
  utf16ToByte,
} from "./cddlError";

/** A debounced view of `value` — re-emits `delayMs` after the last change. */
export function useDebouncedString(value: string, delayMs: number): string {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setOut(value), delayMs);
    return () => clearTimeout(h);
  }, [value, delayMs]);
  return out;
}

/** Same idea for arbitrary state. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setOut(value), delayMs);
    return () => clearTimeout(h);
  }, [value, delayMs]);
  return out;
}

// ---------- CBOR decoding ----------

export interface UseCborDecodedResult {
  /** Cleaned hex (whitespace stripped, lowercased). Empty when invalid. */
  cleanHex: string;
  /** Decoded structural CBOR; `partial` on parse failure, `null` if no input. */
  decoded: CborValue | CborPartialValue | null;
}

/**
 * Decodes the user's CBOR input. Strips whitespace, validates that the
 * remaining text is hex, then runs `cbor_to_json`. On a structural error
 * we still keep the partial tree (lib emits one) so the rest of the UI
 * can render what's there.
 */
export function useCborDecoded(rawInput: string): UseCborDecodedResult {
  const cleanHex = useMemo(() => {
    const t = rawInput.trim().replace(/\s/g, "").toLowerCase();
    return /^[0-9a-f]*$/.test(t) ? t : "";
  }, [rawInput]);

  const decoded = useMemo<CborValue | CborPartialValue | null>(() => {
    if (!cleanHex) return null;
    const r = safeCborToJson(cleanHex);
    if (!r) return null;
    if (r.ok) return r.value;
    return r.partial ?? null;
  }, [cleanHex]);

  return { cleanHex, decoded };
}

// ---------- CDDL schema ----------

export interface UseCddlSchemaResult {
  result: CddlValidationResult | null;
  /** Char range in the source for the parse error (or null when valid). */
  errorRange: [number, number] | null;
  errorLine: number | null;
  /** Top-level rule names (kind === "type"). */
  ruleNames: string[];
  /** Full outline — pass to `cddl_outline`-aware UI bits. */
  outline: CddlOutlineEntry[];
}

export function useCddlSchema(cddl: string): UseCddlSchemaResult {
  const result = useMemo(() => safeValidateCddl(cddl), [cddl]);
  const outline = useMemo(() => safeOutline(cddl), [cddl]);
  const ruleNames = useMemo(
    () => outline.filter(e => e.kind === "type").map(e => e.name),
    [outline],
  );
  const errorRange = useMemo(
    () => (result && !result.valid ? cddlParseErrorRange(result.error) : null),
    [result],
  );
  const errorLine = useMemo(
    () => (result && !result.valid ? cddlParseErrorLine(result.error) : null),
    [result],
  );
  return { result, errorRange, errorLine, ruleNames, outline };
}

// ---------- CBOR ↔ CDDL validation ----------

export interface CddlMappedError {
  range: [number, number];
  message: string;
}

export interface UseCborValidationResult {
  result: CborValidationResult | null;
  /** Primary mismatch + every `additional[]` mismatch, deduped, mapped to
   *  CDDL char ranges (ready to render). */
  errorsOnCddl: CddlMappedError[];
}

export function useCborValidation(
  cleanHex: string,
  cddl: string,
  rule: string,
  schemaIsValid: boolean,
): UseCborValidationResult {
  const result = useMemo<CborValidationResult | null>(() => {
    if (!schemaIsValid) return null;
    return safeValidateCborAgainstCddl(cleanHex, cddl, rule);
  }, [cleanHex, cddl, rule, schemaIsValid]);

  const errorsOnCddl = useMemo<CddlMappedError[]>(() => {
    if (!result || result.valid) return [];
    const all: CborValidationErrorInfo[] = [
      result.error,
      ...(result.error.additional ?? []),
    ];
    const out: CddlMappedError[] = [];
    const seen = new Set<string>();
    for (const err of all) {
      const range = cborErrorOnCddlRange(err);
      if (!range) continue;
      const key = `${range[0]}:${range[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ range, message: describeCborError(err) });
    }
    return out;
  }, [result]);

  return { result, errorsOnCddl };
}

// ---------- Schema-mapped JSON view ----------

export function useDecodeAgainstSchema(
  cleanHex: string,
  cddl: string,
  rule: string,
  schemaIsValid: boolean,
): DecodedAgainstSchema | null {
  return useMemo(() => {
    if (!schemaIsValid) return null;
    return safeDecodeCborAgainstCddl(cleanHex, cddl, rule);
  }, [cleanHex, cddl, rule, schemaIsValid]);
}

// ---------- CBOR ⇄ CDDL bridge map ----------

export function useCborCddlMap(
  cleanHex: string,
  cddl: string,
  rule: string,
  schemaIsValid: boolean,
  cborIsValid: boolean,
): CborCddlMapEntry[] {
  return useMemo(() => {
    if (!schemaIsValid || !cborIsValid) return [];
    return safeMapCborToCddl(cleanHex, cddl, rule);
  }, [cleanHex, cddl, rule, schemaIsValid, cborIsValid]);
}

/**
 * Hovering a CBOR tree node points at the matching CDDL span. Picks the
 * entry whose `cbor_byte_span` *starts at* the hovered byte — that anchors
 * the highlight to the specific node, not its container. (The lib only
 * emits map-key entries for named keys, so a hover that doesn't match any
 * exact span returns null instead of falling back to the parent.)
 */
export function useLinkedCddlRange(
  cborCddlMap: CborCddlMapEntry[],
  hoverPosition: CborPosition | null,
): { range: [number, number]; message: string } | null {
  return useMemo(() => {
    if (!hoverPosition || cborCddlMap.length === 0) return null;
    const target = hoverPosition.offset;
    const matchLength = hoverPosition.length;
    const exact = cborCddlMap.filter(e => {
      const b = e.cbor_byte_span ?? e.cbor_anchor_span;
      return b && b.offset === target && b.length === matchLength;
    });
    const candidates = exact.length > 0 ? exact : cborCddlMap.filter(e => {
      const b = e.cbor_byte_span ?? e.cbor_anchor_span;
      return b && b.offset === target;
    });
    if (candidates.length === 0) return null;
    // Synthetic wrapper rows omit `cddl_byte_span` — drop them since
    // there's nothing to highlight in the schema for those.
    const withCddl = candidates.filter(e => e.cddl_byte_span);
    if (withCddl.length === 0) return null;
    withCddl.sort((a, b) => (a.cbor_anchor_span?.length ?? 0) - (b.cbor_anchor_span?.length ?? 0));
    const e = withCddl[0];
    const span = e.cddl_byte_span!;
    const role = e.entry_role === "key" ? "key" : "value";
    return {
      range: [span.char_offset, span.char_offset + span.char_length],
      message: `${e.cbor_type ?? "node"} ${role} at ${e.cbor_path}${e.rule_name ? ` (rule: ${e.rule_name})` : ""}`,
    };
  }, [hoverPosition, cborCddlMap]);
}

// ---------- "References" for the symbol under the caret ----------

/**
 * Returns char-range bounds for every place the symbol under the caret is
 * defined or used. Triggers only on rule-references / type / group symbols
 * (not whitespace, comments or unknown identifiers).
 */
export function useReferenceRanges(
  cddl: string,
  caretOffset: number | null,
): [number, number][] {
  return useMemo(() => {
    if (caretOffset == null || !cddl) return [];
    // cddl_symbol_at expects UTF-8 bytes, the caret is UTF-16 code units.
    const byteOff = utf16ToByte(cddl, caretOffset);
    const sym = safeSymbolAt(cddl, byteOff);
    if (!sym) return [];
    if (sym.kind !== "rule_reference" && sym.kind !== "type" && sym.kind !== "group") return [];
    if (!sym.name) return [];
    const refs = safeReferences(cddl, sym.name);
    if (!refs) return [];
    const out: [number, number][] = [];
    if (refs.definition) {
      out.push([refs.definition.char_offset, refs.definition.char_offset + refs.definition.char_length]);
    }
    for (const u of refs.uses) {
      out.push([u.char_offset, u.char_offset + u.char_length]);
    }
    return out;
  }, [cddl, caretOffset]);
}
