use std::str::FromStr;
use cardano_serialization_lib::*;
use cardano_serialization_lib::{
    Address,
    ByronAddress,
    EnterpriseAddress,
    RewardAddress,
    BaseAddress,
    Credential,
    PointerAddress,
    CredKind,
    Pointer,
};
use cardano_serialization_lib::{PlutusData, PlutusDatumSchema, PlutusScript};
use cardano_serialization_lib::hash_plutus_data;

use serde_json::{Number, Value};
use crate::bingen::wasm_bindgen;

use crate::js_error::JsError;

#[wasm_bindgen]
pub fn decode_address_with_extended_info(hex_or_bech32: &str) -> Result<String, JsError> {
    let address =
        Address::from_bech32(hex_or_bech32).map_or_else(
            |_| Address::from_hex(hex_or_bech32)
                .map_err(|e| JsError::new(&format!("Error decoding address: {:?}", e))),
            |address| Ok(address))?;

    let mut obj = serde_json::Map::new();
    obj.insert("address".to_string(), Value::String(address.to_bech32(None)
        .map_err(|e| JsError::new(&format!("Error encoding address: {:?}", e)))?));

    let mut extended_data_obj = serde_json::Map::new();

    let network_id = address.network_id()
        .map_err(|e| JsError::new(&format!("Error getting network id: {:?}", e)))?;

    if let Some(base_address) = BaseAddress::from_address(&address) {
        extended_data_obj.insert("type".to_string(), Value::String("BaseAddress".to_string()));
        extended_data_obj.insert("internal_data".to_string(), base_address_to_json(&base_address, network_id));
    } else if let Some(enterprise_address) = EnterpriseAddress::from_address(&address) {
        extended_data_obj.insert("type".to_string(), Value::String("EnterpriseAddress".to_string()));
        extended_data_obj.insert("internal_data".to_string(), enterprise_address_to_json(&enterprise_address, network_id));
    } else if let Some(pointer_address) = PointerAddress::from_address(&address) {
        extended_data_obj.insert("type".to_string(), Value::String("PointerAddress".to_string()));
        extended_data_obj.insert("internal_data".to_string(), pointer_address_to_json(&pointer_address, network_id));
    } else if let Some(reward_address) = RewardAddress::from_address(&address) {
        extended_data_obj.insert("type".to_string(), Value::String("RewardAddress".to_string()));
        extended_data_obj.insert("internal_data".to_string(), reward_address_to_json(&reward_address, network_id));
    } else if let Some(byron_address) = ByronAddress::from_address(&address) {
        extended_data_obj.insert("type".to_string(), Value::String("ByronAddress".to_string()));
        extended_data_obj.insert("internal_data".to_string(), byron_address_to_json(&byron_address, network_id));
    }

    obj.insert("extended_data".to_string(), Value::Object(extended_data_obj));

    Ok(Value::Object(obj).to_string())
}

#[wasm_bindgen]
pub fn decode_native_script_with_extended_info(hex: &str) -> Result<String, JsError> {
    let script = NativeScript::from_hex(hex)
        .map_err(|e| JsError::new(&format!("Error decoding script: {:?}", e)))?;
    let hash = script.hash();

    let script_obj = Value::from_str(&script.to_json().unwrap()).unwrap();

    let mut obj = serde_json::Map::new();
    obj.insert("script_hash".to_string(), Value::String(hash.to_hex()));
    obj.insert("script".to_string(), script_obj);

    Ok(Value::Object(obj).to_string())
}

#[wasm_bindgen]
pub fn decode_plutus_script_with_extended_info(hex: &str) -> Result<String, JsError> {
    let script = PlutusScript::from_hex(hex)
        .map_err(|e| JsError::new(&format!("Error decoding script: {:?}", e)))?;
    let hash = script.hash();

    let script_obj = Value::String(script.to_hex());

    let mut obj = serde_json::Map::new();
    obj.insert("script_hash".to_string(), Value::String(hash.to_hex()));
    obj.insert("script".to_string(), script_obj);

    Ok(Value::Object(obj).to_string())
}

#[wasm_bindgen]
pub fn decode_plutus_data(hex: &str, schema: u32) -> Result<String, JsError> {
    let data = PlutusData::from_hex(hex)
        .map_err(|e| JsError::new(&format!("Error decoding data: {:?}", e)))?;
    let hash = hash_plutus_data(&data);

    let schema = match schema {
        0 => PlutusDatumSchema::BasicConversions,
        1 => PlutusDatumSchema::DetailedSchema,
        _ => return Err(JsError::new(&format!("Invalid schema: {}", schema))),
    };

    let data_obj = Value::from_str(&data.to_json(schema).unwrap()).unwrap();

    let mut obj = serde_json::Map::new();
    obj.insert("data_hash".to_string(), Value::String(hash.to_hex()));
    obj.insert("data".to_string(), data_obj);

    Ok(Value::Object(obj).to_string())
}

fn base_address_to_json(addr: &BaseAddress, network_id: u8) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("payment_cred".to_string(), stake_cred_to_json(&addr.payment_cred()));
    obj.insert("stake_cred".to_string(), stake_cred_to_json(&addr.stake_cred()));
    obj.insert("network_id".to_string(), Value::Number(Number::from(network_id)));
    Value::Object(obj)
}

fn enterprise_address_to_json(addr: &EnterpriseAddress, network_id: u8) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("payment_cred".to_string(), stake_cred_to_json(&addr.payment_cred()));
    obj.insert("network_id".to_string(), Value::Number(Number::from(network_id)));
    Value::Object(obj)
}

fn pointer_address_to_json(addr: &PointerAddress, network_id: u8) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("payment_cred".to_string(), stake_cred_to_json(&addr.payment_cred()));
    obj.insert("network_id".to_string(), Value::Number(Number::from(network_id)));
    obj.insert("pointer".to_string(), pointer_to_json(&addr.stake_pointer()));
    Value::Object(obj)
}

fn pointer_to_json(pointer: &Pointer) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("slot_num".to_string(), Value::String(pointer.slot_bignum().to_string()));
    obj.insert("tx_index".to_string(), Value::String(pointer.tx_index_bignum().to_string()));
    obj.insert("cert_index".to_string(), Value::String(pointer.cert_index_bignum().to_string()));
    Value::Object(obj)
}

fn reward_address_to_json(addr: &RewardAddress, network_id: u8) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("payment_cred".to_string(), stake_cred_to_json(&addr.payment_cred()));
    obj.insert("network_id".to_string(), Value::Number(Number::from(network_id)));
    Value::Object(obj)
}

fn byron_address_to_json(addr: &ByronAddress, network_id: u8) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("attributes".to_string(), Value::String(bytes_to_string(&addr.attributes())));
    obj.insert("network_id".to_string(), Value::Number(Number::from(network_id)));
    obj.insert("protocol_magic".to_string(), Value::Number(Number::from(addr.byron_protocol_magic())));
    Value::Object(obj)
}

fn bytes_to_string(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join("")
}

fn stake_cred_to_json(creds: &Credential) -> Value {
    let mut obj = serde_json::Map::new();
    match creds.kind() {
        CredKind::Key => {
            if let Some(key_hash) = creds.to_keyhash() {
                obj.insert("key_hash".to_string(),Value::String(key_hash.to_hex()));
            }
        },
        CredKind::Script => {
            if let Some(script_hash) = creds.to_scripthash() {
                obj.insert("script_hash".to_string(),Value::String(script_hash.to_hex()));
            }
        },
    }

    Value::from(obj)
}