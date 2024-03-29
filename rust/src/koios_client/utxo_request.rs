use crate::js_error::JsError;
use crate::koios_client::error_mapper::to_js_error;
use crate::koios_client::models::{ApiError, ApiResult, UtxoInfoRequest, UtxoInfoResponse};
use crate::koios_client::network_type::NetworkType;
use cardano_serialization_lib::TransactionInputs;
use itertools::Itertools;
use pallas::ledger::primitives::alonzo::TransactionInput;
use reqwest::Client;

pub(crate) async fn get_utxos(
    inputs: &Vec<String>,
    network_type: NetworkType,
    api_token: &str
) -> Result<Vec<UtxoInfoResponse>, JsError> {
    let client = Client::new();
    let mut inputs_request = UtxoInfoRequest {
        utxo_refs: vec![],
        extended: true,
    };

    for input in inputs {
        inputs_request.utxo_refs.push(input.clone());
    }

    let url = network_type.build_url("utxo_info");

    let response = client
        .post(url)
        .json(&inputs_request)
        .bearer_auth(api_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| to_js_error(err, "get_utxos.send"))?;

    let utxo_infos: ApiResult<Vec<Option<UtxoInfoResponse>>> = response
        .error_for_status()
        .map_err(|err| to_js_error(err, "get_utxos.status"))?
        .json()
        .await
        .map_err(|err| to_js_error(err, "get_utxos.parse"))?;

    let result = utxo_infos
        .map_err(|err: ApiError| err.to_js_error())?
        .into_iter().filter_map(|x| x).collect_vec();
    Ok(result)
}
