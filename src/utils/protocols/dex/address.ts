// Address → 28-byte payment script hash, the single match key every DEX adapter
// uses. CRITICAL: matching must use the PAYMENT script hash ONLY, never the full
// bech32 address — protocols like Splash, SaturnSwap, Lenfi, Optim and Minswap
// bake a *varying* stake/delegation credential into their order addresses, so
// the same order contract appears under many different bech32 strings that all
// share one payment credential.

import { decode_specific_type } from "@cardananium/cquisitor-lib";

interface DecodedAddress {
  address_type?: string;
  details?: { payment_cred?: { type: string; credential: string } };
}

/**
 * The hex (lowercased) payment script hash of a bech32/hex address, or null if
 * the payment credential is a key hash (or the address can't be decoded).
 */
export function getPaymentScriptHash(addressBech32: string): string | null {
  try {
    const decoded = decode_specific_type(addressBech32, "Address", {}) as DecodedAddress;
    if (decoded?.details?.payment_cred?.type === "ScriptHash") {
      return decoded.details.payment_cred.credential.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

/** Lowercased policy ids of every native asset held in an output's value. */
export function outputAssetPolicyIds(
  multiasset: Record<string, Record<string, string>> | null | undefined,
): string[] {
  if (!multiasset) return [];
  return Object.keys(multiasset).map((p) => p.toLowerCase());
}
