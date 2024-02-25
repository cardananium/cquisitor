use cardano_serialization_lib::TransactionInputs;
use pallas::ledger::primitives::alonzo::TransactionInput;
use reqwest::Client;
use crate::js_error::JsError;
use crate::koios_client::error_mapper::to_js_error;
use crate::koios_client::models::{UtxoInfoRequest, UtxoInfoResponse};
use crate::koios_client::network_type::NetworkType;

pub(crate) async fn get_utxos(inputs: Vec<String>, network_type: NetworkType) -> Result<Vec<UtxoInfoResponse>, JsError> {
    let client = Client::new();
    let mut inputs_request = UtxoInfoRequest {
        utxo_refs: vec![],
        extended: false,
    };

    for input in inputs {
        inputs_request.utxo_refs.push(input);
    }

    let url = network_type.build_url("utxo_info");

    let response = client
        .post(url)
        .json(&inputs_request)
        .send().await
        .map_err(to_js_error)?;

    let utxo_infos: Vec<UtxoInfoResponse> = response.json().await.map_err(to_js_error)?;
    Ok(utxo_infos)
}