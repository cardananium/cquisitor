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
import { matchLiqwidNftPolicy, matchLiqwidScriptHash } from "./constants";
import {
  classifyLiqwidRedeemer,
  parseLiqwidMarket,
  parseLiqwidPosition,
  parseLiqwidRaw,
  type LiqwidRawDatum,
  type LiqwidRole,
} from "./datums";

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

function marketView(datum: PD): DexOrderView {
  const m = parseLiqwidMarket(datum);
  const rows: DexRow[] = [
    { label: "Epoch / batch", value: m.epoch.toLocaleString() },
    { label: "Mode", value: m.mode.toString() },
    { label: "Action queue keys", value: m.actionQueueKeys.join(", ") || "(none)" },
    {
      label: "Accumulators",
      value: m.accumulators.map((a) => `${a.actionId}: ${a.amount.toLocaleString()}`).join("  ") || "(none)",
    },
    { label: "Admins / batchers", value: String(m.admins.length) },
    ...m.admins.map((h, i) => ({ label: `  admin ${i}`, value: h, hash: true })),
    { label: "Interest-rate model", value: m.interestRateModel.map((x) => x.toString()).join(", ") },
    { label: "Timing params (ms)", value: m.timingParams.map((x) => x.toString()).join(", ") },
    { label: "Last update (POSIX ms)", value: m.lastUpdate.toLocaleString() },
  ];
  return { protocol: PROTOCOL, role: "market", kind: ROLE_KIND.market, rows, issues: [] };
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
