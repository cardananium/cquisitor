// Unified datum resolution for DEX decoders.
//
// Every datum that reaches a decoder is already a DetailedSchema JSON string,
// whichever way it arrived: cquisitor-lib's decoded Transaction serialises
// both an output's `plutus_data` and a redeemer's `data` that way; Koios hands
// back `inline_datum.value` as the same tree, which the card layer stringifies;
// and the Blockfrost client decodes the CBOR it gets into that tree through the
// worker before building a UTxO from it. So the raw bytes are decoded exactly
// once, in the pass that fetched or decoded the document they came in — never
// here, where there is nothing to await into. A string that is not that JSON
// is not a datum this layer can read, and says so by returning null.
//
// An output can also reference its datum by hash, which is resolved against
// the tx's witness-set datums. This module is the one place that handles both.

import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import type { DataOption } from "@/components/TransactionCardView/types";
import type { PD } from "./plutusData";

/** Decode a DetailedSchema JSON string to `PD`. */
export function decodePlutusJson(raw: string): PD | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return convertSerdeNumbers(parsed) as PD;
    }
  } catch {
    // not the JSON tree — nothing to decode here
  }
  return null;
}

/**
 * Resolve an output's datum to `PD`: an inline datum (decoded), or — when the
 * output only references a datum hash — the matching datum from the tx's
 * witness set (`witnessDatums`, keyed by lowercase datum hash).
 */
export function resolveOutputDatum(
  data: DataOption | null | undefined,
  witnessDatums?: Map<string, PD> | null,
): PD | null {
  if (!data) return null;
  if ("Data" in data) return decodePlutusJson(data.Data);
  if ("DataHash" in data && witnessDatums) {
    return witnessDatums.get(data.DataHash.toLowerCase()) ?? null;
  }
  return null;
}
