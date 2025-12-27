"use client";

import { useMemo, useState } from "react";
import { UtxoRef } from "./UtxoRef";
import { AddressWithTooltip } from "./AddressWithTooltip";
import { CopyIcon, CheckIcon } from "./Icons";
import { AssetsTable, type AssetRow } from "./AssetsTable";

// ============================================================================
// Type Definitions
// ============================================================================

interface ValidatorAsset {
  policy_id: string;
  asset_name: string;
  quantity: number;
}

interface MultiAsset {
  assets: ValidatorAsset[];
}

interface Value {
  coins: number;
  assets: MultiAsset;
}

interface FeeDecomposition {
  txSizeFee: number;
  referenceScriptsFee: number;
  executionUnitsFee: number;
}

interface TxInput {
  txHash: string;
  outputIndex: number;
}

interface ExUnits {
  mem: number;
  steps: number;
}

interface GovernanceActionId {
  txHash: number[];
  index: number;
}

interface LocalCredential {
  keyHash?: number[];
  scriptHash?: number[];
}

interface ProtocolVersion {
  major: number;
  minor: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatLovelace(lovelace: number, forceLovelace = false): string {
  // For fee decomposition, always show in lovelace for precision
  if (forceLovelace) {
    return `${lovelace.toLocaleString()} lovelace`;
  }
  // Otherwise, always show in ADA
  const ada = lovelace / 1_000_000;
  return `₳ ${ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}


function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Human-readable messages for known error types
 * Used when the original message is JSON or not user-friendly
 */
const ERROR_TYPE_MESSAGES: Record<string, (data?: Record<string, unknown>) => string> = {
  // Phase 1 errors
  ValueNotConservedUTxO: () => "Value not conserved — inputs don't match outputs + fee",
  FeeTooSmallUTxO: (data) => {
    const actualFee = data?.actual_fee ?? data?.actualFee;
    const minFee = data?.min_fee ?? data?.minFee;
    if (actualFee !== undefined && minFee !== undefined) {
      return `Fee too small: ${Number(actualFee).toLocaleString()} < ${Number(minFee).toLocaleString()} lovelace required`;
    }
    return "Fee too small for this transaction";
  },
};

/**
 * Error types that have custom display formatters
 * Maps error type name to a cleanup function for the message
 */
const ERROR_TYPE_CLEANUPS: Record<string, (msg: string) => string> = {
  // Phase 1 errors with custom display
  BadInputsUTxO: (msg) => msg.replace(/:\s*TxInput\s*\{[^}]+\}/gi, "").trim(),
  
  ValueNotConservedUTxO: () => "Value not conserved",
  
  FeeTooSmallUTxO: (msg) => msg.replace(/\.\s*Fee decomposition:.*$/i, "").trim(),
  
  // Withdrawal/Reward account errors - remove the stake address from the message
  WithdrawalsNotInRewardAccounts: (msg) => msg.replace(/:\s*"?stake(_test)?1[a-z0-9]+"?\s*$/i, "").trim(),
  
  MissingDatum: (msg) => msg.replace(/Datum\s+[0-9a-fA-F]{64}\s+/gi, "Datum ").trim(),
  
  ExtraneousDatumWitnesses: (msg) => msg.replace(/:\s*[0-9a-fA-F]{56,64}\s*$/i, "").trim(),
  
  ScriptDataHashMismatch: (msg) => msg.replace(/\.\s*Expected:.*$/i, "").trim(),
  
  AuxiliaryDataHashMismatch: (msg) => msg.replace(/\.\s*Expected:.*$/i, "").trim(),
  
  ConflictingMetadataHash: (msg) => msg.replace(/\.\s*Expected:.*$/i, "").trim(),
  
  MissingVKeyWitnesses: (msg) => msg.replace(/:\s*\[?"?[0-9a-fA-F]{56,64}"?\]?\s*$/i, "").trim(),
  
  MissingScriptWitnesses: (msg) => msg.replace(/:\s*\[?"?[0-9a-fA-F]{56,64}"?\]?\s*$/i, "").trim(),
  
  InvalidSignature: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
  ExtraneousSignature: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
  ExtraneousScriptWitnesses: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
  UnnecessaryScriptWitness: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
  UnneededScriptWitness: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
  NativeScriptIsUnsuccessful: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
  PlutusScriptIsUnsuccessful: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
  ReferenceInputOverlapsWithInput: (msg) => msg.replace(/:\s*TxInput\s*\{[^}]+\}/gi, "").trim(),
  
  CollateralInputContainsNonAdaAssets: (msg) => msg.replace(/:\s*TxInput\s*\{[^}]+\}/gi, "").trim(),
  
  CollateralIsLockedByScript: (msg) => msg.replace(/:\s*TxInput\s*\{[^}]+\}/gi, "").trim(),
  
  // Phase 2 errors with custom display
  MissingRequiredDatum: (msg) => msg.replace(/Datum\s+[0-9a-fA-F]{64}\s+/gi, "Datum ").trim(),
  
  MissingRequiredScript: (msg) => msg.replace(/Script\s+[0-9a-fA-F]{64}\s+/gi, "Script ").trim(),
  
  ResolvedInputNotFound: (msg) => msg.replace(/Input\s+[0-9a-fA-F]{64}#\d+/gi, "Input").trim(),
  
  NoEnoughBudget: () => "Not enough execution budget",
  
  // Phase 1 & 2 warnings with custom display
  FeeIsBiggerThanMinFee: (msg) => msg.replace(/\.\s*Fee decomposition:.*$/i, "").trim(),
  
  BudgetIsBiggerThanExpected: (msg) => msg.replace(/\.\s*Expected:.*$/i, "").trim(),
};

/**
 * Gets a human-readable message for a known error type
 */
export function getHumanReadableMessage(errorType: string, errorData?: Record<string, unknown>): string | null {
  const messageGenerator = ERROR_TYPE_MESSAGES[errorType];
  if (messageGenerator) {
    return messageGenerator(errorData);
  }
  return null;
}

/**
 * Cleans up error messages by removing redundant info that's shown in formatted structures below
 * Only cleans if we have a specific cleanup for this error type
 */
function cleanupErrorMessage(message: string, errorType: string): string {
  let cleaned = message;
  
  const cleanup = ERROR_TYPE_CLEANUPS[errorType];
  if (cleanup) {
    cleaned = cleanup(message);
  }
  
  // Also remove stake/reward addresses from any message (they're shown formatted below)
  cleaned = cleaned.replace(/:\s*"?stake(_test)?1[a-z0-9]+"?\s*$/i, "");
  // Remove bech32 addresses (addr1, addr_test1)
  cleaned = cleaned.replace(/:\s*"?addr(_test)?1[a-z0-9]+"?\s*$/i, "");
  
  // Final cleanup
  return cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/[,:\s.]+$/, "")
    .trim();
}

// ============================================================================
// Formatter Components
// ============================================================================

/**
 * Formats a Value (coins + multi-asset)
 */
export function ValueFormatter({ value }: { value: Value }) {
  const hasAssets = value.assets?.assets?.length > 0;
  const isNegative = value.coins < 0;
  
  // Convert assets to the format expected by AssetsTable
  const assetRows: AssetRow[] = hasAssets
    ? value.assets.assets.map((asset) => ({
        policyId: asset.policy_id,
        assetName: asset.asset_name,
        quantity: BigInt(asset.quantity),
      }))
    : [];
  
  return (
    <div className="error-formatter value-formatter">
      <div className={`value-coins ${isNegative ? "negative" : ""}`}>
        <span className="value-label">ADA:</span>
        <span className={`value-amount ${isNegative ? "negative" : ""}`}>{formatLovelace(value.coins)}</span>
      </div>
      {hasAssets && (
        <div className="value-assets">
          <AssetsTable 
            assets={assetRows} 
            showSign={true}
            label="Assets:"
            compact={true}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Formats a Fee Decomposition
 */
export function FeeDecompositionFormatter({ fee }: { fee: FeeDecomposition }) {
  const total = fee.txSizeFee + fee.referenceScriptsFee + fee.executionUnitsFee;
  
  return (
    <div className="error-formatter fee-decomposition-formatter">
      <div className="fee-breakdown">
        <div className="fee-row">
          <span className="fee-label">TX Size:</span>
          <span className="fee-value">{formatLovelace(fee.txSizeFee, true)}</span>
          <span className="fee-percent">
            ({((fee.txSizeFee / total) * 100).toFixed(1)}%)
          </span>
        </div>
        <div className="fee-row">
          <span className="fee-label">Ref Scripts:</span>
          <span className="fee-value">{formatLovelace(fee.referenceScriptsFee, true)}</span>
          <span className="fee-percent">
            ({((fee.referenceScriptsFee / total) * 100).toFixed(1)}%)
          </span>
        </div>
        <div className="fee-row">
          <span className="fee-label">Execution:</span>
          <span className="fee-value">{formatLovelace(fee.executionUnitsFee, true)}</span>
          <span className="fee-percent">
            ({((fee.executionUnitsFee / total) * 100).toFixed(1)}%)
          </span>
        </div>
        <div className="fee-row fee-total">
          <span className="fee-label">Total:</span>
          <span className="fee-value">{formatLovelace(total, true)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats a Transaction Input reference using the unified UtxoRef component
 */
export function TxInputFormatter({ input }: { input: TxInput }) {
  return (
    <UtxoRef 
      txHash={input.txHash}
      index={input.outputIndex}
      variant="error"
    />
  );
}

/**
 * Formats Execution Units
 */
export function ExUnitsFormatter({ units }: { units: ExUnits }) {
  return (
    <div className="error-formatter exunits-formatter">
      <div className="exunits-row">
        <span className="exunits-label">Memory:</span>
        <span className="exunits-value">{units.mem.toLocaleString()}</span>
        <span className="exunits-unit">units</span>
      </div>
      <div className="exunits-row">
        <span className="exunits-label">CPU Steps:</span>
        <span className="exunits-value">{units.steps.toLocaleString()}</span>
        <span className="exunits-unit">units</span>
      </div>
    </div>
  );
}

/**
 * Formats a Governance Action ID
 */
export function GovActionIdFormatter({ actionId }: { actionId: GovernanceActionId }) {
  const txHash = bytesToHex(actionId.txHash);
  return (
    <div className="error-formatter gov-action-formatter">
      <span className="gov-hash">{txHash}</span>
      <span className="gov-separator">#</span>
      <span className="gov-index">{actionId.index}</span>
    </div>
  );
}

/**
 * Formats a Local Credential (KeyHash or ScriptHash)
 */
export function CredentialFormatter({ credential }: { credential: LocalCredential }) {
  const isScript = !!credential.scriptHash;
  const hash = isScript 
    ? bytesToHex(credential.scriptHash!) 
    : bytesToHex(credential.keyHash!);
  
  return (
    <div className="error-formatter credential-formatter">
      <span className={`credential-type ${isScript ? "script" : "key"}`}>
        {isScript ? "Script" : "Key"}
      </span>
      <span className="credential-hash">{hash}</span>
    </div>
  );
}

/**
 * Formats a Protocol Version
 */
export function ProtocolVersionFormatter({ version }: { version: ProtocolVersion }) {
  return (
    <span className="error-formatter protocol-version-formatter">
      v{version.major}.{version.minor}
    </span>
  );
}

/**
 * Formats a Slot number with epoch calculation
 */
export function SlotFormatter({ slot, currentSlot }: { slot: number; currentSlot?: number }) {
  // Approximate epoch (432000 slots per epoch on mainnet)
  const SLOTS_PER_EPOCH = 432000;
  const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
  
  return (
    <div className="error-formatter slot-formatter">
      <span className="slot-value">{slot.toLocaleString()}</span>
      <span className="slot-epoch">(epoch ~{epoch})</span>
      {currentSlot !== undefined && (
        <span className={`slot-diff ${slot > currentSlot ? "future" : "past"}`}>
          {slot > currentSlot 
            ? `+${(slot - currentSlot).toLocaleString()} slots ahead`
            : `${(currentSlot - slot).toLocaleString()} slots ago`
          }
        </span>
      )}
    </div>
  );
}

/**
 * Formats an Address with network detection
 */
export function AddressFormatter({ address }: { address: string }) {
  const isMainnet = address.startsWith("addr1");
  const isTestnet = address.startsWith("addr_test1");
  const isStake = address.startsWith("stake");
  
  return (
    <div className="error-formatter address-formatter">
      <span className={`address-type ${isMainnet ? "mainnet" : isTestnet ? "testnet" : isStake ? "stake" : ""}`}>
        {isMainnet ? "Mainnet" : isTestnet ? "Testnet" : isStake ? "Stake" : "Unknown"}
      </span>
      <span className="address-value" title={address}>
        {address.slice(0, 12)}...{address.slice(-8)}
      </span>
    </div>
  );
}

/**
 * Formats a Hex Hash (script hash, datum hash, etc.)
 */
export function HashFormatter({ hash, label, inline = false }: { hash: string; label?: string; inline?: boolean }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span className={`hash-formatter ${inline ? 'inline' : ''}`}>
      {label && <span className="hash-label">{label}:</span>}
      <code className="hash-value">{hash}</code>
      <span 
        role="button"
        tabIndex={0}
        className={`hash-copy-btn ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        onKeyDown={(e) => e.key === 'Enter' && handleCopy(e as unknown as React.MouseEvent)}
        title={copied ? 'Copied!' : 'Copy hash'}
      >
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      </span>
    </span>
  );
}

/**
 * Formats an array of hex hashes
 */
function HashArrayFormatter({ hashes }: { hashes: string[] }) {
  return (
    <div className="error-formatter hash-array-formatter">
      {hashes.map((hash, idx) => (
        <div key={idx} className="hash-array-item">
          <HashFormatter hash={hash} />
        </div>
      ))}
    </div>
  );
}

/**
 * Formats an array of addresses
 */
function AddressArrayFormatter({ addresses }: { addresses: string[] }) {
  return (
    <div className="error-formatter address-array-formatter">
      {addresses.map((addr, idx) => (
        <div key={idx} className="address-array-item">
          <AddressWithTooltip address={addr} showCopy={true} />
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Smart Formatter - Detects and formats known structures
// ============================================================================

interface FormattedStructure {
  type: string;
  component: React.ReactNode;
}

function detectAndFormat(key: string, value: unknown): FormattedStructure | null {
  if (value === null || value === undefined) return null;
  
  // Check for Value type (has coins and assets)
  if (typeof value === "object" && "coins" in value && "assets" in value) {
    return {
      type: "Value",
      component: <ValueFormatter value={value as Value} />
    };
  }
  
  // Check for FeeDecomposition (both camelCase and snake_case)
  if (typeof value === "object" && 
      (("txSizeFee" in value && "referenceScriptsFee" in value) ||
       ("tx_size_fee" in value && "reference_scripts_fee" in value))) {
    const fee = value as Record<string, number>;
    const normalized: FeeDecomposition = {
      txSizeFee: fee.txSizeFee ?? fee.tx_size_fee ?? 0,
      referenceScriptsFee: fee.referenceScriptsFee ?? fee.reference_scripts_fee ?? 0,
      executionUnitsFee: fee.executionUnitsFee ?? fee.execution_units_fee ?? 0,
    };
    return {
      type: "FeeDecomposition", 
      component: <FeeDecompositionFormatter fee={normalized} />
    };
  }
  
  // Check for TxInput (both camelCase and snake_case)
  if (typeof value === "object" && 
      (("txHash" in value && "outputIndex" in value) ||
       ("tx_hash" in value && "output_index" in value))) {
    const input = value as Record<string, unknown>;
    const normalized: TxInput = {
      txHash: (input.txHash ?? input.tx_hash) as string,
      outputIndex: (input.outputIndex ?? input.output_index) as number,
    };
    return {
      type: "TxInput",
      component: <TxInputFormatter input={normalized} />
    };
  }
  
  // Check for ExUnits
  if (typeof value === "object" && "mem" in value && "steps" in value) {
    return {
      type: "ExUnits",
      component: <ExUnitsFormatter units={value as ExUnits} />
    };
  }
  
  // Check for GovernanceActionId (txHash as array)
  if (typeof value === "object" && "txHash" in value && Array.isArray((value as GovernanceActionId).txHash) && "index" in value) {
    return {
      type: "GovernanceActionId",
      component: <GovActionIdFormatter actionId={value as GovernanceActionId} />
    };
  }
  
  // Check for LocalCredential
  if (typeof value === "object" && ("keyHash" in value || "scriptHash" in value)) {
    const v = value as LocalCredential;
    if ((v.keyHash && Array.isArray(v.keyHash)) || (v.scriptHash && Array.isArray(v.scriptHash))) {
      return {
        type: "Credential",
        component: <CredentialFormatter credential={v} />
      };
    }
  }
  
  // Check for ProtocolVersion
  if (typeof value === "object" && "major" in value && "minor" in value) {
    return {
      type: "ProtocolVersion",
      component: <ProtocolVersionFormatter version={value as ProtocolVersion} />
    };
  }
  
  // Check for address strings - use AddressWithTooltip for rich display
  if (typeof value === "string" && (value.startsWith("addr") || value.startsWith("stake"))) {
    const isRewardAddress = value.startsWith("stake");
    return {
      type: isRewardAddress ? "Reward Address" : "Address",
      component: <AddressWithTooltip address={value} showCopy={true} />
    };
  }
  
  // Check for hex hash strings (56-64 chars)
  if (typeof value === "string" && /^[0-9a-fA-F]{56,64}$/.test(value)) {
    return {
      type: "Hash",
      component: <HashFormatter hash={value} />
    };
  }
  
  // Check for arrays of hashes
  if (Array.isArray(value) && value.length > 0) {
    // Check if it's an array of hex hash strings
    if (value.every(v => typeof v === "string" && /^[0-9a-fA-F]{56,64}$/.test(v))) {
      return {
        type: "HashArray",
        component: <HashArrayFormatter hashes={value} />
      };
    }
    // Check if it's an array of addresses
    if (value.every(v => typeof v === "string" && (v.startsWith("addr") || v.startsWith("stake")))) {
      return {
        type: "AddressArray",
        component: <AddressArrayFormatter addresses={value} />
      };
    }
  }
  
  return null;
}

/**
 * Budget comparison formatter for Phase 2 warnings
 * 
 * NOTE: The library naming is confusing:
 * - expected_budget = what was actually USED during script execution
 * - actual_budget = what was DECLARED in the transaction (the budget you set)
 * 
 * We rename to clearer terms: "used" and "declared"
 */
function BudgetComparisonFormatter({ 
  expected, 
  actual 
}: { 
  expected: ExUnits; 
  actual: ExUnits;
}) {
  // Rename for clarity: expected = used, actual = declared
  const used = expected;
  const declared = actual;
  
  // Calculate how much extra was declared vs what was used
  const memOverhead = declared.mem - used.mem;
  const stepsOverhead = declared.steps - used.steps;
  
  return (
    <div className="smart-message-formatter">
      <div className="message-structures">
        <div className="message-structure-item">
          <span className="structure-key">Declared → Used:</span>
        </div>
        <div className="budget-comparison-inline">
          <span className="budget-inline-label">Memory:</span>
          <span className="budget-inline-value">{declared.mem.toLocaleString()}</span>
          <span className="budget-inline-arrow">→</span>
          <span className="budget-inline-value">{used.mem.toLocaleString()}</span>
          {memOverhead !== 0 && (
            <span className={`budget-inline-diff ${memOverhead > 0 ? 'over' : 'under'}`}>
              ({memOverhead > 0 ? '+' : ''}{memOverhead.toLocaleString()})
            </span>
          )}
        </div>
        <div className="budget-comparison-inline">
          <span className="budget-inline-label">CPU:</span>
          <span className="budget-inline-value">{declared.steps.toLocaleString()}</span>
          <span className="budget-inline-arrow">→</span>
          <span className="budget-inline-value">{used.steps.toLocaleString()}</span>
          {stepsOverhead !== 0 && (
            <span className={`budget-inline-diff ${stepsOverhead > 0 ? 'over' : 'under'}`}>
              ({stepsOverhead > 0 ? '+' : ''}{stepsOverhead.toLocaleString()})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Recursively find and format known structures in nested objects
 */
function findAndFormatNested(data: Record<string, unknown>): Array<{ key: string; formatted: FormattedStructure }> {
  const parts: Array<{ key: string; formatted: FormattedStructure }> = [];
  
  // Special case: BudgetIsBiggerThanExpected with expected_budget/expectedBudget and actual_budget/actualBudget
  const expectedBudgetKey = "expected_budget" in data ? "expected_budget" : 
                            "expectedBudget" in data ? "expectedBudget" : null;
  const actualBudgetKey = "actual_budget" in data ? "actual_budget" : 
                          "actualBudget" in data ? "actualBudget" : null;
  
  if (expectedBudgetKey && actualBudgetKey) {
    const expected = data[expectedBudgetKey] as ExUnits;
    const actual = data[actualBudgetKey] as ExUnits;
    parts.push({
      key: "budget_comparison",
      formatted: {
        type: "BudgetComparison",
        component: <BudgetComparisonFormatter expected={expected} actual={actual} />
      }
    });
    return parts;
  }
  
  for (const [key, value] of Object.entries(data)) {
    const formatted = detectAndFormat(key, value);
    if (formatted) {
      parts.push({ key, formatted });
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // Recursively search nested objects
      const nested = findAndFormatNested(value as Record<string, unknown>);
      for (const item of nested) {
        parts.push({ key: `${key}.${item.key}`, formatted: item.formatted });
      }
    }
  }
  
  return parts;
}

/**
 * Parses error message and extracts structured data for better formatting
 */
export function parseErrorMessage(message: string): {
  text: string;
  structures: FormattedStructure[];
} {
  const structures: FormattedStructure[] = [];
  
  // For now, return the message as-is
  // The individual formatters will be used where we have parsed data from error objects
  
  return { text: message, structures };
}

/**
 * Smart message formatter that detects and formats known data structures
 */
export function SmartMessageFormatter({ 
  message, 
  errorData,
  errorType
}: { 
  message: string; 
  errorData?: Record<string, unknown>;
  errorType?: string;
}) {
  const formattedParts = useMemo(() => {
    if (!errorData) return null;
    
    // Use the recursive finder to detect nested structures
    const parts = findAndFormatNested(errorData);
    
    return parts.length > 0 ? parts : null;
  }, [errorData]);
  
  // Don't show the original message text if we have budget comparison (it's redundant)
  const shouldHideMessage = formattedParts?.some(p => p.key === "budget_comparison");
  
  // Determine the display message:
  // 1. If errorType is known, use human-readable message
  // 2. Otherwise, clean up the original message
  // 3. If message looks like JSON, try to use human-readable instead
  const displayMessage = useMemo(() => {
    if (shouldHideMessage) return "";
    
    // Check if we have a known error type with a human-readable message
    if (errorType) {
      const humanMessage = getHumanReadableMessage(errorType, errorData);
      if (humanMessage !== null) {
        return humanMessage;
      }
    }
    
    // Check if message looks like JSON (starts with { or [)
    const trimmedMsg = message.trim();
    if ((trimmedMsg.startsWith("{") || trimmedMsg.startsWith("[")) && errorType) {
      const humanMessage = getHumanReadableMessage(errorType, errorData);
      if (humanMessage !== null) {
        return humanMessage;
      }
      // If we still don't have a human message but it's JSON, show a generic message
      return errorType.replace(/([A-Z])/g, " $1").trim();
    }
    
    // Clean up message when we have formatted structures below
    if (formattedParts) {
      return cleanupErrorMessage(message, errorType || "");
    }
    
    return message;
  }, [message, errorType, errorData, formattedParts, shouldHideMessage]);
  
  return (
    <div className="smart-message-formatter">
      {!shouldHideMessage && displayMessage && <div className="message-text">{displayMessage}</div>}
      {formattedParts && (
        <div className="message-structures">
          {formattedParts.map(({ key, formatted }) => (
            <div key={key} className="message-structure-item">
              {key !== "budget_comparison" && (
                <span className="structure-key">{key.replace(/_/g, " ")}:</span>
              )}
              {formatted.component}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a Phase1Error or Phase2Error with smart formatting
 */
export function ErrorFormatter({ 
  error,
  errorType,
  message 
}: { 
  error: Record<string, unknown>;
  errorType?: string;
  message: string;
}) {
  // The error data is already extracted by extractErrorInfo in TransactionValidatorContent
  // Just pass it directly to SmartMessageFormatter
  return (
    <SmartMessageFormatter 
      message={message} 
      errorData={error}
      errorType={errorType}
    />
  );
}

/**
 * Returns only the formatted structures (errorData) without the message text.
 * Used for showing details under a "cut"/accordion.
 */
export function ErrorDataDetails({ 
  error
}: { 
  error: Record<string, unknown>;
}) {
  const formattedParts = useMemo(() => {
    if (!error) return null;
    const parts = findAndFormatNested(error);
    return parts.length > 0 ? parts : null;
  }, [error]);
  
  if (!formattedParts) return null;
  
  return (
    <div className="smart-message-formatter">
      <div className="message-structures">
        {formattedParts.map(({ key, formatted }) => (
          <div key={key} className="message-structure-item">
            {key !== "budget_comparison" && (
              <span className="structure-key">{key.replace(/_/g, " ")}:</span>
            )}
            {formatted.component}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Returns only the cleaned/human-readable message text without structures.
 * Used for showing in the header of diagnostics.
 */
export function getCleanedErrorMessage(
  message: string,
  errorType?: string,
  errorData?: Record<string, unknown>
): string {
  // First, try to use error type cleanup if available (this handles budget_comparison, etc.)
  if (errorType) {
    const cleanup = ERROR_TYPE_CLEANUPS[errorType];
    if (cleanup) {
      return cleanup(message);
    }
  }
  
  // Check if we have a known error type with a human-readable message
  if (errorType && errorData) {
    const humanMessage = getHumanReadableMessage(errorType, errorData);
    if (humanMessage !== null) {
      return humanMessage;
    }
  }
  
  // Check if message looks like JSON (starts with { or [)
  const trimmedMsg = message.trim();
  if ((trimmedMsg.startsWith("{") || trimmedMsg.startsWith("[")) && errorType) {
    if (errorData) {
      const humanMessage = getHumanReadableMessage(errorType, errorData);
      if (humanMessage !== null) {
        return humanMessage;
      }
    }
    // If we still don't have a human message but it's JSON, show a generic message
    return errorType.replace(/([A-Z])/g, " $1").trim();
  }
  
  // Clean up message when we have formatted structures
  if (errorData) {
    const parts = findAndFormatNested(errorData);
    if (parts.length > 0) {
      return cleanupErrorMessage(message, errorType || "");
    }
  }
  
  return message;
}

