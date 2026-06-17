// Midnight Glacier Drop config/governance datum parser.
//
// The config UTxO at the config contract (5c7bcedf…) carries a Constr0 record
// with 7 fields:
//   [0] Credential        — authority (Script credential on chain)
//   [1] ByteArray(28)     — authority / policy hash
//   [2] Address           — treasury / destination address #1
//   [3] Address           — treasury / destination address #2
//   [4] List<(Address,Int)> — allocation entries: a destination address and its
//                            NIGHT amount (raw, 6 decimals)
//   [5] List<ByteArray>   — series / batch identifiers (8 observed)
//   [6] Int               — count (8 observed; size of [5])
//
// Field semantics for [0]/[1] are inferred from structure; the allocation list
// ([4]) and series/count are unambiguous.

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  parseCredential,
  parsePlutusAddress,
  type Credential,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";

export interface GlacierAllocation {
  address: PlutusAddress;
  /** Raw NIGHT amount (6 decimals). */
  amount: bigint;
}

export interface GlacierConfig {
  role: "config";
  authority: Credential;
  authorityHash: string;
  treasuryA: PlutusAddress;
  treasuryB: PlutusAddress;
  allocations: GlacierAllocation[];
  series: string[];
  count: bigint;
}

function parseAllocation(d: PD): GlacierAllocation {
  const c = asConstr(d);
  if (c.fields.length !== 2) {
    throw new Error(`Glacier allocation: expected (address, amount), got ${c.fields.length} fields`);
  }
  return { address: parsePlutusAddress(c.fields[0]), amount: asInt(c.fields[1]) };
}

// --- Thaw / redemption datums ----------------------------------------------
//
// Two thaw contracts share the redemption flow (per the 4-installment / 90-day
// schedule, Dec 2025 – Dec 2026):
//
// POOL (merkle batch pool) — Constr0 with 4 fields:
//   [0] ByteArray(32) — per-batch merkle root (recipient/allocation commitment)
//   [1] Int           — thaw start (POSIX ms); 1765324800000 = 2025-12-10 UTC
//   [2] Int           — thaw interval (ms); 7776000000 = 90 days
//   [3] State enum    — Constr0[Int] (a count) OR Constr1[ByteArray] (a bitmap
//                       of already-redeemed tranches/recipients)
//
// POSITION (per-user thaw position; the pool validator is parameterized by this
// contract) — Constr0 with 5 fields:
//   [0] Address — the recipient who owns the position
//   [1] Int     — NIGHT amount (raw, 6 decimals)
//   [2] Int     — next thaw / unlock time (POSIX ms)
//   [3] Int     — tranche index
//   [4] Int     — thaw interval (ms); 7776000000 = 90 days

export type GlacierThawState =
  | { kind: "count"; value: bigint }
  | { kind: "bitmap"; hex: string; setBits: number };

export interface GlacierThawPool {
  role: "thaw";
  variant: "pool";
  merkleRoot: string;
  /** Thaw start, POSIX milliseconds. */
  thawStart: bigint;
  /** Interval between thaws, milliseconds. */
  thawInterval: bigint;
  state: GlacierThawState;
}

export interface GlacierThawPosition {
  role: "thaw";
  variant: "position";
  owner: PlutusAddress;
  /** Raw NIGHT amount for this position (6 decimals). */
  amount: bigint;
  /** Next thaw / unlock time, POSIX milliseconds. */
  nextThaw: bigint;
  /** Tranche index. */
  tranche: bigint;
  /** Interval between thaws, milliseconds. */
  interval: bigint;
}

export type GlacierThaw = GlacierThawPool | GlacierThawPosition;

function popcountHex(hex: string): number {
  let bits = 0;
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (!Number.isNaN(nibble)) bits += (nibble.toString(2).match(/1/g) || []).length;
  }
  return bits;
}

export function parseGlacierThaw(d: PD): GlacierThaw {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`Glacier thaw: expected Constr0, got ctor ${c.tag}`);
  if (c.fields.length === 4) {
    const stateC = asConstr(c.fields[3]);
    const state: GlacierThawState =
      stateC.tag === 0
        ? { kind: "count", value: asInt(stateC.fields[0]) }
        : { kind: "bitmap", hex: asBytes(stateC.fields[0]), setBits: popcountHex(asBytes(stateC.fields[0])) };
    return {
      role: "thaw",
      variant: "pool",
      merkleRoot: asBytes(c.fields[0]),
      thawStart: asInt(c.fields[1]),
      thawInterval: asInt(c.fields[2]),
      state,
    };
  }
  if (c.fields.length === 5) {
    return {
      role: "thaw",
      variant: "position",
      owner: parsePlutusAddress(c.fields[0]),
      amount: asInt(c.fields[1]),
      nextThaw: asInt(c.fields[2]),
      tranche: asInt(c.fields[3]),
      interval: asInt(c.fields[4]),
    };
  }
  throw new Error(`Glacier thaw: expected Constr0 with 4 or 5 fields, got ${c.fields.length}`);
}

export function parseGlacierConfig(d: PD): GlacierConfig {
  const c = asConstr(d);
  if (c.tag !== 0 || c.fields.length !== 7) {
    throw new Error(`Glacier config: expected Constr0 with 7 fields, got ctor ${c.tag}/${c.fields.length}`);
  }
  const f = c.fields;
  return {
    role: "config",
    authority: parseCredential(f[0]),
    authorityHash: asBytes(f[1]),
    treasuryA: parsePlutusAddress(f[2]),
    treasuryB: parsePlutusAddress(f[3]),
    allocations: asList(f[4]).map(parseAllocation),
    series: asList(f[5]).map(asBytes),
    count: asInt(f[6]),
  };
}
