/**
 * Koios API Types
 * Types for Koios REST API responses
 */

// Network Types
export type KoiosNetworkType = 'mainnet' | 'preview' | 'preprod';

export const KOIOS_BASE_URLS: Record<KoiosNetworkType, string> = {
  mainnet: 'https://api.koios.rest/api/v1',
  preview: 'https://preview.koios.rest/api/v1',
  preprod: 'https://preprod.koios.rest/api/v1',
};

// Tip Response
export interface KoiosTip {
  hash: string;
  epoch_no: number;
  abs_slot: number;
  epoch_slot: number;
  block_height: number;
  block_time: number;
}

// Totals Response (for treasury value)
export interface KoiosTotals {
  epoch_no: number;
  circulation: string;
  treasury: string;
  reward: string;
  supply: string;
  reserves: string;
  fees: string;
  deposits_stake: string;
  deposits_drep: string;
  deposits_proposal: string;
}

// UTxO Info Response
export interface KoiosUtxoAsset {
  policy_id: string;
  asset_name: string;
  fingerprint: string;
  decimals: number;
  quantity: string;
}

export interface KoiosInlineDatum {
  bytes: string;
  value: unknown;
}

export interface KoiosReferenceScript {
  hash: string;
  size: number;
  type: string;
  bytes: string;
  value: unknown | null;
}

export interface KoiosUtxoInfo {
  tx_hash: string;
  tx_index: number;
  address: string;
  value: string;
  stake_address: string | null;
  payment_cred: string | null;
  epoch_no: number;
  block_height: number;
  block_time: number;
  datum_hash: string | null;
  inline_datum: KoiosInlineDatum | null;
  reference_script: KoiosReferenceScript | null;
  asset_list: KoiosUtxoAsset[] | null;
  is_spent: boolean;
}

// Account Info Response
export interface KoiosAccountInfo {
  stake_address: string;
  status: 'registered' | 'not registered';
  delegated_drep: string | null;
  delegated_pool: string | null;
  total_balance: string;
  utxo: string;
  rewards: string;
  withdrawals: string;
  rewards_available: string;
  deposit: string;
  reserves: string;
  treasury: string;
}

// Pool Info Response
export interface KoiosPoolInfo {
  pool_id_bech32: string;
  pool_id_hex: string;
  active_epoch_no: number;
  vrf_key_hash: string;
  margin: number;
  fixed_cost: string;
  pledge: string;
  deposit: string;
  reward_addr: string;
  owners: string[];
  relays: Array<{
    dns: string | null;
    srv: string | null;
    ipv4: string | null;
    ipv6: string | null;
    port: number | null;
  }>;
  meta_url: string | null;
  meta_hash: string | null;
  meta_json: {
    name: string;
    ticker: string;
    homepage: string;
    description: string;
  } | null;
  pool_status: 'registered' | 'retiring' | 'retired';
  retiring_epoch: number | null;
  op_cert: string | null;
  op_cert_counter: number | null;
  active_stake: string | null;
  sigma: number | null;
  block_count: number | null;
  live_pledge: string | null;
  live_stake: string | null;
  live_delegators: number;
  live_saturation: number | null;
  voting_power: string | null;
}

// DRep Info Response
export interface KoiosDrepInfo {
  drep_id: string;
  hex: string;
  has_script: boolean;
  registered: boolean;
  deposit: string | null;
  active: boolean;
  expires_epoch_no: number | null;
  amount: string;
  meta_url: string | null;
  meta_hash: string | null;
}

// Committee Info Response
export interface KoiosCommitteeMember {
  status: 'authorized' | 'not_authorized' | 'resigned';
  cc_cold_hex: string;
  cc_cold_has_script: boolean;
  cc_hot_hex: string | null;
  cc_hot_has_script: boolean | null;
  expiration_epoch: number;
}

export interface KoiosCommitteeInfo {
  proposal_id: string;
  proposal_tx_hash: string;
  proposal_index: number;
  quorum_numerator: number;
  quorum_denominator: number;
  members: KoiosCommitteeMember[];
}

// Proposal (Governance Action) Response
export interface KoiosProposal {
  block_time: number;
  proposal_id: string;
  proposal_tx_hash: string;
  proposal_index: number;
  proposal_type: 'ParameterChange' | 'HardForkInitiation' | 'TreasuryWithdrawals' | 'NoConfidence' | 'NewCommittee' | 'NewConstitution' | 'InfoAction';
  proposal_description: unknown;
  deposit: string;
  return_address: string;
  proposed_epoch: number;
  ratified_epoch: number | null;
  enacted_epoch: number | null;
  dropped_epoch: number | null;
  expired_epoch: number | null;
  expiration: number | null;
  meta_url: string | null;
  meta_hash: string | null;
  meta_json: unknown | null;
  meta_comment: string | null;
  meta_language: string | null;
  meta_is_valid: boolean | null;
  withdrawal: {
    stake_address: string;
    amount: string;
  } | null;
  param_proposal: unknown | null;
}

// Epoch Params Response
export interface KoiosEpochParams {
  epoch_no: number;
  min_fee_a: number | null;
  min_fee_b: number | null;
  max_block_size: number | null;
  max_tx_size: number | null;
  max_bh_size: number | null;
  key_deposit: string | null;
  pool_deposit: string | null;
  max_epoch: number | null;
  optimal_pool_count: number | null;
  influence: number | null;
  monetary_expand_rate: number | null;
  treasury_growth_rate: number | null;
  decentralisation: number | null;
  extra_entropy: string | null;
  protocol_major: number | null;
  protocol_minor: number | null;
  min_utxo_value: string | null;
  min_pool_cost: string | null;
  nonce: string | null;
  block_hash: string;
  cost_models: {
    PlutusV1?: number[];
    PlutusV2?: number[];
    PlutusV3?: number[];
  } | null;
  price_mem: number | null;
  price_step: number | null;
  max_tx_ex_mem: number | null;
  max_tx_ex_steps: number | null;
  max_block_ex_mem: number | null;
  max_block_ex_steps: number | null;
  max_val_size: number | null;
  collateral_percent: number | null;
  max_collateral_inputs: number | null;
  coins_per_utxo_size: string | null;
  pvt_motion_no_confidence: number | null;
  pvt_committee_normal: number | null;
  pvt_committee_no_confidence: number | null;
  pvt_hard_fork_initiation: number | null;
  dvt_motion_no_confidence: number | null;
  dvt_committee_normal: number | null;
  dvt_committee_no_confidence: number | null;
  dvt_update_to_constitution: number | null;
  dvt_hard_fork_initiation: number | null;
  dvt_p_p_network_group: number | null;
  dvt_p_p_economic_group: number | null;
  dvt_p_p_technical_group: number | null;
  dvt_p_p_gov_group: number | null;
  dvt_treasury_withdrawal: number | null;
  committee_min_size: number | null;
  committee_max_term_length: number | null;
  gov_action_lifetime: number | null;
  gov_action_deposit: string | null;
  drep_deposit: string | null;
  drep_activity: number | null;
  pvtpp_security_group: number | null;
  min_fee_ref_script_cost_per_byte: number | null;
}

// Transaction CBOR Response
export interface KoiosTxCborResponse {
  tx_hash: string;
  block_hash: string;
  block_height: number;
  cbor: string;
}

// Request body types for POST endpoints
export interface KoiosUtxoRefsRequest {
  _utxo_refs: string[];
  _extended?: boolean;
}

export interface KoiosTxHashesRequest {
  _tx_hashes: string[];
}

export interface KoiosStakeAddressesRequest {
  _stake_addresses: string[];
}

export interface KoiosPoolIdsRequest {
  _pool_bech32_ids: string[];
}

export interface KoiosDrepIdsRequest {
  _drep_ids: string[];
}
