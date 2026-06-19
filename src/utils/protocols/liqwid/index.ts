// Liqwid Finance decoder: normalized views + adapter registration.
//
// See ./datums.ts and ./constants.ts for the schema.
// Roles:
//   market   — 8-field MarketState List (state-token 34293de1 / hub 26aea7e0)
//   position — 5-field Loan List (loan validator 71391f18 / loan-NFT ee944b56)
//   action   — action-queue redeemer enum (validator fa3603d2)
//   qtoken   — qADA receipt token (policy a04ce7a5), detect-only

import {
  registerDexAdapter,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { LIQWID, matchLiqwidNftPolicy, matchLiqwidScriptHash } from "./constants";
import {
  classifyLiqwidRedeemer,
  parseLiqwidActionDatum,
  parseLiqwidMarket,
  parseLiqwidPosition,
  parseLiqwidRaw,
  type LiqwidRawDatum,
  type LiqwidRole,
} from "./datums";
import type { Credential } from "@/utils/protocols/dex/plutusData";

const PROTOCOL = "Liqwid Finance";

const ROLE_KIND: Record<LiqwidRole, string> = {
  market: "Market state",
  position: "Loan / position",
  action: "Batcher action",
  qtoken: "qToken (receipt)",
};

function isLiqwidRole(role: DexRole): role is LiqwidRole {
  return role === "market" || role === "position" || role === "action" || role === "qtoken";
}

function positionView(datum: PD): DexOrderView {
  const p = parseLiqwidPosition(datum);
  const rows: DexRow[] = [
    { label: "Owner (PubKeyHash)", value: p.owner, hash: true },
    { label: "Principal", value: p.principal.toLocaleString() },
    { label: "Interest", value: p.interest.toLocaleString() },
    { label: "Min interest", value: p.minInterest.toLocaleString() },
    { label: "Interest index", value: p.interestIndex.toLocaleString() },
  ];
  return { protocol: PROTOCOL, role: "position", kind: ROLE_KIND.position, rows, issues: [] };
}

// Format a ms duration as a short human hint (12h, 48h, 1d…) when it divides
// cleanly, else "". Used to annotate the timing-param durations.
function durationHint(ms: bigint): string {
  const HOUR = BigInt(3_600_000);
  const DAY = BigInt(24);
  const zero = BigInt(0);
  if (ms <= zero) return "";
  const h = ms / HOUR;
  if (h * HOUR !== ms) return "";
  if (h % DAY === zero) return ` (${(h / DAY).toString()}d)`;
  return ` (${h.toString()}h)`;
}

function marketView(datum: PD): DexOrderView {
  const m = parseLiqwidMarket(datum);
  // Only field meanings that can be defensibly named are named; the rest keep a
  // neutral state[N] label.
  const rows: DexRow[] = [
    // state[0]: batch index — the action validator reads this as the current
    // batch counter, and the action-datum references key off it (value-inferred).
    { label: "Batch index (state[0])", value: m.epoch.toLocaleString() },
    // state[2]: a small selector the validator branches on (0/1/2). Meaning not
    // published — kept neutral.
    { label: "Selector (state[2])", value: m.mode.toString() },
    // state[1]: Map<actionId, queue> — per-action-type id → pending-entry count
    // in that queue's inner map (queues normally drain to 0 within a batch tx).
    {
      label: "Action queues (state[1])",
      value:
        m.actionQueues.map((q) => `${q.actionId}: ${q.entryCount} pending`).join("  ") || "(none)",
    },
    // state[5]: Map<actionId, amount> — per-action accumulated amounts.
    {
      label: "Accumulators (state[5])",
      value: m.accumulators.map((a) => `${a.actionId}: ${a.amount.toLocaleString()}`).join("  ") || "(none)",
    },
    // state[3]: List<Constr0[PubKeyHash]> — authorized signers (value-inferred:
    // each is a 28-byte hash; they appear as required signers on batch txs).
    { label: "Admins / signers (state[3])", value: String(m.admins.length) },
    ...m.admins.map((h, i) => ({ label: `  admin ${i}`, value: h, hash: true })),
    // state[4]: List<Int>(5) — rate-curve / interest parameters (meaning of each
    // slot not published, kept neutral).
    { label: "Rate params (state[4])", value: m.interestRateModel.map((x) => x.toString()).join(", ") },
    // state[6]: List<Int>(6) — durations in ms; the validator reads state[6][4].
    {
      label: "Durations ms (state[6])",
      value: m.timingParams.map((x) => `${x.toString()}${durationHint(x)}`).join(", "),
    },
    // state[7]: POSIXTime ms — value-confirmed (real 2023+ timestamps).
    {
      label: "Last update (state[7])",
      value: `${m.lastUpdate.toLocaleString()} ms (${new Date(Number(m.lastUpdate)).toISOString()})`,
    },
  ];
  return { protocol: PROTOCOL, role: "market", kind: ROLE_KIND.market, rows, issues: [] };
}

function credLabel(c: Credential): string {
  return c.kind === "Script" ? "Script" : "PubKey";
}

function actionView(datum: PD): DexOrderView {
  const a = parseLiqwidActionDatum(datum);
  const rows: DexRow[] = [
    {
      label: "Escrowed LQ amount",
      value: a.amount.toLocaleString(),
      asset: { policyId: LIQWID.lqGovPolicy, assetName: "4c51", amount: a.amount },
    },
    {
      label: `Owner payment cred (${credLabel(a.ownerPaymentCredential)})`,
      value: a.ownerPaymentCredential.hash,
      hash: true,
    },
    a.ownerStakeCredential
      ? {
          label: `Owner stake cred (${credLabel(a.ownerStakeCredential)})`,
          value: a.ownerStakeCredential.hash,
          hash: true,
        }
      : { label: "Owner stake cred", value: "(none)" },
    { label: "Claim references", value: a.references.length ? String(a.references.length) : "(none)" },
    ...a.references.map((r, i): DexRow => ({
      label: `  ref ${i} (batch ${r.index.toString()})`,
      // statusTag is a constant 1 across every observed on-chain ref; surface it
      // only when it deviates so we never silently drop a meaningful variant.
      value:
        `count ${r.count.toString()}, ${new Date(Number(r.timeMs)).toISOString()} (${r.timeMs.toString()} ms)` +
        (r.statusTag === 1 ? "" : `, statusTag ${r.statusTag}`),
    })),
  ];
  return { protocol: PROTOCOL, role: "action", kind: ROLE_KIND.action, rows, issues: [] };
}

export function liqwidRawToView(raw: LiqwidRawDatum): DexOrderView {
  const rows: DexRow[] = [
    {
      label: "Constructor",
      value: raw.constructorTag === null ? "(top-level List)" : String(raw.constructorTag),
    },
    { label: "Field count", value: String(raw.fieldCount) },
    ...raw.fields.map((f): DexRow =>
      f.type === "Bytes" && f.bytes
        ? { label: `Field ${f.index} (Bytes, ${f.summary})`, value: f.bytes, hash: true }
        : { label: `Field ${f.index} (${f.type})`, value: f.summary },
    ),
  ];
  return {
    protocol: PROTOCOL,
    role: raw.role,
    kind: `${ROLE_KIND[raw.role]} (raw)`,
    rows,
    issues: [],
  };
}

function qtokenView(): DexOrderView {
  return {
    protocol: PROTOCOL,
    role: "qtoken",
    kind: ROLE_KIND.qtoken,
    rows: [
      {
        label: "Note",
        value: "qToken interest-bearing receipt (matched by minting policy)",
      },
    ],
    issues: [],
  };
}

export function decodeLiqwid(datum: PD, role: DexRole): DexOrderView {
  if (!isLiqwidRole(role)) {
    return { protocol: PROTOCOL, role, kind: "Unknown Liqwid role", rows: [], issues: [] };
  }
  if (role === "qtoken") {
    if (datum == null) return qtokenView();
    try {
      return liqwidRawToView(parseLiqwidRaw(datum, role));
    } catch {
      return qtokenView();
    }
  }
  // Try the semantic parser for the role; fall back to structural on shape mismatch.
  try {
    if (role === "position") return positionView(datum);
    if (role === "market") return marketView(datum);
    if (role === "action") return actionView(datum);
  } catch {
    /* shape mismatch — fall through to raw */
  }
  return liqwidRawToView(parseLiqwidRaw(datum, role));
}

registerDexAdapter({
  id: "liqwid",
  label: PROTOCOL,
  matchScriptHash: matchLiqwidScriptHash,
  matchNftPolicy: matchLiqwidNftPolicy,
  decode: decodeLiqwid,
  classifyRedeemer: (redeemer: PD, role: DexRole) =>
    classifyLiqwidRedeemer(redeemer, isLiqwidRole(role) ? role : "action"),
});

export * from "./datums";
export { LIQWID, matchLiqwidNftPolicy, matchLiqwidScriptHash } from "./constants";
