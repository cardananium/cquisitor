// Orcfax oracle mainnet identifiers + match functions.
//
// Orcfax publishes Fact Statement (FS) UTxOs with an inline datum carrying a
// price fact. dApps READ these UTxOs as REFERENCE INPUTS (they never spend
// them), so there is no consumer-side redeemer — this adapter is datum-only.
//
// IMPORTANT (see openQuestions in the spec): the FS (fact-statement) script
// hash that actually holds the feed UTxOs is DYNAMIC — it is stored in the FSP
// (FactStatementPointer) UTxO's inline datum and rotates over time. The only
// stable, documented mainnet anchor is the FSP script hash below. We therefore
// match the FSP script hash directly, and ALSO offer a fallback NFT-policy match
// on the legacy preprod V0 auth-token policy. We deliberately do NOT hard-code a
// single FS script hash (it is not a fixed constant). Match a UTxO by the
// 28-byte PAYMENT credential only.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const ORCFAX = {
  // FactStatementPointer (FSP) script hash — the stable mainnet anchor. Its
  // inline datum is a bare ByteArray = the CURRENT Fact-Statement (FS) validator
  // hash (a pointer), NOT a feed Constr.
  fspScriptHash: "8793893b5dda6a513ba63c80e9d7b2d4f108060c11979bfc7d863ff0",
  // Fact-Statement (FS) validator hash(es) where the price-feed UTxOs actually
  // live. This hash is DYNAMIC — it is the value of the FSP pointer datum and
  // rotates when Orcfax redeploys the FS validator. We list the currently-live
  // hash(es) (e.g. 193ee652… holds V1 feeds such as CER/SNEK-ADA/3). When Orcfax
  // rotates the FS validator, read the new
  // hash from the FSP pointer (role "feed-pointer" surfaces it) and add it here.
  fsValidatorHashes: ["193ee65211bb3b4e0ea5f751f415269355a650e2e3706f625cdf1a4b"] as string[],
  // FACT governance/fee token policy + asset name "orcfaxtoken". This is the
  // governance/fee token, NOT a per-fact-statement identifier — do NOT match on
  // it for feeds. Recorded for reference only.
  factTokenPolicy: "a3931691f5c4e65d01c429e473d0dd24c51afdb6daf88e632a6c1e51",
  factTokenAssetName: "6f7263666178746f6b656e", // "orcfaxtoken"
  // Validator License NFT policy (operator licenses, not feeds). Reference only.
  validatorLicensePolicy: "0c6f22bfabcb055927ca3235eac387945b6017f15223d9365e6e4e43",
  // PREPROD-ONLY legacy V0 auth-token policy. NOT
  // mainnet. We can match preprod feed UTxOs that carry this auth NFT.
  preprodV0AuthPolicy: "104d51dd927761bf5d50d32e1ede4b2cff477d475fe32f4f780a4b21",
} as const;

// Match the stable FSP script hash on mainnet → role "feed".
//
// NOTE: the live FS-statement script hash (where feed UTxOs actually sit) is
// dynamic and resolved at runtime from the FSP datum, so it cannot be a fixed
// constant here. Matching the FSP hash is the documented stable anchor.
export function matchOrcfaxScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  // The FS validator holds the actual feed datums → role "feed".
  if (ORCFAX.fsValidatorHashes.includes(lower)) return "feed";
  // The FSP holds a bare-bytes pointer to the current FS validator → its datum
  // is NOT a feed Constr, so give it a distinct role the decoder renders as a
  // pointer instead of trying (and failing) to parse it as a feed.
  if (lower === ORCFAX.fspScriptHash) return "feed-pointer";
  return null;
}

// Fallback match by a validity/auth NFT carried on a feed output. On preprod the
// legacy V0 feed UTxOs carry the auth-token policy below. We check
// the policy id (asset name is not pinned for that legacy feed, so policy match
// suffices on the preprod-only policy). Returns null on mainnet — mainnet feed
// UTxOs are anchored via the FSP script hash, and the FS-token policy id is
// dynamic (not a fixed constant), so it cannot be matched here.
export function matchOrcfaxNftPolicy(
  policyId: string,
  _assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  const lower = policyId.toLowerCase();
  if ((network === "preprod" || network === "preview") &&
      lower === ORCFAX.preprodV0AuthPolicy) {
    return "feed";
  }
  return null;
}
