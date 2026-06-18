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
  govActionName,
  parseLeftoversDatum,
  parseMonoDatum,
  parsePolicyRedeemer,
  parseTreasuryKind,
  validateCDP,
  type ActiveParams,
  type CDPCredential,
  type CDPDatum,
  type LeftoversDatum,
  type MonoDatum,
  type PolicyRedeemer,
} from "./butane";

// Build the Owner DexRow(s). The owner is one of several credential kinds; the
// descriptor word goes into the LABEL and the full hash is surfaced with
// hash:true so the panel truncates + offers a copy button.
//
// AuthorizeWithPubKey carries TWO fields: the 28-byte PubKeyHash (used for the
// direct extra-signatory owner check) and a SECOND field — the FULL ed25519
// verification_key — used only on the signature-delegation path
// (AuthorizingOtherWithSignature in lib/butane/utils.ak). It is commonly empty
// (""); we only add a row when it carries a key so the common case stays clean.
// MustWithdrawFrom carries a StakeCredential whose hash we surface (it was
// previously collapsed to the literal string "must withdraw from stake cred").
function ownerRows(owner: CDPCredential): DexRow[] {
  if (owner.kind === "AuthorizeWithPubKey") {
    const rows: DexRow[] = [{ label: "Owner (pubkey)", value: owner.pubKeyHash, hash: true }];
    if (owner.verificationKey !== "") {
      rows.push({
        label: "Owner verification key (ed25519)",
        value: owner.verificationKey,
        hash: true,
      });
    }
    return rows;
  }
  const ct = owner.constraint;
  if (ct.kind === "MustSpendToken") {
    const { policyId, assetName } = ct.asset;
    return [{ label: "Owner (must spend token)", asset: { policyId, assetName } }];
  }
  // MustWithdrawFrom — surface the stake credential hash (and its kind).
  const st = ct.stake;
  if (st.kind === "Inline") {
    const credKind = st.credential.kind === "Script" ? "script" : "pubkey";
    return [{ label: `Owner (must withdraw from ${credKind})`, value: st.credential.hash, hash: true }];
  }
  return [
    {
      label: "Owner (must withdraw from stake pointer)",
      value: `slot ${st.slotNumber}, txIdx ${st.transactionIndex}, certIdx ${st.certificateIndex}`,
    },
  ];
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

// Basis-point shares (bp_precision = 10_000 in types.ak) → a readable percent.
function bpToPercent(bp: bigint): string {
  return `${(Number(bp) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% (${bp.toLocaleString()} bp)`;
}

// Render the full ActiveParams. The per-synthetic risk config is NOT just a
// collateral-asset count: each named field is a meaningful governance-set value.
// The two interest-rate lists are time-series (the most-recent entry is first,
// the global cap has timestamp 0 as the LAST element); we surface the latest
// rate + the entry count rather than exploding up to 71 rows.
function activeParamsRows(p: ActiveParams): DexRow[] {
  const rows: DexRow[] = [];
  // collateral_assets — surface each AssetClass as an asset row, not a count.
  p.collateralAssets.forEach((a, i) => {
    const weight = p.weights[i];
    const maxProp = p.maxProportions[i];
    const parts: string[] = [];
    if (weight !== undefined) parts.push(`weight ${weight}/${p.denominator}`);
    if (maxProp !== undefined) parts.push(`max ${bpToPercent(maxProp)}`);
    rows.push({
      label: parts.length ? `Collateral ${i} (${parts.join(", ")})` : `Collateral ${i}`,
      asset: { policyId: a.policyId, assetName: a.assetName },
    });
  });
  rows.push({ label: "Weight denominator", value: p.denominator.toLocaleString() });
  rows.push({
    label: "Min outstanding synthetic",
    value: p.minimumOutstandingSynthetic.toLocaleString(),
  });
  // interest_rates / staking_interest_rates: Pair(PosixTime, Int) entries; the
  // parser maps them to {numerator: time, denominator: rate}. Surface the most
  // recent rate (first entry) + count.
  const latestBorrow = p.interestRates[0];
  if (latestBorrow) {
    rows.push({
      label: "Interest rate (latest)",
      value: `${bpToPercent(latestBorrow.denominator)} @ ${latestBorrow.numerator.toLocaleString()} (${p.interestRates.length} stored)`,
    });
  }
  const latestStaking = p.stakingInterestRates[0];
  if (latestStaking) {
    rows.push({
      label: "Staking interest rate (latest)",
      value: `${bpToPercent(latestStaking.denominator)} @ ${latestStaking.numerator.toLocaleString()} (${p.stakingInterestRates.length} stored)`,
    });
  }
  rows.push({ label: "Max liquidation return", value: bpToPercent(p.maxLiquidationReturn) });
  rows.push({ label: "Treasury liquidation share", value: bpToPercent(p.treasuryLiquidationShare) });
  rows.push({ label: "Redemption share", value: bpToPercent(p.redemptionShare) });
  rows.push({ label: "Fee token (BTN) discount", value: bpToPercent(p.feeTokenDiscount) });
  return rows;
}

// Decode a bare asset-name hex to ASCII when printable, else return the hex.
function assetNameLabel(hex: string): string {
  return decodeAssetName(hex) ?? hex;
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
        rows.push(...activeParamsRows(m.params.params));
      }
      break;
    case "GovDatum": {
      kind = "Governance datum";
      // Surface WHICH governance action this datum carries (the discriminant was
      // previously dropped). The full nested payload stays raw at this layer.
      const action = govActionName(m.raw);
      rows.push({ label: "Gov action", value: action ?? "(unknown variant)" });
      break;
    }
    case "TreasuryDatum": {
      kind = "Treasury datum";
      // Surface WHICH treasury variant (5 kinds) — previously dropped entirely.
      const t = parseTreasuryKind(m.raw);
      rows.push({ label: "Treasury type", value: t.kind });
      if (t.kind === "TreasuryWithDebt") {
        rows.push({ label: "Debt amount", value: t.debt.amount.toLocaleString() });
        rows.push({
          label: "Debt asset",
          value: assetNameLabel(t.debt.asset),
          mono: true,
        });
        if (t.creationTime !== null) {
          rows.push({
            label: "Creation time",
            value: `${t.creationTime.toLocaleString()} (POSIX ms)`,
          });
        }
      }
      break;
    }
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
