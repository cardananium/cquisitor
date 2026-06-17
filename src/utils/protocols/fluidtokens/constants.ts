// FluidTokens Loans V3 (P2P lending) — mainnet match constants.
//
// CRITICAL: every production validator (general_spend, pool, request, loan, plus
// the action withdraw scripts) is PARAMETERIZED by (configNFTPolicyId,
// configNFTAssetName), so the un-applied template hashes are NOT equal to the
// deployed mainnet payment-credential hashes. The real policy ids / script
// hashes live only in the on-chain ConfigDatum reference UTxO.
//
// To populate the value slots below, read the protocol's ConfigDatum from
// mainnet:
//   • poolPolicyId / requestPolicyId / loanPolicyId  → NFT_POLICIES below
//   • poolSpendScriptHash / requestSpendScriptHash / loanSpendScriptHash, and the
//     shared general_spend payment hash → SCRIPT_HASHES below
//
// ARCHITECTURE: one shared `general_spend` address holds Request, Pool and Loan
// UTxOs, so the 28-byte payment hash alone CANNOT distinguish the sub-role. The
// minted NFT policy is what tells them apart — so NFT-policy matching is the
// PRIMARY mechanism here; script-hash matching can only yield the generic "loan"
// role.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

/**
 * Per-sub-role minted NFT policy ids (lowercased hex) from the on-chain
 * ConfigDatum (poolPolicyId / requestPolicyId / loanPolicyId).
 *
 * When a validity/identity NFT also pins a specific asset name, list it under
 * the matching `*AssetName` slot so LP/bond tokens under the same policy do not
 * false-positive.
 */
// Deployed hashes/policies from the on-chain mainnet ConfigDatum (a reference
// UTxO carrying the config NFT "parameters" 706172616d6574657273, held inline as
// the ConfigDatum with every deployed hash/policy).
export const FLUIDTOKENS = {
  configAssetName: "706172616d6574657273" as string, // ascii "parameters"
  configPolicyId: "219832152b2c489358f4c02a1818d312a851b1f55774ae881e33a907" as string,
  // Sub-role minted-NFT policy ids (the authoritative role discriminator).
  requestPolicyId: "a37578f027ae878115cc70cd0909ddc855d67b6dd3bd038a757bd221" as string,
  poolPolicyId: "befbcb19919ff8ce5323d123c835da8e7653a098ad482271a72b72f2" as string,
  loanPolicyId: "30f1095a8a2acb68bb0ffa193e18e004b6dd3e12b5d9c2375a1d5c41" as string,
  // Pinned asset names unknown (per-UTxO suffixes) — match on policy alone.
  requestAssetName: "" as string,
  poolAssetName: "" as string,
  loanAssetName: "" as string,
  // Per-sub-role spend validator payment hashes (ConfigDatum fields 8/9/10).
  generalSpendScriptHash: "" as string,
  requestSpendScriptHash: "dc9003272dbd7fc5d19ce4f0eb3a92bec2c4ffcbd58c8ce4493888bc" as string,
  poolSpendScriptHash: "ad353a777c817f4d9d6c4324930f5c6128400517ec9dae0461e034cd" as string,
  loanSpendScriptHash: "5abbaa2eb177b574707fa3617e3436295d45d7795e0874623a9504da" as string,
} as const;

/**
 * Match a 28-byte payment script hash → role. Returns the generic "loan" role
 * for any known FluidTokens spend hash (the shared general_spend address can
 * hold request/pool/loan UTxOs, so the hash alone cannot refine the sub-role —
 * use `matchFluidTokensNftPolicy` for that).
 *
 * Mainnet only; returns null on other networks (no testnet hashes known).
 * Returns null today because all hash slots are empty (not yet sourced).
 */
export function matchFluidTokensScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  const known = [
    FLUIDTOKENS.generalSpendScriptHash,
    FLUIDTOKENS.requestSpendScriptHash,
    FLUIDTOKENS.poolSpendScriptHash,
    FLUIDTOKENS.loanSpendScriptHash,
  ].filter((h) => h !== "");
  if (known.includes(lower)) return "loan";
  return null;
}

/**
 * Match by the minted identity NFT. This is the PRIMARY matcher: the policy id
 * tells request vs pool vs active-loan apart. When a pinned asset name is known
 * for a policy, the NFT's asset name must also be present in `assetNames`.
 *
 * All matchers report the single implemented role tag "loan" (the protocol-level
 * role). The sub-kind (request/pool/loan) is captured separately by the decoder
 * via the datum field-count / the policy that matched; callers that need the
 * sub-kind can consult `fluidTokensSubRoleForPolicy`.
 *
 * Mainnet only. Returns null today because all policy slots are empty.
 */
export function matchFluidTokensNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  const lowerNames = assetNames.map((n) => n.toLowerCase());

  const hit = (policy: string, pinnedName: string): boolean => {
    if (policy === "" || lower !== policy) return false;
    if (pinnedName === "") return true; // no asset-name gate known
    return lowerNames.includes(pinnedName.toLowerCase());
  };

  if (
    hit(FLUIDTOKENS.requestPolicyId, FLUIDTOKENS.requestAssetName) ||
    hit(FLUIDTOKENS.poolPolicyId, FLUIDTOKENS.poolAssetName) ||
    hit(FLUIDTOKENS.loanPolicyId, FLUIDTOKENS.loanAssetName)
  ) {
    return "loan";
  }
  return null;
}

/** Refine the matched policy id into the request/pool/loan sub-kind, or null. */
export function fluidTokensSubRoleForPolicy(
  policyId: string,
): "request" | "pool" | "loan" | null {
  const lower = policyId.toLowerCase();
  if (FLUIDTOKENS.requestPolicyId !== "" && lower === FLUIDTOKENS.requestPolicyId) return "request";
  if (FLUIDTOKENS.poolPolicyId !== "" && lower === FLUIDTOKENS.poolPolicyId) return "pool";
  if (FLUIDTOKENS.loanPolicyId !== "" && lower === FLUIDTOKENS.loanPolicyId) return "loan";
  return null;
}
