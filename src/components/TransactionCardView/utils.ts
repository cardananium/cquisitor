import { bech32 } from "bech32";
import { blake2b } from "@noble/hashes/blake2.js";
import type { ValidationDiagnostic, CardanoNetwork, TransactionData } from "./types";

// Decode bech32 vkey and compute blake2b-224 hash
export function computeVkeyHash(vkeyBech32: string): string | null {
  try {
    const decoded = bech32.decode(vkeyBech32, 100);
    const publicKeyBytes = bech32.fromWords(decoded.words);
    const hash = blake2b(new Uint8Array(publicKeyBytes), { dkLen: 28 });
    return Array.from(hash as Uint8Array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

// Type guard to check if data is a valid transaction
export function isTransactionData(data: unknown): data is TransactionData {
  if (!data || typeof data !== 'object') return false;
  const tx = data as Record<string, unknown>;
  return 'body' in tx && 'witness_set' in tx && typeof tx.is_valid === 'boolean';
}

// Build a map of paths to diagnostics for quick lookup
export function buildDiagnosticsMap(diagnostics: ValidationDiagnostic[]): Map<string, ValidationDiagnostic[]> {
  const map = new Map<string, ValidationDiagnostic[]>();
  for (const diag of diagnostics) {
    if (diag.locations) {
      for (const location of diag.locations) {
        const existing = map.get(location) || [];
        existing.push(diag);
        map.set(location, existing);
      }
    }
  }
  return map;
}

// Check if a path or any of its children have diagnostics
export function getPathDiagnostics(
  basePath: string,
  diagnosticsMap: Map<string, ValidationDiagnostic[]>
): ValidationDiagnostic[] {
  const direct = diagnosticsMap.get(basePath) || [];
  return direct;
}

/**
 * Get counts of diagnostics for descendants only (NOT including the path itself)
 * This is used to show how many items inside a section have issues
 */
export function getDescendantDiagnosticCounts(
  basePath: string,
  diagnosticsMap: Map<string, ValidationDiagnostic[]>
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const [key, diags] of diagnosticsMap.entries()) {
    // Only count descendants, NOT the path itself
    if (key.startsWith(basePath + ".")) {
      for (const d of diags) {
        if (d.severity === "error") errors++;
        else if (d.severity === "warning") warnings++;
      }
    }
  }
  return { errors, warnings };
}

// Re-export cardanoscan link utilities from central location
export { 
  getCardanoscanBaseUrl as getCardanoscanUrl,
  getTransactionLink,
  getAddressLink,
  getStakeKeyLink,
  getGovActionLink,
  getPoolLink,
  cardanoscanLinks
} from "@/utils/cardanoscanLinks";

// Format ADA amount
export function formatAda(lovelace: string): string {
  const value = BigInt(lovelace);
  const ada = Number(value) / 1_000_000;
  return ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

// Truncate hash for display
export function truncateHash(hash: string, startLen = 8, endLen = 8): string {
  if (hash.length <= startLen + endLen + 3) return hash;
  return `${hash.slice(0, startLen)}...${hash.slice(-endLen)}`;
}

// Decode hex string to UTF-8 string
export function hexToString(hex: string): string | null {
  if (hex.length === 0) return null;
  
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Check if result contains printable characters (allow Unicode, not just ASCII)
    // Reject if it contains control characters (except common whitespace) or replacement chars
    if (decoded.length > 0 && !/[\x00-\x1F\x7F\uFFFD]/.test(decoded)) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

// Format asset name - returns decoded string if possible, otherwise hex
export function formatAssetName(hex: string): { display: string; decoded: string | null; hex: string } {
  const decoded = hexToString(hex);
  return {
    display: decoded || hex,
    decoded,
    hex
  };
}

