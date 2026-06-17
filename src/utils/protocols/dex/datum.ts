// Unified datum resolution for DEX decoders.
//
// cquisitor-lib's decoded Transaction pre-decodes inline datums into a JSON
// string of the plutus tree (DetailedSchema-shaped). But some call paths still
// hand us raw CBOR hex (e.g. Koios inline datums, or a redeemer's `data`). And
// an output can reference its datum by hash, which we resolve against the tx's
// witness-set datums. This module is the one place that handles all three.

import { decode_specific_type } from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import type { DataOption } from "@/components/TransactionCardView/types";
import type { PD } from "./plutusData";

/** Decode a DetailedSchema JSON string, or a raw PlutusData CBOR hex string, to `PD`. */
export function decodePlutusJsonOrHex(raw: string): PD | null {
  // 1) Try JSON parse — the common case from a decoded Transaction.
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return convertSerdeNumbers(parsed) as PD;
    }
  } catch {
    // not JSON; fall through to CBOR-hex path
  }
  // 2) Fall back to treating it as a CBOR hex string.
  try {
    const decoded = decode_specific_type(raw, "PlutusData", {
      plutus_data_schema: "DetailedSchema",
    }) as { plutus_data: PD };
    return convertSerdeNumbers(decoded.plutus_data) as PD;
  } catch {
    return null;
  }
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
  if ("Data" in data) return decodePlutusJsonOrHex(data.Data);
  if ("DataHash" in data && witnessDatums) {
    return witnessDatums.get(data.DataHash.toLowerCase()) ?? null;
  }
  return null;
}
