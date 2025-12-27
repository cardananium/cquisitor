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

