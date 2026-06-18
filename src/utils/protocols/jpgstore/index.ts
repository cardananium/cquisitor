// JPG Store v3 (Wayup) decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type {
  Credential,
  PD,
  PlutusAddress,
  StakeCredential,
} from "@/utils/protocols/dex/plutusData";
import { matchJpgStoreNftPolicy, matchJpgStoreScriptHash } from "./constants";
import {
  classifyJpgAskRedeemer,
  jpgPayoutsSum,
  parseJpgAskDatum,
  validateJpgAskDatum,
  type JpgAskDatum,
} from "./ask";
import {
  classifyJpgSwapRedeemer,
  parseJpgSwapDatum,
  validateJpgSwapDatum,
  type JpgSwapDatum,
} from "./swap";

// Label hint for a credential's kind (the full hash itself is rendered as a
// separate hash:true row value).
function credentialKind(addr: PlutusAddress): "script" | "key" {
  return addr.paymentCredential.kind === "Script" ? "script" : "key";
}

function credKind(c: Credential): "script" | "key" {
  return c.kind === "Script" ? "script" : "key";
}

// Render an address' stake credential as a `/ stake …` suffix appended after the
// payment-credential hash (mirrors the Minswap decoder), so the staking part of
// SwapAddress / Address (Maybe<StakingCredential>) is never silently dropped.
function stakeCredentialSuffix(stake: StakeCredential | null): string {
  if (!stake) return "";
  if (stake.kind === "Inline") {
    return ` / stake ${credKind(stake.credential)} ${stake.credential.hash}`;
  }
  return ` / stake pointer (${stake.slotNumber}, ${stake.transactionIndex}, ${stake.certificateIndex})`;
}

function formatAda(lovelace: bigint): string {
  // Render as ADA with up to 6 dp, trimming trailing zeros.
  const neg = lovelace < BigInt(0);
  const abs = neg ? -lovelace : lovelace;
  const whole = abs / BigInt(1_000_000);
  const frac = abs % BigInt(1_000_000);
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  const body = fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
  return `${neg ? "-" : ""}${body} ADA`;
}

export function jpgAskToView(datum: JpgAskDatum): DexOrderView {
  const issues = validateJpgAskDatum(datum);
  const total = jpgPayoutsSum(datum);
  // On-chain Buy fee formula: payouts_sum * 50 / 49 / 50 (~2%), paid as a
  // separate output to the marketplace script (NOT included in `payouts`).
  const marketplaceFee = (total * BigInt(50)) / BigInt(49) / BigInt(50);

  const rows: DexRow[] = [
    { label: "Payouts", value: String(datum.payouts.length) },
    { label: "Payouts total", value: formatAda(total) },
    { label: "Marketplace fee (est. ~2%)", value: formatAda(marketplaceFee) },
    { label: "Owner (seller key)", value: datum.owner, hash: true },
  ];
  datum.payouts.forEach((p, i) => {
    rows.push({
      label: `Payout ${i + 1} (${formatAda(p.amountLovelace)} → ${credentialKind(p.address)})`,
      value: `${p.address.paymentCredential.hash}${stakeCredentialSuffix(p.address.stakeCredential)}`,
      hash: true,
    });
  });

  return {
    protocol: "JPG Store v3",
    role: "listing",
    kind: "NFT listing (ask)",
    rows,
    // Listing assets are the NFT(s) held in the UTxO value, not in the datum;
    // nothing asset-identifying lives in the ask datum itself.
    issues,
  };
}

// OffersV2 swap (bid/offer) — a separate v2 validator (different codebase/era
// from the v3 ask). The offered lovelace lives in the UTxO value, not the datum;
// each Payout's ExpectedValue identifies the requested asset / collection-floor
// policy via its CurrencySymbol keys.
export function jpgSwapToView(datum: JpgSwapDatum): DexOrderView {
  const issues = validateJpgSwapDatum(datum);

  const rows: DexRow[] = [
    { label: "Owner (offerer key)", value: datum.owner, hash: true },
    { label: "Payouts", value: String(datum.payouts.length) },
  ];
  datum.payouts.forEach((p, i) => {
    rows.push({
      label: `Payout ${i + 1} (${credentialKind(p.address)})`,
      value: `${p.address.paymentCredential.hash}${stakeCredentialSuffix(p.address.stakeCredential)}`,
      hash: true,
    });
    if (p.expected.length === 0) {
      rows.push({ label: `  expected`, value: "(no expected value)" });
    }
    p.expected.forEach((pol) => {
      // `natCount` (Natural) is the minimum AGGREGATE token count under this
      // policy that must remain after the specific tokens are matched — the
      // collection-floor threshold. It is 0 for plain ADA / exact-token payouts;
      // surface it only when it actually constrains something.
      if (pol.natCount > BigInt(0)) {
        rows.push({
          label: `  min token count (collection floor)`,
          value: pol.natCount.toString(),
        });
      }
      if (pol.tokens.length === 0) {
        // Policy-only / collection-floor match with no named token: show the
        // full policy id (or note ADA when the policy is empty).
        rows.push(
          pol.policyId
            ? { label: `  policy (any token)`, value: pol.policyId, hash: true }
            : { label: `  expected`, value: "(ada, amount unspecified)" },
        );
        return;
      }
      pol.tokens.forEach((t) => {
        if (!pol.policyId && !t.assetName) {
          // Empty policy + empty token name = the ADA (lovelace) the payout must
          // receive. The WholeNumber here is a LOVELACE amount, NOT a token
          // quantity — render it as ADA so it is not mistaken for an NFT count.
          rows.push({
            label: `  must receive`,
            value: `${formatAda(t.quantity)} (${t.quantity.toString()} lovelace)`,
          });
        } else if (t.assetName) {
          // Full (policyId, assetName) pair → structured asset row (decoded
          // name + policy on hover), carrying the requested quantity.
          rows.push({
            label: `  asset`,
            asset: {
              policyId: pol.policyId,
              assetName: t.assetName,
              amount: t.quantity,
            },
          });
        } else {
          // policyId set, empty token name: any token under this policy plus a
          // required quantity (collection-floor with an explicit count).
          rows.push({ label: `  asset (policy, any name)`, value: pol.policyId, hash: true });
          rows.push({ label: `  quantity`, value: t.quantity.toString() });
        }
      });
    });
  });

  return {
    protocol: "JPG Store OffersV2",
    role: "offer",
    kind: "NFT offer / bid (swap)",
    rows,
    issues,
  };
}

registerDexAdapter({
  id: "jpgstore-v3",
  label: "JPG Store v3",
  matchScriptHash: matchJpgStoreScriptHash,
  matchNftPolicy: matchJpgStoreNftPolicy,
  decode: (datum: PD, role: DexRole) =>
    role === "offer"
      ? jpgSwapToView(parseJpgSwapDatum(datum))
      : jpgAskToView(parseJpgAskDatum(datum)),
  classifyRedeemer: (redeemer: PD, role: DexRole) =>
    role === "offer"
      ? classifyJpgSwapRedeemer(redeemer)
      : classifyJpgAskRedeemer(redeemer),
});

export * from "./ask";
export * from "./swap";
export { JPGSTORE } from "./constants";
