use std::collections::HashSet;
use crate::bingen::wasm_bindgen;
use crate::js_error::JsError;
use crate::koios_client::epoch_protocol_params_request::get_epoch_protocol_params;
use crate::koios_client::models::{EpochParamResponse, QueryChainTipResponse, UtxoInfoResponse};
use crate::koios_client::query_chain_tip_request::get_chain_tip;
use crate::koios_client::utxo_request::get_utxos;
use crate::netwrok_type::NetworkType;
use cardano_serialization_lib::Address;
use itertools::Itertools;
use pallas_codec::minicbor::Decode;
use pallas_codec::utils::{Bytes, CborWrap, KeyValuePairs, NonEmptyKeyValuePairs, PositiveCoin};
use pallas_crypto::hash::Hash;
use pallas_primitives::conway::{AssetName, CostMdls, ExUnits, MintedTx, Multiasset, NativeScript, PlutusData, PlutusV1Script, PlutusV2Script, PlutusV3Script};
use pallas_primitives::conway::{
    PolicyId, PostAlonzoTransactionOutput, PseudoScript, Redeemer, RedeemerTag, ScriptRef,
    TransactionOutput,
};
use pallas_primitives::conway::DatumOption;
use pallas_primitives::conway::Language::PlutusV3;
use pallas_primitives::Fragment;
use pallas_traverse::{Era, MultiEraTx};
use serde_json::{Map, Number, Value};
use uplc::machine::cost_model::ExBudget;
use uplc::tx::error::Error;
use uplc::tx::DataLookupTable;
use uplc::tx::{eval, eval_phase_one, ResolvedInput, SlotConfig};
use uplc::TransactionInput;

#[wasm_bindgen]
pub fn get_utxo_list_from_tx(tx_hex: &str) -> Result<Vec<String>, JsError> {
    let tx_bytes = hex::decode(tx_hex).map_err(|e| JsError::new(&e.to_string()))?;
    let mtx = MultiEraTx::decode_for_era(Era::Conway, &tx_bytes)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let tx = match mtx {
        MultiEraTx::Conway(tx) => tx.into_owned(),
        _ => return Err(JsError::new("Invalid transaction type")),
    };

    let mut all_inputs = Vec::new();
    for input in tx.transaction_body.inputs.iter() {
        all_inputs.push(input_to_request_format(input));
    }
    if let Some(ref_inputs) = &tx.transaction_body.reference_inputs {
        for input in ref_inputs {
            all_inputs.push(input_to_request_format(input));
        }
    }
    if let Some(collaterals) = &tx.transaction_body.collateral {
        for input in collaterals {
            all_inputs.push(input_to_request_format(input));
        }
    }

    Ok(all_inputs)
}

#[wasm_bindgen]
pub fn execute_tx_scripts(
    tx_hex: &str,
    utxo_json: &str,
    protocol_params_json: &str,
) -> Result<String, JsError> {
    let tx_bytes = hex::decode(tx_hex).map_err(|e| JsError::new(&e.to_string()))?;
    let mtx = MultiEraTx::decode_for_era(Era::Conway, &tx_bytes)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let tx = match mtx {
        MultiEraTx::Conway(tx) => tx.into_owned(),
        _ => return Err(JsError::new("Invalid transaction type")),
    };

    let kios_utxos: Vec<UtxoInfoResponse> =
        serde_json::from_str(utxo_json).map_err(|e| JsError::new(&e.to_string()))?;
    let utxos = response_utxo_to_pallas(kios_utxos)?;
    let slot_config: SlotConfig = SlotConfig::default();
    let kios_pp: EpochParamResponse =
        serde_json::from_str(protocol_params_json).map_err(|e| JsError::new(&e.to_string()))?;
    let cost_models = to_pallas_cost_models(&kios_pp);
    let exec_result = eval_all_redeemers(&tx, &utxos, Some(&cost_models), &slot_config, false)?;

    return Ok(build_response_object(exec_result).to_string());
}

#[wasm_bindgen(catch)]
pub async fn execute_tx_scripts_for_specific_network(
    tx_hex: &str,
    network: NetworkType,
    api_token: &str,
) -> Result<String, JsError> {
    let tx_bytes = hex::decode(tx_hex).map_err(|e| JsError::new(&e.to_string()))?;
    let mtx = MultiEraTx::decode_for_era(Era::Conway, &tx_bytes)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let tx = match mtx {
        MultiEraTx::Conway(tx) => tx.into_owned(),
        _ => return Err(JsError::new("Invalid transaction type")),
    };

    let mut all_inputs = Vec::new();
    for input in tx.transaction_body.inputs.iter() {
        all_inputs.push(input_to_request_format(input));
    }
    if let Some(ref_inputs) = &tx.transaction_body.reference_inputs {
        for input in ref_inputs {
            all_inputs.push(input_to_request_format(input));
        }
    }
    if let Some(collaterals) = &tx.transaction_body.collateral {
        for input in collaterals {
            all_inputs.push(input_to_request_format(input));
        }
    }

    let koios_utxos = get_utxos(&all_inputs, network.clone().into(), api_token).await?;

    check_missed_utxos(&all_inputs, &koios_utxos)?;

    let utxos = response_utxo_to_pallas(koios_utxos)?;
    let slot_config = SlotConfig::default();

    let epoch_number = get_chain_tip(network.clone().into(), api_token)
        .await?
        .epoch_no;
    let kios_pp = get_epoch_protocol_params(epoch_number, network.into(), api_token).await?;
    let cost_models = to_pallas_cost_models(&kios_pp);
    let exec_result = eval_all_redeemers(&tx, &utxos, Some(&cost_models), &slot_config, false)?;

    Ok(build_response_object(exec_result).to_string())
}

fn check_missed_utxos(
    request_utxos: &Vec<String>,
    utxos: &Vec<UtxoInfoResponse>,
) -> Result<(), JsError> {
    let utxo_keys: HashSet<String> = utxos
        .iter()
        .map(|u| format!("{}#{}", &u.tx_hash, &u.tx_index))
        .collect();
    let missed_utxos: Vec<String> = request_utxos
        .iter()
        .filter(|u| !utxo_keys.contains(*u))
        .cloned()
        .collect();
    if missed_utxos.len() > 0 {
        return Err(JsError::new(&format!(
            "Can't get these UTXOs from API, check the network type : {}",
            missed_utxos.join(", ")
        )));
    }
    Ok(())
}

fn build_response_object(
    exec_result: Vec<Result<(Redeemer, Redeemer), (Redeemer, Error)>>,
) -> Value {
    let mut response = Vec::new();

    for result in exec_result {
        match result {
            Ok((redeemer, new_redeemer)) => {
                let mut redeemer_result = Map::new();
                redeemer_result.insert(
                    "original_ex_units".to_string(),
                    exec_units_to_json(redeemer.ex_units),
                );
                redeemer_result.insert(
                    "calculated_ex_units".to_string(),
                    exec_units_to_json(new_redeemer.ex_units),
                );
                redeemer_result.insert("redeemer_index".to_string(), redeemer.index.into());
                redeemer_result.insert(
                    "redeemer_tag".to_string(),
                    redeemer_tag_to_string(&redeemer.tag).into(),
                );
                response.push(Value::Object(redeemer_result));
            }
            Err((redeemer, err)) => {
                let mut redeemer_result = Map::new();
                redeemer_result.insert(
                    "original_ex_units".to_string(),
                    exec_units_to_json(redeemer.ex_units),
                );
                redeemer_result.insert("error".to_string(), err.to_string().into());
                redeemer_result.insert("redeemer_index".to_string(), redeemer.index.into());
                redeemer_result.insert(
                    "redeemer_tag".to_string(),
                    redeemer_tag_to_string(&redeemer.tag).into(),
                );
                response.push(Value::Object(redeemer_result));
            }
        }
    }

    return Value::Array(response);
}

fn exec_units_to_json(exec_unit: ExUnits) -> Value {
    let mut obj = Map::new();
    obj.insert(
        "steps".to_string(),
        Value::Number(Number::from(exec_unit.steps)),
    );
    obj.insert(
        "mem".to_string(),
        Value::Number(Number::from(exec_unit.mem)),
    );
    Value::Object(obj)
}

fn redeemer_tag_to_string(tag: &RedeemerTag) -> String {
    match tag {
        RedeemerTag::Spend => "Spend".to_string(),
        RedeemerTag::Mint => "Mint".to_string(),
        RedeemerTag::Cert => "Cert".to_string(),
        RedeemerTag::Reward => "Reward".to_string(),
        RedeemerTag::Propose => "Propose".to_string(),
        RedeemerTag::Vote => "Vote".to_string(),
    }
}

fn input_to_request_format(input: &TransactionInput) -> String {
    return format!("{}#{}", hex::encode(input.transaction_id), input.index);
}

fn to_pallas_cost_models(pp: &EpochParamResponse) -> CostMdls {
    CostMdls {
        plutus_v1: pp
            .cost_models
            .as_ref()
            .and_then(|cm| cm.plutus_v1.as_ref())
            .map(|v1| v1.clone()),
        plutus_v2: pp
            .cost_models
            .as_ref()
            .and_then(|cm| cm.plutus_v2.as_ref())
            .map(|v2| v2.clone()),
        plutus_v3: pp
            .cost_models
            .as_ref()
            .and_then(|cm| cm.plutus_v3.as_ref())
            .map(|v3| v3.clone()),
    }
}

fn response_utxo_to_pallas(utxos: Vec<UtxoInfoResponse>) -> Result<Vec<ResolvedInput>, JsError> {
    let mut resolved_inputs = Vec::new();
    for utxo in utxos {
        let tx_hash: [u8; 32] = hex::decode(&utxo.tx_hash)
            .map_err(|e| JsError::new(&e.to_string()))?
            .try_into()
            .map_err(|e: Vec<u8>| JsError::new("incorrect len"))?;
        let resolved_input = ResolvedInput {
            input: TransactionInput {
                transaction_id: Hash::from(tx_hash),
                index: utxo.tx_index,
            },
            output: TransactionOutput::PostAlonzo(PostAlonzoTransactionOutput {
                address: to_pallas_address(&utxo)?,
                value: to_pallas_value(&utxo)?,
                datum_option: to_pallas_datum(&utxo)?,
                script_ref: to_pallas_script_ref(&utxo)?,
            }),
        };
        resolved_inputs.push(resolved_input);
    }

    Ok(resolved_inputs)
}

fn to_pallas_script_ref(utxo: &UtxoInfoResponse) -> Result<Option<CborWrap<ScriptRef>>, JsError> {
    if let Some(script) = &utxo.reference_script {
        let script_bytes = hex::decode(&script.bytes).map_err(|e| JsError::new(&e.to_string()))?;
        let decoded_script = match script.script_type.as_str() {
            "nativeScript" => Ok(PseudoScript::NativeScript(
                NativeScript::decode_fragment(&script_bytes)
                    .map_err(|e| JsError::new(&e.to_string()))?,
            )),
            "plutusV1" => Ok(PseudoScript::PlutusV1Script(PlutusV1Script(
                script_bytes.into(),
            ))),
            "plutusV2" => Ok(PseudoScript::PlutusV2Script(PlutusV2Script(
                script_bytes.into(),
            ))),
            "plutusV3" => Ok(PseudoScript::PlutusV3Script(PlutusV3Script(
                script_bytes.into(),
            ))),
            _ => Err(JsError::new("Invalid script type")),
        }?;
        Ok(Some(CborWrap(decoded_script)))
    } else {
        Ok(None)
    }
}

fn to_pallas_datum(utxo: &UtxoInfoResponse) -> Result<Option<DatumOption>, JsError> {
    if let Some(datum) = &utxo.inline_datum {
        let datum_bytes = hex::decode(&datum.bytes).map_err(|e| JsError::new(&e.to_string()))?;
        let datum = CborWrap(
            PlutusData::decode_fragment(&datum_bytes).map_err(|e| JsError::new(&e.to_string()))?,
        );
        Ok(Some(DatumOption::Data(datum)))
    } else if let Some(datum_hash) = &utxo.datum_hash {
        let datum_hash: [u8; 32] = hex::decode(datum_hash)
            .map_err(|e| JsError::new(&e.to_string()))?
            .try_into()
            .map_err(|e: Vec<u8>| JsError::new("incorrect len"))?;
        Ok(Some(DatumOption::Hash(Hash::from(datum_hash))))
    } else {
        Ok(None)
    }
}

fn to_pallas_address(utxo: &UtxoInfoResponse) -> Result<Bytes, JsError> {
    Address::from_bech32(&utxo.address)
        .map_err(|_| JsError::new(&format!("Cannot convert address {}", utxo.address)))
        .map(|a| a.to_bytes())
        .map(|a| Bytes::from(a))
}

fn to_pallas_value(
    utxo: &UtxoInfoResponse,
) -> Result<pallas_primitives::conway::Value, JsError> {
    let coins: u64 = utxo
        .value
        .parse()
        .map_err(|e| JsError::new(&format!("{}", e)))?;
    match to_pallas_multi_asset(utxo) {
        Ok(Some(multi_asset)) => Ok(pallas_primitives::conway::Value::Multiasset(
            coins,
            multi_asset,
        )),
        Ok(None) => Ok(pallas_primitives::conway::Value::Coin(coins)),
        Err(e) => Err(e),
    }
}

fn to_pallas_multi_asset(utxo: &UtxoInfoResponse) -> Result<Option<Multiasset<PositiveCoin>>, JsError> {
    if let Some(assets) = &utxo.asset_list {
        let mut multi_asset = Vec::new();
        for (policy, assets) in assets.iter().into_group_map_by(|a| &a.policy_id) {
            let policy_id_bytes: [u8; 28] = hex::decode(policy)
                .map_err(|e| JsError::new(&e.to_string()))?
                .try_into()
                .map_err(|e: Vec<u8>| JsError::new("incorrect len"))?;
            let policy_id = PolicyId::from(policy_id_bytes);
            let mut mapped_assets = Vec::new();
            for asset in assets {
                let asset_name = if let Some(asset_name) = &asset.asset_name {
                    AssetName::from(
                        hex::decode(asset_name).map_err(|e| JsError::new(&e.to_string()))?,
                    )
                } else {
                    AssetName::from(Vec::new())
                };
                let asset_quantity: u64 = asset
                    .quantity
                    .parse()
                    .map_err(|e| JsError::new(&format!("{}", e)))?;

                if asset_quantity == 0 {
                    continue
                }
                let coin = PositiveCoin::try_from(asset_quantity).map_err(
                    |e| JsError::new(&format!("Cannot convert asset quantity: {}", e)),
                )?;
                mapped_assets.push((asset_name, coin));
            }
            multi_asset.push((policy_id, NonEmptyKeyValuePairs::Def(mapped_assets)));
        }
        return Ok(Some(NonEmptyKeyValuePairs::Def(multi_asset)));
    }

    Ok(None)
}

fn eval_all_redeemers(
    tx: &MintedTx,
    utxos: &[ResolvedInput],
    cost_mdls: Option<&CostMdls>,
    slot_config: &SlotConfig,
    run_phase_one: bool,
) -> Result<Vec<Result<(Redeemer, Redeemer), (Redeemer, Error)>>, JsError> {
    let redeemers = tx.transaction_witness_set.redeemer.as_ref();

    let lookup_table = DataLookupTable::from_transaction(tx, utxos);

    if run_phase_one {
        // subset of phase 1 check on redeemers and scripts
        eval_phase_one(tx, utxos, &lookup_table).map_err(|e| JsError::new(&e.to_string()))?;
    }

    match redeemers {
        Some(rs) => {
            let mut collected_redeemers = vec![];
            let remaining_budget = ExBudget::default();
            for (rKey, rValue) in rs.iter() {
                let redeemer = Redeemer {
                    tag: rKey.tag,
                    index: rKey.index,
                    data: rValue.data.clone(),
                    ex_units: rValue.ex_units,
                };
                let result = eval::eval_redeemer(
                    tx,
                    utxos,
                    slot_config,
                    &redeemer,
                    &lookup_table,
                    cost_mdls,
                    &remaining_budget,
                );

                match result {
                    Ok(new_redeemer) => {
                        collected_redeemers.push(Ok((redeemer.clone(), new_redeemer)))
                    }
                    Err(err) => collected_redeemers.push(Err((redeemer.clone(), err))),
                }
            }

            Ok(collected_redeemers)
        }
        None => Ok(vec![]),
    }
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn test_execute_tx_scripts() {
        let tx_hex = "84a900818258205de23a200f136e657307bc69173dddaf38b446bd7242a50f5bf255e329018b65030182a300581d70eafce55e4f0e057b495f77d8019577c56ae1fe188dc7e6d63f4f93b801821a001e8480a1581c32b7e3d552b2b18cb9bf1a39e6e1ce75f62c084f2b917a44c071a3bda14001028201d81858b4d8799f582461666461373264392d383039332d343330332d623030652d3233616362323934313432661a06acfc00d8799fd8799f581c5e0abc8c791c220b8c56e729cb77e95c03c7bd27971896dda0ac2368ffd8799fd8799fd8799f581cc8fdacb82c1cec476d444f559c28f4b75ddb6f483fe20427683a661affffffff1b0000019223dc5f75d8799fd8799f58205f759f3527a47632735470586a7ab2fbee4b4aa8b6504d52d52bc62fa8ec961aff00ff01ff825839005e0abc8c791c220b8c56e729cb77e95c03c7bd27971896dda0ac2368c8fdacb82c1cec476d444f559c28f4b75ddb6f483fe20427683a661a1a15a2ae54021a000d5ab0031a0442ee8109a1581c32b7e3d552b2b18cb9bf1a39e6e1ce75f62c084f2b917a44c071a3bda140010b5820c131e4b612c1a50ddcb739f58185148a26c6beaa198d036f5f9e4e8c7d458de20d8382582002345ff40e1b8730434571b8b4749ad084b2cd582aa8997fa7416be8b76c7da80082582002345ff40e1b8730434571b8b4749ad084b2cd582aa8997fa7416be8b76c7da8058258201c4ef054932bafcb4a59810f31fa0ed001d6611066938d1a1aef1d1237c0a441020e81581cc6aa7af71f8ba577246149edf075d2edd9daa63980b7ca176799af6c128382582066b7282bad1aef9ba0a99f06e618d651d232d4788f0d2ee2d22db22a62391033008258205f759f3527a47632735470586a7ab2fbee4b4aa8b6504d52d52bc62fa8ec961a008258201c4ef054932bafcb4a59810f31fa0ed001d6611066938d1a1aef1d1237c0a44100a10581840100d8799fd8799f58205f759f3527a47632735470586a7ab2fbee4b4aa8b6504d52d52bc62fa8ec961aff00ff821a006acfc01ab2d05e00f5f6";
        let api_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZGRyIjoic3Rha2UxdXh4dWxybmFnNGxkYzBsamd3Z3Q4MnZjdW1reTh4bGhqeDZmbm53NXZ0am5raHNzYWdmbWQiLCJleHAiOjE3NDA1NzMzMDgsInRpZXIiOjEsInByb2pJRCI6InRlc3QifQ.-0o-bqi97cOzAmqBM6xBVmRcEj2slsit5_zlSoSHpt8";
        let network = super::NetworkType::TestnetPreprod;
        let result = super::execute_tx_scripts_for_specific_network(tx_hex, network, api_token)
            .await;
        println!("{:?}", result);
    }
}
