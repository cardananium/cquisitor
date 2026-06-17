// Known MuesliSwap mainnet PAYMENT script hashes + pool-NFT policy.
//
// MuesliSwap is a HYBRID DEX with two independent on-chain surfaces:
//   - ORDER-BOOK (Plutus V1): the order/escrow validator. Two committed
//     versions share the same address family — v1.1 (current) and v1 (legacy).
//   - AMM (Plutus V2): a ConstantProductPool validator + a BatchOrder
//     liquidity-deposit/withdraw escrow validator.
//
// Every hash below is the 28-byte PAYMENT credential, bech32-decoded from the
// committed `.addr` files in muesliswap-cardano-contracts /
// muesliswap-cardano-pool-contracts. Match a UTxO by the payment hash only,
// never the full bech32 (pool addresses ship with and without a stake part but
// agree on the payment hash).

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const MUESLISWAP = {
  // SURFACE A — order-book order/escrow validators (Plutus V1).
  orderBookV11Hash: "15b95fdaceeb507073a1bd198803373beeafbd82560fbf8abe9073ff",
  orderBookV1Hash: "ea184d0a7e640c4b5daa3f2cef851e75477729c2fd89f6ffbed7874c",
  // SURFACE A2 — order-book V2 PRODUCTION order/escrow validator (Plutus V2,
  // LIVE). Carries the richer 8-field Order datum (parseMuesliOrderBookV2Datum).
  orderBookV2Hash: "00fb107bfbd51b3a5638867d3688e986ba38ff34fb738f5bd42b20d5",
  // Matchmaker LICENSE NFT minting policy (v2.2). A matchmaker proves its right
  // to match V2 orders by carrying a token under this policy.
  orderBookV2LicensePolicy: "5817c34e5702473304f3cf676299176d3824e55b8c0bfa94830429fd",
  // SURFACE B — AMM ConstantProductPool validator (Plutus V2).
  poolHash: "7045237d1eb0199c84dffe58fe6df7dc5d255eb4d418e4146d5721f8",
  // SURFACE B — AMM BatchOrder liquidity-order escrow validator (Plutus V2).
  batchOrderHash: "73ede893f547edbd25da6953fda33caacd01f44047922bf7c5ceb951",
  // Pool-identifying NFT minting policy (ConstantProductPoolNFT). Each pool
  // UTxO holds a unique NFT under this policy; the NFT TokenName links a
  // batch-order (odPoolNftTokenName) to its pool.
  poolNftPolicy: "909133088303c49f3a30f1cc8ed553a73857a29779f6c6561cd8093f",
  // Factory / script-version token name "MuesliSwap_AMM".
  scriptVersionHex: "4d7565736c69537761705f414d4d",
} as const;

export function matchMuesliSwapScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === MUESLISWAP.orderBookV11Hash || lower === MUESLISWAP.orderBookV1Hash) {
    return "order";
  }
  // The production V2 order-book carries a distinct richer datum shape; give it
  // its own role so `decode` dispatches to the V2 parser/view.
  if (lower === MUESLISWAP.orderBookV2Hash) return "orderbook-v2-order";
  if (lower === MUESLISWAP.poolHash) return "pool";
  // The AMM batch-order escrow also belongs to the "pool" surface — it carries
  // the liquidity OrderDatum (B3) tied to a pool NFT.
  if (lower === MUESLISWAP.batchOrderHash) return "pool";
  return null;
}

// Pool UTxOs hold a unique NFT under the ConstantProductPoolNFT policy. Unlike
// some DEXes there is no fixed validity asset name (each pool gets its own
// name), so matching the policy alone is the best secondary identifier. Any
// asset under this policy on a UTxO marks the AMM pool surface.
export function matchMuesliSwapNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (policyId.toLowerCase() === MUESLISWAP.poolNftPolicy && assetNames.length > 0) {
    return "pool";
  }
  return null;
}
