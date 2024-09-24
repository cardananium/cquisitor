use crate::js_error::JsError;
use crate::koios_client::error_mapper::to_js_error;
use crate::koios_client::models::{ApiResult, EpochParamResponse};
use crate::koios_client::network_type::NetworkType;
use reqwest::Client;

pub(crate) async fn get_epoch_protocol_params(
    epoch: u64,
    network_type: NetworkType,
    api_token: &str
) -> Result<EpochParamResponse, JsError> {
    let client = Client::new();
    let url = network_type.build_url(format!("epoch_params?_epoch_no={}", epoch).as_str());

    let response = client
        .get(url)
        .header("Accept", "application/json")
        // .header("Content-Type", "application/json")
        .bearer_auth(api_token)
        .send()
        .await
        .map_err(|err| to_js_error(err, "get_epoch_protocol_params.send"))?;

    let api_result: Vec<EpochParamResponse> = response
        .error_for_status()
        .map_err(|err| to_js_error(err, "get_epoch_protocol_params.status"))?
        .json()
        .await
        .map_err(|err| to_js_error(err, "get_epoch_protocol_params.parse"))?;

    let pp = api_result.first().cloned().map_or_else(
        || {
            Err(JsError::new("No epoch protocol params found"))
        },
        |x| Ok(x),
    )?;

    Ok(pp)
}
