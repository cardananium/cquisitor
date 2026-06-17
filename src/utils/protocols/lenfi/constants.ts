// Lenfi (Aada Finance V2) mainnet script hashes + match functions.
//
// Each deployed validator entry carries the reference-script address (addr1w…
// enterprise script address whose 28-byte payment credential == the validator's
// own script hash) and the reference-script UTxO.
//   - pool validator hash 32e8c0ae… is the pool-NFT mint policy; its policy
//     asset list resolves to active pool NFTs, each held at addr1x… (payment
//     script 32e8c0ae… + a per-pool stake credential) carrying the pool datum.
//   - collateral validator hash 8021830a… is the borrower-NFT mint policy; the
//     collateral UTxO is held at addr1x… (payment script 8021830a…) carrying
//     the CollateralDatum.
//
// Match a UTxO by its 28-byte PAYMENT credential only — the pool/collateral
// full addresses also carry a per-position script STAKE credential, but the
// payment hash alone is sufficient and stake-agnostic.
//
// Both the pool validator and the collateral validator are ALSO their own NFT
// mint policies (pool NFT policy == pool script hash; borrower-NFT policy ==
// collateral script hash). The pool NFT and the loan UTxO therefore share the
// same 28-byte hash as their respective script, so matching the payment hash is
// the primary path; matchNftPolicy is provided for the validity-NFT case.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const LENFI_V2 = {
  // poolValidator — pool UTxO payment cred AND pool-NFT mint policy.
  poolHash: "32e8c0ae314ef4be452c16a999867f66d1a1791fc972cb2f7c74e38d",
  // collateralValidator — loan/collateral UTxO payment cred AND borrower-NFT
  // mint policy.
  collateralHash: "8021830afedd85fda1253da2be75b66c0e65c482148eb8ca690903cb",
  // leftoverValidator — liquidation/leftovers script holding LeftoversDatum.
  // Secondary loan-lifecycle address.
  leftoverHash: "9b99fef5ee9a6b170a418999e89edad93bbf55bf1feef57b6053d634",
  // order_contract_* — one validator per request kind.
  orderBorrowHash: "70512aa152ef4ccff4a5f6f01531613edc448af259ddf6727d3d24ea",
  orderDepositHash: "a07bbb17845168ae5a2680c7e7bafdd1a9e1f8cbe07754417b76dac4",
  orderRepayHash: "b25c65c900e52e555ca15be7ab3c5bc0cb52130c172d715e3bcf892b",
  orderWithdrawHash: "f92b3c8b183104bbff4579784550034ff8d75e1c633568f28b223f50",
  // oracleNftPolicy / oracleValidator — oracle reference UTxOs / price feed
  // (policy == validator script hash).
  oracleHash: "13dfcd07acf9c62ae28f7578e637210dddd7f77b393d0983b89c2707",
  // poolConfigPolicy — pool Config UTxO holder.
  poolConfigHash: "ecf0762dfc1c15f918937b151197b3f955e390cff20f6e78ef0be6c9",
} as const;

export function matchLenfiScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === LENFI_V2.poolHash) return "pool";
  if (lower === LENFI_V2.collateralHash || lower === LENFI_V2.leftoverHash) return "loan";
  if (
    lower === LENFI_V2.orderBorrowHash ||
    lower === LENFI_V2.orderDepositHash ||
    lower === LENFI_V2.orderRepayHash ||
    lower === LENFI_V2.orderWithdrawHash
  ) {
    return "order";
  }
  if (lower === LENFI_V2.oracleHash) return "feed";
  if (lower === LENFI_V2.poolConfigHash) return "config";
  return null;
}

// Pool NFT and borrower NFT are minted by the pool/collateral validators
// respectively (policy id == script hash). A pool is identified by holding the
// pool NFT under the pool policy; a loan position by the borrower NFT under the
// collateral policy. The borrower NFT token name is blake2b_256(serialise(pool
// oref)) and the pool NFT token name is the pool stake script hash, so a
// specific validity asset name cannot be pinned generically — matching the
// policy here means "this output carries a Lenfi pool/loan NFT".
export function matchLenfiNftPolicy(
  policyId: string,
  _assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  if (lower === LENFI_V2.poolHash) return "pool";
  if (lower === LENFI_V2.collateralHash) return "loan";
  return null;
}
