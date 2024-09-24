use std::fmt::format;
use serde::{Deserialize, Serialize};
use crate::js_error::JsError;

#[derive(Serialize, Deserialize, Debug)]
pub (crate) struct UtxoInfoRequest {
    #[serde(rename = "_utxo_refs")]
    pub(crate) utxo_refs: Vec<String>,
    #[serde(rename = "_extended")]
    pub(crate) extended: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub (crate) struct InlineDatum {
    pub(crate) bytes: String,
    pub(crate) value: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug)]
pub (crate) struct ReferenceScript {
    pub(crate) hash: String,
    pub(crate) size: u64,
    #[serde(rename = "type")]
    pub(crate) script_type: String,
    pub(crate) bytes: String,
    pub(crate) value: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug)]
pub (crate) struct Asset {
    pub(crate) policy_id: String,
    pub(crate) asset_name: Option<String>,
    pub(crate) fingerprint: String,
    pub(crate) decimals: u64,
    pub(crate) quantity: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub(crate) struct UtxoInfoResponse {
    pub(crate) tx_hash: String,
    pub(crate) tx_index: u64,
    pub(crate) address: String,
    pub(crate) value: String,
    pub(crate) stake_address: Option<String>,
    pub(crate) payment_cred: Option<String>,
    pub(crate) epoch_no: u64,
    pub(crate) block_height: Option<u64>,
    pub(crate) block_time: u64,
    pub(crate) datum_hash: Option<String>,
    pub(crate) inline_datum: Option<InlineDatum>,
    pub(crate) reference_script: Option<ReferenceScript>,
    pub(crate) asset_list: Option<Vec<Asset>>,
    pub(crate) is_spent: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub(crate) struct QueryChainTipResponse {
    pub(crate) hash: String,
    pub(crate) epoch_no: u64,
    pub(crate) abs_slot: u64,
    pub(crate) epoch_slot: u64,
    pub(crate) block_no: Option<u64>,
    pub(crate) block_time: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub(crate) struct CostModels {
    #[serde(rename = "PlutusV1")]
    pub(crate) plutus_v1: Option<Vec<i64>>,
    #[serde(rename = "PlutusV2")]
    pub(crate) plutus_v2:  Option<Vec<i64>>,
    #[serde(rename = "PlutusV3")]
    pub(crate) plutus_v3: Option<Vec<i64>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub (crate) struct EpochParamResponse {
    pub(crate) epoch_no: u64,
    pub(crate) min_fee_a: Option<u64>,
    pub(crate) min_fee_b: Option<u64>,
    pub(crate) max_block_size: Option<u64>,
    pub(crate) max_tx_size: Option<u64>,
    pub(crate) max_bh_size: Option<u64>,
    pub(crate) key_deposit: Option<String>,
    pub(crate) pool_deposit: Option<String>,
    pub(crate) max_epoch: Option<u64>,
    pub(crate) optimal_pool_count: Option<u64>,
    pub(crate) influence: Option<f64>,
    pub(crate) monetary_expand_rate: Option<f64>,
    pub(crate) treasury_growth_rate: Option<f64>,
    pub(crate) decentralisation: Option<f64>,
    pub(crate) extra_entropy: Option<String>,
    pub(crate) protocol_major: Option<u64>,
    pub(crate) protocol_minor: Option<u64>,
    pub(crate) min_utxo_value: Option<String>,
    pub(crate) min_pool_cost: Option<String>,
    pub(crate) nonce: Option<String>,
    pub(crate) block_hash: String,
    pub(crate) cost_models: Option<CostModels>,
    pub(crate) price_mem: Option<f64>,
    pub(crate) price_step: Option<f64>,
    pub(crate) max_tx_ex_mem: Option<u64>,
    pub(crate) max_tx_ex_steps: Option<u64>,
    pub(crate) max_block_ex_mem: Option<u64>,
    pub(crate) max_block_ex_steps: Option<u64>,
    pub(crate) max_val_size: Option<u64>,
    pub(crate) collateral_percent: Option<u64>,
    pub(crate) max_collateral_inputs: Option<u64>,
    pub(crate) coins_per_utxo_size: Option<String>,
    pub(crate) pvt_motion_no_confidence: Option<f64>,
    pub(crate) pvt_committee_normal: Option<f64>,
    pub(crate) pvt_committee_no_confidence: Option<f64>,
    pub(crate) pvt_hard_fork_initiation: Option<f64>,
    pub(crate) dvt_motion_no_confidence: Option<f64>,
    pub(crate) dvt_committee_normal: Option<f64>,
    pub(crate) dvt_committee_no_confidence: Option<f64>,
    pub(crate) dvt_update_to_constitution: Option<f64>,
    pub(crate) dvt_hard_fork_initiation: Option<f64>,
    pub(crate) dvt_p_p_network_group: Option<f64>,
    pub(crate) dvt_p_p_economic_group: Option<f64>,
    pub(crate) dvt_p_p_technical_group: Option<f64>,
    pub(crate) dvt_p_p_gov_group: Option<f64>,
    pub(crate) dvt_treasury_withdrawal: Option<f64>,
    pub(crate) committee_min_size: Option<u64>,
    pub(crate) committee_max_term_length: Option<u64>,
    pub(crate) gov_action_lifetime: Option<u64>,
    pub(crate) gov_action_deposit: Option<String>,
    pub(crate) drep_deposit: Option<String>,
    pub(crate) drep_activity: Option<u64>,
    pub(crate) pvtpp_security_group: Option<f64>,
    pub(crate) min_fee_ref_script_cost_per_byte: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug)]
pub(crate) struct  ApiError {
    pub(crate) code: Option<u64>,
    pub(crate) message: Option<String>,
    pub(crate) hint: Option<String>,
    pub(crate) error: Option<String>,
}

impl ApiError {
    pub (crate) fn to_js_error(&self) -> JsError {
        JsError::new(&format!("ApiError: {:?}", self))
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(untagged)]
pub(crate) enum ApiResult<T>{
    Ok(T),
    Error(ApiError),
}

impl <T> ApiResult<T>{
    pub(crate) fn is_ok(&self) -> bool {
        match self {
            ApiResult::Ok(_) => true,
            ApiResult::Error(_) => false,
        }
    }

    pub (crate) fn is_err(&self) -> bool {
        !self.is_ok()
    }

    pub (crate) fn map_err<F, E>(self, f: F) -> Result<T, E>
        where F: FnOnce(ApiError) -> E
    {
        match self {
            ApiResult::Ok(t) => Ok(t),
            ApiResult::Error(e) => Err(f(e)),
        }
    }
}