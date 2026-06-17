// Genius Yield V1 (PartialOrder) mainnet match constants.
//
// The GY partial-order VALIDATOR is parameterized by [configAddr, AssetClass],
// so it has NO single stable payment script hash to match on. Orders are instead
// identified by holding a token of the V1 PartialOrderNFT minting policy. The
// per-order NFT token name equals the datum's `podNFT` field (index 7).
//
// POLICY — the order NFT minting policy is NOT the PartialOrderConfig (PORef)
// NFT policy:
//   - fae686ea…0af2 is the V1 CONFIG/PORef NFT policy. Its only holders are the
//     two config UTxOs (8- and 12-field `PartialOrderConfigDatum`), NOT orders.
//   - The real V1 order NFT policy is the config datum's `pocdNftSymbol`
//     (field index 2): 22f6999d…f585. Its holders sit at the V1 partial-order
//     validator and carry the exact 15-field `PartialOrderDatum` this module
//     decodes.
//
// V1.1: GY also runs a V1.1 family whose order NFT policy is the 12-field
// config's `pocdNftSymbol` 55c9ddbe…b8be. Its live orders use a DIFFERENT,
// larger 12-field datum layout (offered/asked carried as (AssetClass, Int)
// pairs, price/extra packed under a Constr1 record) that this V1 parser does
// NOT decode, so V1.1 is deliberately NOT matched here — see blockers.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const GENIUS_YIELD_V1 = {
  // V1 PartialOrderNFT minting policy id — the config datum's `pocdNftSymbol`,
  // which identifies 15-field PartialOrder UTxOs.
  nftPolicyV1: "22f6999d4effc0ade05f6e1a70b702c65d6b3cdf0e301e4a8267f585",
} as const;

export const GENIUS_YIELD_V1_1 = {
  // V1.1 PartialOrderNFT minting policy id (the V1.1 config datum's
  // `pocdNftSymbol`), which identifies the 12-field V1.1 PartialOrder UTxOs
  // decoded by parsePartialOrderV11Datum. The per-order NFT token name equals
  // the datum's `nft` (field index 2).
  nftPolicyV11: "55c9ddbea5ebe40eb41b880a2c047227417c14ec1b8d81ad70afb8be",
} as const;

/** Role tag emitted for matched V1.1 orders. */
export const GENIUS_YIELD_V1_1_ROLE = "v1_1-order";

// The order validator is parameterized, so there is no stable payment script
// hash to match on. Always returns null; matching happens via matchNftPolicy.
export function matchGeniusYieldScriptHash(): DexRole | null {
  return null;
}

// Identify an order UTxO by the V1 PartialOrderNFT policy. The per-order NFT
// token name equals the datum's `podNFT`, so when the caller knows the expected
// order NFT name it can be checked; policy-id match alone is generally
// sufficient since this policy only ever appears on order UTxOs. `assetNames`
// are the (lowercased hex) asset names the output holds under `policyId`.
export function matchGeniusYieldNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
  expectedOrderNft?: string,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (policyId.toLowerCase() !== GENIUS_YIELD_V1.nftPolicyV1) return null;
  // When the datum's podNFT is known, require the held token name to match it.
  if (expectedOrderNft != null) {
    return assetNames.includes(expectedOrderNft.toLowerCase()) ? "order" : null;
  }
  return "order";
}

// Identify a V1.1 order UTxO by the V1.1 PartialOrderNFT policy 55c9ddbe…b8be.
// The per-order NFT token name equals the datum's `nft` (29-byte hex), so when
// the caller knows the expected order NFT name it can be checked; policy-id
// match alone is sufficient otherwise since this policy only appears on V1.1
// order UTxOs. `assetNames` are the (lowercased hex) names held under `policyId`.
export function matchGeniusYieldV11NftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
  expectedOrderNft?: string,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (policyId.toLowerCase() !== GENIUS_YIELD_V1_1.nftPolicyV11) return null;
  if (expectedOrderNft != null) {
    return assetNames.includes(expectedOrderNft.toLowerCase()) ? GENIUS_YIELD_V1_1_ROLE : null;
  }
  return GENIUS_YIELD_V1_1_ROLE;
}
