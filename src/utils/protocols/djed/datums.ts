// Djed (COTI/IOG) reserve datum + redeemer parsers.
//
// The reserve datum/redeemer layout below targets the PlutusV2 reserve
// validator. Constr tags decode to a 0-based `constructor` index via
// cquisitor-lib's DetailedSchema.
//
// === DATUM: ReserveState (Constr 0, 10 positional fields) ===
//   [0] Int  reserveAmount  — ADA collateral in LOVELACE held in the reserve.
//   [1] Int  djedAmount      — circulating DJED (DjedMicroUSD), micro-units.
//   [2] Int  shenAmount      — circulating SHEN (ShenMicroUSD), micro-units.
//   [3] lastOracle: Constr0[ Constr0[ Constr0[ TxOutRef, Int(posixMillis) ] ] ]
//   [4] Int  paramA          — protocol parameter preserved across transitions.
//   [5] Int  paramB          — protocol parameter preserved across transitions.
//   [6] Bool                 — paused/locked flag (spend path requires FALSE).
//   [7] ByteArray policyId   — the DJED/SHEN minting policy id.
//   [8] TxOutRef oracleRef   — reference to the oracle NFT UTxO consumed.
//   [9] TxOutRef priorRef    — reference to the prior reserve/state UTxO consumed.
// TxOutRef canonical encoding = Constr0[ Constr0[ ByteArray hash(32) ], Int idx ].

import {
  asBool,
  asBytes,
  asConstr,
  asInt,
  type PD,
} from "@/utils/protocols/dex/plutusData";

export interface DjedTxOutRef {
  txHash: string;
  index: bigint;
}

export interface DjedLastOracle {
  oracleInput: DjedTxOutRef;
  /** POSIX-millisecond timestamp of the last oracle/processing time. */
  timestamp: bigint;
}

export interface DjedReserveState {
  /** ADA collateral in lovelace held in the reserve UTxO. */
  reserveAmount: bigint;
  /** Circulating DJED (DjedMicroUSD) minted so far, micro-units. */
  djedAmount: bigint;
  /** Circulating SHEN (ShenMicroUSD) minted so far, micro-units. */
  shenAmount: bigint;
  lastOracle: DjedLastOracle;
  /** Protocol parameter preserved across the transition (datum field [4]). */
  paramA: bigint;
  /** Protocol parameter preserved across the transition (datum field [5]). */
  paramB: bigint;
  /** Paused/locked flag; the spend path requires this to be false. */
  paused: boolean;
  /** DJED/SHEN minting policy id (= DJED.mintingPolicyId). */
  policyId: string;
  /** Reference to the oracle NFT UTxO consumed (datum field [8]). */
  oracleRef: DjedTxOutRef;
  /** Reference to the prior reserve/state UTxO consumed (datum field [9]). */
  priorRef: DjedTxOutRef;
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

// lastOracle = Constr0[ Constr0[ Constr0[ TxOutRef, Int(posixMillis) ] ] ].
// Three single-field Constr0 wrappers around the innermost (TxOutRef, timestamp).
function parseLastOracle(d: PD): DjedLastOracle {
  let cur = asConstr(d);
  // Peel off the leading single-field wrappers until we reach the 2-field
  // innermost record (TxOutRef, posix-ms).
  let guard = 0;
  while (cur.fields.length === 1 && guard < 4) {
    cur = asConstr(cur.fields[0]);
    guard += 1;
  }
  if (cur.fields.length !== 2) {
    throw new Error(`Djed lastOracle: expected innermost 2-field record, got ${cur.fields.length}`);
  }
  return {
    oracleInput: parseTxOutRef(cur.fields[0]),
    timestamp: asInt(cur.fields[1]),
  };
}

export function parseDjedReserveState(data: PD): DjedReserveState {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Djed ReserveState: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 10) {
    throw new Error(`Djed ReserveState: expected 10 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    reserveAmount: asInt(f[0]),
    djedAmount: asInt(f[1]),
    shenAmount: asInt(f[2]),
    lastOracle: parseLastOracle(f[3]),
    paramA: asInt(f[4]),
    paramB: asInt(f[5]),
    paused: asBool(f[6]),
    policyId: asBytes(f[7]),
    oracleRef: parseTxOutRef(f[8]),
    priorRef: parseTxOutRef(f[9]),
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
