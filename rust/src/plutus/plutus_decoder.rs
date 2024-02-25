use uplc::ast::{DeBruijn, NamedDeBruijn, Program};
use crate::bingen::wasm_bindgen;
use crate::js_error::JsError;

#[wasm_bindgen]
pub fn decode_plutus_program_uplc_json(hex: &str) -> Result<String, JsError> {
    let mut cbor_buffer = Vec::new();
    let mut flat_buffer = Vec::new();
    let program = Program::<DeBruijn>::from_hex(hex, &mut cbor_buffer, &mut flat_buffer)
        .map_err(|e| JsError::new(&e.to_string()))?;

    Ok(super::explain::to_json_program(&program.into()))
}

#[wasm_bindgen]
pub fn decode_plutus_program_pretty_uplc(hex: &str) -> Result<String, JsError> {
    let mut cbor_buffer = Vec::new();
    let mut flat_buffer = Vec::new();
    let program = Program::<DeBruijn>::from_hex(hex, &mut cbor_buffer, &mut flat_buffer)
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(Program::<NamedDeBruijn>::from(program).to_pretty())
}