// Charli3 mainnet feed match constants.
//
// Charli3 is an ORACLE, not a DEX. The consumer-facing artifact is the Oracle
// Feed UTxO datum (price / timestamp / expiry), which DApps read as a REFERENCE
// input. Each trading pair is a SEPARATE parameterized script instance with its
// own Feed-NFT policy id AND its own feed script hash — there is no single shared
// Charli3 hash. The tables below reflect the current mainnet pair registry from
// docs.charli3.io/oracles/resources/networks/mainnet and should be treated as an
// extendable list (Charli3 adds pairs over time).
//
// Match a UTxO by:
//   - the 28-byte PAYMENT script hash of the feed address, OR
//   - the Feed NFT: one of the per-pair policy ids below + the validity asset
//     name "OracleFeed" (= 4f7261636c6546656564). The asset name MUST be checked
//     so unrelated tokens under a policy don't false-positive.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

// Feed NFT token name "OracleFeed" (hex), shared across every pair instance.
export const CHARLI3_FEED_ASSET_NAME = "4f7261636c6546656564";

// Per-pair Feed NFT policy ids (mainnet). token name = CHARLI3_FEED_ASSET_NAME.
export const CHARLI3_FEED_NFT_POLICIES: Record<string, string> = {
  "08c56c0fa73748a23c3bc1d9e6a60a4187416fc4ff8fe3475506990e": "ADA/USD",
  e2ee3c439d71d22a77ccf019953459368b4d35e6184c115d67e1c735: "ADA/C3",
  "696e58d4453c525cb032a325ea8cde6499ff31ffdec05d3ca8dbaea0": "ADA/CHF",
  aaff38a4fd17c66f66e0ac7d578d0ff30b2b1ec0d7638eb007db04cc: "ADA/EURO",
  ba0b98665d9a18c04c50793768780dff7826e2bcff2ff0909b708fa0: "BOOK/USD",
  a665bb42594646eaaed8ed59ada592fb8300775df916a4a5406ffa96: "DJED/USD",
  de640fa36c56ca8eab2ff97dbeb5c3a297452fd133a1f77d7c9d3dbc: "IUSD/USD",
  "6167e3550a74ead031eaebe9ebddbf4d8fb9d9398568261d41bc9e97": "NMKR/ADA",
  "8a78965350bbdd35adbacd748d51c4fb83952d8851f785e2eae05e15": "SHEN/USD",
};

// Per-pair feed PAYMENT script hashes (mainnet). These are the 28-byte payment
// script hashes of the addr1w... feed addresses (header 0x71 = mainnet
// enterprise script).
export const CHARLI3_FEED_SCRIPT_HASHES: Record<string, string> = {
  "1869c28a5c1023a10c1deb30d112226cf45130b800a22d9c2afc1c9c": "ADA/USD",
  af0e4d91894fb19a2576cf5884926c435985a1d392bc00ab59e4665c: "ADA/C3",
  "5d8c5b94b0f7b9ebd60d0fdaa50e61039ded490c2d7a7da1088d1607": "ADA/CHF",
  "363614aa3bd37dc0ec4b7b91c38fe15424a20f7a36d1044a4967aa5e": "ADA/EURO",
  e647c49dc3cf8479304775c8333d4545d52deebed2293409f822ce50: "BOOK/USD",
  "5cab7558e66a4592f019e47447fee9445930486077574abed3429fb4": "DJED/USD",
  "0ce885f663dc693951104d0f5931b8d2c0e5ee656b2b39f9244d8192": "IUSD/USD",
  "712118c809009b34b747d43c781b11751982bbfabfa8aca2107722b2": "NMKR/ADA",
  ecd8548af2a121a652727da169f86fd7b43b4b3b698b8895ba956c50: "SHEN/USD",
};

export const CHARLI3 = {
  feedAssetName: CHARLI3_FEED_ASSET_NAME,
  feedNftPolicies: CHARLI3_FEED_NFT_POLICIES,
  feedScriptHashes: CHARLI3_FEED_SCRIPT_HASHES,
} as const;

/** Resolve the pair label ("ADA/USD") for a known feed policy or script hash. */
export function charli3PairForHash(hash: string): string | null {
  const lower = hash.toLowerCase();
  return (
    CHARLI3_FEED_SCRIPT_HASHES[lower] ?? CHARLI3_FEED_NFT_POLICIES[lower] ?? null
  );
}

export function matchCharli3ScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower in CHARLI3_FEED_SCRIPT_HASHES) return "feed";
  return null;
}

export function matchCharli3NftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  if (!(lower in CHARLI3_FEED_NFT_POLICIES)) return null;
  // Only a UTxO actually holding the OracleFeed validity NFT is a feed.
  if (assetNames.map((n) => n.toLowerCase()).includes(CHARLI3_FEED_ASSET_NAME)) {
    return "feed";
  }
  return null;
}
