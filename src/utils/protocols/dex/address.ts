// Address → 28-byte payment script hash, the single match key every DEX adapter
// uses. CRITICAL: matching must use the PAYMENT script hash ONLY, never the full
// bech32 address — protocols like Splash, SaturnSwap, Lenfi, Optim and Minswap
// bake a *varying* stake/delegation credential into their order addresses, so
// the same order contract appears under many different bech32 strings that all
// share one payment credential.

import { readDecodedAddress, requestAddress } from "@/lib/decodedAddresses";
import type { Credential } from "@/utils/addressTypes";

/**
 * The payment credential of an already-decoded address, or null when the
 * address has no decode yet.
 *
 * Detection runs inside a render, so it cannot wait for one. The passes that
 * produce the addresses — the transaction decode, the UTxO resolver — prime
 * them first, so the answer is normally here already. Asking for a miss is
 * what makes a detector that ran too early correct rather than merely quiet:
 * the decode lands, the store's version changes, and the memo that produced
 * this null runs again.
 */
function paymentCredOf(addressBech32: string): Credential | null {
  const decoded = readDecodedAddress(addressBech32);
  if (decoded === undefined) {
    requestAddress(addressBech32);
    return null;
  }
  return decoded?.details.payment_cred ?? null;
}

/**
 * The hex (lowercased) payment script hash of a bech32/hex address, or null if
 * the payment credential is a key hash (or the address can't be decoded).
 */
export function getPaymentScriptHash(addressBech32: string): string | null {
  const cred = paymentCredOf(addressBech32);
  if (cred?.type === "ScriptHash") {
    return cred.credential.toLowerCase();
  }
  return null;
}

/**
 * Sort key mirroring reward-account BYTE order for the withdrawals of one tx.
 * The script context sorts withdrawals by raw reward-account bytes: header
 * first (0xe_ key credential < 0xf_ script credential; the network bits are
 * identical within a tx), then the 28-byte credential. Undecodable addresses
 * fall back to the input string itself.
 */
export function rewardAccountSortKey(addressBech32: string): string {
  const cred = paymentCredOf(addressBech32);
  if (cred?.credential) {
    return (cred.type === "ScriptHash" ? "1" : "0") + cred.credential.toLowerCase();
  }
  return addressBech32;
}

/** Lowercased policy ids of every native asset held in an output's value. */
export function outputAssetPolicyIds(
  multiasset: Record<string, Record<string, string>> | null | undefined,
): string[] {
  if (!multiasset) return [];
  return Object.keys(multiasset).map((p) => p.toLowerCase());
}
