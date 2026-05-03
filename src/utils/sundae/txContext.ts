// Per-transaction context for Sundae detection on inputs (Cancel, Scoop).
//
// Inputs in a Cardano transaction are sorted lexicographically by
// (transaction_id, index) when the script context is built — and the redeemer
// at `(tag = "Spend", index = i)` corresponds to the i-th input in *that*
// sorted list, not the order they appear in the body.
//
// This module precomputes that mapping for a decoded transaction once, so the
// per-input cards can do an O(1) lookup.

import { decode_specific_type } from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import type {
  TransactionBody,
  TransactionInput,
  TransactionOutput,
  Redeemer,
  CardanoNetwork,
} from "@/components/TransactionCardView/types";
import type { KoiosUtxoInfo } from "@/utils/koiosTypes";
import { lookupSundaeScript, type SundaeScriptEntry } from "./constants";
import { asConstr, asInt, asList, asOptional, isConstr, type PD } from "./plutusData";
import {
  parseV3OrderDatum,
  parseStableswapOrderDatum,
  parseV3SignedStrategyExecution,
  parseStableswapSignedStrategyExecution,
  type V3OrderDatum,
  type SignedStrategyExecution,
} from "./v3";

export type V3OrderRedeemer =
  | { kind: "Scoop" }
  | { kind: "Cancel" };

export interface SundaeInputDetection {
  match: SundaeScriptEntry;
  // The redeemer for this input, if we could resolve one and recognize its
  // shape. V3 orders only — V1 / Stableswap have their own redeemer shapes.
  redeemer?: V3OrderRedeemer;
  // The order's parsed datum, when both utxoInfo + inline datum are available.
  v3Order?: V3OrderDatum;
}

// One entry of the PoolScoop redeemer's `inputOrder` list.
export interface ScoopOrderRef {
  // Sorted-input index of the order in the script context.
  sortedInputIndex: number;
  // Index in the transaction body's inputs[] (the order users see in the UI).
  bodyInputIndex: number | null;
  // True if the redeemer attached an Option<SignedStrategyExecution>.
  hasStrategy: boolean;
  // Parsed strategy execution if `hasStrategy` is true. Null when parsing
  // fails (defensive — we still want the rest of the scoop to render).
  strategy: SignedStrategyExecution | null;
  // Annotation from the redeemer — typically the payout output index, though
  // the on-chain validator does not use it.
  payoutHint: number;
}

export interface SundaeScoopInfo {
  // Body index of the pool input.
  poolInputIndex: number;
  match: SundaeScriptEntry;
  signatoryIndex: number;
  scooperIndex: number;
  orders: ScoopOrderRef[];
}

export interface SundaeTxContext {
  // input_index_in_body → input info, when the input lives at a known sundae
  // script address and we either have utxoInfo or can identify it by hash.
  inputs: Map<number, SundaeInputDetection>;
  // sorted_input_index → input_index_in_body (canonical script-context order)
  sortedToBody: number[];
  // When the tx has a pool input being scooped, the parsed PoolScoop redeemer.
  scoop?: SundaeScoopInfo;
}

function compareInputs(a: TransactionInput, b: TransactionInput): number {
  if (a.transaction_id !== b.transaction_id) {
    return a.transaction_id < b.transaction_id ? -1 : 1;
  }
  return a.index - b.index;
}

function decodePlutusJsonOrHex(raw: string): PD | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return convertSerdeNumbers(parsed) as PD;
    }
  } catch {
    // not JSON
  }
  try {
    const decoded = decode_specific_type(raw, "PlutusData", {
      plutus_data_schema: "DetailedSchema",
    }) as { plutus_data: PD };
    return convertSerdeNumbers(decoded.plutus_data) as PD;
  } catch {
    return null;
  }
}

function classifyV3OrderRedeemer(data: PD): V3OrderRedeemer | null {
  if (!isConstr(data)) return null;
  if (data.constructor === 0 && data.fields.length === 0) return { kind: "Scoop" };
  if (data.constructor === 1 && data.fields.length === 0) return { kind: "Cancel" };
  return null;
}

// Parse a wrapped PoolRedeemer for V3:
//   RedeemerWrapper { Wrapper: PoolRedeemer { PoolScoop {sigIdx, scoopIdx, inputOrder} | Manage } }
// Returns the inputOrder breakdown when it's a PoolScoop, or null otherwise.
interface ParsedPoolScoop {
  signatoryIndex: number;
  scooperIndex: number;
  protocol: "V3" | "Stableswap";
  orders: {
    sortedInputIndex: number;
    hasStrategy: boolean;
    strategy: SignedStrategyExecution | null;
    payoutHint: number;
  }[];
}
function parseV3PoolScoop(data: PD): ParsedPoolScoop | null {
  try {
    // Outer wrapper: RedeemerWrapper, ctor 1, fields: [innerRedeemer]
    const wrapper = asConstr(data);
    if (wrapper.tag !== 1 || wrapper.fields.length !== 1) return null;
    // Inner: PoolRedeemer.PoolScoop, ctor 0, fields: [sigIdx, scooperIdx, inputOrder]
    const inner = asConstr(wrapper.fields[0]);
    if (inner.tag !== 0 || inner.fields.length !== 3) return null;
    const signatoryIndex = Number(asInt(inner.fields[0]));
    const scooperIndex = Number(asInt(inner.fields[1]));
    const orderEntries = asList(inner.fields[2]);
    let detectedProtocol: "V3" | "Stableswap" | null = null;
    const orders = orderEntries.map((entry) => {
      // Each entry is a tuple — V3: [Int, Option<SSE>, Int]; Stableswap: [Int, Option<SSE>, Int, Int].
      const tuple = asList(entry);
      if (tuple.length !== 3 && tuple.length !== 4) {
        throw new Error("scoop: expected 3- or 4-element order tuple");
      }
      const protocolHere: "V3" | "Stableswap" = tuple.length === 4 ? "Stableswap" : "V3";
      if (detectedProtocol && detectedProtocol !== protocolHere) {
        throw new Error("scoop: mixed-protocol inputOrder");
      }
      detectedProtocol = protocolHere;
      const sortedInputIndex = Number(asInt(tuple[0]));
      // Decode Option<SSE>. We use a typed parser for the inner SSE so the
      // panel can show what the strategy actually does.
      const sseParser =
        protocolHere === "Stableswap"
          ? parseStableswapSignedStrategyExecution
          : parseV3SignedStrategyExecution;
      let hasStrategy = false;
      let strategy: SignedStrategyExecution | null = null;
      try {
        strategy = asOptional(tuple[1], sseParser);
        hasStrategy = strategy !== null;
      } catch {
        // SSE parse failed — fall back to the boolean indicator.
        hasStrategy = asOptional(tuple[1], () => true) !== null;
      }
      const payoutHint = Number(asInt(tuple[2]));
      return { sortedInputIndex, hasStrategy, strategy, payoutHint };
    });
    return { signatoryIndex, scooperIndex, protocol: detectedProtocol ?? "V3", orders };
  } catch {
    return null;
  }
}

// Decode the address's payment script hash via cquisitor-lib's Address decoder.
interface DecodedAddress {
  details?: { payment_cred?: { type: string; credential: string } };
}
function paymentScriptHash(addressBech32: string): string | null {
  try {
    const decoded = decode_specific_type(addressBech32, "Address", {}) as DecodedAddress;
    if (decoded?.details?.payment_cred?.type === "ScriptHash") {
      return decoded.details.payment_cred.credential.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

// Some on-chain inline datums round-trip as plain output objects already; the
// Koios path stores `inline_datum.value` which is the same DetailedSchema shape
// we need.
function utxoInfoToOutput(info: KoiosUtxoInfo): TransactionOutput {
  return {
    address: info.address,
    amount: { coin: info.value },
    plutus_data: info.inline_datum
      ? { Data: JSON.stringify(info.inline_datum.value) }
      : info.datum_hash
      ? { DataHash: info.datum_hash }
      : null,
  };
}

export function buildSundaeTxContext(
  body: TransactionBody,
  redeemers: Redeemer[] | null | undefined,
  network: CardanoNetwork | undefined,
  inputUtxoInfoMap: Map<string, KoiosUtxoInfo> | null | undefined
): SundaeTxContext {
  const ctx: SundaeTxContext = { inputs: new Map(), sortedToBody: [] };
  const inputs = body.inputs ?? [];
  if (inputs.length === 0) return ctx;

  // Sort by (txHash, index) and remember the body-order index for each.
  const indexed = inputs.map((inp, i) => ({ inp, i }));
  indexed.sort((a, b) => compareInputs(a.inp, b.inp));
  ctx.sortedToBody = indexed.map((x) => x.i);
  const bodyToSorted = new Map<number, number>();
  ctx.sortedToBody.forEach((bodyIdx, sortedIdx) => bodyToSorted.set(bodyIdx, sortedIdx));

  // Build redeemer lookup: sorted index → redeemer.data (plutus json/hex).
  const spendRedeemers = new Map<number, Redeemer>();
  for (const r of redeemers ?? []) {
    if (String(r.tag).toLowerCase() === "spend") {
      const idx = Number(r.index);
      if (Number.isFinite(idx)) spendRedeemers.set(idx, r);
    }
  }

  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    const utxoKey = `${inp.transaction_id}#${inp.index}`;
    const utxoInfo = inputUtxoInfoMap?.get(utxoKey);
    let scriptHash: string | null = null;
    if (utxoInfo) {
      scriptHash = paymentScriptHash(utxoInfo.address);
    }
    if (!scriptHash) continue;
    const match = lookupSundaeScript(scriptHash, network);
    if (!match) continue;

    const detection: SundaeInputDetection = { match };

    // Parse order datum if available.
    if (
      utxoInfo &&
      match.role === "order" &&
      (match.protocol === "V3" || match.protocol === "Stableswap")
    ) {
      const out = utxoInfoToOutput(utxoInfo);
      if (out.plutus_data && "Data" in out.plutus_data) {
        const pd = decodePlutusJsonOrHex(out.plutus_data.Data);
        if (pd) {
          try {
            detection.v3Order =
              match.protocol === "Stableswap"
                ? parseStableswapOrderDatum(pd)
                : parseV3OrderDatum(pd);
          } catch {
            // Leave undefined; UI will show the script-hash-only state.
          }
        }
      }
    }

    // Resolve redeemer (V3 + Stableswap share the same OrderRedeemer shape).
    if ((match.protocol === "V3" || match.protocol === "Stableswap") && match.role === "order") {
      const sortedIdx = bodyToSorted.get(i);
      if (sortedIdx !== undefined) {
        const r = spendRedeemers.get(sortedIdx);
        if (r) {
          const pd = decodePlutusJsonOrHex(r.data);
          if (pd) {
            const classified = classifyV3OrderRedeemer(pd);
            if (classified) detection.redeemer = classified;
          }
        }
      }
    }

    ctx.inputs.set(i, detection);
  }

  // Scoop detection from redeemer shape alone — works without utxoInfo because
  // the PoolScoop CBOR layout is distinctive enough to identify on its own.
  // Pick the first redeemer that parses as a wrapped PoolScoop; in practice
  // there's exactly one pool input per V3 scoop tx.
  for (const [sortedIdx, r] of spendRedeemers) {
    const pd = decodePlutusJsonOrHex(r.data);
    if (!pd) continue;
    const parsed = parseV3PoolScoop(pd);
    if (!parsed) continue;
    const bodyIdx = ctx.sortedToBody[sortedIdx];
    if (bodyIdx === undefined) continue;
    // Reuse an existing pool match if we have one (utxoInfo path), otherwise
    // synthesize a placeholder match — we don't have the script hash without
    // the address, but the role/protocol are fixed by the redeemer shape.
    const existing = ctx.inputs.get(bodyIdx)?.match;
    const match: SundaeScriptEntry = existing ?? {
      protocol: parsed.protocol,
      role: "pool",
      hash: "",
    };
    ctx.scoop = {
      poolInputIndex: bodyIdx,
      match,
      signatoryIndex: parsed.signatoryIndex,
      scooperIndex: parsed.scooperIndex,
      orders: parsed.orders.map((o) => ({
        ...o,
        bodyInputIndex: ctx.sortedToBody[o.sortedInputIndex] ?? null,
      })),
    };
    // Mark each scooped order input as an order being Scooped, even without
    // utxoInfo — useful for showing the badge on cold reads.
    for (const o of ctx.scoop.orders) {
      if (o.bodyInputIndex === null) continue;
      const existing = ctx.inputs.get(o.bodyInputIndex);
      if (existing) {
        if (!existing.redeemer) existing.redeemer = { kind: "Scoop" };
      } else {
        ctx.inputs.set(o.bodyInputIndex, {
          match: { protocol: parsed.protocol, role: "order", hash: "" },
          redeemer: { kind: "Scoop" },
        });
      }
    }
    break;
  }

  return ctx;
}
