// Known CSWAP DEX (cswap.fi) mainnet script hashes.
//
// CSWAP is an AMM / order-book hybrid DEX. Two distinct PlutusV3 validators hold
// the protocol's datum-bearing UTxOs:
//   - the order-book validator: a maker locks an order UTxO carrying the assets
//     it gives + a list of the assets it wants to receive; a fill/cancel spend
//     consumes it directly.
//   - the AMM pool validator: each constant-product pool sits here, its datum
//     naming the two reserve assets + the pool/LP token policy.
//
// Source of the hashes: CSWAP's OWN DefiLlama TVL adapter
// (projects/cswap-dex/index.js, github.com/cswapsystems/DefiLlama-Adapters),
// which hard-codes the protocol's three script addresses:
//   DEX_POOL_ADDR      addr1z8ke0c9…  -> payment script ed97e0a1…7f6f
//   DEX_ORDERBOOK_ADDR addr1z8d9k3a…  -> payment script da5b47ae…6d4e
//   STAKING_ADDR       addr1zydjdnz…  -> payment script 1b26cc41…7a6b
// (All three are type-1 "addr1z" addresses: a script payment credential + a
// script stake credential. We match on the 28-byte PAYMENT credential only.)
//
// Verified live on mainnet via Koios script_info (all plutusV3, bytes present)
// and credential_utxos (real inline-datum UTxOs at both order + pool).

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const CSWAP = {
  // AMM constant-product pool validator (plutusV3, size 2618). Datum names both
  // reserve assets + the pool/LP token policy.
  poolHash: "ed97e0a1394724bb7cb94f20acf627abc253694c92b88bf8fb4b7f6f",
  // Order-book order/escrow validator (plutusV3, size 1534). Maker locks the
  // given assets + a "wanted" value list; a fill or owner-cancel spends it.
  orderHash: "da5b47aed3955c9132ee087796fa3b58a1ba6173fa31a7bc29e56d4e",
  // Staking-rewards validator (plutusV3, size 3676). Not a DEX order/pool — kept
  // here for provenance only; intentionally NOT matched as a DEX role.
  stakingHash: "1b26cc41dcd8530a4ba9ae584922b5957c365583a25eda8770597a6b",
  // Script stake credential shared by the pool address (addr1z8ke0c9…).
  poolStakeCred: "f1feff38edd67922285e28845a207ddd28e4219baeb3b75e35c5e9af",
  // Script stake credential shared by the order-book address (addr1z8d9k3a…).
  orderStakeCred: "ec39fae09e0835b546eac323f7d1c46d7b7f64fe42f359aae7912b13",
  // The $CSWAP governance/utility token (policy + asset name "CSWAP").
  cswapTokenPolicy: "c863ceaa796d5429b526c336ab45016abd636859f331758e67204e5c",
  cswapTokenName: "4353574150",
} as const;

export function matchCswapScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const h = hash.toLowerCase();
  if (h === CSWAP.orderHash) return "order";
  if (h === CSWAP.poolHash) return "pool";
  return null;
}
