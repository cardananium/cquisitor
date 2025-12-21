/**
 * Transaction Validation Service
 * Orchestrates transaction validation using cquisitor-lib and Koios API
 */

import {
  get_necessary_data_list_js,
  validate_transaction_js,
  get_ref_script_bytes,
  type NecessaryInputData,
  type ValidationInputContext,
  type ValidationResult,
  type ProtocolParameters,
  type UtxoInputContext,
  type AccountInputContext,
  type DrepInputContext,
  type PoolInputContext,
  type GovActionInputContext,
  type CommitteeInputContext,
  type UTxO,
  type TxInput,
  type TxOutput,
  type Asset,
  type LocalCredential,
  type GovernanceActionId,
  type GovernanceActionType,
  type CostModels,
  type ExUnits,
  type SubCoin,
  type ExUnitPrices,
} from '@cardananium/cquisitor-lib';

import { KoiosClient, formatUtxoRef, govActionTypeToKoiosProposalType } from './koiosClient';
import type { GovActionRef } from './koiosClient';
import { ensurePoolIdBech32 } from './cip129';
import { formatScriptRefForLib, encodeCborBytes } from './scriptRefFormat';
import type {
  KoiosNetworkType,
  KoiosUtxoInfo,
  KoiosAccountInfo,
  KoiosDrepInfo,
  KoiosCommitteeMember,
  KoiosProposal,
  KoiosEpochParams,
} from './koiosTypes';
import stringify from 'safe-stable-stringify';

// Re-export types for external use
export type { NecessaryInputData, ValidationInputContext, ValidationResult };

export type NetworkType = 'mainnet' | 'preview' | 'preprod';

/**
 * Configuration for transaction validation
 */
export interface TransactionValidationConfig {
  txHex: string;
  network: NetworkType;
  apiKey?: string;
}

/**
 * Result of fetching necessary data from Koios
 */
export interface FetchedValidationData {
  utxoSet: UtxoInputContext[];
  accountContexts: AccountInputContext[];
  poolContexts: PoolInputContext[];
  drepContexts: DrepInputContext[];
  govActionContexts: GovActionInputContext[];
  lastEnactedGovAction: GovActionInputContext[];
  currentCommitteeMembers: CommitteeInputContext[];
  potentialCommitteeMembers: CommitteeInputContext[];
  protocolParameters: ProtocolParameters;
  slot: bigint;
  treasuryValue: bigint;
}

/**
 * Maps cquisitor-lib NetworkType to Koios network
 */
function mapToKoiosNetwork(network: NetworkType): KoiosNetworkType {
  return network;
}

// ============================================================================
// UTxO Conversion Functions
// ============================================================================

/**
 * Converts Koios UTxO info to cquisitor-lib UTxO format
 * @param koiosUtxo - The Koios UTxO info
 * @param scriptRefBytesOverride - Optional override for reference script bytes (extracted from tx CBOR)
 */
function koiosUtxoToLibUtxo(koiosUtxo: KoiosUtxoInfo, scriptRefBytesOverride?: string): UTxO {
  const input: TxInput = {
    txHash: koiosUtxo.tx_hash,
    outputIndex: koiosUtxo.tx_index,
  };

  // Build asset array
  const assets: Asset[] = [
    { unit: 'lovelace', quantity: koiosUtxo.value },
  ];

  if (koiosUtxo.asset_list) {
    for (const asset of koiosUtxo.asset_list) {
      assets.push({
        unit: asset.policy_id + asset.asset_name,
        quantity: asset.quantity,
      });
    }
  }

  // Determine scriptRef bytes:
  // - scriptRefBytesOverride (from get_ref_script_bytes): already properly formatted, use as-is
  // - koiosUtxo.reference_script?.bytes (from Koios API): raw script bytes, need formatting
  let scriptRef: string | undefined;
  
  if (scriptRefBytesOverride) {
    // Already formatted from get_ref_script_bytes, pass through formatScriptRefForLib
    // (it will detect it's already formatted and return as-is)
    scriptRef = formatScriptRefForLib(scriptRefBytesOverride, koiosUtxo.reference_script?.type);
  } else if (koiosUtxo.reference_script?.bytes) {
    // Koios returns raw script bytes
    // For Plutus scripts: first wrap in CBOR bytes, then format as ScriptRef
    // For Native scripts: pass directly to formatScriptRefForLib
    const scriptType = koiosUtxo.reference_script.type?.toLowerCase() ?? '';
    const isPlutus = scriptType.startsWith('plutus');
    
    const scriptBytes = isPlutus 
      ? encodeCborBytes(koiosUtxo.reference_script.bytes)
      : koiosUtxo.reference_script.bytes;
    
    scriptRef = formatScriptRefForLib(scriptBytes, koiosUtxo.reference_script.type);
  }

  const output: TxOutput = {
    address: koiosUtxo.address,
    amount: assets,
    dataHash: koiosUtxo.datum_hash ?? undefined,
    plutusData: koiosUtxo.inline_datum?.bytes ?? undefined,
    scriptRef,
    scriptHash: koiosUtxo.reference_script?.hash ?? undefined,
  };

  return { input, output };
}

/**
 * Converts Koios UTxO info to UtxoInputContext
 * @param koiosUtxo - The Koios UTxO info
 * @param scriptRefBytesOverride - Optional override for reference script bytes
 */
function koiosUtxoToUtxoContext(koiosUtxo: KoiosUtxoInfo, scriptRefBytesOverride?: string): UtxoInputContext {
  return {
    utxo: koiosUtxoToLibUtxo(koiosUtxo, scriptRefBytesOverride),
    isSpent: koiosUtxo.is_spent,
  };
}

/**
 * Identifies UTxOs that have reference scripts but missing bytes
 */
function findUtxosWithMissingRefScriptBytes(utxoInfos: KoiosUtxoInfo[]): KoiosUtxoInfo[] {
  return utxoInfos.filter(
    utxo => utxo.reference_script && !utxo.reference_script.bytes
  );
}

/**
 * Extracts reference script bytes from transaction CBOR for UTxOs with missing bytes
 * @param utxosWithMissingBytes - UTxOs that need reference script bytes extracted
 * @param client - Koios client for fetching tx CBOR
 * @returns Map of "txHash#outputIndex" to extracted script bytes
 */
async function extractMissingRefScriptBytes(
  utxosWithMissingBytes: KoiosUtxoInfo[],
  client: KoiosClient
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  
  if (utxosWithMissingBytes.length === 0) {
    return result;
  }

  // Group UTxOs by transaction hash to minimize API calls
  const utxosByTxHash = new Map<string, KoiosUtxoInfo[]>();
  for (const utxo of utxosWithMissingBytes) {
    const existing = utxosByTxHash.get(utxo.tx_hash) || [];
    existing.push(utxo);
    utxosByTxHash.set(utxo.tx_hash, existing);
  }

  // Fetch transaction CBORs
  const txHashes = Array.from(utxosByTxHash.keys());
  const txCborResponses = await client.getTxCbor(txHashes);
  
  // Create a map for quick lookup
  const txCborMap = new Map<string, string>();
  for (const response of txCborResponses) {
    txCborMap.set(response.tx_hash, response.cbor);
  }

  // Extract reference script bytes for each UTxO
  for (const [txHash, utxos] of utxosByTxHash.entries()) {
    const txCbor = txCborMap.get(txHash);
    if (!txCbor) {
      console.warn(`Could not fetch CBOR for transaction ${txHash}`);
      continue;
    }

    for (const utxo of utxos) {
      try {
        const refScriptBytes = get_ref_script_bytes(txCbor, utxo.tx_index);
        const key = `${utxo.tx_hash}#${utxo.tx_index}`;
        result.set(key, refScriptBytes);
      } catch (error) {
        console.warn(`Failed to extract ref script bytes for ${utxo.tx_hash}#${utxo.tx_index}:`, error);
      }
    }
  }

  return result;
}

/**
 * Converts Koios account info to AccountInputContext
 */
function koiosAccountToAccountContext(account: KoiosAccountInfo): AccountInputContext {
  return {
    bech32Address: account.stake_address,
    isRegistered: account.status === 'registered',
    payedDeposit: account.deposit ? parseInt(account.deposit, 10) : null,
    delegatedToDrep: account.delegated_drep ?? null,
    delegatedToPool: account.delegated_pool ?? null,
    balance: account.rewards_available ? parseInt(account.rewards_available, 10) : null,
  };
}


/**
 * Converts Koios DRep info to DrepInputContext
 */
function koiosDrepToDrepContext(drep: KoiosDrepInfo): DrepInputContext {
  return {
    bech32Drep: drep.drep_id,
    isRegistered: drep.registered,
    payedDeposit: drep.deposit ? parseInt(drep.deposit, 10) : null,
  };
}

/**
 * Maps proposal type to governance action type
 */
function mapProposalTypeToActionType(proposalType: string): GovernanceActionType {
  const mapping: Record<string, GovernanceActionType> = {
    'ParameterChange': 'parameterChangeAction',
    'HardForkInitiation': 'hardForkInitiationAction',
    'TreasuryWithdrawals': 'treasuryWithdrawalsAction',
    'NoConfidence': 'noConfidenceAction',
    'NewCommittee': 'updateCommitteeAction',
    'NewConstitution': 'newConstitutionAction',
    'InfoAction': 'infoAction',
  };
  return mapping[proposalType] ?? 'infoAction';
}

/**
 * Converts Koios proposal to GovActionInputContext
 */
function koiosProposalToGovActionContext(proposal: KoiosProposal): GovActionInputContext {
  // Parse tx_hash from proposal_id or proposal_tx_hash
  const txHashBytes = hexToBytes(proposal.proposal_tx_hash);
  
  const actionId: GovernanceActionId = {
    txHash: Array.from(txHashBytes),
    index: BigInt(proposal.proposal_index),
  };

  return {
    actionId,
    actionType: mapProposalTypeToActionType(proposal.proposal_type),
    isActive: proposal.expired_epoch === null && proposal.dropped_epoch === null,
  };
}

/**
 * Converts hex credential to LocalCredential
 */
function hexToLocalCredential(hex: string, hasScript: boolean): LocalCredential {
  const bytes = Array.from(hexToBytes(hex));
  if (hasScript) {
    return { scriptHash: bytes };
  }
  return { keyHash: bytes };
}

/**
 * Converts Koios committee member to CommitteeInputContext
 */
function koiosCommitteeToCommitteeContext(member: KoiosCommitteeMember): CommitteeInputContext {
  const coldCredential = hexToLocalCredential(member.cc_cold_hex, member.cc_cold_has_script);
  
  let hotCredential: LocalCredential | null = null;
  if (member.cc_hot_hex && member.cc_hot_has_script !== null) {
    hotCredential = hexToLocalCredential(member.cc_hot_hex, member.cc_hot_has_script);
  }

  return {
    committeeMemberCold: coldCredential,
    committeeMemberHot: hotCredential,
    isResigned: member.status === 'resigned',
  };
}

/**
 * Helper function to convert hex string to byte array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Converts Koios epoch params to ProtocolParameters
 */
function koiosParamsToProtocolParams(params: KoiosEpochParams): ProtocolParameters {
  // Build cost models
  const costModels: CostModels = {};
  if (params.cost_models?.PlutusV1) {
    costModels.plutusV1 = params.cost_models.PlutusV1;
  }
  if (params.cost_models?.PlutusV2) {
    costModels.plutusV2 = params.cost_models.PlutusV2;
  }
  if (params.cost_models?.PlutusV3) {
    costModels.plutusV3 = params.cost_models.PlutusV3;
  }

  // Execution prices - convert from decimal to rational
  const memPrice: SubCoin = priceToSubCoin(params.price_mem ?? 0);
  const stepPrice: SubCoin = priceToSubCoin(params.price_step ?? 0);

  const executionPrices: ExUnitPrices = {
    memPrice,
    stepPrice,
  };

  // Max execution units
  const maxTxExecutionUnits: ExUnits = {
    mem: params.max_tx_ex_mem ?? 0,
    steps: params.max_tx_ex_steps ?? 0,
  };

  const maxBlockExecutionUnits: ExUnits = {
    mem: params.max_block_ex_mem ?? 0,
    steps: params.max_block_ex_steps ?? 0,
  };

  // Reference script cost per byte
  const referenceScriptCostPerByte: SubCoin = {
    numerator: BigInt(params.min_fee_ref_script_cost_per_byte ?? 15),
    denominator: BigInt(1),
  };

  return {
    minFeeCoefficientA: BigInt(params.min_fee_a ?? 44),
    minFeeConstantB: BigInt(params.min_fee_b ?? 155381),
    maxBlockBodySize: params.max_block_size ?? 90112,
    maxTransactionSize: params.max_tx_size ?? 16384,
    maxBlockHeaderSize: params.max_bh_size ?? 1100,
    stakeKeyDeposit: BigInt(params.key_deposit ?? '2000000'),
    stakePoolDeposit: BigInt(params.pool_deposit ?? '500000000'),
    maxEpochForPoolRetirement: params.max_epoch ?? 18,
    protocolVersion: [params.protocol_major ?? 9, params.protocol_minor ?? 0] as [unknown, unknown],
    minPoolCost: BigInt(params.min_pool_cost ?? '340000000'),
    adaPerUtxoByte: BigInt(params.coins_per_utxo_size ?? '4310'),
    costModels,
    executionPrices,
    maxTxExecutionUnits,
    maxBlockExecutionUnits,
    maxValueSize: params.max_val_size ?? 5000,
    collateralPercentage: params.collateral_percent ?? 150,
    maxCollateralInputs: params.max_collateral_inputs ?? 3,
    governanceActionDeposit: BigInt(params.gov_action_deposit ?? '100000000000'),
    drepDeposit: BigInt(params.drep_deposit ?? '500000000'),
    referenceScriptCostPerByte,
  };
}

/**
 * Converts a decimal price to SubCoin (rational number)
 */
function priceToSubCoin(price: number): SubCoin {
  // Convert to a rational approximation
  // Using 10^10 as denominator for sufficient precision
  const denominator = BigInt(10000000000);
  const numerator = BigInt(Math.round(price * Number(denominator)));
  
  // Simplify the fraction if possible
  const gcd = (a: bigint, b: bigint): bigint => (b === BigInt(0) ? a : gcd(b, a % b));
  const divisor = gcd(numerator, denominator);
  
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

/**
 * Helper function to convert byte array to hex string
 */
function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Finds last enacted governance actions for specific types
 */
function findLastEnactedGovActions(
  actionTypes: GovernanceActionType[],
  proposals: KoiosProposal[]
): GovActionInputContext[] {
  const result: GovActionInputContext[] = [];
  
  for (const actionType of actionTypes) {
    // Find the most recent enacted proposal of this type
    const matchingProposals = proposals
      .filter(p => {
        const proposalActionType = mapProposalTypeToActionType(p.proposal_type);
        return proposalActionType === actionType && p.enacted_epoch !== null;
      })
      .sort((a, b) => (b.enacted_epoch ?? 0) - (a.enacted_epoch ?? 0));

    if (matchingProposals.length > 0) {
      result.push(koiosProposalToGovActionContext(matchingProposals[0]));
    }
  }

  return result;
}

/**
 * Converts GovernanceActionId (with txHash as number[]) to GovActionRef (with txHash as hex string)
 */
function govActionIdToRef(actionId: GovernanceActionId): GovActionRef {
  return {
    txHash: bytesToHex(actionId.txHash),
    index: Number(actionId.index),
  };
}

/**
 * Fetches all necessary data from Koios for transaction validation
 */
export async function fetchValidationData(
  necessaryData: NecessaryInputData,
  network: NetworkType,
  apiKey?: string
): Promise<FetchedValidationData> {
  const koiosNetwork = mapToKoiosNetwork(network);
  const client = new KoiosClient({ network: koiosNetwork, apiKey });

  // Convert govActions to refs for targeted querying
  const govActionRefs: GovActionRef[] = necessaryData.govActions.map(govActionIdToRef);
  
  // Convert lastEnactedGovAction types to Koios proposal types for targeted querying
  const lastEnactedProposalTypes: string[] = necessaryData.lastEnactedGovAction.map(
    actionType => govActionTypeToKoiosProposalType(actionType)
  );

  // Fetch all required data in parallel where possible
  // Use targeted queries for proposals instead of fetching all
  const [
    tipResult,
    totalsResult,
    epochParamsResult,
    committeeInfoResult,
    proposalsByRefsResult,
    lastEnactedProposalsResult,
  ] = await Promise.all([
    client.getTip(),
    client.getTotals(),
    client.getEpochParams(),
    client.getCommitteeInfo().catch(() => null), // May fail on older networks
    // Only fetch specific proposals that are referenced in the transaction
    client.getProposalsByRefs(govActionRefs).catch(() => []),
    // Only fetch last enacted proposals for the types needed by the transaction
    client.getLastEnactedProposals(lastEnactedProposalTypes).catch(() => []),
  ]);

  // Get current slot and treasury value
  const currentTip = tipResult[0];
  const slot = BigInt(currentTip.abs_slot);
  
  // Get the latest totals (first item is latest epoch)
  const latestTotals = totalsResult[0];
  const treasuryValue = BigInt(latestTotals?.treasury ?? '0');

  // Get latest epoch params
  const latestParams = epochParamsResult[0];
  const protocolParameters = koiosParamsToProtocolParams(latestParams);

  // Fetch UTxO data
  const utxoRefs = necessaryData.utxos.map((utxo: TxInput) => 
    formatUtxoRef(utxo.txHash, utxo.outputIndex)
  );
  const utxoInfos = await client.getUtxoInfo(utxoRefs);

  // Find UTxOs with reference scripts but missing bytes
  const utxosWithMissingBytes = findUtxosWithMissingRefScriptBytes(utxoInfos);
  
  // Extract missing reference script bytes from transaction CBORs
  const extractedRefScriptBytes = await extractMissingRefScriptBytes(utxosWithMissingBytes, client);
  
  // Convert UTxOs to UtxoInputContext, using extracted bytes where needed
  const utxoSet = utxoInfos.map(utxo => {
    const key = `${utxo.tx_hash}#${utxo.tx_index}`;
    const extractedBytes = extractedRefScriptBytes.get(key);
    return koiosUtxoToUtxoContext(utxo, extractedBytes);
  });

  // Fetch account data
  const accountInfos = await client.getAccountInfo(necessaryData.accounts);
  const accountContexts = accountInfos.map(koiosAccountToAccountContext);

  // For accounts not found, create unregistered entries
  const foundAccounts = new Set(accountInfos.map(a => a.stake_address));
  for (const account of necessaryData.accounts) {
    if (!foundAccounts.has(account)) {
      accountContexts.push({
        bech32Address: account,
        isRegistered: false,
        payedDeposit: null,
        delegatedToDrep: null,
        delegatedToPool: null,
        balance: null,
      });
    }
  }

  // Fetch pool data - convert hex pool IDs to bech32 for Koios API
  // The pools field from get_necessary_data_list_js returns hex pool IDs
  // We need to:
  // 1. Convert hex -> bech32 for Koios API request
  // 2. Keep mapping to convert bech32 -> hex for response (since lib expects hex)
  const poolIdMappings: Map<string, string> = new Map(); // bech32 -> original format from lib
  const poolBech32Ids: string[] = [];
  
  for (const poolId of necessaryData.pools) {
    try {
      const bech32Id = ensurePoolIdBech32(poolId);
      poolBech32Ids.push(bech32Id);
      poolIdMappings.set(bech32Id, poolId);
    } catch (error) {
      console.warn(`Failed to convert pool ID ${poolId}:`, error);
    }
  }
  
  const poolInfos = await client.getPoolInfo(poolBech32Ids);
  
  // Convert Koios response to PoolInputContext using original format from lib
  const poolContexts: PoolInputContext[] = poolInfos.map(pool => {
    const originalPoolId = poolIdMappings.get(pool.pool_id_bech32) || pool.pool_id_bech32;
    return {
      poolId: originalPoolId,
      isRegistered: pool.pool_status === 'registered',
      retirementEpoch: pool.retiring_epoch ?? null,
    };
  });

  // For pools not found, create unregistered entries with original format
  const foundPoolsBech32 = new Set(poolInfos.map(p => p.pool_id_bech32));
  for (const [bech32Id, originalId] of poolIdMappings.entries()) {
    if (!foundPoolsBech32.has(bech32Id)) {
      poolContexts.push({
        poolId: originalId,
        isRegistered: false,
        retirementEpoch: null,
      });
    }
  }

  // Fetch DRep data
  const drepInfos = await client.getDrepInfo(necessaryData.dReps);
  const drepContexts = drepInfos.map(koiosDrepToDrepContext);

  // For DReps not found, create unregistered entries
  const foundDreps = new Set(drepInfos.map(d => d.drep_id));
  for (const drepId of necessaryData.dReps) {
    if (!foundDreps.has(drepId)) {
      drepContexts.push({
        bech32Drep: drepId,
        isRegistered: false,
        payedDeposit: null,
      });
    }
  }

  // Process governance actions - proposals are already filtered by refs
  const govActionContexts = proposalsByRefsResult.map(koiosProposalToGovActionContext);

  // Process last enacted governance actions - already filtered by type
  const lastEnactedGovAction = findLastEnactedGovActions(
    necessaryData.lastEnactedGovAction,
    lastEnactedProposalsResult
  );

  // Process committee members
  let currentCommitteeMembers: CommitteeInputContext[] = [];
  const potentialCommitteeMembers: CommitteeInputContext[] = [];

  if (committeeInfoResult && committeeInfoResult.members) {
    // All current committee members
    const allCommitteeContexts = committeeInfoResult.members.map(koiosCommitteeToCommitteeContext);
    
    // Filter to find members matching cold credentials
    const coldCredentialSet = new Set(
      necessaryData.committeeMembersCold.map((c: LocalCredential) => 
        JSON.stringify('keyHash' in c ? c.keyHash : c.scriptHash)
      )
    );
    
    currentCommitteeMembers = allCommitteeContexts.filter(member => {
      const key = 'keyHash' in member.committeeMemberCold 
        ? member.committeeMemberCold.keyHash 
        : member.committeeMemberCold.scriptHash;
      return coldCredentialSet.has(JSON.stringify(key));
    });

    // Filter to find members matching hot credentials
    const hotCredentialSet = new Set(
      necessaryData.committeeMembersHot.map((c: LocalCredential) => 
        JSON.stringify('keyHash' in c ? c.keyHash : c.scriptHash)
      )
    );

    // Find committee members by hot credential
    const membersByHot = allCommitteeContexts.filter(member => {
      if (!member.committeeMemberHot) return false;
      const key = 'keyHash' in member.committeeMemberHot 
        ? member.committeeMemberHot.keyHash 
        : member.committeeMemberHot.scriptHash;
      return hotCredentialSet.has(JSON.stringify(key));
    });

    // Add to current if not already included
    for (const member of membersByHot) {
      const alreadyExists = currentCommitteeMembers.some(
        m => JSON.stringify(m.committeeMemberCold) === JSON.stringify(member.committeeMemberCold)
      );
      if (!alreadyExists) {
        currentCommitteeMembers.push(member);
      }
    }
  }

  return {
    utxoSet,
    accountContexts,
    poolContexts,
    drepContexts,
    govActionContexts,
    lastEnactedGovAction,
    currentCommitteeMembers,
    potentialCommitteeMembers,
    protocolParameters,
    slot,
    treasuryValue,
  };
}

/**
 * Main function to validate a transaction
 * 
 * @param config - Configuration including transaction hex, network type, and optional API key
 * @returns ValidationResult from cquisitor-lib
 * 
 * @example
 * ```typescript
 * const result = await validateTransaction({
 *   txHex: "84a400...",
 *   network: "mainnet",
 *   apiKey: "your-koios-api-key"
 * });
 * 
 * if (result.errors.length === 0 && result.phase2_errors.length === 0) {
 *   console.log("Transaction is valid!");
 * } else {
 *   console.log("Validation errors:", result.errors);
 * }
 * ```
 */
export async function validateTransaction(
  config: TransactionValidationConfig
): Promise<ValidationResult> {
  const { txHex, network, apiKey } = config;

  // Step 1: Get the list of necessary data from the transaction
  const necessaryDataJson = get_necessary_data_list_js(txHex);
  const necessaryData: NecessaryInputData = JSON.parse(necessaryDataJson);

  // Step 2: Fetch all required data from Koios
  const fetchedData = await fetchValidationData(necessaryData, network, apiKey);

  // Step 3: Build the ValidationInputContext
  const validationContext: ValidationInputContext = {
    utxoSet: fetchedData.utxoSet,
    protocolParameters: fetchedData.protocolParameters,
    slot: fetchedData.slot,
    accountContexts: fetchedData.accountContexts,
    drepContexts: fetchedData.drepContexts,
    poolContexts: fetchedData.poolContexts,
    govActionContexts: fetchedData.govActionContexts,
    lastEnactedGovAction: fetchedData.lastEnactedGovAction,
    currentCommitteeMembers: fetchedData.currentCommitteeMembers,
    potentialCommitteeMembers: fetchedData.potentialCommitteeMembers,
    treasuryValue: fetchedData.treasuryValue,
    networkType: network,
  };

  // Step 4: Validate the transaction
  const validationResultJson = validate_transaction_js(txHex, stringify(validationContext) ?? '{}');
  const validationResult: ValidationResult = JSON.parse(validationResultJson);

  return validationResult;
}

/**
 * Get the list of data that needs to be fetched for validation
 * Useful for understanding what the transaction requires
 */
export function getNecessaryValidationData(txHex: string): NecessaryInputData {
  const necessaryDataJson = get_necessary_data_list_js(txHex);
  return JSON.parse(necessaryDataJson);
}

/**
 * Build ValidationInputContext from pre-fetched data
 * Useful when you want to manage data fetching yourself
 */
export function buildValidationContext(
  fetchedData: FetchedValidationData,
  network: NetworkType
): ValidationInputContext {
  return {
    utxoSet: fetchedData.utxoSet,
    protocolParameters: fetchedData.protocolParameters,
    slot: fetchedData.slot,
    accountContexts: fetchedData.accountContexts,
    drepContexts: fetchedData.drepContexts,
    poolContexts: fetchedData.poolContexts,
    govActionContexts: fetchedData.govActionContexts,
    lastEnactedGovAction: fetchedData.lastEnactedGovAction,
    currentCommitteeMembers: fetchedData.currentCommitteeMembers,
    potentialCommitteeMembers: fetchedData.potentialCommitteeMembers,
    treasuryValue: fetchedData.treasuryValue,
    networkType: network,
  };
}

/**
 * Validate transaction with custom ValidationInputContext
 * Useful when you've built the context yourself
 */
export function validateTransactionWithContext(
  txHex: string,
  context: ValidationInputContext
): ValidationResult {
  const validationResultJson = validate_transaction_js(txHex, stringify(context) ?? '{}');
  return JSON.parse(validationResultJson);
}
