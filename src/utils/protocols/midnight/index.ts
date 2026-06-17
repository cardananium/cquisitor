// Midnight NIGHT / Glacier Drop decoder: normalized views + adapter registration.
//
// Two roles, matched by the 28-byte payment script hash:
//   "distribution" — the NIGHT mint+distribution validator (policy id == script
//       hash); held the 24B airdrop supply with a UNIT datum, so there are no
//       on-chain claim fields to decode — we surface a recognizer view.
//   "config"       — the Glacier Drop config/governance contract; carries a rich
//       datum (authority, treasury, allocation list, series) that we decode.

import {
  registerDexAdapter,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import { asConstr, type Credential, type PD, type PlutusAddress } from "@/utils/protocols/dex/plutusData";
import { matchMidnightScriptHash, MIDNIGHT } from "./constants";
import { parseGlacierConfig, parseGlacierThaw, type GlacierConfig, type GlacierThaw } from "./glacier";

const PROTOCOL = "Midnight (NIGHT)";

// NIGHT has 6 decimals — render a raw amount as a human "N.nnn NIGHT".
function formatNight(raw: bigint): string {
  const scale = BigInt(10) ** BigInt(MIDNIGHT.nightDecimals);
  const whole = raw / scale;
  const frac = (raw % scale).toString().padStart(MIDNIGHT.nightDecimals, "0").replace(/0+$/, "");
  const body = frac ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
  return `${body} NIGHT`;
}

function addrCred(a: PlutusAddress): string {
  return a.paymentCredential.hash;
}

function credLabel(c: Credential): string {
  return `${c.kind === "Script" ? "script" : "key"} hash`;
}

// POSIX milliseconds → "YYYY-MM-DD HH:MM UTC".
function fmtDate(ms: bigint): string {
  return `${new Date(Number(ms)).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Milliseconds → a human day count.
function fmtDays(ms: bigint): string {
  const days = Number(ms) / 86_400_000;
  return Number.isInteger(days) ? `${days} days` : `${days.toFixed(1)} days`;
}

function configToView(cfg: GlacierConfig): DexOrderView {
  const total = cfg.allocations.reduce((s, a) => s + a.amount, BigInt(0));
  const rows: DexRow[] = [
    { label: `Authority (${credLabel(cfg.authority)})`, value: cfg.authority.hash, hash: true },
    { label: "Authority policy", value: cfg.authorityHash, hash: true },
    { label: "Address #1", value: addrCred(cfg.treasuryA), hash: true },
    { label: "Thaw / redemption pool", value: addrCred(cfg.treasuryB), hash: true },
    {
      label: "Allocations",
      value: `${cfg.allocations.length} entries · ${formatNight(total)} total`,
    },
    { label: "Series / batches", value: cfg.count.toString() },
  ];
  cfg.allocations.forEach((a, i) => {
    rows.push({ label: `Alloc ${i + 1} · ${formatNight(a.amount)}`, value: addrCred(a.address), hash: true });
  });
  return { protocol: PROTOCOL, role: "config", kind: "Glacier Drop config", rows, issues: [] };
}

function distributionToView(): DexOrderView {
  return {
    protocol: PROTOCOL,
    role: "distribution",
    kind: "Glacier Drop distribution",
    rows: [
      { label: "Contract", value: "NIGHT mint + distribution validator (policy id = script hash)" },
      { label: "NIGHT policy", value: MIDNIGHT.nightPolicy, hash: true },
      {
        label: "Note",
        value:
          "Held the 24,000,000,000 NIGHT airdrop supply with a unit datum; claims are validator-enforced, so there are no on-chain claim fields.",
      },
    ],
    issues: [],
  };
}

function thawToView(t: GlacierThaw): DexOrderView {
  if (t.variant === "position") {
    const rows: DexRow[] = [
      { label: "Owner", value: addrCred(t.owner), hash: true },
      { label: "Amount", value: formatNight(t.amount) },
      { label: "Next thaw", value: fmtDate(t.nextThaw) },
      { label: "Tranche", value: t.tranche.toString() },
      { label: "Interval", value: fmtDays(t.interval) },
    ];
    return { protocol: PROTOCOL, role: "thaw", kind: "Glacier Drop thaw position", rows, issues: [] };
  }
  const rows: DexRow[] = [
    { label: "Merkle root", value: t.merkleRoot, hash: true },
    { label: "Thaw start", value: fmtDate(t.thawStart) },
    { label: "Thaw interval", value: fmtDays(t.thawInterval) },
  ];
  if (t.state.kind === "count") {
    rows.push({ label: "State", value: `count ${t.state.value.toString()}` });
  } else {
    rows.push({ label: "Redeemed", value: `${t.state.setBits} marked (claim bitmap)` });
  }
  return { protocol: PROTOCOL, role: "thaw", kind: "Glacier Drop thaw pool", rows, issues: [] };
}

export function midnightToView(datum: PD, role: DexRole): DexOrderView {
  if (role === "config") return configToView(parseGlacierConfig(datum));
  if (role === "thaw") return thawToView(parseGlacierThaw(datum));
  return distributionToView();
}

// Classify a redeemer when a distribution-validator UTxO is spent (claim /
// batch distribution). The spend redeemer is the unit value (Constr0[]); other
// constructors are surfaced by index without inventing semantics (the validator
// carries no trace strings).
export function midnightClassifyRedeemer(redeemer: PD, role: DexRole): string | null {
  if (role !== "distribution" && role !== "thaw") return null;
  let c: { tag: number; fields: PD[] };
  try {
    c = asConstr(redeemer);
  } catch {
    return null;
  }
  if (role === "thaw") return `Redeem / thaw tranche (ctor ${c.tag})`;
  if (c.tag === 0 && c.fields.length === 0) return "Claim / release NIGHT (unit redeemer)";
  return `Distribution action (ctor ${c.tag})`;
}

registerDexAdapter({
  id: "midnight-glacier",
  label: PROTOCOL,
  matchScriptHash: matchMidnightScriptHash,
  decode: (datum: PD, role) => midnightToView(datum, role),
  classifyRedeemer: midnightClassifyRedeemer,
});

export * from "./glacier";
export { MIDNIGHT, matchMidnightScriptHash } from "./constants";
