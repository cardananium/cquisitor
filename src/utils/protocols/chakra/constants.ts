// Known Chakra mainnet script hash + pool-NFT policy.
//
// Chakra (chakra-ai.io) is a Cardano bonding-curve token launchpad / DEX —
// the "AI agent token" sister protocol to Indigo. It is integrated with
// DexHunter under the dex id `CHAKRA` (swap-only: no limit orders, no DCA).
//
// Topology (verified on mainnet, June 2026):
//  - ALL pools and swap-order requests sit at ONE shared spending validator
//    (plutusV3, size 8510) at address addr1z9ynss2drkl... whose 28-byte PAYMENT
//    script hash is `4938414d1dbe0a7e46867cfc05ee9b9149dc18b6952c8bc76e760341`.
//    The script's stake part (e77891c98bdf5a3a849d4b61c6e6f50da4ed8dffd6871caf50611ac1)
//    is baked into the validator as a compile-time parameter. Match by the
//    PAYMENT credential only.
//  - That same script hash is ALSO the policy id of the per-pool POOL NFT it
//    mints (datum field[0] = AssetClass(scriptHash, name)); so the pool-NFT
//    policy id == the spend script hash. matchNftPolicy keys off it too.
//  - Each launched token is a SEPARATE per-token CIP-68 validator whose own
//    hash equals that token's policy id — those are NOT Chakra-protocol UTxOs
//    and are intentionally NOT matched here (they would be indistinguishable
//    from any other CIP-68 reference-token script).

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const CHAKRA = {
  // Shared Chakra pool/order spending validator (plutusV3, size 8510). This
  // hash is BOTH the payment credential of every pool/order UTxO AND the
  // minting policy of the per-pool POOL NFT.
  scriptHash: "4938414d1dbe0a7e46867cfc05ee9b9149dc18b6952c8bc76e760341",
  // Validator stake credential, applied as a compile-time param (the addr1z
  // stake part). Surfaced for reference; not used for matching.
  stakeCred: "e77891c98bdf5a3a849d4b61c6e6f50da4ed8dffd6871caf50611ac1",
  // Operator / batcher signatory baked into datum field[11], constant across
  // every observed pool. Surfaced as a labelled row, never used for matching.
  operatorKey: "85a56d4d82f3accc44e2c2f95e6b15e934d3fd556a68d12152f06890",
} as const;

export function matchChakraScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (hash.toLowerCase() === CHAKRA.scriptHash) return "pool";
  return null;
}

// The pool NFT is minted UNDER the script hash itself. An output whose minted
// policy is the Chakra script hash is a Chakra pool. (matchScriptHash already
// catches the spend-side; this covers a producing tx that only carries the NFT
// policy.)
export function matchChakraNftPolicy(
  policyId: string,
  _assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (policyId.toLowerCase() === CHAKRA.scriptHash) return "pool";
  return null;
}
