// SundaeSwap V4 (the vault architecture) datums and redeemers.
//
// Field layouts follow the Aiken source in SundaeSwap-finance/sundae-v4:
//   lib/types/order.ak     OrderDatum, OrderValidatorRedeemer, ConfigRef, RouteStep
//   lib/types/pool.ak      PoolDatum, ActionEntry, PoolState, TranscriptEntry, PoolRedeemer
//   lib/types/settings.ak  SettingsDatum, PoolConfig, OrderConfig, FeeSettings
//   lib/types/common.ak    AssetClass, Destination
//
// V4 differs from V3 in three ways that shape this module:
//
// 1. An order does not say what kind of order it is. It carries
//    `constraints: List<(ByteArray, Data)>` — a list keyed by the script hash
//    of the withdraw validator that enforces each constraint. Reading an order
//    means resolving those hashes against the deployment (see v4Registry.ts)
//    and decoding each payload with the matching decoder (v4Constraints.ts).
//    This module keeps the constraint payloads raw.
//
// 2. A pool spend carries a TRANSCRIPT: `Action { tag, transcript, .. }` where
//    the transcript is a list of successive `PoolState`s. The deltas between
//    consecutive states are what each step of the scoop moved.
//
// 3. Settings is no longer one datum. A global node holds the admins, and
//    token-bound nodes hold per-package `PoolConfig`, per-order-type
//    `OrderConfig`, and `FeeSettings`. They share no constructor tag, so the
//    caller picks the parser by which node it fetched.

import {
  asBool,
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  isConstr,
  parseAssetClass,
  parsePlutusAddress,
  type AssetClass,
  type PD,
  type PlutusAddress,
} from "./plutusData";
import { parseMultisig, type MultisigScript } from "./v3";

// --- Common shapes --------------------------------------------------------

/** `(AssetClass, Int)` — an Aiken 2-tuple, encoded as a 2-element list. */
export interface V4AssetEntry {
  asset: AssetClass;
  amount: bigint;
}

export function parseAssetEntry(d: PD): V4AssetEntry {
  const list = asList(d);
  if (list.length !== 2) throw new Error("expected (asset, amount) pair");
  return { asset: parseAssetClass(list[0]), amount: asInt(list[1]) };
}

export function parseAssetEntryList(d: PD): V4AssetEntry[] {
  return asList(d).map(parseAssetEntry);
}

export function isAda(asset: AssetClass): boolean {
  return asset.policyId === "" && asset.assetName === "";
}

/**
 * `Destination = Fixed { address, datum: Option<Data> } | Self`. Narrower than
 * the V3 `DatumOption` — there is no datum-hash case.
 */
export type V4Destination =
  | { kind: "Fixed"; address: PlutusAddress; datum: PD | null }
  | { kind: "Self" };

export function parseV4Destination(d: PD): V4Destination {
  const c = asConstr(d);
  if (c.tag === 0) {
    if (c.fields.length !== 2) {
      throw new Error(`Destination.Fixed: expected 2 fields, got ${c.fields.length}`);
    }
    return {
      kind: "Fixed",
      address: parsePlutusAddress(c.fields[0]),
      datum: asOptional(c.fields[1], (x) => x),
    };
  }
  if (c.tag === 1) return { kind: "Self" };
  throw new Error(`Destination: unexpected ctor ${c.tag}`);
}

// --- Order datum ----------------------------------------------------------

/** One `(constraint validator hash, payload)` entry of an order's constraint list. */
export interface V4ConstraintEntry {
  /** 28-byte hash of the withdraw validator that enforces this constraint. */
  hash: string;
  /** The payload, left raw — decode with `decodeV4Constraint`. */
  data: PD;
}

export interface V4OrderDatum {
  owner: MultisigScript;
  destination: V4Destination;
  /**
   * Lifetime lovelace allowance for service fees, decremented by `order_fee` on
   * each execution. A continuation output carries the remainder.
   */
  serviceBudget: bigint;
  /**
   * Immutable flat cap on the lovelace a single scoop may deduct, independent
   * of step count. Also the terminal-settlement amount — see
   * `terminalSettlement`.
   */
  maxPerExecution: bigint;
  /**
   * Asset name of the settings node holding this order's `OrderConfig`, which
   * names the order type and lists the constraints it must carry.
   */
  configToken: string;
  constraints: V4ConstraintEntry[];
  extension: PD;
}

/**
 * `OrderDatum`, 7 fields. Field order is load-bearing on chain: the validators
 * read `constraints` positionally as the 6th field.
 */
export function parseV4OrderDatum(data: PD): V4OrderDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`V4 OrderDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 7) {
    throw new Error(`V4 OrderDatum: expected 7 fields, got ${c.fields.length}`);
  }
  return {
    owner: parseMultisig(c.fields[0]),
    destination: parseV4Destination(c.fields[1]),
    serviceBudget: asInt(c.fields[2]),
    maxPerExecution: asInt(c.fields[3]),
    configToken: asBytes(c.fields[4]),
    constraints: parseConstraintEntries(c.fields[5]),
    extension: c.fields[6],
  };
}

function parseConstraintEntries(d: PD): V4ConstraintEntry[] {
  return asList(d).map((entry) => {
    const pair = asList(entry);
    if (pair.length !== 2) {
      throw new Error("constraints entry: expected (hash, data) pair");
    }
    return { hash: asBytes(pair[0]).toLowerCase(), data: pair[1] };
  });
}

/**
 * The lovelace a terminal fill may deduct: `min(max_per_execution,
 * service_budget)` (order_lib.terminal_settlement). A continuation fill instead
 * deducts the difference between the input and output `service_budget`.
 */
export function terminalSettlement(datum: V4OrderDatum): bigint {
  return datum.maxPerExecution < datum.serviceBudget
    ? datum.maxPerExecution
    : datum.serviceBudget;
}

// --- Pool datum -----------------------------------------------------------

/** One entry of a pool's action map: which modules validate a given action tag. */
export interface V4ActionEntry {
  tag: bigint;
  enabled: boolean;
  /** Module validator hashes that must all run for this action. */
  modules: string[];
}

function parseActionEntry(d: PD): V4ActionEntry {
  const c = asConstr(d);
  if (c.tag !== 0 || c.fields.length !== 3) {
    throw new Error("ActionEntry: expected ctor 0 with 3 fields");
  }
  return {
    tag: asInt(c.fields[0]),
    enabled: asBool(c.fields[1]),
    modules: asList(c.fields[2]).map((m) => asBytes(m).toLowerCase()),
  };
}

/** `(ModuleHash, ByteArray)` — per-module state the vault stores but never reads. */
export interface V4ModuleStateEntry {
  moduleHash: string;
  state: string;
}

function parseModuleState(d: PD): V4ModuleStateEntry[] {
  return asList(d).map((entry) => {
    const pair = asList(entry);
    if (pair.length !== 2) {
      throw new Error("module_state entry: expected (hash, state) pair");
    }
    return { moduleHash: asBytes(pair[0]).toLowerCase(), state: asBytes(pair[1]) };
  });
}

/**
 * The four fields every module reads from a pool, and the unit a transcript
 * step records. Declared reserves plus the three LP counters.
 */
export interface V4PoolState {
  assets: V4AssetEntry[];
  totalLp: bigint;
  circulatingLp: bigint;
  premintedLp: bigint;
}

export interface V4PoolDatum {
  kind: "V4";
  assets: V4AssetEntry[];
  totalLp: bigint;
  circulatingLp: bigint;
  premintedLp: bigint;
  identifier: string;
  actions: V4ActionEntry[];
  moduleState: V4ModuleStateEntry[];
  /** Floor on the pool's lovelace surplus, copied from `PoolConfig.min_surplus`. */
  minSurplus: bigint;
  extension: PD;
}

/**
 * `PoolDatum`, 9 fields. Modules read a fixed positional prefix, so new fields
 * are only ever appended — `min_surplus` and `extension` are the two most
 * recent. Accepts a longer datum than we know about and ignores the tail, so a
 * future append does not break rendering.
 */
export function parseV4PoolDatum(data: PD): V4PoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`V4 PoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length < 7) {
    throw new Error(`V4 PoolDatum: expected at least 7 fields, got ${c.fields.length}`);
  }
  return {
    kind: "V4",
    assets: parseAssetEntryList(c.fields[0]),
    totalLp: asInt(c.fields[1]),
    circulatingLp: asInt(c.fields[2]),
    premintedLp: asInt(c.fields[3]),
    identifier: asBytes(c.fields[4]),
    actions: asList(c.fields[5]).map(parseActionEntry),
    moduleState: parseModuleState(c.fields[6]),
    minSurplus: c.fields.length > 7 ? asInt(c.fields[7]) : BigInt(0),
    extension: c.fields.length > 8 ? c.fields[8] : { constructor: 0, fields: [] },
  };
}

/** The pool state a datum starts a scoop in (`pool.initial_state`). */
export function initialPoolState(datum: V4PoolDatum): V4PoolState {
  return {
    assets: datum.assets,
    totalLp: datum.totalLp,
    circulatingLp: datum.circulatingLp,
    premintedLp: datum.premintedLp,
  };
}

function parsePoolState(d: PD): V4PoolState {
  const c = asConstr(d);
  if (c.fields.length < 4) {
    throw new Error(`PoolState: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    assets: parseAssetEntryList(c.fields[0]),
    totalLp: asInt(c.fields[1]),
    circulatingLp: asInt(c.fields[2]),
    premintedLp: asInt(c.fields[3]),
  };
}

/**
 * One step of a pool spend's transcript: the state the pool is in after the
 * step, the fee allowance the step consumed, and the module-specific operation
 * it performed. `operationData` stays raw — only the owning module knows its
 * shape.
 */
export interface V4TranscriptEntry {
  stateAfter: V4PoolState;
  feeBudget: bigint;
  operationTag: bigint;
  operationData: PD;
}

export function parseTranscriptEntry(d: PD): V4TranscriptEntry {
  const c = asConstr(d);
  if (c.fields.length < 4) {
    throw new Error(`TranscriptEntry: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    stateAfter: parsePoolState(c.fields[0]),
    feeBudget: asInt(c.fields[1]),
    operationTag: asInt(c.fields[2]),
    operationData: c.fields[3],
  };
}

// --- Settings nodes -------------------------------------------------------

/**
 * The global settings node (`settings_lib.global_settings`, the empty token
 * name). 5 fields — the treasury address, order modules and batcher share that
 * V4 carried in earlier revisions now live in the token-bound nodes below.
 */
export interface V4SettingsDatum {
  settingsAdmin: MultisigScript;
  treasuryAdmin: MultisigScript;
  /** `None` = anyone may scoop. */
  authorizedScoopers: MultisigScript[] | null;
  securityCouncil: MultisigScript;
  extension: PD;
}

export function parseV4SettingsDatum(data: PD): V4SettingsDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`V4 SettingsDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length < 5) {
    throw new Error(`V4 SettingsDatum: expected 5 fields, got ${c.fields.length}`);
  }
  return {
    settingsAdmin: parseMultisig(c.fields[0]),
    treasuryAdmin: parseMultisig(c.fields[1]),
    authorizedScoopers: asOptional(c.fields[2], (x) => asList(x).map(parseMultisig)),
    securityCouncil: parseMultisig(c.fields[3]),
    extension: c.fields[4],
  };
}

/**
 * A pool package: the pool validator a pool of this kind sits at, its action
 * map, and each module's create-time parameters.
 */
export interface V4PoolConfig {
  kind: "PoolConfig";
  poolValidator: string;
  actions: V4ActionEntry[];
  moduleParams: Array<{ moduleHash: string; params: PD }>;
  /** `None` = permissionless pool creation. */
  mintPermission: MultisigScript | null;
  minSurplus: bigint;
  extension: PD;
}

export function parseV4PoolConfig(data: PD): V4PoolConfig {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`V4 PoolConfig: unexpected ctor ${c.tag}`);
  if (c.fields.length < 5) {
    throw new Error(`V4 PoolConfig: expected at least 5 fields, got ${c.fields.length}`);
  }
  return {
    kind: "PoolConfig",
    poolValidator: asBytes(c.fields[0]).toLowerCase(),
    actions: asList(c.fields[1]).map(parseActionEntry),
    moduleParams: asList(c.fields[2]).map((entry) => {
      const pair = asList(entry);
      if (pair.length !== 2) {
        throw new Error("module_params entry: expected (hash, params) pair");
      }
      return { moduleHash: asBytes(pair[0]).toLowerCase(), params: pair[1] };
    }),
    mintPermission: asOptional(c.fields[3], parseMultisig),
    minSurplus: asInt(c.fields[4]),
    extension: c.fields.length > 5 ? c.fields[5] : { constructor: 0, fields: [] },
  };
}

/**
 * An order type. `label` is the node's own config token name — the value an
 * order's `configToken` points at — and `requiredConstraints` lists the
 * constraint validator hashes an order of this type must carry.
 */
export interface V4OrderConfig {
  kind: "OrderConfig";
  label: string;
  requiredConstraints: string[];
}

export function parseV4OrderConfig(data: PD): V4OrderConfig {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`V4 OrderConfig: unexpected ctor ${c.tag}`);
  if (c.fields.length < 2) {
    throw new Error(`V4 OrderConfig: expected 2 fields, got ${c.fields.length}`);
  }
  return {
    kind: "OrderConfig",
    label: asBytes(c.fields[0]),
    requiredConstraints: asList(c.fields[1]).map((h) => asBytes(h).toLowerCase()),
  };
}

/** Parameters for the fee constraint aggregator. */
export interface V4FeeSettings {
  kind: "FeeSettings";
  baseFee: bigint;
}

export function parseV4FeeSettings(data: PD): V4FeeSettings {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`V4 FeeSettings: unexpected ctor ${c.tag}`);
  if (c.fields.length < 1) throw new Error("V4 FeeSettings: expected 1 field");
  return { kind: "FeeSettings", baseFee: asInt(c.fields[0]) };
}

/**
 * A settings node of unknown kind. The nodes share constructor tag 0 and are
 * told apart by shape, so this tries each parser in order of how specific its
 * shape is. Returns null when nothing fits.
 */
export type V4SettingsNode = V4PoolConfig | V4OrderConfig | V4FeeSettings;

export function classifyV4SettingsNode(data: PD): V4SettingsNode | null {
  if (!isConstr(data)) return null;
  const c = asConstr(data);
  if (c.tag !== 0) return null;
  // PoolConfig: 5+ fields, first is a 28-byte validator hash.
  if (c.fields.length >= 5) {
    try {
      return parseV4PoolConfig(data);
    } catch {
      // fall through
    }
  }
  // OrderConfig: exactly 2 fields — a token name and a list of hashes.
  if (c.fields.length === 2) {
    try {
      return parseV4OrderConfig(data);
    } catch {
      // fall through
    }
  }
  // FeeSettings: a lone integer.
  if (c.fields.length === 1) {
    try {
      return parseV4FeeSettings(data);
    } catch {
      // fall through
    }
  }
  return null;
}

// --- Redeemers ------------------------------------------------------------

/**
 * The order validator's spend redeemer. `Scoop` only ties the spend to the
 * withdraw handler that validates the whole batch; `Cancel` is the owner
 * withdrawing their order.
 */
export type V4OrderSpendRedeemer =
  | { kind: "Cancel" }
  | { kind: "Scoop"; ownInputIndex: bigint };

export function parseV4OrderSpendRedeemer(data: PD): V4OrderSpendRedeemer | null {
  if (!isConstr(data)) return null;
  const c = asConstr(data);
  if (c.tag === 0 && c.fields.length === 0) return { kind: "Cancel" };
  if (c.tag === 1 && c.fields.length === 1) {
    try {
      return { kind: "Scoop", ownInputIndex: asInt(c.fields[0]) };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The pool validator's spend redeemer. Constructor indices are pinned
 * append-only on chain: EscapeHatch 0, Upgrade 1, EmergencyDisable 2, Action 3,
 * Destroy 4.
 */
export type V4PoolSpendRedeemer =
  | { kind: "EscapeHatch"; redeemedLp: bigint }
  | { kind: "Upgrade" }
  | { kind: "EmergencyDisable"; targetTag: bigint; setEnabled: boolean }
  | {
      kind: "Action";
      tag: bigint;
      /** Successive pool states; null when the transcript failed to decode. */
      transcript: V4TranscriptEntry[] | null;
      /** Number of raw transcript entries, even when decoding them failed. */
      transcriptLength: number;
      poolInputIndex: bigint;
      poolOutputIndex: bigint;
    }
  | { kind: "Destroy" };

export function parseV4PoolSpendRedeemer(data: PD): V4PoolSpendRedeemer | null {
  if (!isConstr(data)) return null;
  const c = asConstr(data);
  try {
    if (c.tag === 0 && c.fields.length === 1) {
      return { kind: "EscapeHatch", redeemedLp: asInt(c.fields[0]) };
    }
    if (c.tag === 1 && c.fields.length === 0) return { kind: "Upgrade" };
    if (c.tag === 2 && c.fields.length === 2) {
      return {
        kind: "EmergencyDisable",
        targetTag: asInt(c.fields[0]),
        setEnabled: asBool(c.fields[1]),
      };
    }
    if (c.tag === 3 && c.fields.length === 4) {
      const raw = asList(c.fields[1]);
      let transcript: V4TranscriptEntry[] | null = null;
      try {
        transcript = raw.map(parseTranscriptEntry);
      } catch {
        // A module may carry a shape we don't know; keep the count and let the
        // caller render the step list without state deltas.
        transcript = null;
      }
      return {
        kind: "Action",
        tag: asInt(c.fields[0]),
        transcript,
        transcriptLength: raw.length,
        poolInputIndex: asInt(c.fields[2]),
        poolOutputIndex: asInt(c.fields[3]),
      };
    }
    if (c.tag === 4 && c.fields.length === 0) return { kind: "Destroy" };
  } catch {
    return null;
  }
  return null;
}

/** A reference input the order validator reads an `OrderConfig` from. */
export interface V4ConfigRef {
  refIndex: bigint;
  token: string;
}

/** One scooped order: which output pays it out, and which config governs it. */
export interface V4OrderValidatorEntry {
  outputIndex: bigint;
  configIndex: bigint;
}

/**
 * The order validator's withdraw redeemer — the batch manifest. `entries` is
 * 1:1 with the transaction's order inputs, in input order.
 */
export interface V4OrderValidatorRedeemer {
  configs: V4ConfigRef[];
  entries: V4OrderValidatorEntry[];
}

export function parseV4OrderValidatorRedeemer(
  data: PD,
): V4OrderValidatorRedeemer | null {
  if (!isConstr(data)) return null;
  const c = asConstr(data);
  if (c.tag !== 0 || c.fields.length !== 2) return null;
  try {
    return {
      configs: asList(c.fields[0]).map((entry) => {
        const ec = asConstr(entry);
        if (ec.fields.length < 2) throw new Error("ConfigRef: expected 2 fields");
        return { refIndex: asInt(ec.fields[0]), token: asBytes(ec.fields[1]) };
      }),
      entries: asList(c.fields[1]).map((entry) => {
        const ec = asConstr(entry);
        if (ec.fields.length < 2) {
          throw new Error("OrderValidatorEntry: expected 2 fields");
        }
        return { outputIndex: asInt(ec.fields[0]), configIndex: asInt(ec.fields[1]) };
      }),
    };
  } catch {
    return null;
  }
}

/** One hop of a route: a transcript step of a particular pool input. */
export interface V4RouteStep {
  poolInputIndex: number;
  transcriptStepIndex: number;
}

export function parseRouteStep(d: PD): V4RouteStep {
  const c = asConstr(d);
  if (c.fields.length < 2) throw new Error("RouteStep: expected 2 fields");
  return {
    poolInputIndex: Number(asInt(c.fields[0])),
    transcriptStepIndex: Number(asInt(c.fields[1])),
  };
}

/**
 * The route constraint's withdraw redeemer: one route per order entry, 1:1 and
 * in the same order, with `[]` standing in for an order that carries no route.
 */
export function parseV4RouteWithdrawRedeemer(data: PD): V4RouteStep[][] | null {
  try {
    return asList(data).map((route) => asList(route).map(parseRouteStep));
  } catch {
    return null;
  }
}
