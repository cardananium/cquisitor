// Butane Synthetics decoder: normalized views + adapter registration.
//
// The pointers.spend payment script is shared across six MonoDatum UTxO kinds, so
// decode() parses the full MonoDatum and only renders a "vault" card when it is a
// CDP (Constr 1). Other kinds are rendered as informational state cards (so the
// panel doesn't mis-tag params/gov/treasury/staked UTxOs as positions).

import {
  registerDexAdapter,
  type DexIssue,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { matchButaneNftPolicy, matchButaneScriptHash } from "./constants";
import {
  parseLeftoversDatum,
  parseMonoDatum,
  parsePolicyRedeemer,
  validateCDP,
  type CDPCredential,
  type CDPDatum,
  type LeftoversDatum,
  type MonoDatum,
  type PolicyRedeemer,
} from "./butane";

// Build the Owner DexRow(s). The owner is one of several credential kinds; the
// descriptor word goes into the LABEL and the full hash is surfaced with
// hash:true so the panel truncates + offers a copy button.
function ownerRows(owner: CDPCredential): DexRow[] {
  if (owner.kind === "AuthorizeWithPubKey") {
    return [{ label: "Owner (pubkey)", value: owner.pubKeyHash, hash: true }];
  }
  const ct = owner.constraint;
  if (ct.kind === "MustSpendToken") {
    const { policyId, assetName } = ct.asset;
    return [{ label: "Owner (must spend token)", asset: { policyId, assetName } }];
  }
  return [{ label: "Owner", value: "must withdraw from stake cred" }];
}

// Decode a bare synth asset-name hex into a printable ASCII name when possible
// (USDb/USDs/MIDAS). Returns the decoded name, or null if the hex isn't ASCII.
function decodeAssetName(hex: string): string | null {
  if (hex === "") return "(empty)";
  try {
    const bytes = hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [];
    const ascii = String.fromCharCode(...bytes);
    if (/^[\x20-\x7e]+$/.test(ascii)) return ascii;
  } catch {
    /* fall through */
  }
  return null;
}

// Build the "Synthetic asset" DexRow. Prefer the decoded ASCII name (kept as a
// plain decoded value); fall back to the FULL hex with hash:true.
function syntheticAssetRow(hex: string): DexRow {
  const name = decodeAssetName(hex);
  if (name !== null) return { label: "Synthetic asset", value: name, mono: true };
  return { label: "Synthetic asset", value: hex, hash: true };
}

export function cdpToView(cdp: CDPDatum): DexOrderView {
  const issues = validateCDP(cdp);
  const rows: DexRow[] = [
    syntheticAssetRow(cdp.syntheticAsset),
    { label: "Synthetic debt", value: cdp.syntheticAmount.toLocaleString() },
    { label: "Start time", value: `${cdp.startTime.toLocaleString()} (POSIX ms)` },
    ...ownerRows(cdp.owner),
  ];
  return {
    protocol: "Butane Synthetics",
    role: "vault",
    kind: "CDP (collateralized debt position)",
    rows,
    issues,
  };
}

function leftoversToView(d: LeftoversDatum): DexOrderView {
  return {
    protocol: "Butane Synthetics",
    role: "leftovers",
    kind: "Leftovers claim",
    rows: ownerRows(d.owner),
    issues: [],
  };
}

// Render a non-CDP MonoDatum as an informational state card (NOT a vault).
function monoStateToView(m: MonoDatum): DexOrderView {
  const issues: DexIssue[] = [
    {
      severity: "info",
      message:
        "Butane state UTxO (shares the pointers.spend script with CDP vaults) — not a position",
    },
  ];
  let kind: string;
  const rows: DexRow[] = [];
  switch (m.kind) {
    case "ParamsWrapper":
      kind = "Synthetic parameters";
      rows.push({
        label: "Params",
        value: m.params.kind === "LiveParams" ? "Live" : "Voided (price feed denominator = 0)",
      });
      if (m.params.kind === "LiveParams") {
        rows.push({ label: "Collateral assets", value: String(m.params.params.collateralAssets.length) });
        rows.push({ label: "Denominator", value: m.params.params.denominator.toLocaleString() });
        rows.push({
          label: "Min outstanding synthetic",
          value: m.params.params.minimumOutstandingSynthetic.toLocaleString(),
        });
      }
      break;
    case "GovDatum":
      kind = "Governance datum";
      break;
    case "TreasuryDatum":
      kind = "Treasury datum";
      break;
    case "CompatLockedTokens":
      kind = "Compat locked tokens";
      break;
    case "StakedSynthetics":
      kind = "Staked synthetics";
      rows.push(syntheticAssetRow(m.syntheticAsset));
      rows.push({ label: "Start time", value: `${m.startTime.toLocaleString()} (POSIX ms)` });
      rows.push(...ownerRows(m.owner));
      break;
    default:
      kind = "State UTxO";
  }
  return { protocol: "Butane Synthetics", role: "vault", kind, rows, issues };
}

export function butaneDecode(datum: PD, role: string): DexOrderView {
  if (role === "leftovers") return leftoversToView(parseLeftoversDatum(datum));
  const mono = parseMonoDatum(datum);
  if (mono.kind === "CDP") return cdpToView(mono);
  return monoStateToView(mono);
}

// Classify the synthetics.validate WithdrawFrom redeemer (PolicyRedeemer). The
// real CDP action lives here, not in a spend redeemer (the pointers.spend spend
// redeemer is a trivial forwarding stub).
export function classifyButaneRedeemer(redeemer: PD, _role: string): string | null {
  void _role;
  let r: PolicyRedeemer;
  try {
    r = parsePolicyRedeemer(redeemer);
  } catch {
    return null;
  }
  switch (r.kind) {
    case "SyntheticsMain":
      return `Synthetics main (${r.spends.length} spend, ${r.creates.length} create)`;
    case "CollectVoidedCDP":
      return "Collect voided CDP";
    case "BadDebt":
      return "Bad debt";
    case "Auxilliary":
      return "Auxilliary";
  }
}

registerDexAdapter({
  id: "butane-synthetics",
  label: "Butane Synthetics",
  matchScriptHash: matchButaneScriptHash,
  matchNftPolicy: matchButaneNftPolicy,
  decode: butaneDecode,
  classifyRedeemer: classifyButaneRedeemer,
});

export * from "./butane";
export { BUTANE, matchButaneScriptHash, matchButaneNftPolicy } from "./constants";
