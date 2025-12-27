/**
 * Cardanoscan Link Provider
 * Centralized utility for generating Cardanoscan explorer links
 */

export type CardanoNetwork = "mainnet" | "preview" | "preprod";

/**
 * Get Cardanoscan base URL for a specific network
 */
export function getCardanoscanBaseUrl(network: CardanoNetwork): string {
  switch (network) {
    case "mainnet":
      return "https://cardanoscan.io";
    case "preview":
      return "https://preview.cardanoscan.io";
    case "preprod":
      return "https://preprod.cardanoscan.io";
  }
}

/**
 * Generate a link to a transaction on Cardanoscan
 */
export function getTransactionLink(network: CardanoNetwork, txHash: string): string {
  return `${getCardanoscanBaseUrl(network)}/transaction/${txHash}`;
}

/**
 * Generate a link to an address on Cardanoscan
 */
export function getAddressLink(network: CardanoNetwork, address: string): string {
  return `${getCardanoscanBaseUrl(network)}/address/${address}`;
}

/**
 * Generate a link to a stake key on Cardanoscan
 */
export function getStakeKeyLink(network: CardanoNetwork, stakeKey: string): string {
  return `${getCardanoscanBaseUrl(network)}/stakekey/${stakeKey}`;
}

/**
 * Generate a link to a governance action on Cardanoscan
 * @param bech32GovActionId - The CIP-129 bech32 encoded governance action ID
 */
export function getGovActionLink(network: CardanoNetwork, bech32GovActionId: string): string {
  return `${getCardanoscanBaseUrl(network)}/govAction/${bech32GovActionId}`;
}

/**
 * Generate a link to a pool on Cardanoscan
 */
export function getPoolLink(network: CardanoNetwork, poolId: string): string {
  return `${getCardanoscanBaseUrl(network)}/pool/${poolId}`;
}

/**
 * Generate a link to a DRep on Cardanoscan
 */
export function getDRepLink(network: CardanoNetwork, drepId: string): string {
  return `${getCardanoscanBaseUrl(network)}/drep/${drepId}`;
}

/**
 * Generate a link to a block on Cardanoscan
 */
export function getBlockLink(network: CardanoNetwork, blockHash: string): string {
  return `${getCardanoscanBaseUrl(network)}/block/${blockHash}`;
}

/**
 * Generate a link to an epoch on Cardanoscan
 */
export function getEpochLink(network: CardanoNetwork, epoch: number): string {
  return `${getCardanoscanBaseUrl(network)}/epoch/${epoch}`;
}

/**
 * Generate a link to a token/policy on Cardanoscan
 */
export function getTokenLink(network: CardanoNetwork, fingerprint: string): string {
  return `${getCardanoscanBaseUrl(network)}/token/${fingerprint}`;
}

/**
 * Generate a link to a policy on Cardanoscan
 */
export function getPolicyLink(network: CardanoNetwork, policyId: string): string {
  return `${getCardanoscanBaseUrl(network)}/tokenPolicy/${policyId}`;
}

/**
 * Cardanoscan link provider object for convenient access
 */
export const cardanoscanLinks = {
  baseUrl: getCardanoscanBaseUrl,
  transaction: getTransactionLink,
  address: getAddressLink,
  stakeKey: getStakeKeyLink,
  govAction: getGovActionLink,
  pool: getPoolLink,
  drep: getDRepLink,
  block: getBlockLink,
  epoch: getEpochLink,
  token: getTokenLink,
  policy: getPolicyLink,
} as const;

