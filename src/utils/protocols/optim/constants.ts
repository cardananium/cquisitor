// Optim Finance mainnet match constants.
//
// Optim's OADA batch_stake / staking_amo / collateral_amo validators are
// PARAMETERIZED. The un-applied hashes do NOT match mainnet, so we MUST NOT use
// them as matchers. The OADA / sOADA minting policy ids are stable — a
// stake/unstake settlement is most reliably recognized by the presence of these
// minted tokens. The "bond" (Liquidity Bonds) product's policy ids are unknown.
//
// => matchScriptHash uses the applied mainnet validator payment hashes below.
//    Matching is also done via matchNftPolicy on the OADA / sOADA policy ids.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";
// matchScriptHash is intentionally omitted from the Optim adapter — its spend
// validators are parameterized and no applied mainnet payment hash is known;
// see matchOptimNftPolicy (OADA / sOADA minted-token matching) below.

export const OPTIM = {
  // OADA token minting policy id (asset name empty "").
  oadaPolicyId: "f6099832f9563e4cf59602b3351c3c5a8a7dda2d44575ef69b82cf8d",
  // sOADA (sotoken) minting policy id == StakingAmoDatum.sotoken field.
  soadaPolicyId: "02a574e2f048e288e2a77f48872bf8ffd61d73f9476ac5a83601610b",
  // OADA / sOADA tokens carry the empty asset name on mainnet.
  oTokenAssetName: "",
  // APPLIED mainnet validator PAYMENT hashes (parameterized validators — these
  // are the deployed instances, NOT the un-applied hashes):
  //   stakingAmoHash — the sOADA/OADA rate-state AMO singleton validator; UTxOs
  //     carry a 15-field StakingAmoDatum and hold the OADA backing.
  //   stakeOrderHash — the user stake/unstake order escrow validator; UTxOs
  //     carry a 5-field order datum.
  stakingAmoHash: "b37e1190853f6ccf68cdccf1f5776cb5cf36419a3b020a2eedea74f8",
  stakeOrderHash: "54e67eb61823f5d59026facb2cf5c2a1fd216ef8a9a64ff5761710f9",
} as const;

// Match GENUINE Optim position UTxOs by their applied validator payment hash.
//
// We deliberately do NOT match by the OADA / sOADA token policy: those liquid-
// staking tokens are broadly held (user wallets and other DeFi protocols — e.g.
// Splash stable pools hold OADA), so a token-policy match false-positives on
// unrelated UTxOs. Matching the validator hash is precise and stake-agnostic.
export function matchOptimScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === OPTIM.stakingAmoHash || lower === OPTIM.stakeOrderHash) return "position";
  return null;
}

export function optimTokenForPolicy(policyId: string): "OADA" | "sOADA" | null {
  const lower = policyId.toLowerCase();
  if (lower === OPTIM.oadaPolicyId) return "OADA";
  if (lower === OPTIM.soadaPolicyId) return "sOADA";
  return null;
}
