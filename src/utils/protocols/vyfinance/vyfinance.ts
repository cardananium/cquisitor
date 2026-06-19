// VyFinance (VyFi) v2 datum + redeemer parsers.
//
// Constr tags decode to a 0-based `constructor` index via
// cquisitor-lib's DetailedSchema.
//
// ORDER / SWAP DATUM (UTxO at the addr1w… order address):
//   Constr 0 [
//     ByteArray senderKeyHashes,   -- paymentPkh(28) || stakeKh(28) concatenated
//                                     (56 bytes), or just paymentPkh(28) for
//                                     enterprise senders.
//     Constr <ACTION> [ Int minReceive ]
//   ]
//   ACTION ctor tag (swap actions):
//     3 -> "expect token out" (swap A→B, receive non-ADA bAsset); Int = min tokens.
//     4 -> "expect ADA out"   (swap B→A, receive ADA/lovelace);  Int = min lovelace.
//   Tags 0/1/2 exist in the VyFi action enum (presumed deposit/withdraw/zap
//   liquidity orders); their layouts beyond a single Int are unknown — we pass
//   the tag + raw single Int through.
//
// POOL DATUM (UTxO at the addr1z… pool address, attached BY DATUM HASH):
//   Constr 0 [ Int poolAssetABarFee, Int poolAssetBBarFee, Int totalLpTokens ]
//   Field names per the IndigoProtocol/dexter SDK
//   (src/dex/definitions/vyfinance/pool.ts): PoolAssetABarFee, PoolAssetBBarFee,
//   TotalLpTokens. Pool reserves and the pair's asset identities are NOT in the
//   datum — reserves are the UTxO value and pool identity is the mainNFT.

import {
  asBytes,
  asConstr,
  asInt,
  type PD,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

// --- Order / swap datum ----------------------------------------------------

export type VyFinanceSwapDirection =
  | "expectToken" // ctor 3 — receive non-ADA tokens
  | "expectAda" // ctor 4 — receive ADA / lovelace
  | "liquidity"; // ctor 0/1/2 — liquidity action

export interface VyFinanceOrder {
  /** 28-byte payment pubkeyhash (slice(0,28) of senderKeyHashes). */
  paymentPkh: string;
  /** 28-byte stake key hash, or null for enterprise senders (28-byte field0). */
  stakeKeyHash: string | null;
  /** Raw action constructor tag (3, 4, or 0/1/2). */
  actionTag: number;
  direction: VyFinanceSwapDirection;
  /** The single Int argument of the action = minimum amount to receive. */
  minReceive: bigint;
  issues: DexIssue[];
}

export function parseVyFinanceOrder(data: PD): VyFinanceOrder {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`VyFinance order: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`VyFinance order: expected 2 fields, got ${c.fields.length}`);
  }
  const issues: DexIssue[] = [];

  const senderKeyHashes = asBytes(c.fields[0]);
  // 56 bytes = 112 hex (paymentPkh || stakeKh); 28 bytes = 56 hex (enterprise).
  const paymentPkh = senderKeyHashes.slice(0, 56);
  let stakeKeyHash: string | null = null;
  if (senderKeyHashes.length >= 112) {
    stakeKeyHash = senderKeyHashes.slice(56, 112);
  } else if (senderKeyHashes.length !== 56) {
    issues.push({
      severity: "warning",
      message: `Unexpected senderKeyHashes length (${senderKeyHashes.length / 2} bytes); expected 28 or 56.`,
    });
  }

  const action = asConstr(c.fields[1]);
  if (action.fields.length !== 1) {
    throw new Error(
      `VyFinance order action: expected 1 field, got ${action.fields.length}`,
    );
  }
  const minReceive = asInt(action.fields[0]);

  let direction: VyFinanceSwapDirection;
  if (action.tag === 3) {
    direction = "expectToken";
  } else if (action.tag === 4) {
    direction = "expectAda";
  } else {
    direction = "liquidity";
  }

  return {
    paymentPkh,
    stakeKeyHash,
    actionTag: action.tag,
    direction,
    minReceive,
    issues,
  };
}

// --- Pool datum ------------------------------------------------------------

export interface VyFinancePool {
  /** PoolAssetABarFee — bar fee for pool asset A (dexter field name). */
  barFeeA: bigint;
  /** PoolAssetBBarFee — bar fee for pool asset B (dexter field name). */
  barFeeB: bigint;
  /** TotalLpTokens currently in circulation for this pool. */
  totalLpTokens: bigint;
  issues: DexIssue[];
}

export function parseVyFinancePool(data: PD): VyFinancePool {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`VyFinance pool: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 3) {
    throw new Error(`VyFinance pool: expected 3 fields, got ${c.fields.length}`);
  }
  return {
    barFeeA: asInt(c.fields[0]),
    barFeeB: asInt(c.fields[1]),
    totalLpTokens: asInt(c.fields[2]),
    issues: [],
  };
}

// --- Redeemers -------------------------------------------------------------
//
// Order/swap spend redeemer (the validator has an owner-signature-on-cancel
// branch):
//   Cancel by owner: Constr 1 []  (CBOR d87a80) — owner payment pkh must sign.
//   Execute (batcher): Constr 0 []                — gated by the operatorToken.
export function classifyVyFinanceOrderRedeemer(
  data: PD,
): "Cancel" | "Execute" | null {
  const c = asConstr(data);
  if (c.fields.length !== 0) return null;
  if (c.tag === 1) return "Cancel";
  if (c.tag === 0) return "Execute";
  return null;
}
