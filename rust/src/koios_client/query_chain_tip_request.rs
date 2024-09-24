use crate::js_error::JsError;
use crate::koios_client::error_mapper::to_js_error;
use crate::koios_client::models::{ApiResult, QueryChainTipResponse};
use crate::koios_client::network_type::NetworkType;
use reqwest::Client;

pub(crate) async fn get_chain_tip(
    network_type: NetworkType,
    api_token: &str,
) -> Result<QueryChainTipResponse, JsError> {
    let client = Client::new();
    let url = network_type.build_url("tip");

    let response = client
        .get(url)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .bearer_auth(api_token)
        .send()
        .await
        .map_err(|err| to_js_error(err, "get_chain_tip.send"))?;

    let api_result: ApiResult<Vec<QueryChainTipResponse>> = response
        .error_for_status()
        .map_err(|err| to_js_error(err, "get_chain_tip.status"))?
        .json()
        .await
        .map_err(|err| to_js_error(err, "get_chain_tip.parse"))?;

    let chain_tip = api_result.map_err(|err| err.to_js_error())?;
    Ok(chain_tip.first().cloned().unwrap_or_default())
}
