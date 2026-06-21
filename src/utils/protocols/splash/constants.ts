// Known Splash (ex-Spectrum) mainnet APPLIED script hashes.
//
// IMPORTANT: Splash validators are parameterized, so the un-applied hashes do
// NOT match mainnet. These are the deployed applied hashes. Match a UTxO by the
// 28-byte PAYMENT credential only — order addresses share a payment hash across
// many different staking parts.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const SPLASH = {
  limitOrderHash: "464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02",
  instantOrderHash: "d9143ac63473b17a215d1b7484dfb6ac6b4a0005beb0e26a6ca02c96",
  // Additional spot/limit-order validator deployments (decode as Limit order).
  spotOrderHashes: [
    "dbe7a3d8a1d82990992a38eea1a2efaa68e931e252fc92ca1383809b", // spotOrder v1
    "2025463437ee5d64e89814a66ce7f98cb184a66ae85a2fbbfd750106", // spotOrder v2
  ],
  // Constant-product CFMM pool families (classic + fee-switch variants).
  constProductPoolHashes: [
    "e628bfd68c07a7a38fcd7d8df650812a9dfdbee54b1ed4c25c87ffbf", // constFnPoolV1
    "6b9c456aa650cb808a9ab54326e039d5235ed69f069c9664a8fe5b69", // constFnPoolV2
    "f002facfd69d51b63e7046c6d40349b0b17c8dd775ee415c66af3ccc", // constFnPoolFeeSwitch
    "9dee0659686c3ab807895c929e3284c11222affd710b09be690f924d", // constFnPoolFeeSwitchV2
    "680f52841c06f32cecdcdeff2c20ce6b70c2a5249b94d1a2b4eff294", // constFnPoolFeeSwitchBidirFee
  ],
  // Stableswap pool (PoolData).
  stablePoolHash: "5d3df99fcfbbf282bd76a3d76a2e30bdd22e61c56f1462447938933b", // stableFnPoolT2t
  // Balance-function (weighted) pool families.
  balancePoolHashes: [
    "f60fd1e70f4b9dfc09cdde8d7f7f1277de2694c82a516d7d3cc9e03e", // balanceFnPoolV1
    "c5283689ea30e0920c50adf77345b5809c05c962cc111e0f1d2dbedb", // balanceFnPoolV2
  ],
  // Legacy AMM proxy orders (Swap / Deposit / Redeem).
  proxySwapHash: "2618e94cdb06792f05ae9b1ec78b0231f4b7f4215b1b4cf52e6342de", // constFnPoolSwap
  proxyDepositHash: "075e09eb0fa89e1dc34691b3c56a7f437e60ac5ea67b338f2e176e20", // constFnPoolDeposit
  proxyRedeemHash: "83da79f531c19f9ce4d85359f56968a742cf05cc25ed3ca48c302dee", // constFnPoolRedeem
  // Grid order (GridStateNative / Action). NOT parameterized — un-applied hash ==
  // deployed hash (gridOrderNative).
  gridOrderHash: "6eff899ca605c05c115f0d7b0d0397e2dd886cd366d77bcb4ac65922",
  // Royalty pool (RoyaltyPoolConfig / PoolRedeemer / PoolAction; royaltyPool).
  royaltyPoolHash: "cb684a69e78907a9796b21fc150a758af5f2805e5ed5d5a8ce9f76f1",
} as const;

export function matchSplashScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (
    lower === SPLASH.limitOrderHash ||
    lower === SPLASH.instantOrderHash ||
    (SPLASH.spotOrderHashes as readonly string[]).includes(lower)
  )
    return "order";
  if ((SPLASH.constProductPoolHashes as readonly string[]).includes(lower)) return "pool";
  if (lower === SPLASH.stablePoolHash) return "stable-pool";
  if ((SPLASH.balancePoolHashes as readonly string[]).includes(lower)) return "balance-pool";
  if (lower === SPLASH.proxySwapHash) return "proxy-swap-order";
  if (lower === SPLASH.proxyDepositHash) return "proxy-deposit-order";
  if (lower === SPLASH.proxyRedeemHash) return "proxy-redeem-order";
  if (lower === SPLASH.gridOrderHash) return "grid-order";
  if (lower === SPLASH.royaltyPoolHash) return "royalty-pool";
  return null;
}
