use reqwest::Client;
use crate::js_error::JsError;
use crate::koios_client::error_mapper::to_js_error;
use crate::koios_client::models::QueryChainTipResponse;
use crate::koios_client::network_type::NetworkType;

pub(crate) async fn get_chain_tip(network_type: NetworkType) -> Result<QueryChainTipResponse, JsError> {
    let client = Client::new();
    let url = network_type.build_url("tip");

    let response = client
        .get(url)
        .send().await
        .map_err(to_js_error)?;

    let chain_tip: QueryChainTipResponse = response.json().await.map_err(to_js_error)?;
    Ok(chain_tip)
}
