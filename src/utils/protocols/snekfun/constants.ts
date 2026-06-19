// Known SnekFun mainnet curve validator + curve/pool NFT policy.
//
// SnekFun (snek.fun) is a bonding-curve memecoin launchpad. A creator launches
// a token into a single bonding-curve UTxO held at ONE shared curve validator;
// buyers/sellers spend that UTxO directly (no batcher) to trade the launched
// token against ADA along a cubic bonding curve. Once a curve reaches its
// graduation target (~42,069 ADA market cap) it graduates to a Splash pool —
// that pool is decoded by the SEPARATE Splash adapter (Splash's own validator
// hash d9143ac6…), NOT here. This module decodes ONLY the pre-graduation curve.
//
// Topology (verified on mainnet, June 2026):
//  - Every curve UTxO sits at the shared curve validator (plutusV2, size 2000)
//    whose 28-byte PAYMENT script hash is
//    `905ab869961b094f1b8197278cfe15b45cbe49fa8f32c6b014f85a2d`.
//    Match by the PAYMENT credential only. 1000+ datum-bearing live UTxOs.
//  - Each curve UTxO carries a unique curve/pool NFT (qty 1) minted under a
//    SEPARATE policy `63f947b8d9535bc4e4ce6919e3dc056547e8d30ada12f29aa5f826b8`
//    (plutusV2, size 575); the NFT's AssetClass is stored in datum field[0].
//    A producing tx that only carries that NFT policy is matched too.
//
// Both hashes were checked collision-free across src/utils/protocols/ and
// confirmed live on Koios (plutusV2 validators with datum-bearing UTxOs). The
// Splash graduation-pool hash d9143ac6 is intentionally NOT referenced here.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const SNEKFUN = {
  // Shared bonding-curve spending validator (plutusV2, size 2000).
  curveHash: "905ab869961b094f1b8197278cfe15b45cbe49fa8f32c6b014f85a2d",
  // Curve / pool NFT minting policy (plutusV2, size 575). One NFT (qty 1) per
  // curve UTxO; its AssetClass is datum field[0].
  curveNftPolicy: "63f947b8d9535bc4e4ce6919e3dc056547e8d30ada12f29aa5f826b8",
  // The "trade" withdrawal-validator credential observed in datum field[7],
  // constant across every launched token (protocol-level router). Surfaced for
  // reference; not used for matching.
  tradeWithdrawal: "8807fbe6e36b1c35ad6f36f0993e2fc67ab6f2db06041cfa3a53c04a",
} as const;

export function matchSnekFunScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (hash.toLowerCase() === SNEKFUN.curveHash) return "curve";
  return null;
}

// The curve NFT (qty 1) is minted under a dedicated policy. An output whose
// value carries that policy is a SnekFun curve UTxO. (matchScriptHash already
// catches the spend-side; this covers a producing tx that carries the NFT.)
export function matchSnekFunNftPolicy(
  policyId: string,
  _assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (policyId.toLowerCase() === SNEKFUN.curveNftPolicy) return "curve";
  return null;
}
