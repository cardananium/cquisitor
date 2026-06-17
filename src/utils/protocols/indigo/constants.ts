// Indigo Protocol (CDP / iAsset synthetics) mainnet match constants.
//
// The two roles live at DIFFERENT script addresses:
//   - CDP positions ("cdp") live at the CDP spending validator and carry the
//     cdpAuthToken NFT ("CDP" / 434450).
//   - IAsset config UTxOs ("iasset") live at a SEPARATE iAsset validator and
//     carry the iAssetAuthToken NFT ("IASSET" / 494153534554).
// BOTH datums are wrapped in a top-level Constr 0 on chain, so the role CANNOT
// be derived from the top-level constructor — it is taken from the matched
// script hash / NFT policy and passed to the decoder as the `role` hint.
//
// The script-hash fields are the 28-byte payment hashes of the addresses
// holding the auth-token NFTs. Mainnet only — return null for any other network.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const INDIGO = {
  // CDP spending validator (payment hash of addr1w8lsky9l7g8yk…) — CDP positions.
  cdpHash: "ff0b10bff20e4b68b491492e5ba6c8048a704763b0a45ce2995da0be",
  // iAsset config validator (payment hash of addr1wx5uvyaq…) — IAsset config UTxOs.
  iAssetHash: "a9c613a0e6f6bef5a4f6b1d15f8bdd5b1105fede0a3c380d1a920028",
  // cdpAuthToken policy, tokenName "CDP" (hex "434450") — authentic CDP positions.
  cdpAuthTokenPolicy: "708f5e6d597fc038d09a738d7be32edd6ea779d6feb32a53668d9050",
  cdpAuthTokenName: "434450", // "CDP"
  // iAssetAuthToken policy, tokenName "IASSET" (hex "494153534554") — IAsset config.
  iAssetAuthTokenPolicy: "97da12de04a6b527cc3b3469c5e5485cf258dfd1021f12e728f2e714",
  iAssetAuthTokenName: "494153534554", // "IASSET"
  // The single minting policy under which ALL iAssets (iUSD/iBTC/iETH/...) are
  // minted/burned. Useful to detect debt mint/burn inside a CDP tx.
  cdpAssetSymbol: "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880",
} as const;

export function matchIndigoScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === INDIGO.cdpHash) return "cdp";
  if (lower === INDIGO.iAssetHash) return "iasset";
  return null;
}

// Refine the role by the auth-token NFT the UTxO carries (when one is present).
// cdpAuthToken("CDP") → "cdp"; iAssetAuthToken("IASSET") → "iasset".
export function matchIndigoNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  const names = assetNames.map((n) => n.toLowerCase());
  if (lower === INDIGO.cdpAuthTokenPolicy && names.includes(INDIGO.cdpAuthTokenName)) {
    return "cdp";
  }
  if (lower === INDIGO.iAssetAuthTokenPolicy && names.includes(INDIGO.iAssetAuthTokenName)) {
    return "iasset";
  }
  return null;
}
