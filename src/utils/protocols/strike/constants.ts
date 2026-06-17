// Strike Finance (Perpetuals) mainnet match constants.
//
// IMPORTANT: the orders / manage_positions / position_mint / liquidity_mint
// validators are PARAMETERIZED. The hashes below are the deployed mainnet hashes
// (the manage_positions hash even self-references inside the PositionDatum).
// Match a UTxO by its 28-byte PAYMENT script hash only — never the full bech32 —
// because Strike addresses are enterprise today but may gain a stake credential
// later.
//
// Note: manage_positions_script_hash = 268eca9c… is a stale/test value; the REAL
// deployed hash is e4b0afad… — do not use 268eca9c.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const STRIKE = {
  // manage_positions validator — active positions live here as PositionDatum.
  managePositionsHash: "e4b0afad821fcfe6b18cc1ee5c2c69cc4afb6b2ff15173904132a498",
  // orders validator — pending orders + just-opened positions sit here before
  // batching, as OrderDatum or a fresh PositionDatum.
  ordersHash: "1e0c1a445e185485277c044d77d2b1aaf80aa489a28a4c1e11ec8df0",
  // pool validator — singleton PoolDatum lives here.
  poolHash: "148c5cbcebfcf7f62d4555171b0e354273eb759929c8f410d6a1fe03",

  // position_mint policy — mints/burns the STRIKE_PERP_POSITION NFT carried by
  // every position UTxO. Strongest position anchor.
  positionPolicy: "632f08b440fb322f2d63e2603feb970906dbd89d14ed2a358103c3fa",
  // protocol_auth policy — mints the 3 protocol singletons (PROTOCOL_POOL_NFT /
  // PROTOCOL_SETTINGS_NFT / PROTOCOL_MANAGER_NFT).
  protocolAuthPolicy: "49d445ff011b422b2e99ca61f69518ace8ba79b70a023157ccd175fe",
  // liquidity_mint LP policy — asset STRIKE_PERP_LP.
  lpPolicy: "339c9e27a305538bea1b45829b757c5988381e9a1dada352508299f6",

  // Constant asset names (hex of ASCII).
  positionAssetName: "535452494b455f504552505f504f534954494f4e", // "STRIKE_PERP_POSITION"
  poolNftAssetName: "50524f544f434f4c5f504f4f4c5f4e4654", // "PROTOCOL_POOL_NFT"
} as const;

// Strike Finance (Forwards) mainnet match constants — a SEPARATE contract set
// from the perpetuals validators above (see ./forwards for parsers).
//
// All three validators are plutusV3 and were deployed together as reference
// scripts in ONE mainnet tx (cda6fb856182681566c038a44ea15d763fddc0fd5e122bf70b2b1b9991d655b2).
// `agreement` takes no parameters. `collateral` is parameterized by the agreement hash, and
// `forwards` by the collateral hash; the bytecode of each EMBEDS its parent's
// hash, chaining agreement → collateral → forwards end-to-end. The forwards
// validator is a MULTIVALIDATOR (spend + mint), so forwardsHash doubles as the
// forward-position NFT policy id (asset name "STRIKE" = 535452494b45).
export const STRIKE_FORWARDS = {
  // forwards multivalidator — ForwardsDatum lives here; also the NFT mint policy.
  forwardsHash: "28ad78b1e9891eaafe5fa28db8353030bcb15d5d0784ef4fff06323c",
  // collateral validator — CollateralDatum lives here (per-party deposits + collateral).
  collateralHash: "466155712f2ee5e0c376cfc6abb0dd981ee22b1976fcf360ef63b47b",
  // agreement validator — AgreementDatum lives here (unparameterized).
  agreementHash: "c571c0c0f3de2c8f15a68804d4484621c8d43e48d66c96308ff25ec3",

  // forward-position NFT asset name — "STRIKE".
  forwardAssetName: "535452494b45",
} as const;

export function matchStrikeForwardsScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  // A forward agreement's lifecycle spans all three validators; surface every
  // one as "forward-position" so the whole contract reads as one role.
  if (
    lower === STRIKE_FORWARDS.forwardsHash ||
    lower === STRIKE_FORWARDS.collateralHash ||
    lower === STRIKE_FORWARDS.agreementHash
  ) {
    return "forward-position";
  }
  return null;
}

export function matchStrikeForwardsNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  const names = assetNames.map((n) => n.toLowerCase());
  // The forward-position NFT is minted by the forwards multivalidator policy
  // under asset name "STRIKE"; any UTxO carrying it is part of a forward.
  if (lower === STRIKE_FORWARDS.forwardsHash && names.includes(STRIKE_FORWARDS.forwardAssetName)) {
    return "forward-position";
  }
  return null;
}

export function matchStrikeScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  // A position lifecycle spans TWO script addresses: pending/just-opened sit at
  // the orders validator, active positions at manage_positions. Both are
  // surfaced as "position".
  if (lower === STRIKE.managePositionsHash || lower === STRIKE.ordersHash) return "position";
  if (lower === STRIKE.poolHash) return "pool";
  return null;
}

export function matchStrikeNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  const names = assetNames.map((n) => n.toLowerCase());
  // The position NFT is the most robust anchor: any UTxO carrying the
  // STRIKE_PERP_POSITION asset under the position_mint policy is a Strike
  // position, whether pending (orders) or active (manage_positions).
  if (lower === STRIKE.positionPolicy && names.includes(STRIKE.positionAssetName)) {
    return "position";
  }
  // The singleton PROTOCOL_POOL_NFT marks the pool UTxO (LP shares + the other
  // protocol singletons share neither this policy nor this name).
  if (lower === STRIKE.protocolAuthPolicy && names.includes(STRIKE.poolNftAssetName)) {
    return "pool";
  }
  return null;
}
