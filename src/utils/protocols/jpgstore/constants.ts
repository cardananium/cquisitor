// Known JPG Store / Wayup (Anvil) v3 mainnet script hashes.
//
// JPG Store is an NFT marketplace, NOT a DEX. The v3 contracts (Plutus V2) have
// exactly ONE validator: `ask.spend` (asset-for-ADA listings). Match a listing
// UTxO by its 28-byte PAYMENT credential only.
//
// Hash roles:
//   - askListingHash:  the "ask.spend" validator hash.
//   - marketplaceFeeHash: marketplace_sh — the script that RECEIVES the ~2% fee
//     output on Buy. This is NOT the listing UTxO itself; it is only a
//     corroborating signal that a tx is a JPG buy.
//
// The v3 contracts have NO bid/offer validator (only `ask`). The live
// ADA-for-asset bid/offer mechanism is the SEPARATE "OffersV2" `swap` validator
// (PlutusV2): a single combined validator handling both directions. It is matched
// below by its mainnet payment script hash and labeled role "offer" to keep it
// distinct from the v3 ask "listing".

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const JPGSTORE = {
  // ask.spend — the asset-for-ADA listing validator (the actual listing UTxO).
  askListingHash: "c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65",
  // marketplace_sh — receives the ~2% fee output on Buy (corroborating only).
  marketplaceFeeHash: "84cc25ea4c29951d40b443b95bbc5676bc425470f96376d1984af9ab",
  // marketplace_stake_sh — stake cred of the fee output.
  marketplaceStakeHash: "2c967f4bd28944b06462e13c5e3f5d5fa6e03f8567569438cd833e6d",
  // OffersV2 `swap` — the v2 combined bid/offer escrow validator (PlutusV2,
  // header 0x71 enterprise script).
  // Address: addr1wxgx3far7qygq0k6epa0zcvcvrevmn0ypsnfsue94nsn3tgdf3chh.
  offersV2SwapHash: "9068a7a3f008803edac87af1619860f2cdcde40c26987325ace138ad",
} as const;

export function matchJpgStoreScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === JPGSTORE.askListingHash) return "listing";
  if (lower === JPGSTORE.offersV2SwapHash) return "offer";
  return null;
}

// JPG listings are not identified by a validity NFT — they are matched purely by
// the ask script payment credential. This stub is provided for API parity with
// other adapters and always returns null (no known JPG validity-NFT policy).
export function matchJpgStoreNftPolicy(
  _policyId: string,
  _assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  return null;
}
