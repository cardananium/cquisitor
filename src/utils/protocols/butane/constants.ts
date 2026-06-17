// Butane Synthetics — known mainnet APPLIED script hashes + the synth mint policy.
//
// The CDP
// (vault) UTxO sits at the `pointers.spend` payment credential with stake cred =
// the `pointers.mint` synth policy.
//
// IMPORTANT: the `pointers.spend` payment script is SHARED across six MonoDatum
// UTxO kinds (params/cdp/gov/treasury/compat/staked) — matching the script hash
// alone tags the UTxO as a Butane state UTxO; the decoder MUST then discriminate
// the actual vault/CDP by MonoDatum Constr 1 (see butane.ts / index.ts).
//
// The `synthetics.validate` (40628e11…) hash is NOT an address credential — it is
// the withdraw-zero business-logic stake/mint validator carrying the real CDP
// `PolicyRedeemer` in the tx WithdrawFrom. We expose it for completeness.
//
// No testnet hashes are known → return null for non-mainnet networks.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const BUTANE = {
  // pointers.spend — payment credential of every Butane state UTxO (incl. CDP).
  pointersSpendHash: "6a67658782f20360cc4cdf5a808ab9363bbeaeb2f8773d27a2b514eb",
  // leftovers.collect — post-liquidation/redemption claim script (LeftoversDatum).
  leftoversCollectHash: "a1825847a0dc1a03afa3e9426c447f34668c6fb71a65cb6f6a88d933",
  // synthetics.validate — withdraw-zero CDP business-logic validator (NOT an
  // address credential). Stake cred key for the PolicyRedeemer withdrawal.
  syntheticsValidateHash: "40628e112b44bfc78858150a1ce9549caa4bfc0169762402004f5719",
  // pointers.mint — vanity-mined synth mint policy. Stake cred on every CDP UTxO
  // and the policy minting USDb/USDs/MIDAS + the empty-name CDP lock token.
  pointersMintPolicy: "00000000000410c2d9e01e8ec78ab1dc6bbc383fae76cbe2689beb02",
} as const;

export function matchButaneScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  // pointers.spend is the payment cred of all six MonoDatum UTxO kinds; tag it
  // "vault" here, then discriminate the actual CDP by MonoDatum Constr 1 in the
  // decoder. params/gov/treasury/compat/staked share this hash.
  if (lower === BUTANE.pointersSpendHash) return "vault";
  if (lower === BUTANE.leftoversCollectHash) return "leftovers";
  return null;
}

// The synth mint policy also pins a Butane CDP (it is the stake cred on every CDP
// UTxO). Synth asset names (USDb/USDs/MIDAS) are not pinned in source constants —
// any token under this policy (incl. the empty-name CDP lock token) is Butane, so
// we match on the policy alone here.
export function matchButaneNftPolicy(
  policyId: string,
  _assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (policyId.toLowerCase() === BUTANE.pointersMintPolicy) return "vault";
  return null;
}
