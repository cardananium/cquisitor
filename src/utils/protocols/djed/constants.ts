// Djed (COTI/IOG) algorithmic stablecoin — mainnet identifiers + match functions.
//
// Djed/Shen is a state-machine bank: a single "reserve" UTxO holds all ADA
// collateral, the DjedStableCoinNFT thread token (supply 1), and the entire
// un-minted DJED + SHEN supply. Mint/burn of DJED (stablecoin) and SHEN
// (reservecoin) happens by spending + recreating this reserve UTxO with an
// updated datum. PlutusV2, datum is provided BY HASH (not inline) — a TS caller
// must resolve the datum witness rather than read an inline_datum.
//
// We identify a reserve UTxO either by the 28-byte PAYMENT script hash of the
// reserve validator, OR by the value holding the DjedStableCoinNFT thread token
// (policy + the specific NFT asset name, qty 1). Matching the DJED/SHEN policy
// alone is NOT sufficient — that same policy also mints the circulating
// DjedMicroUSD / ShenMicroUSD tokens — so we require the NFT asset name.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const DJED = {
  // Reserve validator script hash (PlutusV2). Address
  // addr1z8mcpc26j64fmhhd6sv5qj5mk9xqnfxgm6k8zmk7h2rlu4qm5kjdmrpmng059yellupyvwgay2v0lz6663swmds7hp0qhxg9gt
  reserveScriptHash: "f780e15a96aa9ddeedd419404a9bb14c09a4c8deac716edeba87fe54",
  // DJED/SHEN minting policy id (also field [7] of the reserve datum).
  mintingPolicyId: "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61",
  // Asset names (lowercased hex) minted under the policy above.
  threadNftAssetName: "446a6564537461626c65436f696e4e4654", // "DjedStableCoinNFT", supply 1
  djedAssetName: "446a65644d6963726f555344", // "DjedMicroUSD" (stablecoin), 6 decimals
  shenAssetName: "5368656e4d6963726f555344", // "ShenMicroUSD" (reservecoin), 6 decimals
} as const;

// Match the reserve validator's 28-byte payment script hash on mainnet.
export function matchDjedScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (hash.toLowerCase() === DJED.reserveScriptHash) return "reserve";
  return null;
}

// Identify a reserve UTxO by the DjedStableCoinNFT thread token: the DJED/SHEN
// minting policy PLUS the specific thread-NFT asset name. We require the asset
// name because the same policy also mints the circulating DJED/SHEN tokens, so a
// policy-only match would false-positive on any wallet holding DjedMicroUSD or
// ShenMicroUSD. `assetNames` are the (lowercased hex) names held under
// `policyId` in the output.
export function matchDjedNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (policyId.toLowerCase() !== DJED.mintingPolicyId) return null;
  const names = assetNames.map((n) => n.toLowerCase());
  if (names.includes(DJED.threadNftAssetName)) return "reserve";
  return null;
}
