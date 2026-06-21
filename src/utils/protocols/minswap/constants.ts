// Known Minswap V2 mainnet script hashes + token policies.
//
// The deployed mainnet hashes below are the parameterized hashes.
//
//   order  spend  c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c
//   pool   spend  ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b
//   factory       7bc5fbd41a95f561be84369631e0e35895efb0b73e0a7480bb9ed730
//   authen / LP / validity-NFT minting policy
//                 f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c
//   pool UTxOs additionally hold the MSP validity NFT (policy above, asset name
//   4d5350 = "MSP"); LP tokens share the same policy.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const MINSWAP_V2 = {
  orderScriptHash: "c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c",
  poolScriptHash: "ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b",
  factoryScriptHash: "7bc5fbd41a95f561be84369631e0e35895efb0b73e0a7480bb9ed730",
  authenPolicyId: "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c",
  // validity NFT asset names under authenPolicyId
  poolNftAssetName: "4d5350", // "MSP"
} as const;

// Minswap V2 is mainnet-only in our registry for now (no stable testnet V2
// hashes). We still match when the network is unknown.
export function matchMinswapV2ScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === MINSWAP_V2.orderScriptHash) return "order";
  if (lower === MINSWAP_V2.poolScriptHash) return "pool";
  return null;
}

// --- Minswap V1 (legacy PlutusV1) -----------------------------------------
//
// The order script hash is the payment credential of ORDER_BASE_ADDRESS
// (mainnet); the pool script hash is POOL_SCRIPT_HASH (decoded from its bech32
// `script1…`). Both are plutusV1.
export const MINSWAP_V1 = {
  // payment cred of ORDER_BASE_ADDRESS[MAINNET]
  orderScriptHash: "a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b",
  // POOL_SCRIPT_HASH (also hard-coded inside the order validator CBOR)
  poolScriptHash: "e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309",
  // factory token that every valid V1 pool UTxO carries
  factoryPolicyId: "13aa2accf2e1561723aa26871e071fdf32c867cff7e7d50ad470d62f",
  factoryAssetName: "4d494e53574150", // "MINSWAP"
  lpPolicyId: "e4214b7cce62ac6fbba385d164df48e157eae5863521b4b67ca71d86",
  poolNftPolicyId: "0be55d262b29f564998ff81efe21bdc0022621c12f15af08d0f2ddb1",
} as const;

export function matchMinswapV1ScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === MINSWAP_V1.orderScriptHash) return "v1-order";
  if (lower === MINSWAP_V1.poolScriptHash) return "v1-pool";
  return null;
}

// --- Minswap Stableswap (PlutusV2) ----------------------------------------
//
// Each stable pool is a separately-parameterized validator, so there is one
// order hash and one pool hash per pool. These are the payment credentials of
// the StableswapConstant.CONFIG[MAINNET] orderAddress/poolAddress entries
// (plutusV2). Order is index-aligned with pool by pool.
export const MINSWAP_STABLESWAP = {
  // 14 mainnet stable pools.
  orderScriptHashes: [
    "4c4d65a0616f60adc2cba70f533705233b1d7e8cb3e9868cdca39d86", // DJED-iUSD
    "62d3e3975c6ec02d4002640413368a2d46ea10548b1cd217a3e9b7cd", // USDC-DJED
    "96c2d95fc73740ef18abb95af68be279f80bb711eb69a527f3b1d713", // USDM-iUSD
    "865085a4d810ed21f7677bdf3b1a93e1b75fd17f246d7f0243493cde", // DJED-USDM
    "6d0241ff7fa052c63645a75e189f84214b6be062f59d6ac9c7bbb2c1", // DJED-MyUSD
    "fb65ab56748b6c2894d04e68c0b92fc2a00178303ef1ee62a539afda", // MyUSD-USDM
    "f5da441786eef04048a9f59fff53c5c9ef101a59ad0488e1a8aa3897", // USDC-iUSD
    "2aa1ae236856def55f77e6bb1aa5b43801ec0097f9e0a69fa24fc0ed", // USDC-iUSD-0.1
    "f1d4865bce47591d67ec320e92eeb26b917389e65f8fb12bb9b38877", // USDM-USDA
    "e296ea95bb834b0816ee6b700fb008c1e52d7508728b914ff3f52764", // iUSD-USDA
    "2c3a242850258ed3ebf501bb9515a159370de774a86fa70e27f24075", // wETH-iETH
    "9fb4b54c367463bd3da3d2e8aa9357133ef7b489adb1cf9cb2e8dd70", // wBTC-iBTC
    "baef35198c17567a43cf11a5d049b83f664241b35a666f5988f08092", // wSOL-iSOL
    "01dbf30889e419e67f38dde1cc0c265da01d83c42f868128a87376b6", // USDT-iUSD
  ],
  poolScriptHashes: [
    "3d6b603c4c4abe4273223b45a858e7f546b8c520048f43218e250c66",
    "8edad0df48fe66f9785b327321abb50b23d4b37bc4250504632be59e",
    "68a7a481d2221939af26d24ab146b7695cdb5cfb2b73b319a5449227",
    "8cd62e5a2553c5d57be78ba0058451b925b4f1d111a2f6fd5c73a94b",
    "8fe23277978e4cdefaaf278f5c6f534de8b361cb6cb178a622a71319",
    "b109e0ae17302c6f185883f2e1eea8cf54fa2386ddf3e32769674a91",
    "17b793894c04d15b79a6b7fdbfd75ba273b2d3229c4a9717f6221a7a",
    "aae7c6c0a2d37ef5aa4ed1fca519949fd9f6588318839dc5d7c7b27f",
    "1cd639e0731532fb27252504801100c9cd0f31419c0c63c914301771",
    "119a5401c8942c2a8f49d2372ed090868aff53a6211a8600ec0bc13e",
    "85c162aaf17039cb3f9949dcd7fc5d81020bcb18dd764d2b21dddabc",
    "5ec0bf47958dfa60def3b4e96b89953fa51f99c288fcb61495f9b9c7",
    "a2f52338d5ab1d9f0c603a51c07168aafebf54f5d708b2abe71988c6",
    "71b00bb6a54422cad7de4e784ced3a1aa9cd2974303f89d026b8756c", // USDT-iUSD
  ],
} as const;

const STABLESWAP_ORDER_SET = new Set<string>(MINSWAP_STABLESWAP.orderScriptHashes);
const STABLESWAP_POOL_SET = new Set<string>(MINSWAP_STABLESWAP.poolScriptHashes);

export function matchMinswapStableswapScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (STABLESWAP_ORDER_SET.has(lower)) return "stableswap-order";
  if (STABLESWAP_POOL_SET.has(lower)) return "stableswap-pool";
  return null;
}
