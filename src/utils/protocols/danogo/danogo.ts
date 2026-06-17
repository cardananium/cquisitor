// Danogo — bond order-book DEX datum/redeemer parsers.
//
// Danogo is a bond order-book (smart-UTxO shuffling, NOT an AMM — no pools).
// Two on-chain systems:
//  - bond-dex: the 4 tradable order datums + their spend redeemers.
//    Role = "order".
//  - bond-issue: bond/loan position state. Role = "position".
//
// Single-constructor records => Constr ctor 0 with fields in type-declaration
// order. Enums => Constr tag = variant index (0-based). Option<a>: Some =
// Constr0[x], None = Constr1[] (handled by asOptional). Hashes/policies are
// 28-byte ByteArrays. Mainnet script-hash/NFT matching lives in constants.ts.

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  isList,
  isMap,
  type PD,
} from "@/utils/protocols/dex/plutusData";

// --- DEX order datums (role: order) ----------------------------------------

// 1. AskLimit — sell order.
//    Constr 0 [ owner_vk, owner_sk, requested_yield ]
export interface DanogoAskLimit {
  kind: "AskLimit";
  ownerVk: string; // PublicKeyHash, ByteArray(28)
  ownerSk: string | null; // Option<ByteArray(28)>
  requestedYield: bigint;
}

// 2. BidLimitMulti — buy order.
//    Constr 0 [ owner_vk, owner_sk, from_epoch, to_epoch, quantity,
//               requested_yield, bond_types ]
export interface DanogoBidLimitMulti {
  kind: "BidLimitMulti";
  ownerVk: string;
  ownerSk: string | null;
  fromEpoch: bigint;
  toEpoch: bigint;
  quantity: bigint;
  requestedYield: bigint;
  bondTypes: BondType[];
}

// 3. AskMaking — market-maker sell.
//    Constr 0 [ owner_vk, owner_sk, requested_yield, bid_sc, margin ]
export interface DanogoAskMaking {
  kind: "AskMaking";
  ownerVk: string;
  ownerSk: string | null;
  requestedYield: bigint;
  bidSc: string; // ScriptKeyHash, ByteArray(28)
  margin: bigint;
}

// 4. BidMaking — market-maker buy.
//    Constr 0 [ owner_vk, owner_sk, from_epoch, to_epoch, quantity,
//               requested_yield, ask_sc, margin ]
export interface DanogoBidMaking {
  kind: "BidMaking";
  ownerVk: string;
  ownerSk: string | null;
  fromEpoch: bigint;
  toEpoch: bigint;
  quantity: bigint;
  requestedYield: bigint;
  askSc: string; // ScriptKeyHash, ByteArray(28)
  margin: bigint;
}

export type DanogoOrder =
  | DanogoAskLimit
  | DanogoBidLimitMulti
  | DanogoAskMaking
  | DanogoBidMaking;

// BondType enum.
//   Constr 0 [] = DanogoBond, Constr 1 [] = OptimBond
export type BondType = "DanogoBond" | "OptimBond";

function parseBondType(d: PD): BondType {
  const c = asConstr(d);
  if (c.tag === 0) return "DanogoBond";
  if (c.tag === 1) return "OptimBond";
  throw new Error(`BondType: unexpected ctor ${c.tag}`);
}

function parseAskLimit(fields: PD[]): DanogoAskLimit {
  return {
    kind: "AskLimit",
    ownerVk: asBytes(fields[0]),
    ownerSk: asOptional(fields[1], asBytes),
    requestedYield: asInt(fields[2]),
  };
}

function parseAskMaking(fields: PD[]): DanogoAskMaking {
  return {
    kind: "AskMaking",
    ownerVk: asBytes(fields[0]),
    ownerSk: asOptional(fields[1], asBytes),
    requestedYield: asInt(fields[2]),
    bidSc: asBytes(fields[3]),
    margin: asInt(fields[4]),
  };
}

function parseBidLimitMulti(fields: PD[]): DanogoBidLimitMulti {
  return {
    kind: "BidLimitMulti",
    ownerVk: asBytes(fields[0]),
    ownerSk: asOptional(fields[1], asBytes),
    fromEpoch: asInt(fields[2]),
    toEpoch: asInt(fields[3]),
    quantity: asInt(fields[4]),
    requestedYield: asInt(fields[5]),
    bondTypes: asList(fields[6]).map(parseBondType),
  };
}

function parseBidMaking(fields: PD[]): DanogoBidMaking {
  return {
    kind: "BidMaking",
    ownerVk: asBytes(fields[0]),
    ownerSk: asOptional(fields[1], asBytes),
    fromEpoch: asInt(fields[2]),
    toEpoch: asInt(fields[3]),
    quantity: asInt(fields[4]),
    requestedYield: asInt(fields[5]),
    askSc: asBytes(fields[6]),
    margin: asInt(fields[7]),
  };
}

// Disambiguate the four order datums by arity. All four are Constr 0; their
// field counts are AskLimit=3, AskMaking=5, BidLimitMulti=7, BidMaking=8 — all
// distinct, so arity is sufficient here. (The spec notes that once per-validator
// mainnet hashes are known, matching by the spent scriptHash is preferred over
// arity; until then this is the safe path.)
export function parseDanogoOrder(data: PD): DanogoOrder {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Danogo order: unexpected ctor ${c.tag}`);
  switch (c.fields.length) {
    case 3:
      return parseAskLimit(c.fields);
    case 5:
      return parseAskMaking(c.fields);
    case 7:
      return parseBidLimitMulti(c.fields);
    case 8:
      return parseBidMaking(c.fields);
    default:
      throw new Error(
        `Danogo order: unexpected field count ${c.fields.length} (expected 3/5/7/8)`,
      );
  }
}

// --- DEX spend redeemers ---------------------------------------------------

// TradeAction (bare) — used by limit_ask, making_ask, making_bid. All nullary.
const BARE_TRADE_ACTIONS = [
  "Update",
  "Buy",
  "Sell",
  "Upgrade",
  "GarbageCollector",
] as const;
export type BareTradeAction = (typeof BARE_TRADE_ACTIONS)[number];

export function classifyBareTradeAction(data: PD): BareTradeAction | null {
  const c = asConstr(data);
  if (c.fields.length !== 0) return null;
  return BARE_TRADE_ACTIONS[c.tag] ?? null;
}

// TradeAction (field-carrying) — used by limit_bid `bid_multi`.
export interface BidOffer {
  policyId: string;
  assetName: string;
  quantity: bigint;
}

export type MultiTradeAction =
  | { kind: "Update" }
  | { kind: "Buy" }
  | {
      kind: "Sell";
      exchangeFee: bigint; // Lovelace
      sellerReceive: bigint; // Lovelace
      offers: BidOffer[];
      contIdx: bigint | null; // Option<Int>
    }
  | { kind: "Upgrade" }
  | { kind: "GarbageCollector" };

// each offer tuple = List[ByteArray(policy), ByteArray(name), Int(qty)]
function parseBidOffer(d: PD): BidOffer {
  const list = asList(d);
  if (list.length !== 3) throw new Error("Danogo offer: expected (policy, name, qty)");
  return {
    policyId: asBytes(list[0]),
    assetName: asBytes(list[1]),
    quantity: asInt(list[2]),
  };
}

export function parseMultiTradeAction(data: PD): MultiTradeAction {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      return { kind: "Update" };
    case 1:
      return { kind: "Buy" };
    case 2:
      return {
        kind: "Sell",
        exchangeFee: asInt(c.fields[0]),
        sellerReceive: asInt(c.fields[1]),
        offers: asList(c.fields[2]).map(parseBidOffer),
        contIdx: asOptional(c.fields[3], asInt),
      };
    case 3:
      return { kind: "Upgrade" };
    case 4:
      return { kind: "GarbageCollector" };
    default:
      throw new Error(`Danogo MultiTradeAction: unexpected ctor ${c.tag}`);
  }
}

// WithdrawAction — used by limit_bid `withdraw` (reward/withdraw purpose).
// Single ctor:
//   SellMulti = Constr 0 [ bid_skh:ByteArray(28) ]
export interface DanogoWithdrawAction {
  kind: "SellMulti";
  bidSkh: string;
}

export function parseWithdrawAction(data: PD): DanogoWithdrawAction {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Danogo WithdrawAction: unexpected ctor ${c.tag}`);
  return { kind: "SellMulti", bidSkh: asBytes(c.fields[0]) };
}

// --- bond-issue position datums (role: position) ---------------------------

// RequestDatum — borrow request UTxO.
//   Constr 0 [ apr, duration, symbol, borrower, requested, issued,
//              epo_rewards, prepaid, buffer, fee ]
export interface DanogoRequestDatum {
  kind: "RequestDatum";
  apr: bigint;
  duration: bigint;
  symbol: string; // PolicyId, ByteArray(28)
  borrower: string; // AssetName
  requested: bigint;
  issued: bigint;
  epoRewards: bigint;
  prepaid: bigint;
  buffer: bigint;
  fee: bigint;
}

// BondDatum — active bond UTxO.
//   Constr 0 [ epo_rewards(PValue=Map), duration, bond_symbol, token_name,
//              bond_amount, buffer, fee, borrower, start ]
// epo_rewards serialized as a PlutusData Map, e.g.
//   { map: [{ k: <policy>, v: { map: [{ k: <name>, v: <int> }] } }] }.
export interface DanogoBondDatum {
  kind: "BondDatum";
  epoRewards: PValueEntry[];
  duration: bigint;
  bondSymbol: string; // PolicyId
  tokenName: string; // AssetName
  bondAmount: bigint;
  buffer: bigint;
  fee: bigint;
  borrower: string; // AssetName
  start: bigint;
}

export type DanogoPosition = DanogoRequestDatum | DanogoBondDatum;

// PValue = Dict<PolicyId, Dict<AssetName, Int>>. The outer and inner Dicts
// serialize as PlutusData **Maps** — e.g. { map: [{ k: <policy>, v: { map: [{ k:
// <name>, v: <int> }] } }] } — NOT List-of-tuples. We accept the Map encoding
// (canonical) and keep the List-of-(k,v)-tuples form as a defensive fallback.
export interface PValueEntry {
  policyId: string;
  assets: { assetName: string; quantity: bigint }[];
}

// Read a `Dict<k, v>` that may be encoded either as a PlutusData Map (canonical,
// what real datums use) or as a List of 2-element (k, v) tuples (some encoders).
function asDictEntries(d: PD): { k: PD; v: PD }[] {
  if (isMap(d)) return d.map;
  if (isList(d)) {
    return d.list.map((entry) => {
      const pair = asList(entry);
      if (pair.length !== 2) throw new Error("PValue: expected (key, value) pair");
      return { k: pair[0], v: pair[1] };
    });
  }
  throw new Error("PValue: expected Map or List");
}

function parsePValue(d: PD): PValueEntry[] {
  return asDictEntries(d).map(({ k, v }) => ({
    policyId: asBytes(k),
    assets: asDictEntries(v).map((inner) => ({
      assetName: asBytes(inner.k),
      quantity: asInt(inner.v),
    })),
  }));
}

function parseRequestDatum(fields: PD[]): DanogoRequestDatum {
  return {
    kind: "RequestDatum",
    apr: asInt(fields[0]),
    duration: asInt(fields[1]),
    symbol: asBytes(fields[2]),
    borrower: asBytes(fields[3]),
    requested: asInt(fields[4]),
    issued: asInt(fields[5]),
    epoRewards: asInt(fields[6]),
    prepaid: asInt(fields[7]),
    buffer: asInt(fields[8]),
    fee: asInt(fields[9]),
  };
}

function parseBondDatum(fields: PD[]): DanogoBondDatum {
  return {
    kind: "BondDatum",
    epoRewards: parsePValue(fields[0]),
    duration: asInt(fields[1]),
    bondSymbol: asBytes(fields[2]),
    tokenName: asBytes(fields[3]),
    bondAmount: asInt(fields[4]),
    buffer: asInt(fields[5]),
    fee: asInt(fields[6]),
    borrower: asBytes(fields[7]),
    start: asInt(fields[8]),
  };
}

// Disambiguate position datums by arity: RequestDatum=10, BondDatum=9. Both are
// Constr 0. The leading field also differs (RequestDatum[0]=apr is an Int;
// BondDatum[0]=epo_rewards is a PValue List), which we use as a tie-breaker.
export function parseDanogoPosition(data: PD): DanogoPosition {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Danogo position: unexpected ctor ${c.tag}`);
  if (c.fields.length === 10) return parseRequestDatum(c.fields);
  if (c.fields.length === 9) return parseBondDatum(c.fields);
  throw new Error(
    `Danogo position: unexpected field count ${c.fields.length} (expected 9/10)`,
  );
}

// --- bond-issue redeemers --------------------------------------------------

// BondIssueAction — shared mint+spend redeemer (bond.ak, request.ak).
// All nullary.
const BOND_ISSUE_ACTIONS = [
  "RequestCreate",
  "RequestUpdate",
  "BondCreate",
  "BondRedeem",
  "BondPayInterest",
  "BondChangeStakeKey",
  "RedeemFee",
  "RedeemForce",
] as const;
export type BondIssueAction = (typeof BOND_ISSUE_ACTIONS)[number];

export function classifyBondIssueAction(data: PD): BondIssueAction | null {
  const c = asConstr(data);
  if (c.fields.length !== 0) return null;
  return BOND_ISSUE_ACTIONS[c.tag] ?? null;
}

// ProtocolParamsAction — protocol NFT mint (protocol.ak mint_protocol).
//   MintProtocol = Constr 0 [], BurnProtocol = Constr 1 []
const PROTOCOL_PARAMS_ACTIONS = ["MintProtocol", "BurnProtocol"] as const;
export type ProtocolParamsAction = (typeof PROTOCOL_PARAMS_ACTIONS)[number];

export function classifyProtocolParamsAction(data: PD): ProtocolParamsAction | null {
  const c = asConstr(data);
  if (c.fields.length !== 0) return null;
  return PROTOCOL_PARAMS_ACTIONS[c.tag] ?? null;
}

// --- light validation ------------------------------------------------------

import type { DexIssue } from "@/utils/protocols/dex/registry";

const HASH28 = /^[0-9a-f]{56}$/;

export function validateDanogoOrder(order: DanogoOrder): DexIssue[] {
  const issues: DexIssue[] = [];
  if (!HASH28.test(order.ownerVk.toLowerCase())) {
    issues.push({ severity: "warning", message: "owner_vk is not a 28-byte hash" });
  }
  if ("requestedYield" in order && order.requestedYield < BigInt(0)) {
    issues.push({ severity: "warning", message: "requested_yield is negative" });
  }
  if ("quantity" in order && order.quantity <= BigInt(0)) {
    issues.push({ severity: "warning", message: "quantity is not positive" });
  }
  if (
    (order.kind === "BidLimitMulti" || order.kind === "BidMaking") &&
    order.fromEpoch > order.toEpoch
  ) {
    issues.push({ severity: "warning", message: "from_epoch is after to_epoch" });
  }
  return issues;
}

export function validateDanogoPosition(pos: DanogoPosition): DexIssue[] {
  const issues: DexIssue[] = [];
  const policy = pos.kind === "RequestDatum" ? pos.symbol : pos.bondSymbol;
  if (!HASH28.test(policy.toLowerCase())) {
    issues.push({ severity: "warning", message: "policy id is not a 28-byte hash" });
  }
  if (pos.duration < BigInt(0)) {
    issues.push({ severity: "warning", message: "duration is negative" });
  }
  return issues;
}
