/**
 * Koios API Client
 * Functions for fetching data from Koios REST API
 */

import {
  KoiosNetworkType,
  KOIOS_BASE_URLS,
  KoiosTip,
  KoiosTotals,
  KoiosUtxoInfo,
  KoiosAccountInfo,
  KoiosPoolInfo,
  KoiosDrepInfo,
  KoiosCommitteeInfo,
  KoiosProposal,
  KoiosEpochParams,
  KoiosUtxoRefsRequest,
  KoiosStakeAddressesRequest,
  KoiosPoolIdsRequest,
  KoiosDrepIdsRequest,
  KoiosTxCborResponse,
  KoiosTxHashesRequest,
} from './koiosTypes';

/**
 * Represents a governance action reference for querying
 */
export interface GovActionRef {
  txHash: string; // hex format
  index: number;
}

export interface KoiosClientConfig {
  network: KoiosNetworkType;
  apiKey?: string;
}

export class KoiosClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: KoiosClientConfig) {
    this.baseUrl = KOIOS_BASE_URLS[config.network];
    this.apiKey = config.apiKey;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Koios API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  private async post<T, B>(endpoint: string, body: B): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Koios API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get the current chain tip
   */
  async getTip(): Promise<KoiosTip[]> {
    return this.get<KoiosTip[]>('/tip');
  }

  /**
   * Get tokenomics totals (including treasury value)
   */
  async getTotals(epochNo?: number): Promise<KoiosTotals[]> {
    const endpoint = epochNo !== undefined ? `/totals?_epoch_no=${epochNo}` : '/totals';
    return this.get<KoiosTotals[]>(endpoint);
  }

  /**
   * Get UTxO information for given UTxO references
   * @param utxoRefs Array of strings in format "tx_hash#output_index"
   */
  async getUtxoInfo(utxoRefs: string[]): Promise<KoiosUtxoInfo[]> {
    if (utxoRefs.length === 0) {
      return [];
    }
    const body: KoiosUtxoRefsRequest = {
      _utxo_refs: utxoRefs,
      _extended: true,
    };
    return this.post<KoiosUtxoInfo[], KoiosUtxoRefsRequest>('/utxo_info', body);
  }

  /**
   * Get account information for given stake addresses
   */
  async getAccountInfo(stakeAddresses: string[]): Promise<KoiosAccountInfo[]> {
    if (stakeAddresses.length === 0) {
      return [];
    }
    const body: KoiosStakeAddressesRequest = {
      _stake_addresses: stakeAddresses,
    };
    return this.post<KoiosAccountInfo[], KoiosStakeAddressesRequest>('/account_info', body);
  }

  /**
   * Get pool information for given pool IDs
   * @param poolIds Array of pool IDs in bech32 format (pool1...)
   */
  async getPoolInfo(poolIds: string[]): Promise<KoiosPoolInfo[]> {
    if (poolIds.length === 0) {
      return [];
    }
    const body: KoiosPoolIdsRequest = {
      _pool_bech32_ids: poolIds,
    };
    return this.post<KoiosPoolInfo[], KoiosPoolIdsRequest>('/pool_info', body);
  }

  /**
   * Get DRep information for given DRep IDs
   * @param drepIds Array of DRep IDs in bech32 format (drep1...)
   */
  async getDrepInfo(drepIds: string[]): Promise<KoiosDrepInfo[]> {
    if (drepIds.length === 0) {
      return [];
    }
    const body: KoiosDrepIdsRequest = {
      _drep_ids: drepIds,
    };
    return this.post<KoiosDrepInfo[], KoiosDrepIdsRequest>('/drep_info', body);
  }

  /**
   * Get current committee information
   */
  async getCommitteeInfo(): Promise<KoiosCommitteeInfo> {
    return this.get<KoiosCommitteeInfo>('/committee_info');
  }

  /**
   * Get all governance proposals
   * @deprecated Use getProposalsByRefs or getLastEnactedProposals for targeted queries
   */
  async getProposalList(): Promise<KoiosProposal[]> {
    return this.get<KoiosProposal[]>('/proposal_list');
  }

  /**
   * Get governance proposals by specific references (tx_hash + index)
   * Uses Koios vertical filtering to only fetch needed proposals
   * @param refs Array of governance action references
   */
  async getProposalsByRefs(refs: GovActionRef[]): Promise<KoiosProposal[]> {
    if (refs.length === 0) {
      return [];
    }

    // Build OR filter for multiple proposals
    // Koios uses PostgREST format: or=(and(proposal_tx_hash.eq.hash1,proposal_index.eq.0),and(...))
    const conditions = refs.map(
      ref => `and(proposal_tx_hash.eq.${ref.txHash},proposal_index.eq.${ref.index})`
    );
    const orFilter = `or=(${conditions.join(',')})`;
    
    return this.get<KoiosProposal[]>(`/proposal_list?${orFilter}`);
  }

  /**
   * Get the last enacted governance proposals for specific action types
   * Uses Koios vertical filtering to only fetch enacted proposals
   * @param proposalTypes Array of proposal types to query (e.g., 'ParameterChange', 'HardForkInitiation')
   */
  async getLastEnactedProposals(proposalTypes: string[]): Promise<KoiosProposal[]> {
    if (proposalTypes.length === 0) {
      return [];
    }

    // Build filter for enacted proposals of specific types
    // Filter: enacted_epoch is not null AND proposal_type in (types...)
    // Order by enacted_epoch desc to get the most recent first
    const typeConditions = proposalTypes.map(type => `proposal_type.eq.${type}`);
    const typeFilter = typeConditions.length === 1 
      ? typeConditions[0] 
      : `or=(${typeConditions.join(',')})`;
    
    // Filter for enacted proposals only (enacted_epoch is not null)
    const enactedFilter = 'enacted_epoch=not.is.null';
    
    // Order by enacted_epoch descending to get most recent first
    const orderBy = 'order=enacted_epoch.desc';
    
    return this.get<KoiosProposal[]>(`/proposal_list?${enactedFilter}&${typeFilter}&${orderBy}`);
  }

  /**
   * Get epoch parameters (protocol parameters)
   */
  async getEpochParams(epochNo?: number): Promise<KoiosEpochParams[]> {
    const endpoint = epochNo !== undefined ? `/epoch_params?_epoch_no=${epochNo}` : '/epoch_params';
    return this.get<KoiosEpochParams[]>(endpoint);
  }

  /**
   * Get transaction CBOR by transaction hash
   * @param txHashes Array of transaction hashes
   * @returns Array of transaction CBOR responses
   */
  async getTxCbor(txHashes: string[]): Promise<KoiosTxCborResponse[]> {
    if (txHashes.length === 0) {
      return [];
    }
    const body: KoiosTxHashesRequest = {
      _tx_hashes: txHashes,
    };
    return this.post<KoiosTxCborResponse[], KoiosTxHashesRequest>('/tx_cbor', body);
  }
}

/**
 * Helper function to format UTxO reference for Koios API
 */
export function formatUtxoRef(txHash: string, outputIndex: number): string {
  return `${txHash}#${outputIndex}`;
}

/**
 * Maps GovernanceActionType from cquisitor-lib to Koios proposal_type
 */
export function govActionTypeToKoiosProposalType(actionType: string): string {
  const mapping: Record<string, string> = {
    'parameterChangeAction': 'ParameterChange',
    'hardForkInitiationAction': 'HardForkInitiation',
    'treasuryWithdrawalsAction': 'TreasuryWithdrawals',
    'noConfidenceAction': 'NoConfidence',
    'updateCommitteeAction': 'NewCommittee',
    'newConstitutionAction': 'NewConstitution',
    'infoAction': 'InfoAction',
  };
  return mapping[actionType] ?? 'InfoAction';
}
