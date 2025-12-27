import type { ExtractedHashes } from "@cardananium/cquisitor-lib";
import type { KoiosUtxoInfo } from "@/utils/koiosTypes";

// Re-export for convenience
export type { ExtractedHashes };
export type { KoiosUtxoInfo };

/**
 * Map of UTxO reference (txHash#outputIndex) to KoiosUtxoInfo
 */
export type InputUtxoInfoMap = Map<string, KoiosUtxoInfo>;

export type CardanoNetwork = "mainnet" | "preview" | "preprod";

// --- Native Script Types ---

export interface ScriptPubkey {
  addr_keyhash: string;
}

export interface ScriptAll {
  native_scripts: NativeScript[];
}

export interface ScriptAny {
  native_scripts: NativeScript[];
}

export interface ScriptNOfK {
  n: number;
  native_scripts: NativeScript[];
}

export interface TimelockStart {
  slot: string;
}

export interface TimelockExpiry {
  slot: string;
}

export type NativeScript =
  | { ScriptPubkey: ScriptPubkey }
  | { ScriptAll: ScriptAll }
  | { ScriptAny: ScriptAny }
  | { ScriptNOfK: ScriptNOfK }
  | { TimelockStart: TimelockStart }
  | { TimelockExpiry: TimelockExpiry };

// --- Auxiliary Data ---

export interface AuxiliaryData {
  metadata?: { [k: string]: string } | null;
  native_scripts?: NativeScript[] | null;
  plutus_scripts?: string[] | null;
  prefer_alonzo_format: boolean;
}

// --- Credential Types ---

export type CredType =
  | { Script: string }
  | { Key: string };

// --- Certificate Types ---

export interface StakeRegistration {
  coin?: string | null;
  stake_credential: CredType;
}

export interface StakeDeregistration {
  coin?: string | null;
  stake_credential: CredType;
}

export interface StakeDelegation {
  pool_keyhash: string;
  stake_credential: CredType;
}

export interface PoolRegistration {
  pool_params: PoolParams;
}

export interface PoolParams {
  cost: string;
  margin: UnitInterval;
  operator: string;
  pledge: string;
  pool_metadata?: PoolMetadata | null;
  pool_owners: string[];
  relays: Relay[];
  reward_account: string;
  vrf_keyhash: string;
}

export interface UnitInterval {
  denominator: string;
  numerator: string;
}

export interface PoolMetadata {
  pool_metadata_hash: string;
  url: string;
}

export type Relay =
  | { SingleHostAddr: SingleHostAddr }
  | { SingleHostName: SingleHostName }
  | { MultiHostName: MultiHostName };

export interface SingleHostAddr {
  ipv4?: [number, number, number, number] | null;
  ipv6?: number[] | null;
  port?: number | null;
}

export interface SingleHostName {
  dns_name: string;
  port?: number | null;
}

export interface MultiHostName {
  dns_name: string;
}

export interface PoolRetirement {
  epoch: number;
  pool_keyhash: string;
}

export interface GenesisKeyDelegation {
  genesis_delegate_hash: string;
  genesishash: string;
  vrf_keyhash: string;
}

export interface MoveInstantaneousRewardsCert {
  move_instantaneous_reward: MoveInstantaneousReward;
}

export interface MoveInstantaneousReward {
  pot: "Reserves" | "Treasury";
  variant: MIREnum;
}

export type MIREnum =
  | { ToOtherPot: string }
  | { ToStakeCredentials: StakeToCoin[] };

export interface StakeToCoin {
  amount: string;
  stake_cred: CredType;
}

export interface Anchor {
  anchor_data_hash: string;
  anchor_url: string;
}

export interface CommitteeHotAuth {
  committee_cold_credential: CredType;
  committee_hot_credential: CredType;
}

export interface CommitteeColdResign {
  anchor?: Anchor | null;
  committee_cold_credential: CredType;
}

export interface DRepDeregistration {
  coin: string;
  voting_credential: CredType;
}

export interface DRepRegistration {
  anchor?: Anchor | null;
  coin: string;
  voting_credential: CredType;
}

export interface DRepUpdate {
  anchor?: Anchor | null;
  voting_credential: CredType;
}

export type DRep =
  | "AlwaysAbstain"
  | "AlwaysNoConfidence"
  | { KeyHash: string }
  | { ScriptHash: string };

export interface StakeAndVoteDelegation {
  drep: DRep;
  pool_keyhash: string;
  stake_credential: CredType;
}

export interface StakeRegistrationAndDelegation {
  coin: string;
  pool_keyhash: string;
  stake_credential: CredType;
}

export interface StakeVoteRegistrationAndDelegation {
  coin: string;
  drep: DRep;
  pool_keyhash: string;
  stake_credential: CredType;
}

export interface VoteDelegation {
  drep: DRep;
  stake_credential: CredType;
}

export interface VoteRegistrationAndDelegation {
  coin: string;
  drep: DRep;
  stake_credential: CredType;
}

export type Certificate =
  | { StakeRegistration: StakeRegistration }
  | { StakeDeregistration: StakeDeregistration }
  | { StakeDelegation: StakeDelegation }
  | { PoolRegistration: PoolRegistration }
  | { PoolRetirement: PoolRetirement }
  | { GenesisKeyDelegation: GenesisKeyDelegation }
  | { MoveInstantaneousRewardsCert: MoveInstantaneousRewardsCert }
  | { CommitteeHotAuth: CommitteeHotAuth }
  | { CommitteeColdResign: CommitteeColdResign }
  | { DRepDeregistration: DRepDeregistration }
  | { DRepRegistration: DRepRegistration }
  | { DRepUpdate: DRepUpdate }
  | { StakeAndVoteDelegation: StakeAndVoteDelegation }
  | { StakeRegistrationAndDelegation: StakeRegistrationAndDelegation }
  | { StakeVoteRegistrationAndDelegation: StakeVoteRegistrationAndDelegation }
  | { VoteDelegation: VoteDelegation }
  | { VoteRegistrationAndDelegation: VoteRegistrationAndDelegation };

// --- Governance Types ---

export type Voter =
  | { ConstitutionalCommitteeHotCred: CredType }
  | { DRep: CredType }
  | { StakingPool: string };

export type VoteKind = "No" | "Yes" | "Abstain";

export interface GovernanceActionId {
  index: number;
  transaction_id: string;
}

export interface VotingProcedure {
  anchor?: Anchor | null;
  vote: VoteKind;
}

export interface Vote {
  action_id: GovernanceActionId;
  voting_procedure: VotingProcedure;
}

export interface VoterVotes {
  voter: Voter;
  votes: Vote[];
}

export interface ProtocolVersion {
  major: number;
  minor: number;
}

export interface ProtocolParamUpdate {
  ada_per_utxo_byte?: string | null;
  collateral_percentage?: number | null;
  // ... other protocol params (simplified)
  [key: string]: unknown;
}

export interface ParameterChangeAction {
  gov_action_id?: GovernanceActionId | null;
  policy_hash?: string | null;
  protocol_param_updates: ProtocolParamUpdate;
}

export interface HardForkInitiationAction {
  gov_action_id?: GovernanceActionId | null;
  protocol_version: ProtocolVersion;
}

export interface TreasuryWithdrawalsAction {
  policy_hash?: string | null;
  withdrawals: { [k: string]: string };
}

export interface NoConfidenceAction {
  gov_action_id?: GovernanceActionId | null;
}

export interface Committee {
  members: CommitteeMember[];
  quorum_threshold: UnitInterval;
}

export interface CommitteeMember {
  stake_credential: CredType;
  term_limit: number;
}

export interface UpdateCommitteeAction {
  committee: Committee;
  gov_action_id?: GovernanceActionId | null;
  members_to_remove: CredType[];
}

export interface Constitution {
  anchor: Anchor;
  script_hash?: string | null;
}

export interface NewConstitutionAction {
  constitution: Constitution;
  gov_action_id?: GovernanceActionId | null;
}

export type InfoAction = [];

export type GovernanceAction =
  | { ParameterChangeAction: ParameterChangeAction }
  | { HardForkInitiationAction: HardForkInitiationAction }
  | { TreasuryWithdrawalsAction: TreasuryWithdrawalsAction }
  | { NoConfidenceAction: NoConfidenceAction }
  | { UpdateCommitteeAction: UpdateCommitteeAction }
  | { NewConstitutionAction: NewConstitutionAction }
  | { InfoAction: InfoAction };

export interface VotingProposal {
  anchor: Anchor;
  deposit: string;
  governance_action: GovernanceAction;
  reward_account: string;
}

// --- Data and Script References ---

export type DataOption =
  | { DataHash: string }
  | { Data: string };

export type ScriptRef =
  | { NativeScript: NativeScript }
  | { PlutusScript: string };

// --- Bootstrap Witness ---

export interface BootstrapWitness {
  attributes: number[];
  chain_code: number[];
  signature: string;
  vkey: string;
}

// ============================================
// Application-specific Types
// ============================================

// Re-use ValidationDiagnostic from ValidationJsonViewer
export interface ValidationDiagnostic {
  severity: "error" | "warning";
  message: string;
  hint?: string | null;
  locations?: string[];
  phase?: string;
  errorType?: string;
  errorData?: Record<string, unknown>;
}

export interface TransactionCardViewProps {
  data: {
    transaction_hash?: string;
    transaction?: TransactionData;
  };
  network?: CardanoNetwork;
  diagnostics?: ValidationDiagnostic[];
  focusedPath?: string[] | null;
  extractedHashes?: ExtractedHashes | null;
  /** Fetched UTxO info for transaction inputs from Koios */
  inputUtxoInfoMap?: InputUtxoInfoMap | null;
}

// Transaction types
export interface TransactionData {
  auxiliary_data?: AuxiliaryData | null;
  body: TransactionBody;
  is_valid: boolean;
  witness_set: WitnessSet;
}

export interface TransactionBody {
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  fee: string;
  ttl?: string | null;
  certs?: Certificate[] | null;
  withdrawals?: Record<string, string> | null;
  mint?: [string, Record<string, string>][] | null;
  auxiliary_data_hash?: string | null;
  validity_start_interval?: string | null;
  script_data_hash?: string | null;
  collateral?: TransactionInput[] | null;
  required_signers?: string[] | null;
  network_id?: string | null;
  collateral_return?: TransactionOutput | null;
  total_collateral?: string | null;
  reference_inputs?: TransactionInput[] | null;
  voting_procedures?: VoterVotes[] | null;
  voting_proposals?: VotingProposal[] | null;
  current_treasury_value?: string | null;
  donation?: string | null;
}

export interface TransactionInput {
  transaction_id: string;
  index: number;
}

export interface TransactionOutput {
  address: string;
  amount: {
    coin: string;
    multiasset?: Record<string, Record<string, string>> | null;
  };
  plutus_data?: DataOption | null;
  script_ref?: ScriptRef | null;
}

export interface WitnessSet {
  vkeys?: VkeyWitness[] | null;
  native_scripts?: NativeScript[] | null;
  bootstraps?: BootstrapWitness[] | null;
  plutus_scripts?: string[] | null;
  plutus_data?: { elems: string[]; definite_encoding?: boolean | null } | null;
  redeemers?: Redeemer[] | null;
}

export interface VkeyWitness {
  vkey: string;
  vkey_hash?: string;
  signature: string;
}

export interface Redeemer {
  tag: string;
  index: string;
  data: string;
  ex_units: { mem: string; steps: string };
}

// Section card props
export interface SectionCardProps {
  title: string;
  icon: string;
  colorScheme: "blue" | "green" | "orange" | "purple" | "red" | "teal" | "pink" | "indigo";
  children: React.ReactNode;
  badge?: string | number;
  path?: string;
  diagnosticsMap?: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  defaultExpanded?: boolean;
}
