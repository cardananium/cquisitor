// Djed (COTI/IOG) reserve datum + redeemer parsers.
//
// The reserve datum/redeemer layout below targets the PlutusV2 reserve
// validator. Constr tags decode to a 0-based `constructor` index via
// cquisitor-lib's DetailedSchema.
//
// Field names + semantics follow the open-source Open DJED reverse-engineering
// of the protocol (artifi-labs/open-djed, packages/data/src/pool-datum.ts —
// the validated `PoolDatumSchema` + its committed CBOR test vector). The reserve
// (a.k.a. "pool"/bank) datum is a Constr 0 with 10 positional fields:
//
// === DATUM: ReserveState / PoolDatum (Constr 0, 10 positional fields) ===
//   [0] Int  adaInReserve     — ADA collateral in LOVELACE held in the reserve.
//   [1] Int  djedInCirculation— circulating DJED (DjedMicroUSD), micro-units.
//   [2] Int  shenInCirculation— circulating SHEN (ShenMicroUSD), micro-units.
//   [3] lastOrder: Constr0[ Constr0[ { order: TxOutRef, time: Int(posixMillis) } ] ]
//        — the LAST order processed by the bank: its consumed OutputReference and
//          the timestamp recorded in that order's output datum.
//   [4] Int  minADA           — minimum ADA that must remain in the reserve UTxO.
//   [5] Int  _1               — unknown protocol constant (1530050 on mainnet);
//                               unnamed in the Open DJED schema, surfaced raw.
//   [6] Nullable<Any>         — an Option: Constr0[x]=Some / Constr1[]=Nothing.
//                               Always Nothing on observed mainnet datums; unnamed
//                               in the Open DJED schema, surfaced raw (NOT a Bool).
//   [7] ByteArray mintingPolicyId — the DJED/SHEN/DjedStableCoinNFT minting policy.
//   [8] TxOutRef mintingPolicyUniqRef — the one-shot OutputReference that seeds
//                               the DJED/SHEN/NFT minting policy (constant).
//   [9] TxOutRef _3           — an OutputReference, unnamed in the Open DJED
//                               schema, surfaced raw.
// TxOutRef canonical encoding = Constr0[ Constr0[ ByteArray hash(32) ], Int idx ].

import {
  asBytes,
  asConstr,
  asInt,
  isConstr,
  type PD,
} from "@/utils/protocols/dex/plutusData";

export interface DjedTxOutRef {
  txHash: string;
  index: bigint;
}

export interface DjedLastOrder {
  /** OutputReference of the last order the bank processed (datum field [3]). */
  order: DjedTxOutRef;
  /** POSIX-millisecond timestamp recorded in that order's output datum. */
  timestamp: bigint;
}

export interface DjedReserveState {
  /** ADA collateral in lovelace held in the reserve UTxO (field [0]). */
  adaInReserve: bigint;
  /** Circulating DJED (DjedMicroUSD) minted so far, micro-units (field [1]). */
  djedInCirculation: bigint;
  /** Circulating SHEN (ShenMicroUSD) minted so far, micro-units (field [2]). */
  shenInCirculation: bigint;
  /** Last order processed by the bank: its OutputReference + time (field [3]). */
  lastOrder: DjedLastOrder;
  /** Minimum ADA that must remain in the reserve UTxO (field [4]). */
  minADA: bigint;
  /** Unknown protocol constant; unnamed (`_1`) in the Open DJED schema (field [5]). */
  field1: bigint;
  /**
   * Option (Nullable) at field [6]: Constr0[x]=Some, Constr1[]=Nothing.
   * Unnamed (`_2`) in the Open DJED schema; always Nothing on observed mainnet
   * datums. `true` here means Some is present, `false` means Nothing — this is
   * NOT a paused/locked boolean flag.
   */
  optionPresent: boolean;
  /** DJED/SHEN/NFT minting policy id (field [7], = DJED.mintingPolicyId). */
  mintingPolicyId: string;
  /** One-shot OutputReference seeding the minting policy (field [8]). */
  mintingPolicyUniqRef: DjedTxOutRef;
  /** Unknown OutputReference; unnamed (`_3`) in the Open DJED schema (field [9]). */
  field3: DjedTxOutRef;
}

// TxOutRef = Constr0[ Constr0[ ByteArray hash(32) ], Int index ].
function parseTxOutRef(d: PD): DjedTxOutRef {
  const outer = asConstr(d);
  if (outer.fields.length !== 2) {
    throw new Error(`Djed TxOutRef: expected 2 fields, got ${outer.fields.length}`);
  }
  const idWrap = asConstr(outer.fields[0]);
  if (idWrap.fields.length !== 1) {
    throw new Error(`Djed TxOutRef id: expected 1 field, got ${idWrap.fields.length}`);
  }
  return {
    txHash: asBytes(idWrap.fields[0]),
    index: asInt(outer.fields[1]),
  };
}

// lastOrder = Constr0[ Constr0[ { order: TxOutRef, time: Int(posixMillis) } ] ].
// Leading single-field Constr0 wrappers around the innermost (TxOutRef, timestamp).
function parseLastOrder(d: PD): DjedLastOrder {
  let cur = asConstr(d);
  // Peel off the leading single-field wrappers until we reach the 2-field
  // innermost record (TxOutRef, posix-ms).
  let guard = 0;
  while (cur.fields.length === 1 && guard < 4) {
    cur = asConstr(cur.fields[0]);
    guard += 1;
  }
  if (cur.fields.length !== 2) {
    throw new Error(`Djed lastOrder: expected innermost 2-field record, got ${cur.fields.length}`);
  }
  return {
    order: parseTxOutRef(cur.fields[0]),
    timestamp: asInt(cur.fields[1]),
  };
}

// Nullable<Any> encoded as Constr0[x] (Some) / Constr1[] (Nothing). We only need
// to know whether a value is present, so we return a plain boolean.
function isSome(d: PD): boolean {
  return isConstr(d) && d.constructor === 0;
}

export function parseDjedReserveState(data: PD): DjedReserveState {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Djed ReserveState: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 10) {
    throw new Error(`Djed ReserveState: expected 10 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    adaInReserve: asInt(f[0]),
    djedInCirculation: asInt(f[1]),
    shenInCirculation: asInt(f[2]),
    lastOrder: parseLastOrder(f[3]),
    minADA: asInt(f[4]),
    field1: asInt(f[5]),
    optionPresent: isSome(f[6]),
    mintingPolicyId: asBytes(f[7]),
    mintingPolicyUniqRef: parseTxOutRef(f[8]),
    field3: parseTxOutRef(f[9]),
  };
}

// === REDEEMER: ReserveAction (top-level enum, Constr tag 0..4) ===
//   tag 0 — no-field action.
//   tag 1 — no-field action.
//   tag 2 — Constr2[ Constr0[ ByteArray ownerOrKey, TxOutRef ] ] : the MAIN
//           mint/burn/order-settlement action (the only fields-bearing ctor).
//   tag 3 — no-field action.
//   tag 4 — no-field action.
//
// Only tag 2 is definitively the fields-bearing main action; the exact labels
// for 0/1/3/4 (settle batch vs admin/upgrade) are not proven line-by-line, so
// we surface their ctor index rather than inventing names.

export type DjedReserveAction =
  | { kind: "Action"; tag: number }
  | {
      kind: "MainAction";
      tag: 2;
      /** Owner / authorising key bytes (head of the tag-2 payload). */
      ownerOrKey: string;
      /** TxOutRef the main action references (the consumed reserve/order ref). */
      ref: DjedTxOutRef | null;
    };

export function parseDjedReserveAction(data: PD): DjedReserveAction {
  const c = asConstr(data);
  if (c.tag === 2) {
    // Constr2[ Constr0[ ByteArray, TxOutRef ] ].
    let ownerOrKey = "";
    let ref: DjedTxOutRef | null = null;
    try {
      const inner = asConstr(c.fields[0]);
      ownerOrKey = asBytes(inner.fields[0]);
      ref = parseTxOutRef(inner.fields[1]);
    } catch {
      // Leave defaults if the nested payload doesn't match the expected shape.
    }
    return { kind: "MainAction", tag: 2, ownerOrKey, ref };
  }
  return { kind: "Action", tag: c.tag };
}

// Human label for a top-level reserve redeemer ctor. Only tag 2 has a proven
// meaning (the main mint/burn/settlement action); the rest are passed through by
// their ctor index.
export function classifyDjedReserveRedeemer(data: PD): string | null {
  const c = asConstr(data);
  if (c.tag === 2) return "Mint/Burn/Settle (main)";
  if (c.tag >= 0 && c.tag <= 4) return `Reserve action #${c.tag}`;
  return null;
}
