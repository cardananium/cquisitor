// Djed (COTI/IOG) decoder: normalized views + adapter registration.
//
// Role "reserve": the single state-machine bank UTxO. The datum is provided BY
// HASH (not inline) — the caller must resolve the datum witness before passing
// it here. The spend redeemer's tag-2 main action carries mint/burn/settlement
// intent; we classify the top-level ctor only (per-order sub-enum semantics are
// not fully proven).

import {
  registerDexAdapter,
  type DexIssue,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { DJED, matchDjedNftPolicy, matchDjedScriptHash } from "./constants";
import {
  classifyDjedReserveRedeemer,
  parseDjedReserveState,
  type DjedReserveState,
  type DjedTxOutRef,
} from "./datums";

function shortHex(hex: string, head = 6): string {
  if (hex.length <= head * 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-head)}`;
}

// Full (un-shortened) TxOutRef string: `<txHash>#<index>`. The shared hash
// component truncates + copies it in the row.
function formatRef(ref: DjedTxOutRef): string {
  return `${ref.txHash}#${ref.index.toString()}`;
}

// 6-decimal micro-unit amount rendered with its whole-unit value alongside.
function formatMicro(micro: bigint, symbol: string): string {
  const sign = micro < BigInt(0) ? "-" : "";
  const abs = micro < BigInt(0) ? -micro : micro;
  const scale = BigInt(1_000_000);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(6, "0").replace(/0+$/, "");
  const dec = frac.length > 0 ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
  return `${sign}${dec} ${symbol} (${micro.toLocaleString()} micro)`;
}

// Lovelace rendered as ADA with the raw lovelace alongside.
function formatLovelace(lovelace: bigint): string {
  const scale = BigInt(1_000_000);
  const whole = lovelace / scale;
  const frac = (lovelace % scale).toString().padStart(6, "0").replace(/0+$/, "");
  const dec = frac.length > 0 ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
  return `${dec} ADA (${lovelace.toLocaleString()} lovelace)`;
}

// Render a POSIX-millisecond timestamp as an ISO date alongside the raw value.
function formatPosixMs(ms: bigint): string {
  const n = Number(ms);
  const iso = Number.isFinite(n) ? new Date(n).toISOString() : "?";
  return `${iso} (${ms.toLocaleString()} ms)`;
}

export function reserveToView(state: DjedReserveState): DexOrderView {
  const issues: DexIssue[] = [];
  // Sanity-check the embedded policy id against the known DJED/SHEN policy.
  if (state.mintingPolicyId.toLowerCase() !== DJED.mintingPolicyId) {
    issues.push({
      severity: "info",
      message: `Datum policy id ${shortHex(state.mintingPolicyId)} differs from the known DJED/SHEN policy`,
    });
  }
  const rows: DexRow[] = [
    { label: "Reserve (collateral)", value: formatLovelace(state.adaInReserve) },
    { label: "DJED circulating", value: formatMicro(state.djedInCirculation, "DJED") },
    { label: "SHEN circulating", value: formatMicro(state.shenInCirculation, "SHEN") },
    { label: "Min ADA in reserve", value: formatLovelace(state.minADA) },
    { label: "Field [5] (unnamed)", value: state.field1.toLocaleString(), mono: true },
    {
      label: "Field [6] option",
      value: state.optionPresent ? "Some (present)" : "Nothing",
    },
    { label: "Mint policy", value: state.mintingPolicyId, hash: true },
    {
      label: "Last order time",
      value: formatPosixMs(state.lastOrder.timestamp),
    },
    { label: "Last order ref", value: formatRef(state.lastOrder.order), hash: true },
    { label: "Minting-policy unique ref", value: formatRef(state.mintingPolicyUniqRef), hash: true },
    { label: "Field [9] ref (unnamed)", value: formatRef(state.field3), hash: true },
  ];
  return {
    protocol: "Djed",
    role: "reserve",
    kind: "Reserve (Djed/Shen bank)",
    rows,
    issues,
  };
}

registerDexAdapter({
  id: "djed",
  label: "Djed",
  matchScriptHash: matchDjedScriptHash,
  matchNftPolicy: matchDjedNftPolicy,
  decode: (datum: PD, role: DexRole) => {
    void role;
    return reserveToView(parseDjedReserveState(datum));
  },
  classifyRedeemer: (redeemer: PD) => classifyDjedReserveRedeemer(redeemer),
});

export * from "./datums";
export { DJED } from "./constants";
