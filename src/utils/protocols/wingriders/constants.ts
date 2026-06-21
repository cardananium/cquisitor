// Known WingRiders V2 mainnet script hashes + pool validity NFT policies.
//
// Order/request UTxOs live at the request validator script address (match by the
// 28-byte payment script hash). Pool UTxOs are identified by holding exactly one
// validity NFT: policy id below + asset name "4c" (ASCII 'L'). LP share tokens
// live under the same policy but with a per-pool asset name, so the pool match
// MUST check the asset name, not just the policy.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

// WingRiders has shipped more than one Constant-product contract set (same datum
// format, different script hashes / LP policy per deployment), so each role is a
// LIST of every known mainnet deployment's hash. Add a deployment's hashes here
// and it is recognized with no decoder change.
export const WINGRIDERS_V2 = {
  cpRequestHashes: [
    "86ae9eebd8b97944a45201e4aec1330a72291af2d071644bba015959",
    "c134d839a64a5dfb9b155869ef3f34280751a622f69958baa8ffd29c",
    "23680ea6701b56f2c12ae79d8af94fd36f509b7b007029c7ce114840",
  ],
  cpPoolHashes: [
    "e6c90a5923713af5786963dee0fdffd830ca7e0c86a041d9e5833e91",
    "af97793b8702f381976cec83e303e9ce17781458c73c4bb16fe02b83",
    "946ae228430f2fc64aa8b3acb910ee27e9b3e47aa8f925fac27834a1",
  ],
  cpLiquidityPolicies: [
    "026a18d04a0c642759bb3d83b12e3344894e5c1c7b2aeb1a2113a570",
    "6fdc63a1d71dc2c65502b79baae7fb543185702b12c3c5fb639ed737",
  ],
  stableRequestHashes: ["c5e0385012d5f010b1dc7ab42ba632944052de232051ec6ce3bfd72e"],
  stablePoolHashes: ["9868d58fbfcc2b14cfc7d9eec0b765e7e6fc4e950c9c2748ace9ce61"],
  stableLiquidityPolicies: ["980e8c567670d34d4ec13a0c3b6de6199f260ae5dc9dc9e867bc5c93"],
  validityAssetName: "4c",
};

export function matchWingRidersScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (WINGRIDERS_V2.cpRequestHashes.includes(lower)) return "order";
  if (WINGRIDERS_V2.stableRequestHashes.includes(lower)) return "stableswap-order";
  if (WINGRIDERS_V2.cpPoolHashes.includes(lower)) return "pool";
  if (WINGRIDERS_V2.stablePoolHashes.includes(lower)) return "stableswap-pool";
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
  if (WINGRIDERS_V2.cpLiquidityPolicies.includes(lower)) return "pool";
  if (WINGRIDERS_V2.stableLiquidityPolicies.includes(lower)) return "stableswap-pool";
  return null;
}

export function wingRidersPoolKindForPolicy(policyId: string): "ConstantProduct" | "Stableswap" | null {
  const lower = policyId.toLowerCase();
  if (WINGRIDERS_V2.cpLiquidityPolicies.includes(lower)) return "ConstantProduct";
  if (WINGRIDERS_V2.stableLiquidityPolicies.includes(lower)) return "Stableswap";
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
