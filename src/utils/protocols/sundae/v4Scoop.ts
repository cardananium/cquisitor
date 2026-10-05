// Reconstructs a SundaeSwap V4 scoop from a decoded transaction.
//
// A V4 scoop is a batch: one or more pools are spent under an `Action`
// redeemer, and a set of orders are spent under `Scoop`, with the order
// validator's withdraw redeemer acting as the batch manifest. What makes V4
// legible — and what V3 had no equivalent of — is the TRANSCRIPT each pool
// spend carries: a list of successive `PoolState`s. The difference between two
// consecutive states is exactly what that step of the scoop moved.
//
// INDEX SPACES. Three of them, and mixing them up silently produces wrong
// answers, so every field here says which one it is in:
//
//   body index    — position in `body.inputs`, what the UI numbers inputs by.
//   sorted index  — position after sorting inputs by (transaction_id, index).
//                   The script context sorts inputs, so EVERY index inside a
//                   redeemer is in this space: `Scoop { own_input_index }`,
//                   `Action { pool_input_index }`, and `RouteStep.
//                   pool_input_index`. The withdraw manifest's `entries` are
//                   likewise 1:1 with the order inputs in SORTED order.
//   output index   — position in `body.outputs`, which is never reordered.
//
// ATTRIBUTION. The manifest ties each order to its payout output, and each
// pool's transcript says what the pool did, but nothing in a basic or swap
// order says WHICH pool step filled it — the constraints only check the order's
// own value change. Only a route constraint states that mapping outright. So
// this module reports what the transaction actually says: per-order payout
// deltas, per-step pool deltas, and an explicit route when one is present. It
// infers an order→step link only when the asset flow leaves one possibility.

import {
  convertSerdeNumbers,
  type CardanoNetwork,
  type KoiosUtxoInfo,
  type Redeemer,
  type TransactionBody,
  type TransactionInput,
  type TransactionOutput,
} from "@cardananium/cquisitor-lib";
import { getPaymentScriptHash } from "@/utils/protocols/dex/address";
import { decodePlutusJson } from "@/utils/protocols/dex/datum";
import type { AssetClass, PD } from "./plutusData";
import {
  initialPoolState,
  parseV4OrderDatum,
  parseV4OrderSpendRedeemer,
  parseV4OrderValidatorRedeemer,
  parseV4PoolDatum,
  parseV4PoolSpendRedeemer,
  parseV4RouteWithdrawRedeemer,
  terminalSettlement,
  type V4AssetEntry,
  type V4OrderDatum,
  type V4OrderSpendRedeemer,
  type V4OrderValidatorRedeemer,
  type V4PoolDatum,
  type V4PoolSpendRedeemer,
  type V4PoolState,
  type V4RouteStep,
} from "./v4";
import {
  decodeV4Constraints,
  describeV4OrderKind,
  primaryConstraint,
  type V4DecodedConstraint,
} from "./v4Constraints";
import { getV4Deployment, lookupV4Script, type V4Network } from "./v4Registry";

/** CIP-68 fungible-token prefix; a pool's LP token is `0014df10 ++ identifier`. */
const CIP68_333_PREFIX = "0014df10";
/** CIP-68 NFT prefix; a pool's authenticating NFT is `000de140 ++ identifier`. */
const CIP68_222_PREFIX = "000de140";

export function lpAssetFor(poolMintPolicy: string, identifier: string): AssetClass {
  return { policyId: poolMintPolicy, assetName: CIP68_333_PREFIX + identifier };
}

export function poolNftFor(poolMintPolicy: string, identifier: string): AssetClass {
  return { policyId: poolMintPolicy, assetName: CIP68_222_PREFIX + identifier };
}

function assetKey(a: AssetClass): string {
  return `${a.policyId}.${a.assetName}`;
}

function sameAsset(a: AssetClass, b: AssetClass): boolean {
  return a.policyId === b.policyId && a.assetName === b.assetName;
}

// --- Value helpers --------------------------------------------------------

/** A transaction value flattened to a per-asset map, keyed `policy.name`. */
export type FlatValue = Map<string, { asset: AssetClass; amount: bigint }>;

function addTo(v: FlatValue, asset: AssetClass, amount: bigint): void {
  const key = assetKey(asset);
  const existing = v.get(key);
  if (existing) existing.amount += amount;
  else v.set(key, { asset, amount });
}

/** Flatten a decoded output's value (lovelace + multiasset) into a map. */
export function flattenOutputValue(output: TransactionOutput): FlatValue {
  const flat: FlatValue = new Map();
  addTo(flat, { policyId: "", assetName: "" }, BigInt(output.amount?.coin ?? 0));
  const multiasset = output.amount?.multiasset;
  if (multiasset) {
    for (const [policyId, names] of Object.entries(multiasset)) {
      for (const [assetName, qty] of Object.entries(names)) {
        addTo(flat, { policyId: policyId.toLowerCase(), assetName: assetName.toLowerCase() }, BigInt(qty));
      }
    }
  }
  return flat;
}

/** Flatten a resolved input UTxO's value into the same shape. */
export function flattenUtxoValue(utxo: KoiosUtxoInfo): FlatValue {
  const flat: FlatValue = new Map();
  addTo(flat, { policyId: "", assetName: "" }, BigInt(utxo.value ?? 0));
  for (const a of utxo.asset_list ?? []) {
    addTo(
      flat,
      { policyId: (a.policy_id ?? "").toLowerCase(), assetName: (a.asset_name ?? "").toLowerCase() },
      BigInt(a.quantity ?? 0),
    );
  }
  return flat;
}

/** `after − before`, dropping assets whose amount did not change. */
export function valueDelta(before: FlatValue, after: FlatValue): V4AssetEntry[] {
  const out: V4AssetEntry[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const b = before.get(key);
    const a = after.get(key);
    const amount = (a?.amount ?? BigInt(0)) - (b?.amount ?? BigInt(0));
    if (amount !== BigInt(0)) out.push({ asset: (a ?? b)!.asset, amount });
  }
  return out.sort((x, y) => assetKey(x.asset).localeCompare(assetKey(y.asset)));
}

// --- Pool step deltas -----------------------------------------------------

/**
 * One step of a pool's transcript, with what it moved. Deltas are stated from
 * the ORDER's side, matching `route_lib.compute_deltas`: a reserve delta is
 * `before − after`, so an asset leaving the pool is positive, while the LP
 * delta is `after − before`, so newly minted LP is positive.
 */
export interface V4PoolStep {
  /** Position in this pool's transcript. */
  stepIndex: number;
  /** The module operation tag the step recorded. */
  operationTag: bigint;
  /**
   * The module's own operation payload, left raw. Its shape is the module's
   * business, but the modules deployed so far embed the output reference of the
   * order the step serves — which is how a step is tied to an order.
   */
  operationData: PD;
  /** Fee allowance the step consumed. */
  feeBudget: bigint;
  stateBefore: V4PoolState;
  stateAfter: V4PoolState;
  /** What the step moved, order-side. Positive = flows out of the pool. */
  deltas: V4AssetEntry[];
}

/**
 * Per-step deltas for a pool spend, walking the transcript from the datum's
 * initial state. Returns an empty list when the transcript did not decode.
 */
export function poolSteps(
  datum: V4PoolDatum,
  redeemer: V4PoolSpendRedeemer,
  poolMintPolicy: string | null,
): V4PoolStep[] {
  if (redeemer.kind !== "Action" || !redeemer.transcript) return [];
  const lpAsset = poolMintPolicy ? lpAssetFor(poolMintPolicy, datum.identifier) : null;
  const steps: V4PoolStep[] = [];
  let before = initialPoolState(datum);
  redeemer.transcript.forEach((entry, i) => {
    const after = entry.stateAfter;
    steps.push({
      stepIndex: i,
      operationTag: entry.operationTag,
      operationData: entry.operationData,
      feeBudget: entry.feeBudget,
      stateBefore: before,
      stateAfter: after,
      deltas: stateDeltas(before, after, lpAsset),
    });
    before = after;
  });
  return steps;
}

/**
 * Order-side deltas between two pool states. Reserves are paired by position,
 * as the on-chain `asset_deltas_pinned` does — the invariant modules do not all
 * pin the asset class per index, so a mismatch is reported rather than paired
 * across differing classes.
 */
function stateDeltas(
  before: V4PoolState,
  after: V4PoolState,
  lpAsset: AssetClass | null,
): V4AssetEntry[] {
  const out: V4AssetEntry[] = [];
  const n = Math.min(before.assets.length, after.assets.length);
  for (let i = 0; i < n; i++) {
    const b = before.assets[i];
    const a = after.assets[i];
    if (!sameAsset(b.asset, a.asset)) continue; // classes differ at this index
    const amount = b.amount - a.amount; // leaving the pool is positive
    if (amount !== BigInt(0)) out.push({ asset: b.asset, amount });
  }
  if (lpAsset) {
    const lpDelta = after.circulatingLp - before.circulatingLp;
    if (lpDelta !== BigInt(0)) out.push({ asset: lpAsset, amount: lpDelta });
  }
  return out;
}

// --- Reconstruction -------------------------------------------------------

/** A pool being spent in this scoop. */
export interface V4ScoopPool {
  bodyInputIndex: number;
  sortedInputIndex: number;
  datum: V4PoolDatum;
  redeemer: V4PoolSpendRedeemer;
  /** Per-step deltas, empty when the redeemer is not an `Action`. */
  steps: V4PoolStep[];
  /** Output index the `Action` redeemer says the pool continues at. */
  poolOutputIndex: number | null;
  /** The pool's LP token, when the deployment's pool mint policy is known. */
  lpAsset: AssetClass | null;
}

/** An order being spent in this scoop, or cancelled. */
export interface V4ScoopOrder {
  bodyInputIndex: number;
  sortedInputIndex: number;
  /** Position among the order inputs in sorted order — the manifest's index. */
  orderIndex: number;
  /**
   * This order's own output reference. Pool transcripts name the order a step
   * serves by embedding this, which is what ties a step to an order.
   */
  txHash: string;
  outputIndex: number;
  datum: V4OrderDatum | null;
  /** Null when the datum could not be resolved or parsed. */
  parseError: string | null;
  redeemer: V4OrderSpendRedeemer | null;
  constraints: V4DecodedConstraint[];
  /** Short label, e.g. "Swap", "Deposit". */
  kind: string;
  /** Output the manifest pays this order out to. */
  payoutOutputIndex: number | null;
  /**
   * Value change from this order's input to its payout output, when both are
   * resolved. `after − before`, so what the order received is positive.
   */
  payoutDelta: V4AssetEntry[] | null;
  /** True when the payout output sits at the order address (a partial fill). */
  isContinuation: boolean;
  /**
   * Lovelace this fill was allowed to deduct as the service fee: the budget
   * difference on a continuation, `min(max_per_execution, service_budget)` on a
   * terminal fill.
   */
  feeDeducted: bigint | null;
  /** Route this order declared, when the route constraint is present. */
  route: V4RouteStep[] | null;
}

export interface V4ScoopInfo {
  network: V4Network;
  pools: V4ScoopPool[];
  orders: V4ScoopOrder[];
  /** The batch manifest, when the order validator's withdraw redeemer decoded. */
  manifest: V4OrderValidatorRedeemer | null;
  /** True when at least one order is being cancelled rather than scooped. */
  hasCancel: boolean;
  /** sorted index → body index, so callers can translate redeemer indices. */
  sortedToBody: number[];
  /** Notes about anything we could not resolve, for display rather than silence. */
  issues: string[];
}

function compareInputs(a: TransactionInput, b: TransactionInput): number {
  if (a.transaction_id !== b.transaction_id) {
    return a.transaction_id < b.transaction_id ? -1 : 1;
  }
  return a.index - b.index;
}

/**
 * The inline datum of a resolved input UTxO. Koios and the Blockfrost worker
 * both hand back `inline_datum.value` as an already-parsed DetailedSchema tree,
 * so this normalizes its numbers in place rather than round-tripping through
 * JSON — a plutus int can exceed `MAX_SAFE_INTEGER`, and `JSON.stringify`
 * rejects the BigInt it decodes to.
 */
function utxoToDatum(utxo: KoiosUtxoInfo): PD | null {
  const inline = utxo.inline_datum as { value?: unknown } | null | undefined;
  if (!inline || inline.value === undefined || inline.value === null) return null;
  try {
    return convertSerdeNumbers(inline.value as never) as PD;
  } catch {
    return null;
  }
}

/** Decode a redeemer's DetailedSchema JSON payload, or null. */
function redeemerData(r: Redeemer | undefined): PD | null {
  return r ? decodePlutusJson(r.data) : null;
}

/**
 * Build the scoop view for a transaction, or null when the transaction spends
 * no V4 pool and no V4 order.
 *
 * Needs `inputUtxoInfoMap` to see input datums and values; without it the
 * orders and pools cannot be read and the function returns null.
 */
export function buildV4Scoop(
  body: TransactionBody,
  redeemers: Redeemer[] | null | undefined,
  network: CardanoNetwork | undefined,
  inputUtxoInfoMap: Map<string, KoiosUtxoInfo> | null | undefined,
): V4ScoopInfo | null {
  if (!inputUtxoInfoMap) return null;
  const inputs = body.inputs ?? [];
  const outputs = body.outputs ?? [];
  if (inputs.length === 0) return null;

  // sorted ↔ body index maps.
  const indexed = inputs.map((inp, i) => ({ inp, i }));
  indexed.sort((a, b) => compareInputs(a.inp, b.inp));
  const sortedToBody = indexed.map((x) => x.i);
  const bodyToSorted = new Map<number, number>();
  sortedToBody.forEach((bodyIdx, sortedIdx) => bodyToSorted.set(bodyIdx, sortedIdx));

  const spendRedeemers = new Map<number, Redeemer>();
  for (const r of redeemers ?? []) {
    if (String(r.tag).toLowerCase() === "spend") spendRedeemers.set(Number(r.index), r);
  }

  const issues: string[] = [];

  // Classify every input by its V4 validator title. A pool and an order live at
  // different validators, so one pass over the inputs separates them.
  interface Classified {
    bodyIndex: number;
    txHash: string;
    outputIndex: number;
    sortedIndex: number;
    utxo: KoiosUtxoInfo;
    title: string;
    network: V4Network;
  }
  const poolInputs: Classified[] = [];
  const orderInputs: Classified[] = [];

  for (let bodyIndex = 0; bodyIndex < inputs.length; bodyIndex++) {
    const inp = inputs[bodyIndex];
    const utxo = inputUtxoInfoMap.get(`${inp.transaction_id}#${inp.index}`);
    if (!utxo) continue;
    const scriptHash = getPaymentScriptHash(utxo.address);
    if (!scriptHash) continue;
    const match = lookupV4Script(scriptHash, network);
    if (!match) continue;
    const entry: Classified = {
      bodyIndex,
      txHash: inp.transaction_id.toLowerCase(),
      outputIndex: inp.index,
      sortedIndex: bodyToSorted.get(bodyIndex)!,
      utxo,
      title: match.title,
      network: match.network,
    };
    if (match.titles.some((t) => t.startsWith("pool."))) poolInputs.push(entry);
    else if (match.titles.some((t) => t.startsWith("order."))) orderInputs.push(entry);
  }

  if (poolInputs.length === 0 && orderInputs.length === 0) return null;

  const scoopNetwork = (poolInputs[0] ?? orderInputs[0]).network;
  const deployment = getV4Deployment(scoopNetwork);
  const poolMintPolicy = deployment.byTitle["pool.mint"]?.toLowerCase() ?? null;
  if (!poolMintPolicy) {
    issues.push("pool.mint policy is unknown for this deployment; LP deltas are omitted");
  }

  // --- Pools ---
  const pools: V4ScoopPool[] = [];
  for (const p of poolInputs) {
    const raw = utxoToDatum(p.utxo);
    if (!raw) {
      issues.push(`pool input #${p.bodyIndex} carries no readable inline datum`);
      continue;
    }
    let datum: V4PoolDatum;
    try {
      datum = parseV4PoolDatum(raw);
    } catch (e) {
      issues.push(
        `pool input #${p.bodyIndex} datum did not parse: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const pdRedeemer = redeemerData(spendRedeemers.get(p.sortedIndex));
    const redeemer = pdRedeemer ? parseV4PoolSpendRedeemer(pdRedeemer) : null;
    if (!redeemer) {
      issues.push(`pool input #${p.bodyIndex} has no recognizable pool redeemer`);
      continue;
    }
    pools.push({
      bodyInputIndex: p.bodyIndex,
      sortedInputIndex: p.sortedIndex,
      datum,
      redeemer,
      steps: poolSteps(datum, redeemer, poolMintPolicy),
      poolOutputIndex: redeemer.kind === "Action" ? Number(redeemer.poolOutputIndex) : null,
      lpAsset: poolMintPolicy ? lpAssetFor(poolMintPolicy, datum.identifier) : null,
    });
  }

  // --- Manifest (the order validator's withdraw redeemer) ---
  const orderValidatorHash = deployment.byTitle["order.spend"]?.toLowerCase() ?? null;
  const manifest = findManifest(body, redeemers, orderValidatorHash);
  if (orderInputs.length > 0 && !manifest) {
    issues.push("order validator withdraw redeemer not found; payout outputs are unknown");
  }

  // --- Routes (the route constraint's withdraw redeemer) ---
  const routeHash = deployment.byTitle["route.withdraw"]?.toLowerCase() ?? null;
  const routes = routeHash ? findRoutes(body, redeemers, routeHash) : null;

  // --- Orders ---
  // Manifest entries are 1:1 with the order inputs in SORTED order, so sort
  // before indexing into it.
  orderInputs.sort((a, b) => a.sortedIndex - b.sortedIndex);
  const orders: V4ScoopOrder[] = [];
  let hasCancel = false;

  orderInputs.forEach((o, orderIndex) => {
    const raw = utxoToDatum(o.utxo);
    let datum: V4OrderDatum | null = null;
    let parseError: string | null = null;
    if (!raw) {
      parseError = "no readable inline datum on the order input";
    } else {
      try {
        datum = parseV4OrderDatum(raw);
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
    }

    const pdRedeemer = redeemerData(spendRedeemers.get(o.sortedIndex));
    const redeemer = pdRedeemer ? parseV4OrderSpendRedeemer(pdRedeemer) : null;
    if (redeemer?.kind === "Cancel") hasCancel = true;

    const constraints = datum ? decodeV4Constraints(datum.constraints, network) : [];

    const entry = manifest?.entries[orderIndex] ?? null;
    const payoutOutputIndex = entry ? Number(entry.outputIndex) : null;
    const payout =
      payoutOutputIndex !== null && payoutOutputIndex < outputs.length
        ? outputs[payoutOutputIndex]
        : null;

    let payoutDelta: V4AssetEntry[] | null = null;
    let isContinuation = false;
    let feeDeducted: bigint | null = null;
    if (payout) {
      payoutDelta = valueDelta(flattenUtxoValue(o.utxo), flattenOutputValue(payout));
      isContinuation = payout.address === o.utxo.address;
      feeDeducted = computeFeeDeducted(datum, payout, isContinuation);
    }

    orders.push({
      bodyInputIndex: o.bodyIndex,
      sortedInputIndex: o.sortedIndex,
      orderIndex,
      txHash: o.txHash,
      outputIndex: o.outputIndex,
      datum,
      parseError,
      redeemer,
      constraints,
      kind: datum ? describeV4OrderKind(constraints) : "Order",
      payoutOutputIndex,
      payoutDelta,
      isContinuation,
      feeDeducted,
      route: routes?.[orderIndex]?.length ? routes[orderIndex] : null,
    });
  });

  return {
    network: scoopNetwork,
    pools,
    orders,
    manifest,
    hasCancel,
    sortedToBody,
    issues,
  };
}

/**
 * The service fee this fill deducted. On a continuation the order's datum
 * carries the remaining budget, so the fee is the difference; on a terminal
 * fill there is no continuing datum and the allowance is
 * `min(max_per_execution, service_budget)`.
 */
function computeFeeDeducted(
  datum: V4OrderDatum | null,
  payout: TransactionOutput,
  isContinuation: boolean,
): bigint | null {
  if (!datum) return null;
  if (!isContinuation) return terminalSettlement(datum);
  const raw = payout.plutus_data && "Data" in payout.plutus_data
    ? decodePlutusJson(payout.plutus_data.Data)
    : null;
  if (!raw) return null;
  try {
    return datum.serviceBudget - parseV4OrderDatum(raw).serviceBudget;
  } catch {
    return null;
  }
}

/** Reward addresses in the canonical script-context order used by redeemer indices. */
function sortedRewardAddresses(withdrawals: Record<string, string> | null | undefined): string[] {
  const addrs = Object.keys(withdrawals ?? {});
  if (addrs.length <= 1) return addrs;
  return addrs
    .map((a) => ({ a, key: rewardSortKey(a) }))
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
    .map((x) => x.a);
}

function rewardSortKey(addr: string): string {
  const hash = getPaymentScriptHash(addr);
  return hash ? `1${hash}` : `0${addr}`;
}

/**
 * Find a withdraw redeemer by the script hash of the credential it targets.
 * Matching on the credential rather than on the redeemer's shape avoids
 * mistaking one constraint validator's redeemer for another's.
 */
function findWithdrawRedeemerFor(
  body: TransactionBody,
  redeemers: Redeemer[] | null | undefined,
  scriptHash: string,
): PD | null {
  const sorted = sortedRewardAddresses(body.withdrawals);
  for (const r of redeemers ?? []) {
    const tag = String(r.tag).toLowerCase();
    if (tag !== "reward" && tag !== "withdraw") continue;
    const addr = sorted[Number(r.index)];
    if (!addr) continue;
    if (getPaymentScriptHash(addr) !== scriptHash) continue;
    const pd = decodePlutusJson(r.data);
    if (pd) return pd;
  }
  return null;
}

function findManifest(
  body: TransactionBody,
  redeemers: Redeemer[] | null | undefined,
  orderValidatorHash: string | null,
): V4OrderValidatorRedeemer | null {
  if (orderValidatorHash) {
    const pd = findWithdrawRedeemerFor(body, redeemers, orderValidatorHash);
    if (pd) return parseV4OrderValidatorRedeemer(pd);
  }
  // The withdrawals may not have decoded yet (address decoding is async on
  // first paint). Fall back to shape: the manifest is the only withdraw
  // redeemer that parses as `{ configs, entries }` with a non-empty entry list.
  for (const r of redeemers ?? []) {
    const tag = String(r.tag).toLowerCase();
    if (tag !== "reward" && tag !== "withdraw") continue;
    const pd = decodePlutusJson(r.data);
    if (!pd) continue;
    const parsed = parseV4OrderValidatorRedeemer(pd);
    if (parsed && parsed.entries.length > 0) return parsed;
  }
  return null;
}

function findRoutes(
  body: TransactionBody,
  redeemers: Redeemer[] | null | undefined,
  routeHash: string,
): V4RouteStep[][] | null {
  const pd = findWithdrawRedeemerFor(body, redeemers, routeHash);
  return pd ? parseV4RouteWithdrawRedeemer(pd) : null;
}

// --- Derived summaries ----------------------------------------------------

/** Total steps across every pool in the scoop. */
export function totalSteps(scoop: V4ScoopInfo): number {
  return scoop.pools.reduce((n, p) => n + p.steps.length, 0);
}

/**
 * The service fee the scoop collected, summed over the orders whose fee we
 * could compute. Returns null when no order yielded a figure.
 */
export function totalFee(scoop: V4ScoopInfo): bigint | null {
  let sum = BigInt(0);
  let any = false;
  for (const o of scoop.orders) {
    if (o.feeDeducted !== null) {
      sum += o.feeDeducted;
      any = true;
    }
  }
  return any ? sum : null;
}

/** True when the scoop touches more than one pool — the multi-pool case. */
export function isMultiPool(scoop: V4ScoopInfo): boolean {
  return scoop.pools.length > 1;
}

/**
 * The action label for a pool spend, e.g. "Action tag 100 · 3 steps".
 * `Action` is the scoop path; the others are administrative.
 */
export function describePoolRedeemer(redeemer: V4PoolSpendRedeemer): string {
  switch (redeemer.kind) {
    case "Action":
      return `Action tag ${redeemer.tag}`;
    case "EscapeHatch":
      return `Escape hatch (${redeemer.redeemedLp} LP)`;
    case "Upgrade":
      return "Upgrade";
    case "EmergencyDisable":
      return `Emergency ${redeemer.setEnabled ? "enable" : "disable"} of tag ${redeemer.targetTag}`;
    case "Destroy":
      return "Destroy";
  }
}

/** The primary constraint's label for an order, for compact rendering. */
export function orderConstraintLabel(order: V4ScoopOrder): string {
  const primary = primaryConstraint(order.constraints);
  return primary ? primary.label : "no constraints";
}
