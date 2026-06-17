// STUB — pending a cquisitor-lib export. See the plan below.
//
// This module used to hand-roll an encoder from cquisitor-lib's DetailedSchema
// PlutusData JSON (e.g. `{"constructor":0,"fields":[...]}`) to canonical
// PlutusData CBOR hex, because de-uplc-web's parts-mode `redeemer`/`datum`
// params want CBOR hex and cquisitor-lib only DECODES (cbor → json), it exposes
// no inverse. That ~100 lines of CBOR plumbing was removed.
//
// ─────────────────────────────────────────────────────────────────────────────
// TODO(deuplc): implement the json → cbor conversion in cquisitor-lib, not here.
//
// cquisitor-lib ALREADY depends on the CSL Rust crate (cardano-serialization-lib
// 15.0.3) and decodes PlutusData via `csl::PlutusData::from_hex(..).to_json(
// DetailedSchema)`. The inverse is built into the same crate, so a thin
// wasm_bindgen export does the job WITHOUT pulling CSL into the frontend bundle
// (we deliberately avoid that — cquisitor's wasm is already ~6.5 MB).
//
// 1. Add to ../cquisitor-lib (mirrors the existing `cbor_to_json` export):
//
//      #[wasm_bindgen]
//      pub fn plutus_data_json_to_cbor(json: &str) -> Result<String, JsValue> {
//          use cardano_serialization_lib::{PlutusData, PlutusDatumSchema};
//          PlutusData::from_json(json, PlutusDatumSchema::DetailedSchema)
//              .map(|pd| pd.to_hex())
//              .map_err(|e| JsValue::from_str(&format!("{e}")))
//      }
//
//    Then wasm-pack build → bump version → npm publish.
// 2. Here: replace the stub below with `plutus_data_json_to_cbor(t)` for JSON
//    input (keep the "already hex → passthrough" guard), and re-add a test.
//
// The de-uplc buttons are currently hidden via DEUPLC_ENABLED, so this path is
// dormant and the stub's passthrough is never exercised in the UI.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STUB. Real conversion is deferred to cquisitor-lib (see TODO above). Hex input
 * (already-encoded inline datum) passes through; DetailedSchema JSON is returned
 * unchanged for now — the de-uplc feature is disabled, so this is never reached.
 */
export function plutusJsonToCborHex(s: string): string {
  return s.trim();
}
