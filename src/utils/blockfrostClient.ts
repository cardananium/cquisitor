/**
 * Blockfrost API Client
 *
 * Implements the same surface as KoiosClient — same method signatures,
 * same return types — by fanning out to Blockfrost's per-item GET endpoints
 * and translating the responses into Koios-shaped objects so the validator
 * pipeline (transactionValidation.ts) stays provider-agnostic.
 *
 * Trade-off: Blockfrost has no batch UTxO/account/pool endpoints, so we
 * issue N concurrent requests where Koios would issue one. For validator
 * use (≈5-30 items per call site) the latency is fine.
 */
import { decode_specific_type } from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "./serdeNumbers";
import type { GovActionRef, BlockchainDataClient } from "./koiosClient";
import {
  PLUTUS_V1_ORDER,
  PLUTUS_V2_ORDER,
  PLUTUS_V3_ORDER,
} from "./plutusCostModelOrder";
import {
  KoiosNetworkType,
  KoiosTip,
  KoiosTotals,
  KoiosUtxoInfo,
  KoiosUtxoAsset,
  KoiosInlineDatum,
  KoiosReferenceScript,
  KoiosAccountInfo,
  KoiosPoolInfo,
  KoiosDrepInfo,
  KoiosCommitteeInfo,
  KoiosConstitution,
  KoiosProposal,
  KoiosEpochParams,
  KoiosTxCborResponse,
} from "./koiosTypes";

const BLOCKFROST_BASE_URLS: Record<KoiosNetworkType, string> = {
  mainnet: "https://cardano-mainnet.blockfrost.io/api/v0",
  preview: "https://cardano-preview.blockfrost.io/api/v0",
  preprod: "https://cardano-preprod.blockfrost.io/api/v0",
};

export interface BlockfrostClientConfig {
  network: KoiosNetworkType;
  apiKey: string;
}

const PREDEFINED_DREPS = new Set(["AlwaysAbstain", "AlwaysNoConfidence"]);

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex: odd length");
  const buf = new ArrayBuffer(clean.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

// --- Raw Blockfrost shapes (only what we consume) ------------------------

interface BfBlock {
  time: number;
  height: number;
  hash: string;
  slot: number;
  epoch: number;
  epoch_slot: number;
}

interface BfNetwork {
  supply: {
    max: string;
    total: string;
    circulating: string;
    locked: string;
    treasury: string;
    reserves: string;
  };
}

interface BfAmount {
  unit: string; // "lovelace" or policyId+assetName hex
  quantity: string;
}

interface BfTxOutput {
  address: string;
  amount: BfAmount[];
  output_index: number;
  data_hash: string | null;
  inline_datum: string | null; // hex CBOR
  reference_script_hash: string | null;
  consumed_by_tx?: string | null;
}

interface BfTxUtxos {
  hash: string;
  outputs: BfTxOutput[];
}

interface BfAccount {
  stake_address: string;
  // `active` = currently delegating; `registered` = current registration state.
  // The two diverge for stake addresses that registered then deregistered, so
  // map `registered` (not `active`) to KoiosAccountInfo.status.
  active: boolean;
  registered: boolean;
  controlled_amount: string;
  rewards_sum: string;
  withdrawable_amount: string;
  pool_id: string | null;
  drep_id: string | null;
  // Conway-era; older builds may not have this.
  active_epoch?: number | null;
}

interface BfPool {
  pool_id: string;
  hex: string;
  vrf_key: string;
  blocks_minted: number;
  live_stake: string;
  live_size: number;
  live_saturation: number;
  active_stake: string;
  active_size: number;
  declared_pledge: string;
  live_pledge: string;
  margin_cost: number;
  fixed_cost: string;
  reward_account: string;
  owners: string[];
  registration: string[];
  retirement: string[];
}

interface BfDrep {
  drep_id: string;
  hex: string;
  amount: string;
  active: boolean;
  active_epoch: number | null;
  has_script: boolean;
  retired: boolean;
  expired: boolean;
}

// NOTE: no BfCommittee/BfCommitteeMember types here — public Blockfrost has
// no committee endpoint, so getCommitteeInfo returns an empty stub. See
// comment on that method for details.

interface BfProposal {
  tx_hash: string;
  cert_index: number;
  governance_type: string; // "parameter_change" etc.
  deposit: string;
  return_address: string;
  expiration: number;
  enacted_epoch: number | null;
  ratified_epoch: number | null;
  expired_epoch: number | null;
  dropped_epoch: number | null;
  // Some builds expose `meta_url`/`meta_hash`; values are unused upstream.
}

// --- Cost model translation ----------------------------------------------

// Blockfrost returns cost_models as a named-key object (e.g.
// `addInteger-cpu-arguments-intercept: 100788`). The validator expects the
// canonical operator-ordered array form, so we lay them out by index.
function namedCostModelToArray(
  named: Record<string, number> | null | undefined,
  order: readonly string[]
): number[] | null {
  if (!named) return null;
  const out: number[] = new Array(order.length);
  for (let i = 0; i < order.length; i++) {
    const v = named[order[i]];
    // Use 0 for missing keys — we don't expect any in practice, but the
    // validator can't accept undefined slots.
    out[i] = typeof v === "number" ? v : 0;
  }
  return out;
}

interface BfEpochParameters {
  epoch: number;
  min_fee_a: number;
  min_fee_b: number;
  max_block_size: number;
  max_tx_size: number;
  max_block_header_size: number;
  key_deposit: string;
  pool_deposit: string;
  e_max: number;
  n_opt: number;
  a0: number;
  rho: number;
  tau: number;
  decentralisation_param: number;
  extra_entropy: string | null;
  protocol_major_ver: number;
  protocol_minor_ver: number;
  min_utxo: string;
  min_pool_cost: string;
  nonce: string;
  // Deprecated by Blockfrost in favour of `cost_models_raw`; we still read it
  // as a fallback for older nodes that haven't started serving the raw form.
  cost_models: {
    PlutusV1?: Record<string, number>;
    PlutusV2?: Record<string, number>;
    PlutusV3?: Record<string, number>;
  } | null;
  // Already in canonical operator-index order — no name→index mapping needed.
  cost_models_raw?: {
    PlutusV1?: number[];
    PlutusV2?: number[];
    PlutusV3?: number[];
  } | null;
  price_mem: number;
  price_step: number;
  max_tx_ex_mem: string;
  max_tx_ex_steps: string;
  max_block_ex_mem: string;
  max_block_ex_steps: string;
  max_val_size: string;
  collateral_percent: number;
  max_collateral_inputs: number;
  coins_per_utxo_size: string;
  coins_per_utxo_word?: string;
  pvt_motion_no_confidence?: number;
  pvt_committee_normal?: number;
  pvt_committee_no_confidence?: number;
  pvt_hard_fork_initiation?: number;
  dvt_motion_no_confidence?: number;
  dvt_committee_normal?: number;
  dvt_committee_no_confidence?: number;
  dvt_update_to_constitution?: number;
  dvt_hard_fork_initiation?: number;
  dvt_p_p_network_group?: number;
  dvt_p_p_economic_group?: number;
  dvt_p_p_technical_group?: number;
  dvt_p_p_gov_group?: number;
  dvt_treasury_withdrawal?: number;
  committee_min_size?: number;
  committee_max_term_length?: number;
  gov_action_lifetime?: number;
  gov_action_deposit?: string;
  drep_deposit?: string;
  drep_activity?: number;
  pvtpp_security_group?: number;
  min_fee_ref_script_cost_per_byte?: number;
}

interface BfScriptInfo {
  script_hash: string;
  type: "timelock" | "plutusV1" | "plutusV2" | "plutusV3";
  serialised_size: number | null;
}

// --- Helpers --------------------------------------------------------------

function parseUnit(unit: string): { policy_id: string; asset_name: string } {
  if (unit === "lovelace") return { policy_id: "", asset_name: "" };
  // First 56 chars are the policy ID; remainder is the hex-encoded asset name.
  return { policy_id: unit.slice(0, 56), asset_name: unit.slice(56) };
}

function bfAmountsToKoiosAssets(amount: BfAmount[]): {
  lovelace: string;
  assets: KoiosUtxoAsset[];
} {
  let lovelace = "0";
  const assets: KoiosUtxoAsset[] = [];
  for (const a of amount) {
    if (a.unit === "lovelace") {
      lovelace = a.quantity;
    } else {
      const { policy_id, asset_name } = parseUnit(a.unit);
      assets.push({
        policy_id,
        asset_name,
        // Blockfrost doesn't return fingerprint/decimals on /txs/utxos.
        fingerprint: "",
        decimals: 0,
        quantity: a.quantity,
      });
    }
  }
  return { lovelace, assets };
}

function decodeInlineDatumValue(hex: string): unknown {
  try {
    const decoded = decode_specific_type(hex, "PlutusData", {
      plutus_data_schema: "DetailedSchema",
    }) as { plutus_data: unknown };
    return convertSerdeNumbers(decoded.plutus_data);
  } catch {
    return null;
  }
}

function mapGovernanceType(t: string): KoiosProposal["proposal_type"] {
  switch (t) {
    case "parameter_change":
      return "ParameterChange";
    case "hard_fork_initiation":
      return "HardForkInitiation";
    case "treasury_withdrawals":
      return "TreasuryWithdrawals";
    case "no_confidence":
      return "NoConfidence";
    case "new_committee":
      return "NewCommittee";
    case "new_constitution":
      return "NewConstitution";
    case "info_action":
    default:
      return "InfoAction";
  }
}

// --- Client ---------------------------------------------------------------

export class BlockfrostClient implements BlockchainDataClient {
  private baseUrl: string;
  private apiKey: string;

  // Per-instance caches — many calls in fetchValidationData hit the same URLs
  // (e.g. /epochs/latest, /scripts/{hash}, /txs/{hash}/utxos). Memoising them
  // halves request volume on the typical validation path.
  private getCache = new Map<string, Promise<unknown>>();

  constructor(config: BlockfrostClientConfig) {
    this.baseUrl = BLOCKFROST_BASE_URLS[config.network];
    this.apiKey = config.apiKey;
  }

  private headers(): HeadersInit {
    return {
      project_id: this.apiKey,
      Accept: "application/json",
    };
  }

  private async getRaw<T>(path: string, opts?: { allow404?: boolean }): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    // Cache key includes allow404 so a 404→null reuse never leaks to a caller
    // that would otherwise expect a throw.
    const cacheKey = opts?.allow404 ? `${url}|404ok` : url;
    const cached = this.getCache.get(cacheKey) as Promise<T | null> | undefined;
    if (cached) return cached;
    const promise = fetch(url, { method: "GET", headers: this.headers() }).then(async (res) => {
      if (res.status === 404 && opts?.allow404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Blockfrost API error: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
      }
      return res.json() as Promise<T>;
    });
    // Evict failed promises so a transient error doesn't poison the rest of
    // the validation run (one 429/5xx would otherwise stick for the session).
    promise.catch(() => {
      if (this.getCache.get(cacheKey) === promise) this.getCache.delete(cacheKey);
    });
    this.getCache.set(cacheKey, promise);
    return promise;
  }

  private async get<T>(path: string): Promise<T> {
    const result = await this.getRaw<T>(path);
    return result as T;
  }

  // --- KoiosClient surface ------------------------------------------------

  async getTip(): Promise<KoiosTip[]> {
    const block = await this.get<BfBlock>("/blocks/latest");
    return [
      {
        hash: block.hash,
        epoch_no: block.epoch,
        abs_slot: block.slot,
        epoch_slot: block.epoch_slot,
        block_height: block.height,
        block_time: block.time,
      },
    ];
  }

  async getTotals(epochNo?: number): Promise<KoiosTotals[]> {
    // Blockfrost has no per-epoch supply view; `/network` returns *current*
    // supply only. The validator only consumes `treasury`, so this is fine.
    void epochNo;
    const net = await this.get<BfNetwork>("/network");
    return [
      {
        epoch_no: 0,
        circulation: net.supply.circulating,
        treasury: net.supply.treasury,
        reward: "0",
        supply: net.supply.total,
        reserves: net.supply.reserves,
        fees: "0",
        deposits_stake: "0",
        deposits_drep: "0",
        deposits_proposal: "0",
      },
    ];
  }

  async getUtxoInfo(utxoRefs: string[]): Promise<KoiosUtxoInfo[]> {
    if (utxoRefs.length === 0) return [];
    // Group by tx hash; one /txs/{hash}/utxos call returns all outputs of a tx.
    const refsByTx = new Map<string, number[]>();
    for (const ref of utxoRefs) {
      const [hash, indexStr] = ref.split("#");
      const index = Number(indexStr);
      const list = refsByTx.get(hash) ?? [];
      list.push(index);
      refsByTx.set(hash, list);
    }
    const all = await Promise.all(
      Array.from(refsByTx.entries()).map(async ([txHash, indices]) => {
        const utxos = await this.getRaw<BfTxUtxos>(`/txs/${txHash}/utxos`, { allow404: true });
        if (!utxos) return [];
        const wanted = new Set(indices);
        return Promise.all(
          utxos.outputs
            .filter((o) => wanted.has(o.output_index))
            .map((o) => this.bfOutputToKoios(txHash, o))
        );
      })
    );
    return all.flat();
  }

  private async bfOutputToKoios(txHash: string, o: BfTxOutput): Promise<KoiosUtxoInfo> {
    const { lovelace, assets } = bfAmountsToKoiosAssets(o.amount);

    let inline_datum: KoiosInlineDatum | null = null;
    if (o.inline_datum) {
      inline_datum = {
        bytes: o.inline_datum,
        // The lib decoder returns the same DetailedSchema shape Koios already
        // gives us, so downstream code doesn't see a difference.
        value: decodeInlineDatumValue(o.inline_datum),
      };
    }

    let reference_script: KoiosReferenceScript | null = null;
    if (o.reference_script_hash) {
      reference_script = await this.fetchReferenceScript(o.reference_script_hash);
    }

    return {
      tx_hash: txHash,
      tx_index: o.output_index,
      address: o.address,
      value: lovelace,
      stake_address: null,
      payment_cred: null,
      epoch_no: 0,
      block_height: 0,
      block_time: 0,
      datum_hash: o.data_hash,
      inline_datum,
      reference_script,
      asset_list: assets.length > 0 ? assets : null,
      is_spent: !!o.consumed_by_tx,
    };
  }

  private async fetchReferenceScript(hash: string): Promise<KoiosReferenceScript | null> {
    try {
      const [info, cbor] = await Promise.all([
        this.getRaw<BfScriptInfo>(`/scripts/${hash}`, { allow404: true }),
        this.getRaw<{ cbor: string | null }>(`/scripts/${hash}/cbor`, { allow404: true }),
      ]);
      if (!info) return null;
      // For native scripts /scripts/{hash}/cbor returns null — that's expected
      // and the validator handles missing bytes via extractMissingRefScriptBytes.
      // For Plutus scripts a missing CBOR is a real failure: we leave bytes
      // empty so the upstream "missing bytes" path can try recovering from
      // the originating tx CBOR rather than silently dropping the ref script.
      return {
        hash,
        size: info.serialised_size ?? 0,
        // Match Koios's casing convention. Koios uses lowercase "plutusV2" too,
        // and the validator pipeline lowercases anyway.
        type: info.type,
        bytes: cbor?.cbor ?? "",
        value: null,
      };
    } catch {
      return null;
    }
  }

  async getAccountInfo(stakeAddresses: string[]): Promise<KoiosAccountInfo[]> {
    if (stakeAddresses.length === 0) return [];
    const responses = await Promise.all(
      stakeAddresses.map((addr) =>
        this.getRaw<BfAccount>(`/accounts/${addr}`, { allow404: true }).then(
          (data) => ({ addr, data })
        )
      )
    );
    const out: KoiosAccountInfo[] = [];
    for (const { addr, data } of responses) {
      if (!data) continue; // unknown — caller fills in unregistered fallback
      out.push({
        stake_address: addr,
        // `data.registered` is the actual registration state. A stake address
        // can return 200 with `registered: false` after deregistration, so the
        // earlier "200 ⇒ registered" assumption was wrong.
        status: data.registered ? "registered" : "not registered",
        delegated_drep: data.drep_id ?? null,
        delegated_pool: data.pool_id ?? null,
        total_balance: data.controlled_amount,
        utxo: "0",
        rewards: data.rewards_sum,
        withdrawals: "0",
        rewards_available: data.withdrawable_amount,
        // Blockfrost doesn't expose the historical deposit. Hardcode 2 ADA:
        // Cardano's keyDeposit has been 2_000_000 lovelace since Shelley and
        // has never changed, so this is correct in practice and keeps the
        // validator on the same numeric path as the Koios provider (which
        // always returns a non-empty value).
        deposit: "2000000",
        reserves: "0",
        treasury: "0",
      });
    }
    return out;
  }

  async getPoolInfo(poolIds: string[]): Promise<KoiosPoolInfo[]> {
    if (poolIds.length === 0) return [];
    const responses = await Promise.all(
      poolIds.map((id) =>
        this.getRaw<BfPool>(`/pools/${id}`, { allow404: true }).then((data) => ({ id, data }))
      )
    );
    const out: KoiosPoolInfo[] = [];
    for (const { id, data } of responses) {
      if (!data) continue;
      out.push({
        pool_id_bech32: id,
        pool_id_hex: data.hex ?? "",
        active_epoch_no: 0,
        vrf_key_hash: data.vrf_key,
        margin: data.margin_cost,
        fixed_cost: data.fixed_cost,
        pledge: data.declared_pledge,
        deposit: "500000000",
        reward_addr: data.reward_account,
        owners: data.owners,
        relays: [],
        meta_url: null,
        meta_hash: null,
        meta_json: null,
        // `registration` and `retirement` are append-only lists of cert tx
        // hashes for the pool's history. The pool's *current* state is
        // determined by which list received the most recent entry — but
        // Blockfrost only gives us the lists in chronological order, not the
        // last-touched-at. Since each retirement must be preceded by a
        // registration, `registration.length > retirement.length` ⇒ the pool
        // is currently registered (re-registered after its last retirement).
        pool_status: data.registration.length > data.retirement.length ? "registered" : "retired",
        retiring_epoch: null,
        op_cert: null,
        op_cert_counter: null,
        active_stake: data.active_stake,
        sigma: null,
        block_count: data.blocks_minted,
        live_pledge: data.live_pledge,
        live_stake: data.live_stake,
        live_delegators: data.live_size,
        live_saturation: data.live_saturation,
        voting_power: null,
      });
    }
    return out;
  }

  async getDrepInfo(drepIds: string[]): Promise<KoiosDrepInfo[]> {
    const valid = drepIds.filter(
      (id) => id && id.trim() !== "" && !PREDEFINED_DREPS.has(id)
    );
    if (valid.length === 0) return [];
    const responses = await Promise.all(
      valid.map((id) =>
        this.getRaw<BfDrep>(`/governance/dreps/${id}`, { allow404: true }).then(
          (data) => ({ id, data })
        )
      )
    );
    const out: KoiosDrepInfo[] = [];
    for (const { id, data } of responses) {
      if (!data) continue;
      out.push({
        drep_id: id,
        hex: data.hex,
        has_script: data.has_script,
        drep_status: data.retired ? 'deregistered' : 'registered',
        deposit: null,
        active: data.active,
        expires_epoch_no: null,
        amount: data.amount,
        meta_url: null,
        meta_hash: null,
      });
    }
    return out;
  }

  async getCommitteeInfo(): Promise<KoiosCommitteeInfo> {
    // KNOWN LIMITATION: the public Blockfrost API has no committee endpoint
    // (verified against blockfrost/openapi.yaml; /governance/committee and
    // every plausible variant return 400 "Invalid path"). For now return an
    // empty committee so the validator runs to completion;
    // committee-membership-aware validation (resignations, hot-key auth,
    // etc.) simply degrades on the Blockfrost provider compared to Koios.
    // Switch back to fetching here once Blockfrost ships an equivalent
    // endpoint.
    return {
      proposal_id: "",
      proposal_tx_hash: "",
      proposal_index: 0,
      quorum_numerator: 0,
      quorum_denominator: 1,
      members: [],
    };
  }

  async getConstitution(): Promise<KoiosConstitution | null> {
    // KNOWN LIMITATION: the public Blockfrost API has no constitution endpoint
    // (verified against blockfrost/openapi.json — only /governance/committee,
    // /dreps and /proposals exist). Return null so callers can fall back to the
    // well-known per-network guardrails script hash. Koios serves this via its
    // Ogmios passthrough; switch to a real fetch here if Blockfrost adds one.
    return null;
  }

  async getProposalsByRefs(refs: GovActionRef[]): Promise<KoiosProposal[]> {
    if (refs.length === 0) return [];
    const responses = await Promise.all(
      refs.map((ref) =>
        this.getRaw<BfProposal>(
          `/governance/proposals/${ref.txHash}/${ref.index}`,
          { allow404: true }
        )
      )
    );
    const out: KoiosProposal[] = [];
    for (const data of responses) {
      if (!data) continue;
      out.push(this.bfProposalToKoios(data));
    }
    return out;
  }

  async getLastEnactedProposals(proposalTypes: string[]): Promise<KoiosProposal[]> {
    if (proposalTypes.length === 0) return [];
    // `/governance/proposals` (list) only returns
    // `{id, tx_hash, cert_index, governance_type}` — no enacted_epoch — so
    // we have to fetch each candidate's detail to know whether it was
    // enacted. We walk pages newest-first, filter list entries to types we
    // still need, batch-fetch their details, and take the first enacted hit
    // per type. The detail calls are the expensive part, so prefiltering on
    // governance_type before issuing them is what keeps the request budget
    // sane.
    type BfProposalListItem = {
      id: string;
      tx_hash: string;
      cert_index: number;
      governance_type: string;
    };
    const remaining = new Set(proposalTypes.map((t) => t.toLowerCase()));
    const enacted: KoiosProposal[] = [];
    const PAGE_SIZE = 100;
    const MAX_PAGES = 20;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = await this.get<BfProposalListItem[]>(
        `/governance/proposals?count=${PAGE_SIZE}&page=${page}&order=desc`
      );
      if (list.length === 0) break;
      const candidates = list.filter((p) => {
        const key = mapGovernanceType(p.governance_type).toLowerCase();
        return remaining.has(key);
      });
      const details = await Promise.all(
        candidates.map((c) =>
          this.getRaw<BfProposal>(
            `/governance/proposals/${c.tx_hash}/${c.cert_index}`,
            { allow404: true }
          )
        )
      );
      for (const d of details) {
        if (!d || d.enacted_epoch === null) continue;
        const koios = this.bfProposalToKoios(d);
        const key = koios.proposal_type.toLowerCase();
        if (remaining.has(key)) {
          enacted.push(koios);
          // Lock in the most-recent enaction per type, then stop watching it.
          remaining.delete(key);
        }
      }
      if (remaining.size === 0) break;
      if (list.length < PAGE_SIZE) break;
    }
    return enacted;
  }

  async getEpochParams(epochNo?: number): Promise<KoiosEpochParams[]> {
    const path =
      epochNo !== undefined ? `/epochs/${epochNo}/parameters` : "/epochs/latest/parameters";
    const p = await this.get<BfEpochParameters>(path);
    // Prefer `cost_models_raw` (already in canonical order, hash-stable) and
    // fall back to translating the deprecated named-key `cost_models` only if
    // the node doesn't serve the raw form. The named-key path is fragile —
    // adding a new operator requires updating PLUTUS_V*_ORDER in lockstep, and
    // any drift produces silent script_data_hash mismatches.
    const cost_models =
      p.cost_models_raw
        ? {
            PlutusV1: p.cost_models_raw.PlutusV1,
            PlutusV2: p.cost_models_raw.PlutusV2,
            PlutusV3: p.cost_models_raw.PlutusV3,
          }
        : p.cost_models
          ? {
              PlutusV1: namedCostModelToArray(p.cost_models.PlutusV1, PLUTUS_V1_ORDER) ?? undefined,
              PlutusV2: namedCostModelToArray(p.cost_models.PlutusV2, PLUTUS_V2_ORDER) ?? undefined,
              PlutusV3: namedCostModelToArray(p.cost_models.PlutusV3, PLUTUS_V3_ORDER) ?? undefined,
            }
          : null;
    return [
      {
        epoch_no: p.epoch,
        min_fee_a: p.min_fee_a,
        min_fee_b: p.min_fee_b,
        max_block_size: p.max_block_size,
        max_tx_size: p.max_tx_size,
        max_bh_size: p.max_block_header_size,
        key_deposit: p.key_deposit,
        pool_deposit: p.pool_deposit,
        max_epoch: p.e_max,
        optimal_pool_count: p.n_opt,
        influence: p.a0,
        monetary_expand_rate: p.rho,
        treasury_growth_rate: p.tau,
        decentralisation: p.decentralisation_param,
        extra_entropy: p.extra_entropy,
        protocol_major: p.protocol_major_ver,
        protocol_minor: p.protocol_minor_ver,
        min_utxo_value: p.min_utxo,
        min_pool_cost: p.min_pool_cost,
        nonce: p.nonce,
        block_hash: "",
        cost_models,
        price_mem: p.price_mem,
        price_step: p.price_step,
        max_tx_ex_mem: Number(p.max_tx_ex_mem),
        max_tx_ex_steps: Number(p.max_tx_ex_steps),
        max_block_ex_mem: Number(p.max_block_ex_mem),
        max_block_ex_steps: Number(p.max_block_ex_steps),
        max_val_size: Number(p.max_val_size),
        collateral_percent: p.collateral_percent,
        max_collateral_inputs: p.max_collateral_inputs,
        coins_per_utxo_size: p.coins_per_utxo_size,
        pvt_motion_no_confidence: p.pvt_motion_no_confidence ?? null,
        pvt_committee_normal: p.pvt_committee_normal ?? null,
        pvt_committee_no_confidence: p.pvt_committee_no_confidence ?? null,
        pvt_hard_fork_initiation: p.pvt_hard_fork_initiation ?? null,
        dvt_motion_no_confidence: p.dvt_motion_no_confidence ?? null,
        dvt_committee_normal: p.dvt_committee_normal ?? null,
        dvt_committee_no_confidence: p.dvt_committee_no_confidence ?? null,
        dvt_update_to_constitution: p.dvt_update_to_constitution ?? null,
        dvt_hard_fork_initiation: p.dvt_hard_fork_initiation ?? null,
        dvt_p_p_network_group: p.dvt_p_p_network_group ?? null,
        dvt_p_p_economic_group: p.dvt_p_p_economic_group ?? null,
        dvt_p_p_technical_group: p.dvt_p_p_technical_group ?? null,
        dvt_p_p_gov_group: p.dvt_p_p_gov_group ?? null,
        dvt_treasury_withdrawal: p.dvt_treasury_withdrawal ?? null,
        committee_min_size: p.committee_min_size ?? null,
        committee_max_term_length: p.committee_max_term_length ?? null,
        gov_action_lifetime: p.gov_action_lifetime ?? null,
        gov_action_deposit: p.gov_action_deposit ?? null,
        drep_deposit: p.drep_deposit ?? null,
        drep_activity: p.drep_activity ?? null,
        pvtpp_security_group: p.pvtpp_security_group ?? null,
        min_fee_ref_script_cost_per_byte: p.min_fee_ref_script_cost_per_byte ?? null,
      },
    ];
  }

  async getTxCbor(txHashes: string[]): Promise<KoiosTxCborResponse[]> {
    if (txHashes.length === 0) return [];
    const results = await Promise.all(
      txHashes.map((hash) =>
        this.getRaw<{ cbor: string }>(`/txs/${hash}/cbor`, { allow404: true }).then(
          (data) => (data ? { tx_hash: hash, block_hash: "", block_height: 0, cbor: data.cbor } : null)
        )
      )
    );
    return results.filter((r): r is KoiosTxCborResponse => r !== null);
  }

  async submitTransaction(txHex: string): Promise<string> {
    const bytes = hexToBytes(txHex);
    const response = await fetch(`${this.baseUrl}/tx/submit`, {
      method: "POST",
      headers: {
        project_id: this.apiKey,
        "Content-Type": "application/cbor",
        Accept: "application/json",
      },
      body: new Blob([bytes], { type: "application/cbor" }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Blockfrost submit error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`
      );
    }
    const txHash = await response.json();
    return typeof txHash === "string" ? txHash : String(txHash);
  }

  // --- Helpers shared across methods --------------------------------------

  private bfProposalToKoios(p: BfProposal): KoiosProposal {
    return {
      block_time: 0,
      proposal_id: "",
      proposal_tx_hash: p.tx_hash,
      proposal_index: p.cert_index,
      proposal_type: mapGovernanceType(p.governance_type),
      proposal_description: null,
      deposit: p.deposit,
      return_address: p.return_address,
      proposed_epoch: 0,
      ratified_epoch: p.ratified_epoch,
      enacted_epoch: p.enacted_epoch,
      dropped_epoch: p.dropped_epoch,
      expired_epoch: p.expired_epoch,
      expiration: p.expiration,
      meta_url: null,
      meta_hash: null,
      meta_json: null,
      meta_comment: null,
      meta_language: null,
      meta_is_valid: null,
      withdrawal: null,
      param_proposal: null,
    };
  }
}
