/**
 * Types for decoded Cardano addresses from cquisitor-lib
 */

export interface Credential {
  type: "KeyHash" | "ScriptHash";
  credential: string;
}

export interface StakePointer {
  slot: string;
  transaction_index: string;
  cert_index: string;
}

export interface AddressDetails {
  address_bech32?: string;
  address_base58?: string;
  network_id?: number;
  payment_cred?: Credential;
  staking_cred?: Credential;
  stake_pointer?: StakePointer;
  type?: string;
  derivation_path?: string;
}

export type AddressType = "Base" | "Enterprise" | "Reward" | "Pointer" | "Byron" | "Malformed";

export interface DecodedAddress {
  address_type: AddressType;
  details: AddressDetails;
}

/**
 * The credential that governs staking for a decoded address.
 *
 * A reward address holds one credential, and the decoder reports it as
 * `payment_cred`; only an address carrying both parts fills `staking_cred`.
 * Reading `staking_cred` alone therefore misses the whole reward-address case.
 */
export function stakeCredentialOf(decoded: DecodedAddress | null | undefined): Credential | null {
  if (!decoded) return null;
  if (decoded.address_type === "Reward") return decoded.details.payment_cred ?? null;
  return decoded.details.staking_cred ?? null;
}

