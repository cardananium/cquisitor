// VyFinance (VyFi) v2 mainnet matching.
//
// IMPORTANT: VyFinance deploys ONE order validator and ONE pool validator PER
// POOL — each is parameterized by that pool's `mainNFT` policy as a compile-time
// constant. So the script hashes below are SPECIFIC to the
// ADA/USDA pool and are NOT global. A fully generic matcher would enumerate every
// pool from https://api.vyfi.io/lp?networkId=1&v2=true and match each UTxO by its
// per-pool order/pool address payment hash and/or by the pool's `mainNFT` policy.
//
// We therefore expose three matchers:
//  - `matchVyFinanceScriptHash`: the known ADA/USDA order + pool payment hashes,
//    plus the shared v2 pool script-STAKE key used as a fast pool-family filter.
//  - `matchVyFinanceNftPolicy`: matches a pool UTxO by the known per-pool mainNFT
//    policy (qty 1 on the pool UTxO).
// Match a UTxO by the 28-byte PAYMENT credential only.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole, PoolPair } from "@/utils/protocols/dex/registry";
import { VYFINANCE_POOLS } from "./pools.generated";

export const VYFINANCE = {
  // ADA/USDA order validator — payment hash of orderValidatorUtxoAddress
  // (addr1w9wghyy…), plutusV1. Per-pool.
  orderValidatorHash: "5c8b908655af5e66d66364a935225a109ccd8bacee574f73a41486f9",
  // ADA/USDA pool validator — payment hash of poolValidatorUtxoAddress
  // (addr1z955fyz…), plutusV1. Per-pool.
  poolValidatorHash: "694490530fd3abcf89aad027583203b2735080f4e841e6e189ac40ec",
  // Shared across ALL v2 pool (addr1z…) addresses — a fast pool-family filter.
  poolStakeKey: "b6811a70cfdddcc753a33d5bc895bf9912793cf7e225517fbf1d206b",
  // ADA/USDA mainNFT.currencySymbol — qty 1 on the pool UTxO. Per-pool.
  mainNftPolicy: "f7f9777979a2a96777823f149e6696954f43967fc56cfc7095a33f98",
  // operatorToken.currencySymbol (name VyFi_Credential) — CONSTANT across all
  // pools; gates order/pool execution by the VyFi operator/batcher.
  operatorTokenPolicy: "4d07e0ceae00e6c53598cea00a53c54a94c6b6aa071482244cc0adb5",
} as const;

// Every v2 pool's order + pool payment-script hash is enumerated in the
// generated registry (from the VyFi /lp API), which also carries each pool's
// trading pair. Matching against it covers all ~307 pools, not just ADA/USDA.
export function matchVyFinanceScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  return VYFINANCE_POOLS[hash.toLowerCase()]?.role ?? null;
}

/** The trading pair for a per-pool order/pool script hash, or null if unknown. */
export function vyFinancePairForHash(hash: string): PoolPair | null {
  return VYFINANCE_POOLS[hash.toLowerCase()]?.pair ?? null;
}

// A pool UTxO carries exactly one token of the pool's mainNFT policy. The
// operator credential policy is constant across pools but is held by the batcher,
// not the pool UTxO, so it does not identify a pool by itself.
export function matchVyFinanceNftPolicy(
  policyId: string,
  _assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (policyId.toLowerCase() === VYFINANCE.mainNftPolicy) return "pool";
  return null;
}
