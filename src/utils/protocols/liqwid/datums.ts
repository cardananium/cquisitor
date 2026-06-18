// Liqwid Finance datum/redeemer parsers.
//
//   (1) the LOAN spend validator 71391f18 — datums are all List[5];
//   (2) the MARKET-STATE address (state-token 34293de1) — datums are all List[8];
//   (3) the ACTION validator fa3603d2 — redeemer is the action enum
//       (tags 0|1|2|3|4|5) + which state/loan fields each touches.
//
// Shape (ctor=none, top-level List, field count, field types) is identical across
// every UTxO.

import {
  asConstr,
  asOptional,
  isBytes,
  isConstr,
  isInt,
  isList,
  isMap,
  parseCredential,
  type Credential,
  type PD,
} from "@/utils/protocols/dex/plutusData";

export type LiqwidRole = "market" | "position" | "action" | "qtoken";

// ---------------------------------------------------------------------------
// Position / Loan datum  (role: "position")
// ---------------------------------------------------------------------------
// On-chain shape: TOP-LEVEL LIST of 5 elements (NOT a Constr).
//   [0] owner       : Bytes(28)  PubKeyHash of the position owner
//   [1] principal   : Int        underlying supplied/borrowed (asset base units)
//   [2] interest    : Int        accrued interest in underlying base units
//   [3] minInterest : Int        minimum/origination interest (≈0.08% of principal
//                                 on observed ADA loans) in underlying base units
//   [4] interestIndex: Int       fixed-point interest accumulator snapshot at the
//                                 last update (high-precision, ~1.6e16+ observed)
// The loan validator (71391f18) only structurally checks an OUTPUT datum's
// element[0] (a tag/optional) and element[1] (a 0- or 28-byte hash); the SEMANTIC
// accounting (principal/interest math) is enforced by the action validator.
export interface LiqwidPositionDatum {
  role: "position";
  owner: string;
  principal: bigint;
  interest: bigint;
  minInterest: bigint;
  interestIndex: bigint;
}

// ---------------------------------------------------------------------------
// Market-state datum  (role: "market")
// ---------------------------------------------------------------------------
// On-chain shape: TOP-LEVEL LIST of 8 elements (NOT a Constr). Held on a UTxO
// marked by the state-token NFT (policy 34293de1, asset name ""). Identical
// across all state UTxOs.
//   [0] epoch / batch counter      : Int   monotonically increasing per market
//                                           (0…150 observed) — the batch index the
//                                           action validator reads as state[0].
//   [1] actionQueues               : Map<Int, Map>  per-action-type queues keyed
//                                           by action id (0,1,…); values are inner
//                                           maps of pending queue entries.
//   [2] mode / quorum              : Int   small selector (1 or 3 observed); the
//                                           action validator reads state[2] and
//                                           branches on values 0/1/2.
//   [3] admins / batchers          : List<Constr0[Bytes(28)]>  authorized signer
//                                           PubKeyHashes (each wrapped Constr 0).
//   [4] interestRateModel          : List<Int>(5)  rate-curve params
//                                           (e.g. [18250000000, 30000000,
//                                           3650000000, 30000000, 30000000]).
//   [5] accumulators               : Map<Int, Int>  per-action accumulated amounts
//                                           keyed by action id (e.g. {0: supplyAcc,
//                                           1: demandAcc}).
//   [6] timingParams               : List<Int>(6)  durations in ms
//                                           (43200000=12h, 172800000=48h, …); the
//                                           action validator reads state[6][4].
//   [7] lastUpdate / deadline      : Int   POSIXTime in ms (~1.68e12–1.78e12).
export interface LiqwidMarketDatum {
  role: "market";
  epoch: bigint;
  /**
   * state[1] action queues: per-action-type id → number of pending queue
   * entries currently held in that queue's inner map. (Queues are filled and
   * drained within a single batch tx, so persisted datums normally show 0
   * entries per key; this preserves the size if a populated queue is ever
   * observed instead of collapsing the inner map to just its keys.)
   */
  actionQueues: { actionId: number; entryCount: number }[];
  mode: bigint;
  admins: string[];
  interestRateModel: bigint[];
  accumulators: { actionId: bigint; amount: bigint }[];
  timingParams: bigint[];
  lastUpdate: bigint;
}

function pdInt(d: PD): bigint {
  if (!isInt(d)) throw new Error("Liqwid: expected Int");
  return typeof d.int === "bigint" ? d.int : BigInt(d.int);
}
function pdBytes(d: PD): string {
  if (!isBytes(d)) throw new Error("Liqwid: expected Bytes");
  return d.bytes;
}

export function parseLiqwidPosition(data: PD): LiqwidPositionDatum {
  if (!isList(data)) throw new Error("Liqwid position: expected top-level List");
  const f = data.list;
  if (f.length !== 5) throw new Error(`Liqwid position: expected 5 fields, got ${f.length}`);
  return {
    role: "position",
    owner: pdBytes(f[0]),
    principal: pdInt(f[1]),
    interest: pdInt(f[2]),
    minInterest: pdInt(f[3]),
    interestIndex: pdInt(f[4]),
  };
}

// Each admin entry is Constr 0 [Bytes(28)] — unwrap to the raw hash.
function parseAdmin(d: PD): string {
  if (isConstr(d)) {
    const c = asConstr(d);
    if (c.fields.length === 1 && isBytes(c.fields[0])) return c.fields[0].bytes;
  }
  if (isBytes(d)) return d.bytes;
  throw new Error("Liqwid market: malformed admin entry");
}

export function parseLiqwidMarket(data: PD): LiqwidMarketDatum {
  if (!isList(data)) throw new Error("Liqwid market: expected top-level List");
  const f = data.list;
  if (f.length !== 8) throw new Error(`Liqwid market: expected 8 fields, got ${f.length}`);
  const queue = isMap(f[1]) ? f[1].map : [];
  const accMap = isMap(f[5]) ? f[5].map : [];
  return {
    role: "market",
    epoch: pdInt(f[0]),
    actionQueues: queue.map((e) => ({
      actionId: Number(pdInt(e.k)),
      entryCount: isMap(e.v) ? e.v.map.length : isList(e.v) ? e.v.list.length : 0,
    })),
    mode: pdInt(f[2]),
    admins: isList(f[3]) ? f[3].list.map(parseAdmin) : [],
    interestRateModel: isList(f[4]) ? f[4].list.map(pdInt) : [],
    accumulators: accMap.map((e) => ({ actionId: pdInt(e.k), amount: pdInt(e.v) })),
    timingParams: isList(f[6]) ? f[6].list.map(pdInt) : [],
    lastUpdate: pdInt(f[7]),
  };
}

// ---------------------------------------------------------------------------
// Batcher-action / LQ-escrow datum  (role: "action")
// ---------------------------------------------------------------------------
// On-chain shape: TOP-LEVEL LIST of 4 elements (NOT a Constr). Held on the
// action validator (fa3603d2) at addr1w8arvq7j9…, each UTxO marked by the V2
// state-token (policy 5785b71b, asset name = the action-validator hash).
//
//   [0] amount          : Int   — VALUE-CONFIRMED to equal the LQ governance
//                                  token quantity (policy da8c3085…, name "LQ")
//                                  held on the SAME UTxO, across every observed
//                                  UTxO. So this is the escrowed LQ amount. The
//                                  action validator reads exactly this LQ asset
//                                  value, matching it against datum[0].
//   [1] ownerPayment    : Constr0[Bytes(28)]  — a Credential (VerificationKey)
//                                  for the beneficiary's payment part.
//   [2] ownerStake      : Maybe Credential     — Some = Constr0[Constr0[Bytes28]]
//                                  (a VKey/Script stake credential), None =
//                                  Constr1[]. Together [1]+[2] reconstruct the
//                                  beneficiary's shelley address.
//   [3] references      : List< [ Int idx, Constr1[Int count, Int posixMs] ] >
//                                  — claim/snapshot references. `idx` is a market
//                                  batch index (matches MarketState[0] history);
//                                  the inner pair is (count, POSIXTime-ms). Often
//                                  empty. The POSIX ms (e.g. 1691686314000) and
//                                  the batch index are value-confirmed; `count`
//                                  is kept neutral.
//
// NOTE: field names beyond the address/amount/timestamp parts are NOT taken from
// any published Liqwid schema (the market/action validators are closed-source).
// Anything not defensibly named is surfaced with a neutral label + its raw value.
export interface LiqwidActionRef {
  /** Market batch index this reference points at (matches MarketState[0]). */
  index: bigint;
  /**
   * Inner Constr tag — a status/variant discriminator (always 1 across every
   * observed on-chain reference; kept neutral, surfaced only when != 1).
   */
  statusTag: number;
  /** Inner small int (claim count / snapshot counter — kept neutral). */
  count: bigint;
  /** POSIXTime in milliseconds of the referenced batch. */
  timeMs: bigint;
}
export interface LiqwidActionDatum {
  role: "action";
  /** Escrowed LQ amount (== on-chain LQ token quantity on this UTxO). */
  amount: bigint;
  ownerPaymentCredential: Credential;
  ownerStakeCredential: Credential | null;
  references: LiqwidActionRef[];
}

function parseActionRef(d: PD): LiqwidActionRef | null {
  if (!isList(d) || d.list.length !== 2) return null;
  const idx = d.list[0];
  const inner = d.list[1];
  if (!isInt(idx) || !isConstr(inner)) return null;
  const c = asConstr(inner);
  if (c.fields.length !== 2 || !isInt(c.fields[0]) || !isInt(c.fields[1])) return null;
  return { index: pdInt(idx), statusTag: c.tag, count: pdInt(c.fields[0]), timeMs: pdInt(c.fields[1]) };
}

export function parseLiqwidActionDatum(data: PD): LiqwidActionDatum {
  if (!isList(data)) throw new Error("Liqwid action datum: expected top-level List");
  const f = data.list;
  if (f.length !== 4) throw new Error(`Liqwid action datum: expected 4 fields, got ${f.length}`);
  // [1] = bare Credential; [2] = Maybe Credential.
  const ownerPaymentCredential = parseCredential(f[1]);
  const ownerStakeCredential = asOptional(f[2], parseCredential);
  const refList = isList(f[3]) ? f[3].list : [];
  const references: LiqwidActionRef[] = [];
  for (const r of refList) {
    const parsed = parseActionRef(r);
    if (!parsed) throw new Error("Liqwid action datum: malformed reference entry");
    references.push(parsed);
  }
  return {
    role: "action",
    amount: pdInt(f[0]),
    ownerPaymentCredential,
    ownerStakeCredential,
    references,
  };
}

// ---------------------------------------------------------------------------
// Action redeemer  (role: "action")
// ---------------------------------------------------------------------------
// The redeemer is a Constr; the constructor index selects the action:
//   0  Supply / Deposit       : fields[0] = Int amount delta. Validator computes
//                               `sum = state[0] + amount`, requires sum >= 0, and
//                               checks the updated state list equals [i_data(sum),
//                               …]. (Adds underlying to the market.)
//   1  Demand / Withdraw req.  : no fields. Enqueues / validates a demand action
//                               against the queue (no amount in the redeemer).
//   2  Process supply batch    : sub-entries each a Constr with tag 0 (apply, with
//                               an Int) or tag 1 (skip). Batch-applies queued
//                               supply actions.
//   3  Process demand/liq batch: reads state[0], state[2] (mode 0/1/2), and
//                               state[6][4] (a timing param) plus an interest-rate
//                               list[4]; filters queue entries by an amount bound.
//                               Batch settlement / liquidation step.
//   4  Owner-scoped action     : fields[0] = Constr with sub-tag 0 or 1, each
//                               carrying Bytes(28) (a PubKeyHash). Owner-keyed op
//                               (e.g. add/cancel a queued action for an owner).
//   5  Finalize / close        : no fields. Terminal/cleanup step.
export const LIQWID_ACTIONS: Record<number, string> = {
  0: "Supply/Deposit",
  1: "Demand/Withdraw (request)",
  2: "ProcessSupplyBatch",
  3: "ProcessDemandBatch/Liquidate",
  4: "OwnerAction",
  5: "Finalize",
};

export interface LiqwidActionView {
  tag: number;
  action: string;
  /** For tag 0: the supplied amount delta. */
  amount: bigint | null;
  /** For tag 4: the inner sub-tag (0|1) and 28-byte owner hash, if present. */
  ownerSubTag: number | null;
  owner: string | null;
}

export function classifyLiqwidRedeemer(data: PD, _role: LiqwidRole): string | null {
  void _role;
  const v = parseLiqwidAction(data);
  if (!v) {
    if (data && typeof data === "object" && isInt(data)) {
      const n = typeof data.int === "bigint" ? data.int : BigInt(data.int);
      return `Int ${n.toString()} (Liqwid action unmapped)`;
    }
    return null;
  }
  if (v.tag === 0 && v.amount !== null) return `${v.action} (amount ${v.amount.toString()})`;
  if (v.tag === 4 && v.owner) {
    return `${v.action} (sub ${v.ownerSubTag}, owner 0x${v.owner.slice(0, 8)}…)`;
  }
  return v.action;
}

export function parseLiqwidAction(data: PD): LiqwidActionView | null {
  if (data == null || typeof data !== "object" || !isConstr(data)) return null;
  const c = asConstr(data);
  const action = LIQWID_ACTIONS[c.tag] ?? `Action ${c.tag} (unmapped)`;
  let amount: bigint | null = null;
  let ownerSubTag: number | null = null;
  let owner: string | null = null;
  if (c.tag === 0 && c.fields.length >= 1 && isInt(c.fields[0])) {
    amount = typeof c.fields[0].int === "bigint" ? c.fields[0].int : BigInt(c.fields[0].int);
  }
  if (c.tag === 4 && c.fields.length >= 1 && isConstr(c.fields[0])) {
    const inner = asConstr(c.fields[0]);
    ownerSubTag = inner.tag;
    if (inner.fields.length >= 1 && isBytes(inner.fields[0])) owner = inner.fields[0].bytes;
  }
  return { tag: c.tag, action, amount, ownerSubTag, owner };
}

// ---------------------------------------------------------------------------
// Structural fallback (any role) — used when a datum does not match the known
// shape, so the panel still shows the raw PlutusData layout.
// ---------------------------------------------------------------------------
export interface LiqwidRawField {
  index: number;
  type: string;
  summary: string;
  /** For Bytes fields: the FULL hex (empty string for an empty byte string). */
  bytes?: string;
}
export interface LiqwidRawDatum {
  role: LiqwidRole;
  constructorTag: number | null;
  fieldCount: number;
  fields: LiqwidRawField[];
}

function pdType(d: PD): string {
  if (isInt(d)) return "Int";
  if (isBytes(d)) return "Bytes";
  if (isList(d)) return "List";
  if (isMap(d)) return "Map";
  if (isConstr(d)) return "Constr";
  return "Unknown";
}
function summarize(d: PD): string {
  if (isInt(d)) {
    const v = typeof d.int === "bigint" ? d.int : BigInt(d.int);
    return v.toLocaleString();
  }
  if (isBytes(d)) {
    const len = d.bytes.length / 2;
    // Bytes values are surfaced FULL + hash-flagged by the view; the summary is
    // only a fallback descriptor (e.g. empty byte string).
    return d.bytes === "" ? "(empty)" : `${len}B`;
  }
  if (isList(d)) return `${d.list.length} item(s)`;
  if (isMap(d)) return `${d.map.length} entry(ies)`;
  if (isConstr(d)) return `Constr ${d.constructor} [${d.fields.length} field(s)]`;
  return "(unknown)";
}

export function parseLiqwidRaw(data: PD, role: LiqwidRole): LiqwidRawDatum {
  if (data == null || typeof data !== "object") {
    throw new Error("Liqwid: empty or non-object datum");
  }
  let constructorTag: number | null = null;
  let topFields: PD[];
  if (isConstr(data)) {
    const c = asConstr(data);
    constructorTag = c.tag;
    topFields = c.fields;
  } else if (isList(data)) {
    topFields = data.list;
  } else {
    topFields = [data];
  }
  return {
    role,
    constructorTag,
    fieldCount: topFields.length,
    fields: topFields.map((f, index) => ({
      index,
      type: pdType(f),
      summary: summarize(f),
      ...(isBytes(f) ? { bytes: f.bytes } : {}),
    })),
  };
}
