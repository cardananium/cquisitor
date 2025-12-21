"use client";

import { useMemo, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

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

function formatLovelace(lovelace: number): string {
  const ada = lovelace / 1_000_000;
  if (lovelace === 0) return "0 ₳";
  if (Math.abs(lovelace) < 1_000_000) {
    return `${lovelace.toLocaleString()} lovelace`;
  }
  return `${ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ₳`;
}

function formatAssetName(hexName: string): string {
  if (!hexName || hexName === "") return "(empty)";
  try {
    const bytes = hexName.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || [];
    const decoded = String.fromCharCode(...bytes);
    // Check if it's printable ASCII - show full name
    if (/^[\x20-\x7E]+$/.test(decoded)) {
      return decoded;
    }
    // Non-printable - show hex
    return hexName;
  } catch {
    return hexName;
  }
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Error types that have custom display formatters
 * Maps error type name to a cleanup function for the message
 */
const ERROR_TYPE_CLEANUPS: Record<string, (msg: string) => string> = {
  // Phase 1 errors with custom display
  BadInputsUTxO: (msg) => msg.replace(/:\s*TxInput\s*\{[^}]+\}/gi, "").trim(),
  
  ValueNotConservedUTxO: () => "Value not conserved",
  
  FeeTooSmallUTxO: (msg) => msg.replace(/\.\s*Fee decomposition:.*$/i, "").trim(),
  
  MissingDatum: (msg) => msg.replace(/Datum\s+[0-9a-fA-F]{64}\s+/gi, "Datum ").trim(),
  
  ExtraneousDatumWitnesses: (msg) => msg.replace(/:\s*[0-9a-fA-F]{56,64}\s*$/i, "").trim(),
  
  ScriptDataHashMismatch: (msg) => msg.replace(/\.\s*Expected:.*$/i, "").trim(),
  
  AuxiliaryDataHashMismatch: (msg) => msg.replace(/\.\s*Expected:.*$/i, "").trim(),
  
  ConflictingMetadataHash: (msg) => msg.replace(/\.\s*Expected:.*$/i, "").trim(),
  
  MissingVKeyWitnesses: (msg) => msg.replace(/:\s*\[?"?[0-9a-fA-F]{56,64}"?\]?\s*$/i, "").trim(),
  
  MissingScriptWitnesses: (msg) => msg.replace(/:\s*\[?"?[0-9a-fA-F]{56,64}"?\]?\s*$/i, "").trim(),
  
  InvalidSignature: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
  ExtraneousSignature: (msg) => msg.replace(/:\s*"?[0-9a-fA-F]{56,64}"?\s*$/i, "").trim(),
  
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
  
  BudgetIsBiggerThanExpected: () => "", // Hide message, show only formatted budget
};

/**
 * Cleans up error messages by removing redundant info that's shown in formatted structures below
 * Only cleans if we have a specific cleanup for this error type
 */
function cleanupErrorMessage(message: string, errorType: string): string {
  const cleanup = ERROR_TYPE_CLEANUPS[errorType];
  if (cleanup) {
    const cleaned = cleanup(message);
    // Final cleanup
    return cleaned
      .replace(/\s{2,}/g, " ")
      .replace(/[,:\s.]+$/, "")
      .trim();
  }
  return message;
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
  
  return (
    <Tooltip.Provider delayDuration={100}>
      <div className="error-formatter value-formatter">
        <div className={`value-coins ${isNegative ? "negative" : ""}`}>
          <span className="value-label">ADA:</span>
          <span className="value-amount">{formatLovelace(value.coins)}</span>
        </div>
        {hasAssets && (
          <div className="value-assets">
            <span className="value-label">Assets:</span>
            <div className="asset-list">
              {value.assets.assets.map((asset, idx) => (
                <div key={idx} className="asset-item">
                  <span className="asset-policy">{asset.policy_id}</span>
                  <span className="asset-separator">.</span>
                  <span className="asset-name">{formatAssetName(asset.asset_name)}</span>
                  <span className={`asset-quantity ${asset.quantity < 0 ? "negative" : ""}`}>
                    {asset.quantity < 0 ? "" : "+"}{asset.quantity.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Tooltip.Provider>
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
          <span className="fee-value">{formatLovelace(fee.txSizeFee)}</span>
          <span className="fee-percent">
            ({((fee.txSizeFee / total) * 100).toFixed(1)}%)
          </span>
        </div>
        <div className="fee-row">
          <span className="fee-label">Ref Scripts:</span>
          <span className="fee-value">{formatLovelace(fee.referenceScriptsFee)}</span>
          <span className="fee-percent">
            ({((fee.referenceScriptsFee / total) * 100).toFixed(1)}%)
          </span>
        </div>
        <div className="fee-row">
          <span className="fee-label">Execution:</span>
          <span className="fee-value">{formatLovelace(fee.executionUnitsFee)}</span>
          <span className="fee-percent">
            ({((fee.executionUnitsFee / total) * 100).toFixed(1)}%)
          </span>
        </div>
        <div className="fee-row fee-total">
          <span className="fee-label">Total:</span>
          <span className="fee-value">{formatLovelace(total)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats a Transaction Input reference (same style as HashFormatter)
 */
export function TxInputFormatter({ input }: { input: TxInput }) {
  const [copied, setCopied] = useState(false);
  const fullValue = `${input.txHash}#${input.outputIndex}`;
  
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fullValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip.Provider delayDuration={100}>
      <span className="hash-formatter">
        <code className="hash-value">{input.txHash}</code>
        <span className="tx-separator">#</span>
        <span className="tx-index">{input.outputIndex}</span>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span 
              role="button"
              tabIndex={0}
              className={`hash-copy-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopy}
              onKeyDown={(e) => e.key === 'Enter' && handleCopy(e as unknown as React.MouseEvent)}
            >
              {copied ? '✓' : '📋'}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="hash-tooltip-content" sideOffset={5}>
              {copied ? 'Copied!' : 'Copy input reference'}
              <Tooltip.Arrow className="hash-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </span>
    </Tooltip.Provider>
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
    <Tooltip.Provider delayDuration={100}>
      <span className={`hash-formatter ${inline ? 'inline' : ''}`}>
        {label && <span className="hash-label">{label}:</span>}
        <code className="hash-value">{hash}</code>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span 
              role="button"
              tabIndex={0}
              className={`hash-copy-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopy}
              onKeyDown={(e) => e.key === 'Enter' && handleCopy(e as unknown as React.MouseEvent)}
            >
              {copied ? '✓' : '📋'}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="hash-tooltip-content" sideOffset={5}>
              {copied ? 'Copied!' : 'Copy hash'}
              <Tooltip.Arrow className="hash-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </span>
    </Tooltip.Provider>
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
          <AddressFormatter address={addr} />
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
  
  // Check for address strings
  if (typeof value === "string" && (value.startsWith("addr") || value.startsWith("stake"))) {
    return {
      type: "Address",
      component: <AddressFormatter address={value} />
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
 */
function BudgetComparisonFormatter({ 
  expected, 
  actual 
}: { 
  expected: ExUnits; 
  actual: ExUnits;
}) {
  const memDiff = actual.mem - expected.mem;
  const stepsDiff = actual.steps - expected.steps;
  const isOverspending = memDiff > 0 || stepsDiff > 0;
  
  return (
    <div className="smart-message-formatter">
      <div className="message-text">
        {isOverspending 
          ? "Declared execution units exceed actual usage — you are overpaying transaction fees"
          : "Actual execution units differ from declared values"
        }
      </div>
      <div className="message-structures">
        <div className="message-structure-item">
          <span className="structure-key">Declared vs Actual:</span>
        </div>
        <div className="budget-comparison-inline">
          <span className="budget-inline-label">Memory:</span>
          <span className="budget-inline-value">{expected.mem.toLocaleString()}</span>
          <span className="budget-inline-arrow">→</span>
          <span className="budget-inline-value">{actual.mem.toLocaleString()}</span>
          {memDiff !== 0 && (
            <span className={`budget-inline-diff ${memDiff > 0 ? 'over' : 'under'}`}>
              ({memDiff > 0 ? '+' : ''}{memDiff.toLocaleString()})
            </span>
          )}
        </div>
        <div className="budget-comparison-inline">
          <span className="budget-inline-label">CPU:</span>
          <span className="budget-inline-value">{expected.steps.toLocaleString()}</span>
          <span className="budget-inline-arrow">→</span>
          <span className="budget-inline-value">{actual.steps.toLocaleString()}</span>
          {stepsDiff !== 0 && (
            <span className={`budget-inline-diff ${stepsDiff > 0 ? 'over' : 'under'}`}>
              ({stepsDiff > 0 ? '+' : ''}{stepsDiff.toLocaleString()})
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
  
  // Clean up message based on error type (only when we have custom display)
  const displayMessage = formattedParts && errorType
    ? cleanupErrorMessage(message, errorType) 
    : message;
  
  return (
    <div className="smart-message-formatter">
      {!shouldHideMessage && <div className="message-text">{displayMessage}</div>}
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

