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

export function reserveToView(state: DjedReserveState): DexOrderView {
  const issues: DexIssue[] = [];
  // The spend path requires the paused flag to be false; flag it when set.
  if (state.paused) {
    issues.push({
      severity: "warning",
      message: "Reserve paused/locked flag is set (spend path requires it to be false)",
    });
  }
  // Sanity-check the embedded policy id against the known DJED/SHEN policy.
  if (state.policyId.toLowerCase() !== DJED.mintingPolicyId) {
    issues.push({
      severity: "info",
      message: `Datum policy id ${shortHex(state.policyId)} differs from the known DJED/SHEN policy`,
    });
  }
  const rows: DexRow[] = [
    { label: "Reserve (collateral)", value: formatLovelace(state.reserveAmount) },
    { label: "DJED circulating", value: formatMicro(state.djedAmount, "DJED") },
    { label: "SHEN circulating", value: formatMicro(state.shenAmount, "SHEN") },
    { label: "Param A", value: state.paramA.toLocaleString() },
    { label: "Param B", value: state.paramB.toLocaleString() },
    { label: "Paused", value: state.paused ? "yes" : "no" },
    { label: "Mint policy", value: state.policyId, hash: true },
    {
      label: "Last oracle time",
      value: `${state.lastOracle.timestamp.toLocaleString()} (POSIX ms)`,
    },
    { label: "Last oracle input", value: formatRef(state.lastOracle.oracleInput), hash: true },
    { label: "Oracle ref", value: formatRef(state.oracleRef), hash: true },
    { label: "Prior state ref", value: formatRef(state.priorRef), hash: true },
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
