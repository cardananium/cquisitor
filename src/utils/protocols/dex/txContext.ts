// Per-transaction context shared by every DEX decoder.
//
// Two facts every batched-order DEX needs and that are 100% protocol-agnostic:
//
//  1. Inputs are sorted lexicographically by (transaction_id, index) when the
//     script context is built, and the Spend redeemer at index i targets the
//     i-th input in *that* sorted list — not the body order. We precompute the
//     mapping once.
//
//  2. Many newer protocols (Splash, FluidTokens, Butane, Optim, Genius Yield V2)
//     put the real action in a `WithdrawFrom` (stake) redeemer keyed by the
//     withdrawal's reward-account credential, NOT in the spend redeemer. We index
//     withdrawal redeemers by their sorted position so an adapter can find them.

import type {
  TransactionBody,
  TransactionInput,
  Redeemer,
  CardanoNetwork,
} from "@/components/TransactionCardView/types";
import type { KoiosUtxoInfo } from "@/utils/koiosTypes";
import { getPaymentScriptHash } from "./address";
import { decodePlutusJsonOrHex } from "./datum";
import { listDexAdapters } from "./registry";
import type { DexAdapter, DexRole } from "./registry";

export interface DexInputDetection {
  adapterId: string;
  label: string;
  role: DexRole;
  /** Classified spend redeemer (e.g. "Apply", "Cancel"), when recognized. */
  redeemer?: string;
}

export interface DexTxContext {
  /** input_index_in_body → detection, for inputs at a known DEX script address. */
  inputs: Map<number, DexInputDetection>;
  /** sorted_input_index → input_index_in_body (canonical script-context order). */
  sortedToBody: number[];
  /** input_index_in_body → sorted_input_index. */
  bodyToSorted: Map<number, number>;
  /** sorted_input_index → the Spend redeemer at that index. */
  spendRedeemers: Map<number, Redeemer>;
  /** sorted_withdrawal_index → the Reward/Withdraw redeemer (decoded `data` is the action). */
  withdrawRedeemers: Map<number, Redeemer>;
}

function compareInputs(a: TransactionInput, b: TransactionInput): number {
  if (a.transaction_id !== b.transaction_id) {
    return a.transaction_id < b.transaction_id ? -1 : 1;
  }
  return a.index - b.index;
}

function buildRedeemerMap(redeemers: Redeemer[] | null | undefined, tag: string): Map<number, Redeemer> {
  const map = new Map<number, Redeemer>();
  for (const r of redeemers ?? []) {
    if (String(r.tag).toLowerCase() === tag) {
      const idx = Number(r.index);
      if (Number.isFinite(idx)) map.set(idx, r);
    }
  }
  return map;
}

export function buildDexTxContext(
  body: TransactionBody,
  redeemers: Redeemer[] | null | undefined,
  network: CardanoNetwork | undefined,
  inputUtxoInfoMap: Map<string, KoiosUtxoInfo> | null | undefined,
): DexTxContext {
  const ctx: DexTxContext = {
    inputs: new Map(),
    sortedToBody: [],
    bodyToSorted: new Map(),
    spendRedeemers: buildRedeemerMap(redeemers, "spend"),
    withdrawRedeemers: buildRedeemerMap(redeemers, "reward"),
  };

  const inputs = body.inputs ?? [];
  if (inputs.length === 0) return ctx;

  const indexed = inputs.map((inp, i) => ({ inp, i }));
  indexed.sort((a, b) => compareInputs(a.inp, b.inp));
  ctx.sortedToBody = indexed.map((x) => x.i);
  ctx.sortedToBody.forEach((bodyIdx, sortedIdx) => ctx.bodyToSorted.set(bodyIdx, sortedIdx));

  if (!inputUtxoInfoMap) return ctx;
  const adapters = listDexAdapters();

  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    const utxoInfo = inputUtxoInfoMap.get(`${inp.transaction_id}#${inp.index}`);
    if (!utxoInfo) continue;
    const scriptHash = getPaymentScriptHash(utxoInfo.address);
    if (!scriptHash) continue;

    let matched: { adapter: DexAdapter; role: DexRole } | null = null;
    for (const adapter of adapters) {
      const role = adapter.matchScriptHash?.(scriptHash, network);
      if (role) {
        matched = { adapter, role };
        break;
      }
    }
    if (!matched) continue;

    const detection: DexInputDetection = {
      adapterId: matched.adapter.id,
      label: matched.adapter.label,
      role: matched.role,
    };

    if (matched.adapter.classifyRedeemer) {
      const sortedIdx = ctx.bodyToSorted.get(i);
      const r = sortedIdx !== undefined ? ctx.spendRedeemers.get(sortedIdx) : undefined;
      if (r) {
        const pd = decodePlutusJsonOrHex(r.data);
        if (pd) {
          const classified = matched.adapter.classifyRedeemer(pd, matched.role);
          if (classified) detection.redeemer = classified;
        }
      }
    }

    ctx.inputs.set(i, detection);
  }

  return ctx;
}
