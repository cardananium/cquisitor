// Levvy (Levvy Finance) mainnet P2P NFT/token lending validator.
//
// Single spending validator (PlutusV2), mainnet payment script hash
// `08c81fc9b97a09be991c64ea53dc5824af3eb7dadb48b72bb6871c5e`. The script is
// published under many addresses that share this 28-byte PAYMENT-script
// credential but differ by stake credential (each lender's own stake key is
// baked into the script address). Identify Levvy UTxOs by the PAYMENT script
// hash only, never by full address.
//
// The role (offer vs loan) is NOT carried in the script hash — every Levvy UTxO
// is the same validator. We report the generic role "loan" from the hash match
// and let `decode(datum, role)` refine it from the datum's top constructor
// (0 = offer, 1 = active loan, 2 = settlement).

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const LEVVY = {
  // PlutusV2 spending validator.
  validatorHash: "08c81fc9b97a09be991c64ea53dc5824af3eb7dadb48b72bb6871c5e",
  // Platform fee + $SOCIETY "passport" discount metadata (helper_10).
  feePolicyId: "ea3bd93994f9ad85d33efd941df28efb5892bad33c1b61c227fdf2c9",
  feeRecipient: "7538357a3717e7746b4c79bac7dcc538567615ee3247e40f44ea83bd",
} as const;

export function matchLevvyScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  // The validator serves both offers and loans; the concrete role is recovered
  // from the inline datum's top constructor in `decode`.
  if (hash.toLowerCase() === LEVVY.validatorHash) return "loan";
  return null;
}
