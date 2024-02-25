use reqwest::Client;
use crate::js_error::JsError;
use crate::koios_client::error_mapper::to_js_error;
use crate::koios_client::models::{EpochParamResponse};
use crate::koios_client::network_type::NetworkType;

pub(crate) async fn get_epoch_protocol_params(epoch: u64, network_type: NetworkType) -> Result<EpochParamResponse, JsError> {
    let client = Client::new();
    let url = network_type.build_url(format!("epoch_params?_epoch_no={}", epoch).as_str());

    let response = client
        .get(url)
        .send().await
        .map_err(to_js_error)?;

    let chain_tip: EpochParamResponse = response.json().await.map_err(to_js_error)?;
    Ok(chain_tip)
}
