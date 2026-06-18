// SnekFun bonding-curve datum + redeemer parsers (curve validator 905ab869…).
//
// The curve datum is a single-constructor Constr 0 with exactly 9 fields. Field
// layout (field[3,4,6,7] are constant across every launched token, i.e.
// protocol-level curve parameters, while field[0,2,5,8] vary per token):
//
//   [0] curveNft    AssetClass  Constr0[policy, name] — the qty-1 curve NFT held
//                               in this UTxO, minted under SNEKFUN.curveNftPolicy.
//   [1] base        AssetClass  Constr0[policy, name] — the quote asset; ADA = ("","").
//   [2] token       AssetClass  Constr0[policy, name] — the launched memecoin.
//   [3] coeffA      Int         cubic bonding-curve coefficient (validator `int_2`).
//   [4] coeffB      Int         linear bonding-curve coefficient (validator `int_1`).
//   [5] owner       Bytes(28)   creator pubkey hash; must sign on the curve-trade path
//                               (validator checks it is in tx_info.signatories).
//   [6] targetLovelace Int      graduation target lovelace (validator `int`; the curve
//                               graduates to a Splash pool once reached).
//   [7] tradeWithdrawal Bytes(28)  withdrawal/staking script hash invoked on the Buy
//                               (curve-trade) path (validator field_7).
//   [8] adminWithdrawal Bytes(28)  withdrawal/staking script hash invoked on the Sell /
//                               admin path (validator field_8).
//
// The spend redeemer is Constr0[inputIndex Int, outputIndex Int, action] where
// `action` is a nullary ctor: Constr0[] = Buy (curve-trade math path),
// Constr1[] = Sell, Constr2[] = other. Buy/Sell route the validator between the
// two withdrawal validators in field[7]/field[8].

import {
  asBytes,
  asConstr,
  asInt,
  parseAssetClass,
  type AssetClass,
  type PD,
} from "@/utils/protocols/dex/plutusData";
import type { DexIssue } from "@/utils/protocols/dex/registry";

export interface SnekFunCurve {
  /** The qty-1 curve NFT this UTxO holds (minted under SNEKFUN.curveNftPolicy). */
  curveNft: AssetClass;
  /** Quote asset; ADA = ("", ""). */
  base: AssetClass;
  /** The launched memecoin being traded along the curve. */
  token: AssetClass;
  /** Cubic bonding-curve coefficient. */
  coeffA: bigint;
  /** Linear bonding-curve coefficient. */
  coeffB: bigint;
  /** Creator pubkey hash that must sign on the curve-trade path. */
  owner: string;
  /** Graduation target lovelace (curve → Splash pool once reached). */
  targetLovelace: bigint;
  /** Withdrawal/staking script hash invoked on the Buy (trade) path. */
  tradeWithdrawal: string;
  /** Withdrawal/staking script hash invoked on the Sell / admin path. */
  adminWithdrawal: string;
}

export function parseSnekFunCurve(data: PD): SnekFunCurve {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`SnekFun curve: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 9) {
    throw new Error(`SnekFun curve: expected 9 fields, got ${f.length}`);
  }
  return {
    curveNft: parseAssetClass(f[0]),
    base: parseAssetClass(f[1]),
    token: parseAssetClass(f[2]),
    coeffA: asInt(f[3]),
    coeffB: asInt(f[4]),
    owner: asBytes(f[5]),
    targetLovelace: asInt(f[6]),
    tradeWithdrawal: asBytes(f[7]),
    adminWithdrawal: asBytes(f[8]),
  };
}

/** Light, non-throwing validation over a parsed curve datum. */
export function validateSnekFunCurve(curve: SnekFunCurve): DexIssue[] {
  const issues: DexIssue[] = [];
  for (const [label, hash] of [
    ["owner", curve.owner],
    ["tradeWithdrawal", curve.tradeWithdrawal],
    ["adminWithdrawal", curve.adminWithdrawal],
  ] as const) {
    if (hash.length !== 56) {
      issues.push({
        severity: "error",
        message: `${label} hash must be 28 bytes, got ${hash.length / 2}`,
      });
    }
  }
  if (curve.targetLovelace <= BigInt(0)) {
    issues.push({ severity: "warning", message: "targetLovelace is not positive" });
  }
  const tokenIsAda = curve.token.policyId === "" && curve.token.assetName === "";
  if (tokenIsAda) {
    issues.push({ severity: "warning", message: "launched token leg is ADA" });
  }
  return issues;
}

export type SnekFunRedeemerKind = "Buy" | "Sell" | "Other";

export interface SnekFunRedeemer {
  kind: SnekFunRedeemerKind;
  /** Index into the resolved-input list locating the curve's own input. */
  inputIndex: bigint;
  /** Index into the output list locating the continuing curve output. */
  outputIndex: bigint;
}

// Spend redeemer = Constr0[inputIndex Int, outputIndex Int, action]. `action`
// is a nullary ctor: 0 = Buy, 1 = Sell, anything else = Other.
export function parseSnekFunRedeemer(data: PD): SnekFunRedeemer | null {
  const c = asConstr(data);
  if (c.tag !== 0 || c.fields.length < 3) return null;
  const actionCtor = asConstr(c.fields[2]);
  const kind: SnekFunRedeemerKind =
    actionCtor.tag === 0 ? "Buy" : actionCtor.tag === 1 ? "Sell" : "Other";
  return {
    kind,
    inputIndex: asInt(c.fields[0]),
    outputIndex: asInt(c.fields[1]),
  };
}

export function classifySnekFunRedeemer(data: PD): SnekFunRedeemerKind | null {
  const r = parseSnekFunRedeemer(data);
  return r ? r.kind : null;
}
