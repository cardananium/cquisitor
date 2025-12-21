/**
 * CIP-129: Governance Identifiers
 * 
 * This module implements the CIP-129 specification for encoding and decoding
 * governance identifiers in Cardano's Conway era.
 * 
 * @see https://github.com/cardano-foundation/CIPs/blob/master/CIP-0129/README.md
 */

import { bech32 } from 'bech32';

// ============================================================================
// Constants
// ============================================================================

/**
 * Key Types (bits [7;4] of header byte)
 */
export enum GovKeyType {
  CC_HOT = 0x00,  // 0000....
  CC_COLD = 0x10, // 0001....
  DREP = 0x20,    // 0010....
}

/**
 * Credential Types (bits [3;0] of header byte)
 * Values 0 and 1 are reserved to prevent conflicts with Cardano Address Network tags
 */
export enum CredentialType {
  KEY_HASH = 0x02,    // ....0010
  SCRIPT_HASH = 0x03, // ....0011
}

/**
 * Bech32 prefixes for governance identifiers
 */
export const BECH32_PREFIXES = {
  DREP: 'drep',
  CC_HOT: 'cc_hot',
  CC_COLD: 'cc_cold',
  GOV_ACTION: 'gov_action',
} as const;

/**
 * Header byte values for each key type + credential type combination
 */
export const HEADER_BYTES = {
  CC_HOT_KEY_HASH: GovKeyType.CC_HOT | CredentialType.KEY_HASH,       // 0x02
  CC_HOT_SCRIPT_HASH: GovKeyType.CC_HOT | CredentialType.SCRIPT_HASH, // 0x03
  CC_COLD_KEY_HASH: GovKeyType.CC_COLD | CredentialType.KEY_HASH,     // 0x12
  CC_COLD_SCRIPT_HASH: GovKeyType.CC_COLD | CredentialType.SCRIPT_HASH, // 0x13
  DREP_KEY_HASH: GovKeyType.DREP | CredentialType.KEY_HASH,           // 0x22
  DREP_SCRIPT_HASH: GovKeyType.DREP | CredentialType.SCRIPT_HASH,     // 0x23
} as const;

// ============================================================================
// Types
// ============================================================================

export type GovKeyTypeString = 'cc_hot' | 'cc_cold' | 'drep';
export type CredentialTypeString = 'key_hash' | 'script_hash';

export interface GovernanceCredential {
  keyType: GovKeyTypeString;
  credentialType: CredentialTypeString;
  hash: string; // hex-encoded credential hash (28 bytes = 56 hex chars)
}

export interface GovernanceActionId {
  txHash: string; // hex-encoded transaction hash (32 bytes = 64 hex chars)
  index: number;  // governance action index within the transaction
}

export interface DecodedGovernanceId {
  type: 'credential' | 'action';
  prefix: string;
  data: GovernanceCredential | GovernanceActionId;
  rawBytes: string; // hex-encoded full identifier bytes
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Get the bech32 prefix for a given key type
 */
export function getPrefix(keyType: GovKeyTypeString): string {
  switch (keyType) {
    case 'cc_hot':
      return BECH32_PREFIXES.CC_HOT;
    case 'cc_cold':
      return BECH32_PREFIXES.CC_COLD;
    case 'drep':
      return BECH32_PREFIXES.DREP;
    default:
      throw new Error(`Unknown key type: ${keyType}`);
  }
}

/**
 * Get the key type from a bech32 prefix
 */
export function getKeyTypeFromPrefix(prefix: string): GovKeyTypeString {
  switch (prefix) {
    case BECH32_PREFIXES.CC_HOT:
      return 'cc_hot';
    case BECH32_PREFIXES.CC_COLD:
      return 'cc_cold';
    case BECH32_PREFIXES.DREP:
      return 'drep';
    default:
      throw new Error(`Unknown bech32 prefix: ${prefix}`);
  }
}

/**
 * Get the GovKeyType enum value for a key type string
 */
function getGovKeyType(keyType: GovKeyTypeString): GovKeyType {
  switch (keyType) {
    case 'cc_hot':
      return GovKeyType.CC_HOT;
    case 'cc_cold':
      return GovKeyType.CC_COLD;
    case 'drep':
      return GovKeyType.DREP;
    default:
      throw new Error(`Unknown key type: ${keyType}`);
  }
}

/**
 * Get the CredentialType enum value for a credential type string
 */
function getCredentialType(credType: CredentialTypeString): CredentialType {
  switch (credType) {
    case 'key_hash':
      return CredentialType.KEY_HASH;
    case 'script_hash':
      return CredentialType.SCRIPT_HASH;
    default:
      throw new Error(`Unknown credential type: ${credType}`);
  }
}

/**
 * Parse the header byte to extract key type and credential type
 */
function parseHeader(header: number): { keyType: GovKeyTypeString; credentialType: CredentialTypeString } {
  const keyTypeBits = header & 0xF0; // bits [7;4]
  const credTypeBits = header & 0x0F; // bits [3;0]

  let keyType: GovKeyTypeString;
  switch (keyTypeBits) {
    case GovKeyType.CC_HOT:
      keyType = 'cc_hot';
      break;
    case GovKeyType.CC_COLD:
      keyType = 'cc_cold';
      break;
    case GovKeyType.DREP:
      keyType = 'drep';
      break;
    default:
      throw new Error(`Unknown key type in header: 0x${keyTypeBits.toString(16)}`);
  }

  let credentialType: CredentialTypeString;
  switch (credTypeBits) {
    case CredentialType.KEY_HASH:
      credentialType = 'key_hash';
      break;
    case CredentialType.SCRIPT_HASH:
      credentialType = 'script_hash';
      break;
    default:
      throw new Error(`Unknown credential type in header: 0x${credTypeBits.toString(16)}`);
  }

  return { keyType, credentialType };
}

/**
 * Build the header byte from key type and credential type
 */
function buildHeader(keyType: GovKeyTypeString, credentialType: CredentialTypeString): number {
  return getGovKeyType(keyType) | getCredentialType(credentialType);
}

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Encode a governance credential to CIP-129 bech32 format
 * 
 * @param credential - The governance credential to encode
 * @returns The bech32-encoded governance identifier
 * 
 * @example
 * ```typescript
 * const bech32Id = encodeGovernanceCredential({
 *   keyType: 'drep',
 *   credentialType: 'key_hash',
 *   hash: '00000000000000000000000000000000000000000000000000000000'
 * });
 * // Returns: 'drep1ygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7vlc9n'
 * ```
 */
export function encodeGovernanceCredential(credential: GovernanceCredential): string {
  const { keyType, credentialType, hash } = credential;
  
  // Validate hash length (28 bytes = 56 hex chars)
  if (hash.length !== 56) {
    throw new Error(`Invalid credential hash length: expected 56 hex chars, got ${hash.length}`);
  }
  
  const header = buildHeader(keyType, credentialType);
  const hashBytes = hexToBytes(hash);
  
  // Combine header + hash
  const fullBytes = new Uint8Array(1 + hashBytes.length);
  fullBytes[0] = header;
  fullBytes.set(hashBytes, 1);
  
  // Convert to bech32 words
  const words = bech32.toWords(fullBytes);
  
  // Get prefix based on key type
  const prefix = getPrefix(keyType);
  
  // Encode to bech32
  return bech32.encode(prefix, words, 100);
}

/**
 * Encode a governance action ID to CIP-129 bech32 format
 * 
 * @param actionId - The governance action ID to encode
 * @returns The bech32-encoded governance action identifier
 * 
 * @example
 * ```typescript
 * const bech32Id = encodeGovernanceActionId({
 *   txHash: '0000000000000000000000000000000000000000000000000000000000000000',
 *   index: 17
 * });
 * // Returns: 'gov_action1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpzklpgpf'
 * ```
 */
export function encodeGovernanceActionId(actionId: GovernanceActionId): string {
  const { txHash, index } = actionId;
  
  // Validate txHash length (32 bytes = 64 hex chars)
  if (txHash.length !== 64) {
    throw new Error(`Invalid transaction hash length: expected 64 hex chars, got ${txHash.length}`);
  }
  
  if (index < 0 || index > 255) {
    throw new Error(`Invalid governance action index: must be 0-255, got ${index}`);
  }
  
  const txHashBytes = hexToBytes(txHash);
  
  // Combine txHash + index (index as single byte)
  const fullBytes = new Uint8Array(txHashBytes.length + 1);
  fullBytes.set(txHashBytes, 0);
  fullBytes[txHashBytes.length] = index;
  
  // Convert to bech32 words
  const words = bech32.toWords(fullBytes);
  
  // Encode to bech32
  return bech32.encode(BECH32_PREFIXES.GOV_ACTION, words, 120);
}

/**
 * Encode a governance identifier from hex bytes to bech32
 * Automatically detects the type based on the prefix provided
 * 
 * @param hex - The hex-encoded identifier (with header for credentials)
 * @param prefix - The bech32 prefix to use
 * @returns The bech32-encoded identifier
 */
export function encodeFromHex(hex: string, prefix: string): string {
  const bytes = hexToBytes(hex);
  const words = bech32.toWords(bytes);
  return bech32.encode(prefix, words, 120);
}

// ============================================================================
// Decoding Functions
// ============================================================================

/**
 * Decode a CIP-129 bech32 governance identifier
 * 
 * @param bech32Id - The bech32-encoded governance identifier
 * @returns The decoded governance identifier data
 * 
 * @example
 * ```typescript
 * const decoded = decodeGovernanceId('drep1ygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7vlc9n');
 * // Returns:
 * // {
 * //   type: 'credential',
 * //   prefix: 'drep',
 * //   data: {
 * //     keyType: 'drep',
 * //     credentialType: 'key_hash',
 * //     hash: '00000000000000000000000000000000000000000000000000000000'
 * //   },
 * //   rawBytes: '2200000000000000000000000000000000000000000000000000000000'
 * // }
 * ```
 */
export function decodeGovernanceId(bech32Id: string): DecodedGovernanceId {
  const decoded = bech32.decode(bech32Id, 120);
  const bytes = new Uint8Array(bech32.fromWords(decoded.words));
  const prefix = decoded.prefix;
  const rawBytes = bytesToHex(bytes);
  
  if (prefix === BECH32_PREFIXES.GOV_ACTION) {
    // Governance Action ID: txHash (32 bytes) + index (1 byte)
    if (bytes.length !== 33) {
      throw new Error(`Invalid governance action ID length: expected 33 bytes, got ${bytes.length}`);
    }
    
    const txHash = bytesToHex(bytes.slice(0, 32));
    const index = bytes[32];
    
    return {
      type: 'action',
      prefix,
      data: { txHash, index } as GovernanceActionId,
      rawBytes,
    };
  } else {
    // Governance Credential: header (1 byte) + hash (28 bytes)
    if (bytes.length !== 29) {
      throw new Error(`Invalid governance credential length: expected 29 bytes, got ${bytes.length}`);
    }
    
    const header = bytes[0];
    const { keyType, credentialType } = parseHeader(header);
    const hash = bytesToHex(bytes.slice(1));
    
    // Validate that prefix matches key type
    const expectedPrefix = getPrefix(keyType);
    if (prefix !== expectedPrefix) {
      throw new Error(`Prefix mismatch: expected ${expectedPrefix} for key type ${keyType}, got ${prefix}`);
    }
    
    return {
      type: 'credential',
      prefix,
      data: { keyType, credentialType, hash } as GovernanceCredential,
      rawBytes,
    };
  }
}

/**
 * Decode a governance credential from bech32 format
 * 
 * @param bech32Id - The bech32-encoded governance credential
 * @returns The decoded governance credential
 */
export function decodeGovernanceCredential(bech32Id: string): GovernanceCredential {
  const decoded = decodeGovernanceId(bech32Id);
  if (decoded.type !== 'credential') {
    throw new Error('Expected a governance credential, got a governance action ID');
  }
  return decoded.data as GovernanceCredential;
}

/**
 * Decode a governance action ID from bech32 format
 * 
 * @param bech32Id - The bech32-encoded governance action ID
 * @returns The decoded governance action ID
 */
export function decodeGovernanceActionId(bech32Id: string): GovernanceActionId {
  const decoded = decodeGovernanceId(bech32Id);
  if (decoded.type !== 'action') {
    throw new Error('Expected a governance action ID, got a governance credential');
  }
  return decoded.data as GovernanceActionId;
}

/**
 * Decode a bech32 governance identifier to hex bytes
 * 
 * @param bech32Id - The bech32-encoded identifier
 * @returns Object containing the prefix and hex-encoded bytes
 */
export function decodeToHex(bech32Id: string): { prefix: string; hex: string } {
  const decoded = bech32.decode(bech32Id, 120);
  const bytes = new Uint8Array(bech32.fromWords(decoded.words));
  return {
    prefix: decoded.prefix,
    hex: bytesToHex(bytes),
  };
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert a governance action from standard format (txHash#index) to CIP-129 bech32
 * 
 * @param standard - The standard format governance action ID (e.g., "txHash#17")
 * @returns The CIP-129 bech32-encoded governance action ID
 * 
 * @example
 * ```typescript
 * const bech32Id = govActionFromStandard(
 *   '0000000000000000000000000000000000000000000000000000000000000000#17'
 * );
 * // Returns: 'gov_action1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpzklpgpf'
 * ```
 */
export function govActionFromStandard(standard: string): string {
  const parts = standard.split('#');
  if (parts.length !== 2) {
    throw new Error(`Invalid standard governance action format: expected "txHash#index", got "${standard}"`);
  }
  
  const [txHash, indexStr] = parts;
  const index = parseInt(indexStr, 10);
  
  if (isNaN(index)) {
    throw new Error(`Invalid governance action index: "${indexStr}"`);
  }
  
  return encodeGovernanceActionId({ txHash, index });
}

/**
 * Convert a CIP-129 bech32 governance action ID to standard format (txHash#index)
 * 
 * @param bech32Id - The CIP-129 bech32-encoded governance action ID
 * @returns The standard format governance action ID
 * 
 * @example
 * ```typescript
 * const standard = govActionToStandard(
 *   'gov_action1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpzklpgpf'
 * );
 * // Returns: '0000000000000000000000000000000000000000000000000000000000000000#17'
 * ```
 */
export function govActionToStandard(bech32Id: string): string {
  const actionId = decodeGovernanceActionId(bech32Id);
  return `${actionId.txHash}#${actionId.index}`;
}

/**
 * Convert a raw credential hash to CIP-129 bech32 format
 * 
 * @param hash - The hex-encoded credential hash (28 bytes)
 * @param keyType - The type of governance key
 * @param credentialType - The type of credential (key hash or script hash)
 * @returns The CIP-129 bech32-encoded credential
 */
export function credentialToBech32(
  hash: string,
  keyType: GovKeyTypeString,
  credentialType: CredentialTypeString
): string {
  return encodeGovernanceCredential({ keyType, credentialType, hash });
}

/**
 * Convert a CIP-129 bech32 credential to its raw hash
 * 
 * @param bech32Id - The CIP-129 bech32-encoded credential
 * @returns The hex-encoded credential hash
 */
export function bech32ToCredentialHash(bech32Id: string): string {
  const credential = decodeGovernanceCredential(bech32Id);
  return credential.hash;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if a string is a valid CIP-129 governance identifier
 * 
 * @param bech32Id - The string to check
 * @returns True if the string is a valid CIP-129 governance identifier
 */
export function isValidGovernanceId(bech32Id: string): boolean {
  try {
    decodeGovernanceId(bech32Id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a string is a valid CIP-129 governance credential
 * 
 * @param bech32Id - The string to check
 * @returns True if the string is a valid CIP-129 governance credential
 */
export function isValidGovernanceCredential(bech32Id: string): boolean {
  try {
    const decoded = decodeGovernanceId(bech32Id);
    return decoded.type === 'credential';
  } catch {
    return false;
  }
}

/**
 * Check if a string is a valid CIP-129 governance action ID
 * 
 * @param bech32Id - The string to check
 * @returns True if the string is a valid CIP-129 governance action ID
 */
export function isValidGovernanceActionId(bech32Id: string): boolean {
  try {
    const decoded = decodeGovernanceId(bech32Id);
    return decoded.type === 'action';
  } catch {
    return false;
  }
}

/**
 * Get the type of a governance identifier
 * 
 * @param bech32Id - The bech32-encoded governance identifier
 * @returns The type of identifier ('drep', 'cc_hot', 'cc_cold', 'gov_action') or null if invalid
 */
export function getGovernanceIdType(bech32Id: string): string | null {
  try {
    const decoded = bech32.decode(bech32Id, 120);
    const validPrefixes = [
      BECH32_PREFIXES.DREP,
      BECH32_PREFIXES.CC_HOT,
      BECH32_PREFIXES.CC_COLD,
      BECH32_PREFIXES.GOV_ACTION,
    ];
    
    if (validPrefixes.includes(decoded.prefix as typeof validPrefixes[number])) {
      return decoded.prefix;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// DRep-specific helpers
// ============================================================================

/**
 * Encode a DRep credential to bech32
 * 
 * @param hash - The hex-encoded DRep credential hash
 * @param isScriptHash - Whether the credential is a script hash (default: false for key hash)
 * @returns The bech32-encoded DRep ID
 */
export function encodeDRepId(hash: string, isScriptHash = false): string {
  return encodeGovernanceCredential({
    keyType: 'drep',
    credentialType: isScriptHash ? 'script_hash' : 'key_hash',
    hash,
  });
}

/**
 * Decode a DRep ID from bech32
 * 
 * @param bech32Id - The bech32-encoded DRep ID
 * @returns The decoded DRep credential
 */
export function decodeDRepId(bech32Id: string): GovernanceCredential {
  const credential = decodeGovernanceCredential(bech32Id);
  if (credential.keyType !== 'drep') {
    throw new Error(`Expected DRep credential, got ${credential.keyType}`);
  }
  return credential;
}

// ============================================================================
// CC Hot-specific helpers
// ============================================================================

/**
 * Encode a CC Hot credential to bech32
 * 
 * @param hash - The hex-encoded CC Hot credential hash
 * @param isScriptHash - Whether the credential is a script hash (default: false for key hash)
 * @returns The bech32-encoded CC Hot ID
 */
export function encodeCCHotId(hash: string, isScriptHash = false): string {
  return encodeGovernanceCredential({
    keyType: 'cc_hot',
    credentialType: isScriptHash ? 'script_hash' : 'key_hash',
    hash,
  });
}

/**
 * Decode a CC Hot ID from bech32
 * 
 * @param bech32Id - The bech32-encoded CC Hot ID
 * @returns The decoded CC Hot credential
 */
export function decodeCCHotId(bech32Id: string): GovernanceCredential {
  const credential = decodeGovernanceCredential(bech32Id);
  if (credential.keyType !== 'cc_hot') {
    throw new Error(`Expected CC Hot credential, got ${credential.keyType}`);
  }
  return credential;
}

// ============================================================================
// CC Cold-specific helpers
// ============================================================================

/**
 * Encode a CC Cold credential to bech32
 * 
 * @param hash - The hex-encoded CC Cold credential hash
 * @param isScriptHash - Whether the credential is a script hash (default: false for key hash)
 * @returns The bech32-encoded CC Cold ID
 */
export function encodeCCColdId(hash: string, isScriptHash = false): string {
  return encodeGovernanceCredential({
    keyType: 'cc_cold',
    credentialType: isScriptHash ? 'script_hash' : 'key_hash',
    hash,
  });
}

/**
 * Decode a CC Cold ID from bech32
 * 
 * @param bech32Id - The bech32-encoded CC Cold ID
 * @returns The decoded CC Cold credential
 */
export function decodeCCColdId(bech32Id: string): GovernanceCredential {
  const credential = decodeGovernanceCredential(bech32Id);
  if (credential.keyType !== 'cc_cold') {
    throw new Error(`Expected CC Cold credential, got ${credential.keyType}`);
  }
  return credential;
}

// ============================================================================
// Pool ID Conversion Helpers
// ============================================================================

/**
 * Convert a pool key hash (hex) to bech32 pool ID (pool1...)
 * 
 * @param hexHash - The hex-encoded pool key hash (28 bytes = 56 hex chars)
 * @returns The bech32-encoded pool ID
 * 
 * @example
 * ```typescript
 * const poolId = poolIdHexToBech32('0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f');
 * // Returns: 'pool1pur...'
 * ```
 */
export function poolIdHexToBech32(hexHash: string): string {
  if (hexHash.length !== 56) {
    throw new Error(`Invalid pool key hash length: expected 56 hex chars, got ${hexHash.length}`);
  }
  
  const bytes = hexToBytes(hexHash);
  const words = bech32.toWords(bytes);
  return bech32.encode('pool', words, 90);
}

/**
 * Convert a bech32 pool ID (pool1...) to hex pool key hash
 * 
 * @param bech32PoolId - The bech32-encoded pool ID
 * @returns The hex-encoded pool key hash
 * 
 * @example
 * ```typescript
 * const hex = poolIdBech32ToHex('pool1pur...');
 * // Returns: '0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f'
 * ```
 */
export function poolIdBech32ToHex(bech32PoolId: string): string {
  const decoded = bech32.decode(bech32PoolId, 90);
  if (decoded.prefix !== 'pool') {
    throw new Error(`Expected 'pool' prefix, got '${decoded.prefix}'`);
  }
  const bytes = new Uint8Array(bech32.fromWords(decoded.words));
  return bytesToHex(bytes);
}

/**
 * Check if a string is a valid bech32 pool ID
 * 
 * @param poolId - The string to check
 * @returns True if valid bech32 pool ID
 */
export function isPoolIdBech32(poolId: string): boolean {
  try {
    const decoded = bech32.decode(poolId, 90);
    return decoded.prefix === 'pool';
  } catch {
    return false;
  }
}

/**
 * Check if a string is a hex pool key hash (56 hex characters)
 * 
 * @param poolId - The string to check
 * @returns True if valid hex pool key hash
 */
export function isPoolIdHex(poolId: string): boolean {
  return /^[0-9a-fA-F]{56}$/.test(poolId);
}

/**
 * Convert pool ID to bech32 format (if it's hex, convert; if already bech32, return as is)
 * 
 * @param poolId - The pool ID in either hex or bech32 format
 * @returns The bech32-encoded pool ID
 */
export function ensurePoolIdBech32(poolId: string): string {
  if (isPoolIdBech32(poolId)) {
    return poolId;
  }
  if (isPoolIdHex(poolId)) {
    return poolIdHexToBech32(poolId);
  }
  throw new Error(`Invalid pool ID format: ${poolId}`);
}

/**
 * Convert pool ID to hex format (if it's bech32, convert; if already hex, return as is)
 * 
 * @param poolId - The pool ID in either hex or bech32 format
 * @returns The hex-encoded pool key hash
 */
export function ensurePoolIdHex(poolId: string): string {
  if (isPoolIdHex(poolId)) {
    return poolId;
  }
  if (isPoolIdBech32(poolId)) {
    return poolIdBech32ToHex(poolId);
  }
  throw new Error(`Invalid pool ID format: ${poolId}`);
}

