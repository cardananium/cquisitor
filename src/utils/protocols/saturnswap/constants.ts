// Known SaturnSwap mainnet script hashes.
//
// SaturnSwap is a batcherless order-book DEX: a maker locks an order UTxO at the
// saturn_swap validator and a taker tx directly spends it with a Fill redeemer
// (or the maker cancels). Plutus V2. Match a UTxO by its 28-byte PAYMENT
// credential only — order addresses share a payment hash across many different
// staking parts (the protocol stake credential is appended to the spend
// address).

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const SATURNSWAP = {
  // saturn_swap order/escrow validator (plutusV2, size 5003).
  orderHash: "1af84a9e697e1e7b042a0a06f061e88182feb9e9ada950b36a916bd5",
  // saturn_liquidity pool validator (plutusV2, size 5644). Partial-fill outputs
  // are also created here, and a pool-owned order's owner Address payment cred
  // references this hash.
  liquidityHash: "bec4575e6b77dfd0f60ccf510b0aa3dfc8ef69faa9774928130a849c",
  // Project stake credential observed on the full spend address.
  stakeCred: "5ea481523030b23a495286ca1a18bd141a493e9b5a19d889953f6cdb",
} as const;

export function matchSaturnSwapScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (hash.toLowerCase() === SATURNSWAP.orderHash) return "order";
  return null;
}
