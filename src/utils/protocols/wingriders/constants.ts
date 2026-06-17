// Known WingRiders V2 mainnet script hashes + pool validity NFT policies.
//
// Order/request UTxOs live at the request validator script address (match by the
// 28-byte payment script hash). Pool UTxOs are identified by holding exactly one
// validity NFT: policy id below + asset name "4c" (ASCII 'L'). LP share tokens
// live under the same policy but with a per-pool asset name, so the pool match
// MUST check the asset name, not just the policy.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const WINGRIDERS_V2 = {
  cpRequestHash: "86ae9eebd8b97944a45201e4aec1330a72291af2d071644bba015959",
  stableRequestHash: "c5e0385012d5f010b1dc7ab42ba632944052de232051ec6ce3bfd72e",
  cpLiquidityPolicy: "026a18d04a0c642759bb3d83b12e3344894e5c1c7b2aeb1a2113a570",
  stableLiquidityPolicy: "980e8c567670d34d4ec13a0c3b6de6199f260ae5dc9dc9e867bc5c93",
  validityAssetName: "4c",
  // Pool SPEND validator payment hashes — where pool UTxOs actually live. Lets us
  // match a pool by address even if the NFT-policy path misses. Both plutusV1.
  cpPoolHash: "e6c90a5923713af5786963dee0fdffd830ca7e0c86a041d9e5833e91",
  stablePoolHash: "9868d58fbfcc2b14cfc7d9eec0b765e7e6fc4e950c9c2748ace9ce61",
} as const;

export function matchWingRidersScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === WINGRIDERS_V2.cpRequestHash) return "order";
  if (lower === WINGRIDERS_V2.stableRequestHash) return "stableswap-order";
  if (lower === WINGRIDERS_V2.cpPoolHash) return "pool";
  if (lower === WINGRIDERS_V2.stablePoolHash) return "stableswap-pool";
  return null;
}

export function matchWingRidersNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  if (!assetNames.includes(WINGRIDERS_V2.validityAssetName)) return null;
  if (lower === WINGRIDERS_V2.cpLiquidityPolicy) return "pool";
  if (lower === WINGRIDERS_V2.stableLiquidityPolicy) return "stableswap-pool";
  return null;
}

export function wingRidersPoolKindForPolicy(policyId: string): "ConstantProduct" | "Stableswap" | null {
  const lower = policyId.toLowerCase();
  if (lower === WINGRIDERS_V2.cpLiquidityPolicy) return "ConstantProduct";
  if (lower === WINGRIDERS_V2.stableLiquidityPolicy) return "Stableswap";
  return null;
}

// WingRiders rapid-dex pool validator.
//
// poolHash is the pool script's payment hash, which ALSO doubles as the pool
// validity-NFT policy id (pool policy id == pool script hash). The pool UTxO
// holds exactly one validity NFT under this policy with asset name "50"
// (ASCII 'P'), DISTINCT from V2's "4c" ('L'). LP share tokens live under the
// same policy with a per-pool asset name, so the pool match MUST check the
// asset name, not just the policy.
//
// poolHash is the APPLIED mainnet hash — the un-applied hash 723bee63… is NOT
// what is deployed; the applied validator is below.
export const WINGRIDERS_RAPID_DEX = {
  poolHash: "348225d4082c67eacf432a261f1b128a2411be18a2a4c3860974d473",
  validityAssetName: "50",
} as const;

export function matchWingRidersRapidScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (hash.toLowerCase() === WINGRIDERS_RAPID_DEX.poolHash) return "rapid-pool";
  return null;
}

export function matchWingRidersRapidNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (
    policyId.toLowerCase() === WINGRIDERS_RAPID_DEX.poolHash &&
    assetNames.includes(WINGRIDERS_RAPID_DEX.validityAssetName)
  ) {
    return "rapid-pool";
  }
  return null;
}
