// Snapshot of the deployed SundaeSwap V4 script hashes, per network.
//
// GENERATED — do not edit by hand. Refresh with:
//   bun scripts/refresh-sundae-v4-hashes.ts
//
// The authoritative source is the `protocols` query on the
// environment-specific GraphQL API (api.sundae.fi, api.preview.sundae.fi,
// api.preprod.sundae.fi). `v4Registry.ts` refreshes from there in the
// background; this table is the synchronous fallback so detection works
// offline and on first paint, and still resolves after a redeploy once the
// refresh lands.
//
// Validator titles are the API's own (`blueprint.validators[].title`), e.g.
// "order.spend", "pool.spend", "basic_order.withdraw". A ".supersededN"
// suffix marks a retired deployment the API still reports.
//
// Captured 2026-10-04.

import type { V4ValidatorTable } from "./v4Registry";

export const V4_HASHES: Record<"mainnet" | "preview" | "preprod", V4ValidatorTable> = {
  mainnet: {
    "basic_order.withdraw": "30f1fac08a15ef84ea6a5aa04989b1c2ceeb3b437f2c3103df5aca68",
    "constant_sum.withdraw": "4e1a435f8d55f26068150579c18964e58078082b899e6bb560be7cd5",
    "fairness.withdraw": "31d2328d6ddc3d5dfc48c5b827aa922506a80e7db40f25ef807d0fd5",
    "fee_constraint.withdraw": "267eabb980be6699144e85b24283659838b0746e0fd2f08be1423e70",
    "fee_split.withdraw": "1351c687e6359b0030086fc7ddd6cd389f55f97faba3f531c5535688",
    "governance.withdraw": "518c4a6ef444c2f0631b3a7adb7514d80212dff988e35c1318da88a2",
    "order.spend": "07eb2fb09d9dd6603870ce6f84c8f8506249152173ddf0c77f1f07ec",
    "pool.mint": "d9d5985e0657933005d6eb953aeadad29aa8c36f17e493e2962584ec",
    "pool.spend": "21c9b7b965646069f9becebf8b4c3cedaf84c19b109eaa5980a14a26",
    "settings.mint": "371738e95ab3f0afba69c6b0896df05d7851a5307a830677b77c2ead",
    "settings.spend": "808db58d7d66d348b0cc7d83c202ef1d19534d00bf6c463a531020ad",
    "stableswap.withdraw": "f47f6594cab956302f7f1cd81ac4122e9ee128146102497feca1a79f",
    "strategy_order.withdraw": "35a9eebba5ea685d1deb20e269ca0045b9ff35df85cedde95c619a70",
    "treasury_policy.withdraw": "bcdca3ffc967ed2a5bf2dc9040f9f17d97f574122f7561fe26ef565b",
  },
  preview: {
    "banded_concentrated_liquidity.withdraw": "0977898c126442fdab79057b5b677932b55d4373d93b87dcee3e7d9a",
    "basic_order.withdraw": "4859acf5f46a50f383d16323a3c7eacf502ba732aa8874a7d3b7783e",
    "constant_sum.withdraw": "fa7f4860b25488fd63f2a7f5be4e8711520d288074b01286c9f14344",
    "fairness.withdraw": "f291de3ed5b01fa102764bfca6b6e8bc503a5899fc44fbc903b752c3",
    "fee_constraint.withdraw": "d7d1c09deb8bc8e15baae7895e57e86ab6d0cb10e2faaa6d96cd691b",
    "fee_split.withdraw": "6cec93b3ee519553eda356c36b9ef6ad91397495a4316c53fc2ce426",
    "governance.withdraw": "4e91572ab876102327c2b5cc1ab0b273de0dc40dc88d6668030d5246",
    "oracle.withdraw": "144f4c996e3e85a10f2c3bd3d01b32fc4bdee1d237167fc7dd678d59",
    "order.spend": "8a7ecdafb3605ddf761751b391c20482b7ef42ca01575d135d484c2b",
    "pool.mint": "b8a18e251b3e5078c04203f1a9af52408064c5d3a4256cfcfe3f67dd",
    "pool.spend": "f577d24cfa393efdb85482554acbdd5082f99acba9c17eab916cf87a",
    "settings.mint": "7b576da254d745bcbbabc91f34605deaa08f4e68d216f2a67d72ee12",
    "settings.spend": "43f2ee25b54dcd8150df9e9908ae890638844cd3a748ef05d8a09d09",
    "stableswap.withdraw": "9db7ce54fb25f4390a89bb715a022fe79a86b9a043aa22c31c27380a",
    "stableswap.withdraw.superseded1": "a44e0058459a223752be78dc4df7ca86446ba22ef95c7ee690e0b5a3",
    "strategy_order.withdraw": "5b67b76ff03dd497083df1450caabb3a4a99feea53ad631e700173ee",
    "treasury_policy.withdraw": "6076d7f51bc653c484cec76b9a7f1c116fa573175691b74cfd372876",
  },
  preprod: {
    "basic_order.withdraw": "e6d77b2d7cca04e2c9b8af99ed0a798cbd69e702fa1c2d8fde989dae",
    "constant_sum.withdraw": "b22b5293a1d6265a5a02564436bf35f6f3cef85654f565c2759cce4b",
    "fairness.withdraw": "e2a916c7a20f53970e7270dd27918b5104a3dfe06dcf47ecd0395844",
    "fee_constraint.withdraw": "ab835b719a82f620d5517b7fe846b4db1c8caadd024befe63efce5b6",
    "fee_split.withdraw": "1735ce824f52913fdae7e03a9005c35b4eb56aaa793c51d1b20e904d",
    "governance.withdraw": "d0fe277f9969b57c3c265311b4dfff277588ae036fc0c408d367d515",
    "order.spend": "2d066c461f37f3a41d2b2e57df0bff04cdf1ac799d06cb103f685ff2",
    "pool.mint": "a7a054cbb875e4882f1f3248a078643e66f3d00271c0a74f4d85b477",
    "pool.spend": "ae364bd4888823a4c8932845a19c5b3891480a9a2e6ba068afd35ee7",
    "settings.mint": "ecd76a8c8cf574d44b38a016246c1c6f9a75f5baa8417db8e59c81c5",
    "settings.spend": "726a1160a888c6d08934c4e001eb166e81dda300c2500d8b53fb4130",
    "stableswap.withdraw": "031b29852b494e33ab3b66a4df53d28dd8d00af15b59d3c5a6529db0",
    "strategy_order.withdraw": "3e32ea28c902aef16682b96bd7236347a55a216d7e4cc5ff7b0c5f9a",
    "treasury_policy.withdraw": "cb4795b8c101099e2bd0f8923c6f10f618ab1f2b552b8c18ffb25416",
  },
};
