"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ResizablePanels from "@/components/ResizablePanels";
import ValidationJsonViewer, { type ValidationDiagnostic } from "@/components/ValidationJsonViewer";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Tabs from "@radix-ui/react-tabs";
import * as Accordion from "@radix-ui/react-accordion";
import * as Progress from "@radix-ui/react-progress";
import Select from "@/components/Select";
import {
  XCircleIcon,
  WarningIcon,
  InfoIcon,
  SuccessIcon,
  InfoCircleIcon,
  CheckCircleIcon,
  SpinnerIcon,
  ChevronDownIcon,
  CopyIcon,
  CheckIcon,
} from "@/components/Icons";
import { ErrorDataDetails, getCleanedErrorMessage } from "@/components/ErrorDataFormatters";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import EmptyStatePlaceholder from "@/components/EmptyStatePlaceholder";
import {
  validateTransaction,
  type NetworkType,
} from "@/utils/transactionValidation";
import { decode_specific_type, extract_hashes_from_transaction_js } from "@cardananium/cquisitor-lib";
import type { ExtractedHashes } from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import { reorderTransactionFields } from "@/utils/reorderTransactionFields";
import { useTransactionValidator, type DecodedTransaction } from "@/context/TransactionValidatorContext";
import TransactionCardView from "@/components/TransactionCardView";
import ViewModeSelectionModal, { type ViewMode } from "@/components/ViewModeSelectionModal";
import type {
  ValidationPhase1Error,
  ValidationPhase2Error,
  ValidationPhase1Warning,
  ValidationPhase2Warning,
  EvalRedeemerResult,
} from "@cardananium/cquisitor-lib";

// Storage keys for view mode preference
const VIEW_MODE_STORAGE_KEY = "cquisitor_tx_validator_view_mode";
const VIEW_MODE_SELECTED_KEY = "cquisitor_tx_validator_view_mode_selected";

// Check if string is valid hex
function isValidHex(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed.length === 0) return false;
  return /^[0-9a-fA-F]+$/.test(trimmed);
}

// Check if string is valid base64
function isValidBase64(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed.length === 0) return false;
  // Check base64 format: alphanumeric, +, /, and optional padding =
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)) return false;
  if (trimmed.length % 4 !== 0) return false;
  try {
    const decoded = Buffer.from(trimmed, "base64");
    // Verify it's actually valid by re-encoding
    return decoded.length > 0 && Buffer.from(decoded).toString("base64") === trimmed;
  } catch {
    return false;
  }
}

// Convert base64 to hex
function base64ToHex(base64: string): string {
  return Buffer.from(base64.trim(), "base64").toString("hex");
}

// Process input: convert base64 to hex if needed
function processTransactionInput(input: string): { hex: string; wasBase64: boolean } {
  const trimmed = input.trim();
  
  // If it's already valid hex, return as is
  if (isValidHex(trimmed)) {
    return { hex: trimmed, wasBase64: false };
  }
  
  // Try to convert from base64
  if (isValidBase64(trimmed)) {
    return { hex: base64ToHex(trimmed), wasBase64: true };
  }
  
  // Return as-is (will fail validation with proper error)
  return { hex: trimmed, wasBase64: false };
}

type DiagnosticSeverity = "error" | "warning" | "info" | "success";

interface DiagnosticItem {
  severity: DiagnosticSeverity;
  message: string;
  details?: string;
  hint?: string | null;
  locations?: string[];
  phase?: string;
  errorType?: string;
  errorData?: Record<string, unknown>;
}

function extractErrorInfo(error: unknown): { errorType?: string; errorData?: Record<string, unknown> } {
  if (!error || typeof error !== "object") return {};
  // The error is typically an enum with a single key containing the data
  const keys = Object.keys(error);
  if (keys.length === 1) {
    const errorType = keys[0];
    const data = (error as Record<string, unknown>)[errorType];
    if (data && typeof data === "object") {
      return { errorType, errorData: data as Record<string, unknown> };
    }
    return { errorType };
  }
  return { errorData: error as Record<string, unknown> };
}

function formatPhase1Error(err: ValidationPhase1Error): DiagnosticItem {
  const { errorType, errorData } = extractErrorInfo(err.error);
  return {
    severity: "error",
    message: err.error_message,
    hint: err.hint,
    locations: err.locations,
    phase: "Phase 1",
    errorType,
    errorData,
  };
}

function formatPhase2Error(err: ValidationPhase2Error): DiagnosticItem {
  const { errorType, errorData } = extractErrorInfo(err.error);
  return {
    severity: "error",
    message: err.error_message,
    hint: err.hint,
    locations: err.locations,
    phase: "Phase 2",
    errorType,
    errorData,
  };
}

function formatPhase1Warning(warn: ValidationPhase1Warning): DiagnosticItem {
  const { errorType, errorData } = extractErrorInfo(warn.warning);
  return {
    severity: "warning",
    message: warn.warning_message,
    hint: warn.hint,
    locations: warn.locations,
    phase: "Phase 1",
    errorType,
    errorData,
  };
}

function formatPhase2Warning(warn: ValidationPhase2Warning): DiagnosticItem {
  const { errorType, errorData } = extractErrorInfo(warn.warning);
  return {
    severity: "warning",
    message: warn.warning_message,
    hint: warn.hint,
    locations: warn.locations,
    phase: "Phase 2",
    errorType,
    errorData,
  };
}

// Note: formatRedeemerResult was removed as Plutus results are now shown in a dedicated tab

function DiagnosticIcon({ severity }: { severity: DiagnosticSeverity }) {
  switch (severity) {
    case "error":
      return <XCircleIcon size={16} className="text-red-500 flex-shrink-0" />;
    case "warning":
      return <WarningIcon size={16} className="text-yellow-500 flex-shrink-0" />;
    case "info":
      return <InfoIcon size={16} className="text-blue-500 flex-shrink-0" />;
    case "success":
      return <SuccessIcon size={16} className="text-green-500 flex-shrink-0" />;
  }
}

// Format diagnostics to markdown for copying
function formatDiagnosticsToMarkdown(items: DiagnosticItem[]): string {
  if (items.length === 0) return "✅ No problems detected";
  
  const errors = items.filter(i => i.severity === "error");
  const warnings = items.filter(i => i.severity === "warning");
  
  let md = "";
  
  if (errors.length > 0) {
    md += `## ❌ Errors (${errors.length})\n\n`;
    errors.forEach((item, idx) => {
      md += `### ${idx + 1}. [${item.phase}] ${item.message}\n`;
      if (item.details) md += `- **Details:** ${item.details}\n`;
      if (item.hint) md += `- **Hint:** ${item.hint}\n`;
      if (item.locations && item.locations.length > 0) {
        md += `- **Location:** \`${item.locations.join("`, `")}\`\n`;
      }
      md += "\n";
    });
  }
  
  if (warnings.length > 0) {
    md += `## ⚠️ Warnings (${warnings.length})\n\n`;
    warnings.forEach((item, idx) => {
      md += `### ${idx + 1}. [${item.phase}] ${item.message}\n`;
      if (item.details) md += `- **Details:** ${item.details}\n`;
      if (item.hint) md += `- **Hint:** ${item.hint}\n`;
      if (item.locations && item.locations.length > 0) {
        md += `- **Location:** \`${item.locations.join("`, `")}\`\n`;
      }
      md += "\n";
    });
  }
  
  return md.trim();
}

function DiagnosticsList({ items, onLocationClick }: { 
  items: DiagnosticItem[]; 
  onLocationClick?: (locations: string[]) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="diagnostics-container">
        <div className="diagnostics-empty">
          <DiagnosticIcon severity="success" />
          <span>No problems detected</span>
        </div>
      </div>
    );
  }

  // Items with details can be expanded - expand all by default
  const expandableItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.details || item.hint || item.errorData || (item.locations && item.locations.length > 0));
  
  const defaultExpanded = expandableItems.map(({ index }) => `diag-${index}`);

  return (
    <div className="diagnostics-container">
      <Accordion.Root 
        type="multiple" 
        defaultValue={defaultExpanded}
        className="diagnostics-accordion"
      >
        {items.map((item, index) => {
          // Get cleaned message for display in header
          const displayMessage = item.errorData 
            ? getCleanedErrorMessage(item.message, item.errorType, item.errorData)
            : item.message;
          
          // Content under cut: errorData structures, details, hint, locations
          const hasExpandableContent = item.errorData || item.details || item.hint || (item.locations && item.locations.length > 0);
          
          return (
            <Accordion.Item 
              key={index} 
              value={`diag-${index}`}
              className={`diagnostic-accordion-item diagnostic-${item.severity}`}
              disabled={!hasExpandableContent}
            >
              <Accordion.Header className="diagnostic-accordion-header">
                <Accordion.Trigger className="diagnostic-accordion-trigger">
                  <DiagnosticIcon severity={item.severity} />
                  {item.phase && <span className="diagnostic-phase">{item.phase}</span>}
                  <span className="diagnostic-message">{displayMessage || item.message}</span>
                  {hasExpandableContent && (
                    <ChevronDownIcon size={16} className="diagnostic-chevron" />
                  )}
                </Accordion.Trigger>
              </Accordion.Header>
              
              {hasExpandableContent && (
                <Accordion.Content className="diagnostic-accordion-content">
                  <div className="diagnostic-details">
                    {item.errorData && (
                      <ErrorDataDetails error={item.errorData} />
                    )}
                    {item.details && (
                      <div className="diagnostic-detail-row">
                        <span className="diagnostic-detail-label">Details:</span>
                        <span className="diagnostic-detail-value">{item.details}</span>
                      </div>
                    )}
                    {item.hint && (
                      <div className="diagnostic-detail-row">
                        <span className="diagnostic-detail-label">Hint:</span>
                        <span className="diagnostic-detail-value diagnostic-hint">{item.hint}</span>
                      </div>
                    )}
                    {item.locations && item.locations.length > 0 && (
                      <div className="diagnostic-detail-row diagnostic-locations-row">
                        <span className="diagnostic-detail-label">Location{item.locations.length > 1 ? 's' : ''}:</span>
                        <div className="diagnostic-locations-list">
                          {item.locations.map((loc, locIndex) => (
                            <button 
                              key={locIndex}
                              className="diagnostic-location-chip"
                              onClick={(e) => {
                                e.stopPropagation();
                                onLocationClick?.([loc]);
                              }}
                              title={`Navigate to ${loc}`}
                            >
                              <span className="location-chip-icon">📍</span>
                              {loc}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Accordion.Content>
              )}
            </Accordion.Item>
          );
        })}
      </Accordion.Root>
    </div>
  );
}

// Progress bar component for execution units
function ExUnitProgress({ 
  label, 
  used, 
  total, 
  unit 
}: { 
  label: string; 
  used: bigint; 
  total: bigint; 
  unit: string;
}) {
  const percentage = total > BigInt(0) ? Number((used * BigInt(100)) / total) : 0;
  const isOverBudget = used > total;
  
  return (
    <div className="exunit-progress-row">
      <div className="exunit-progress-header">
        <span className="exunit-progress-label">{label}</span>
        <span className="exunit-progress-values">
          <span className={isOverBudget ? 'text-red-400' : ''}>
            {used.toLocaleString()}
          </span>
          <span className="exunit-progress-separator">/</span>
          <span>{total.toLocaleString()}</span>
          <span className="exunit-progress-unit">{unit}</span>
        </span>
      </div>
      <Progress.Root 
        className={`exunit-progress-root ${isOverBudget ? 'over-budget' : ''}`} 
        value={Math.min(percentage, 100)}
      >
        <Progress.Indicator 
          className={`exunit-progress-indicator ${isOverBudget ? 'error' : percentage > 80 ? 'warning' : 'success'}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </Progress.Root>
      <span className={`exunit-progress-percent ${isOverBudget ? 'over-budget' : ''}`}>
        {isOverBudget && <span className="over-budget-label">OVER</span>}
        {percentage.toFixed(1)}%
      </span>
    </div>
  );
}

// Plutus Script Results component with Accordion
function PlutusScriptResults({ results }: { results: EvalRedeemerResult[] }) {
  if (results.length === 0) {
    return (
      <div className="plutus-empty-state">
        <div className="plutus-empty-icon">📜</div>
        <p>No Plutus scripts in this transaction</p>
      </div>
    );
  }

  // Start with all items expanded
  const defaultValue = results.map((_, i) => `item-${i}`);

  return (
    <Accordion.Root 
      type="multiple" 
      defaultValue={defaultValue}
      className="plutus-accordion"
    >
      {results.map((result, index) => {
        const providedMem = BigInt(result.provided_ex_units.mem);
        const providedSteps = BigInt(result.provided_ex_units.steps);
        const calculatedMem = result.success ? BigInt(result.calculated_ex_units.mem) : BigInt(0);
        const calculatedSteps = result.success ? BigInt(result.calculated_ex_units.steps) : BigInt(0);
        
        return (
          <Accordion.Item 
            key={index} 
            value={`item-${index}`}
            className={`plutus-accordion-item ${result.success ? 'success' : 'error'}`}
          >
            <Accordion.Header className="plutus-accordion-header">
              <Accordion.Trigger className="plutus-accordion-trigger">
                <div className="plutus-accordion-title">
                  <span className="plutus-result-tag">{result.tag}[{result.index}]</span>
                  {result.success ? (
                    <span className="plutus-status-badge success">
                      <SuccessIcon size={14} />
                      Success
                    </span>
                  ) : (
                    <span className="plutus-status-badge error">
                      <XCircleIcon size={14} />
                      Failed
                    </span>
                  )}
                </div>
                <ChevronDownIcon size={16} className="plutus-accordion-chevron" />
              </Accordion.Trigger>
            </Accordion.Header>
            
            <Accordion.Content className="plutus-accordion-content">
              <div className="plutus-accordion-body">
                {result.success ? (
                  <div className="exunit-progress-container">
                    <ExUnitProgress 
                      label="Memory" 
                      used={calculatedMem} 
                      total={providedMem} 
                      unit="mem" 
                    />
                    <ExUnitProgress 
                      label="CPU Steps" 
                      used={calculatedSteps} 
                      total={providedSteps} 
                      unit="steps" 
                    />
                  </div>
                ) : (
                  <>
                    <div className="plutus-provided-units">
                      <span className="plutus-ex-label">Provided Budget:</span>
                      <span>{providedMem.toLocaleString()} mem</span>
                      <span className="plutus-separator">•</span>
                      <span>{providedSteps.toLocaleString()} steps</span>
                    </div>
                    {result.error && (
                      <div className="plutus-error-message">
                        {result.error}
                      </div>
                    )}
                  </>
                )}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        );
      })}
    </Accordion.Root>
  );
}

export default function TransactionValidatorContent() {
  const {
    txInput,
    setTxInput,
    network,
    setNetwork,
    apiKey,
    isLoading,
    setIsLoading,
    result,
    setResult,
    error,
    setError,
    decodedTx,
    setDecodedTx,
    decodeError,
    setDecodeError,
    activeTab,
    setActiveTab,
    focusedPath,
    setFocusedPath,
    extractedHashes,
    setExtractedHashes,
    inputUtxoInfoMap,
    setInputUtxoInfoMap,
    handleApiKeyChange,
    clearAll,
  } = useTransactionValidator();
  
  const focusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  
  // View mode state - load from localStorage if available
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === "tree" || saved === "cards") {
        return saved;
      }
    }
    return "cards";
  });
  
  // Track if user has ever selected a view mode
  const [hasSelectedViewMode, setHasSelectedViewMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(VIEW_MODE_SELECTED_KEY) === "true";
    }
    return false;
  });
  
  // Modal visibility state
  const [showViewModeModal, setShowViewModeModal] = useState(false);
  
  // Track if we should show modal after first decode
  const shouldShowModalRef = useRef(false);
  
  const previousTxHashRef = useRef<string | null>(null);

  // Transform validation paths to actual JSON paths
  // Specific transformations for known path differences
  const transformPathForJson = useCallback((path: string): string => {
    // transaction.witness_set.plutus_data.X -> transaction.witness_set.plutus_data.elems.X
    if (path.startsWith('transaction.witness_set.plutus_data.')) {
      const suffix = path.slice('transaction.witness_set.plutus_data.'.length);
      // Check if suffix starts with a number
      if (/^\d+/.test(suffix)) {
        return `transaction.witness_set.plutus_data.elems.${suffix}`;
      }
    }
    return path;
  }, []);

  // Handle clicking on a location in diagnostics
  const handleLocationClick = useCallback((locations: string[]) => {
    const transformedPaths = locations.map(transformPathForJson);
    setFocusedPath(transformedPaths);
    
    // Clear previous timeout if exists
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
    }
    
    // Set new timeout to clear focus after animation completes
    focusTimeoutRef.current = setTimeout(() => {
      setFocusedPath(null);
      focusTimeoutRef.current = null;
    }, 2000);
  }, [transformPathForJson, setFocusedPath]);

  // Handle view mode selection from modal
  const handleViewModeSelect = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setHasSelectedViewMode(true);
    setShowViewModeModal(false);
    
    // Save to localStorage
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    localStorage.setItem(VIEW_MODE_SELECTED_KEY, "true");
  }, []);

  // Handle modal close without selection (defaults to cards)
  const handleViewModeModalClose = useCallback(() => {
    setShowViewModeModal(false);
    // Don't mark as selected - will show again on next fresh decode
  }, []);

  // Decode transaction when input changes
  useEffect(() => {
    if (!txInput.trim()) {
      setDecodedTx(null);
      setDecodeError(null);
      setExtractedHashes(null);
      previousTxHashRef.current = null;
      shouldShowModalRef.current = false;
      return;
    }

    const { hex } = processTransactionInput(txInput);
    
    try {
      const decoded = decode_specific_type(hex, "Transaction", {});
      let convertedResult = convertSerdeNumbers(decoded);
      convertedResult = reorderTransactionFields(convertedResult);
      const newDecodedTx = convertedResult as DecodedTransaction;
      
      // Check if the transaction hash has changed
      const newTxHash = newDecodedTx.transaction_hash;
      const isNewTransaction = previousTxHashRef.current === null || previousTxHashRef.current !== newTxHash;
      
      if (previousTxHashRef.current !== null && previousTxHashRef.current !== newTxHash) {
        // Transaction hash changed - reset validation results
        setResult(null);
        setError(null);
        setInputUtxoInfoMap(null);
        setFocusedPath(null);
      }
      
      // Show view mode modal on first successful decode if user hasn't selected before
      if (isNewTransaction && previousTxHashRef.current === null && !hasSelectedViewMode) {
        shouldShowModalRef.current = true;
      }
      
      previousTxHashRef.current = newTxHash ?? null;
      
      setDecodedTx(newDecodedTx);
      setDecodeError(null);
      
      // Extract hashes for datums and scripts
      try {
        const hashesJson = extract_hashes_from_transaction_js(hex);
        const hashes: ExtractedHashes = JSON.parse(hashesJson);
        setExtractedHashes(hashes);
      } catch {
        // Ignore hash extraction errors - not critical
        setExtractedHashes(null);
      }
      
      // Show modal after state updates
      if (shouldShowModalRef.current) {
        shouldShowModalRef.current = false;
        setShowViewModeModal(true);
      }
    } catch (e) {
      setDecodeError(e instanceof Error ? e.message : "Failed to decode transaction");
      setDecodedTx(null);
      setExtractedHashes(null);
      previousTxHashRef.current = null;
      shouldShowModalRef.current = false;
    }
  }, [txInput, setDecodedTx, setDecodeError, setExtractedHashes, setResult, setError, setInputUtxoInfoMap, setFocusedPath, hasSelectedViewMode]);

  const handleValidate = async () => {
    if (!apiKey.trim()) {
      setError("Koios API Key is required. Get one at koios.rest/pricing/Pricing.html");
      return;
    }

    if (!txInput.trim()) {
      setError("Please enter a transaction CBOR hex or base64");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setInputUtxoInfoMap(null);

    try {
      // Process input - convert base64 to hex if needed
      const { hex } = processTransactionInput(txInput);

      const { result: validationResult, utxoInfoMap } = await validateTransaction({
        txHex: hex,
        network,
        apiKey: apiKey.trim(),
      });
      setResult(validationResult);
      setInputUtxoInfoMap(utxoInfoMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Build diagnostics list from validation result (excluding redeemer results)
  const diagnostics: DiagnosticItem[] = [];
  if (result) {
    // Phase 1 errors first
    result.errors.forEach(err => {
      diagnostics.push(formatPhase1Error(err));
    });
    
    // Phase 2 errors
    result.phase2_errors.forEach(err => {
      diagnostics.push(formatPhase2Error(err));
    });
    
    // Phase 1 warnings
    result.warnings.forEach(warn => {
      diagnostics.push(formatPhase1Warning(warn));
    });
    
    // Phase 2 warnings
    result.phase2_warnings.forEach(warn => {
      diagnostics.push(formatPhase2Warning(warn));
    });
  }

  // Count errors and warnings for tab badges
  const errorCount = diagnostics.filter(d => d.severity === "error").length;
  const warningCount = diagnostics.filter(d => d.severity === "warning").length;

  // Copy diagnostics to clipboard as markdown
  const handleCopyDiagnostics = () => {
    const markdown = formatDiagnosticsToMarkdown(diagnostics);
    navigator.clipboard.writeText(markdown);
    setCopiedDiagnostics(true);
    setTimeout(() => setCopiedDiagnostics(false), 2000);
  };

  // Build diagnostics for the JSON viewer (with locations for tree highlighting)
  // Transform paths to match actual JSON structure
  const jsonViewerDiagnostics: ValidationDiagnostic[] = [];
  if (result) {
    result.errors.forEach(err => {
      const { errorType, errorData } = extractErrorInfo(err.error);
      jsonViewerDiagnostics.push({
        severity: "error",
        message: err.error_message,
        hint: err.hint,
        locations: err.locations?.map(transformPathForJson),
        phase: "Phase 1",
        errorType,
        errorData,
      });
    });
    
    result.phase2_errors.forEach(err => {
      const { errorType, errorData } = extractErrorInfo(err.error);
      jsonViewerDiagnostics.push({
        severity: "error",
        message: err.error_message,
        hint: err.hint,
        locations: err.locations?.map(transformPathForJson),
        phase: "Phase 2",
        errorType,
        errorData,
      });
    });
    
    result.warnings.forEach(warn => {
      const { errorType, errorData } = extractErrorInfo(warn.warning);
      jsonViewerDiagnostics.push({
        severity: "warning",
        message: warn.warning_message,
        hint: warn.hint,
        locations: warn.locations?.map(transformPathForJson),
        phase: "Phase 1",
        errorType,
        errorData,
      });
    });
    
    result.phase2_warnings.forEach(warn => {
      const { errorType, errorData } = extractErrorInfo(warn.warning);
      jsonViewerDiagnostics.push({
        severity: "warning",
        message: warn.warning_message,
        hint: warn.hint,
        locations: warn.locations?.map(transformPathForJson),
        phase: "Phase 2",
        errorType,
        errorData,
      });
    });
  }

  // Left panel: Input, controls, and tabs
  const leftPanel = (
    <div className="panel-content validator-left-new">
      {/* Title bar */}
      <div className="panel-header-compact">
        <span className="panel-title">Transaction Validator</span>
        <HelpTooltip>
          <strong>How to use:</strong> Paste transaction CBOR (hex or base64), enter your Koios API key, then click Validate to check Phase 1 &amp; 2 validation rules. Click on errors to navigate to the problematic field.
        </HelpTooltip>
        <button onClick={clearAll} className="btn-icon" title="Clear">
          ✕
        </button>
      </div>

      {/* Controls row: Network + API Key */}
      <div className="validator-controls-row">
        <div className="control-group">
          <label>Network</label>
          <Select
            value={network}
            onValueChange={(value) => setNetwork(value as NetworkType)}
            options={[
              { value: "mainnet", label: "Mainnet" },
              { value: "preview", label: "Preview" },
              { value: "preprod", label: "Preprod" },
            ]}
          />
        </div>

        <div className="control-group flex-1">
          <label htmlFor="api-key" className="api-key-label">
            Koios API Key <span className="text-red-500">*</span>
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button type="button" className="info-icon-button">
                    <InfoCircleIcon size={13} className="info-icon" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="tooltip-content" sideOffset={5} side="bottom">
                    <p>API key is required to fetch blockchain data from Koios API for transaction validation.</p>
                    <a 
                      href="https://koios.rest/pricing/Pricing.html" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="tooltip-link"
                    >
                      Get your API key at koios.rest →
                    </a>
                    <Tooltip.Arrow className="tooltip-arrow" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            placeholder="Enter your Koios API key"
            className={`validator-input ${!apiKey.trim() ? 'validator-input-required' : ''}`}
          />
        </div>
      </div>

      {/* Usage hint */}
      <HintBanner storageKey="cquisitor_hint_validator">
        <strong>How to use:</strong> Paste transaction CBOR (hex or base64), enter your Koios API key, then click <strong>Validate</strong> to check Phase 1 &amp; 2 validation rules.
      </HintBanner>

      {/* CBOR input row with Validate button */}
      <div className="validator-input-row">
        <div className="validator-textarea-wrapper">
          {!txInput.trim() && (
            <div className="paste-hint-overlay paste-hint-overlay-small">
              <svg
                className="paste-hint-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="8" y="2" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M16 4H18C19.1046 4 20 4.89543 20 6V20C20 21.1046 19.1046 22 18 22H6C4.89543 22 4 21.1046 4 20V6C4 4.89543 4.89543 4 6 4H8" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="paste-hint-text">Paste here</span>
              <span className="paste-hint-formats">HEX · Base64</span>
            </div>
          )}
          <textarea
            value={txInput}
            onChange={(e) => setTxInput(e.target.value)}
            placeholder=""
            className="validator-cbor-input"
            spellCheck={false}
            rows={3}
          />
        </div>
        <button
          onClick={handleValidate}
          disabled={isLoading || !txInput.trim() || !apiKey.trim()}
          className="validator-validate-btn"
        >
          {isLoading ? (
            <SpinnerIcon size={18} className="animate-spin" />
          ) : (
            <CheckCircleIcon size={18} />
          )}
          <span>{isLoading ? "Validating..." : "Validate"}</span>
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="validator-error-banner">
          <DiagnosticIcon severity="error" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs: Validation Result / Plutus Scripts with status indicator */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="validator-tabs">
        <Tabs.List className="validator-tabs-list">
          <Tabs.Trigger value="validation" className="validator-tab">
            Validation Result
            {errorCount > 0 && (
              <span className="validator-tab-badge error">
                <XCircleIcon size={12} />
                {errorCount}
              </span>
            )}
            {warningCount > 0 && (
              <span className="validator-tab-badge warning">
                <WarningIcon size={12} />
                {warningCount}
              </span>
            )}
          </Tabs.Trigger>
          <Tabs.Trigger value="plutus" className="validator-tab">
            Plutus Scripts
            {result && result.eval_redeemer_results.length > 0 && (
              <span className="validator-tab-count">{result.eval_redeemer_results.length}</span>
            )}
          </Tabs.Trigger>
          
          {/* Copy button - only show when on validation tab and has diagnostics */}
          {activeTab === "validation" && diagnostics.length > 0 && (
            <button 
              className={`diagnostics-copy-btn tabs-copy-btn ${copiedDiagnostics ? 'copied' : ''}`}
              onClick={handleCopyDiagnostics}
              title="Copy all diagnostics as Markdown"
            >
              {copiedDiagnostics ? (
                <>
                  <CheckIcon size={12} />
                  Copied!
                </>
              ) : (
                <>
                  <CopyIcon size={12} />
                  Copy
                </>
              )}
            </button>
          )}
        </Tabs.List>

        <Tabs.Content value="validation" className="validator-tab-content">
          {result ? (
            <DiagnosticsList items={diagnostics} onLocationClick={handleLocationClick} />
          ) : (
            <div className="empty-state">
              <p className="empty-hint">
                Enter transaction CBOR and click &quot;Validate&quot; to see results
              </p>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="plutus" className="validator-tab-content">
          {result ? (
            <PlutusScriptResults results={result.eval_redeemer_results} />
          ) : (
            <div className="empty-state">
              <p className="empty-hint">
                Validate a transaction to see Plutus script execution results
              </p>
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );

  // View mode toggle icons
  const TreeIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h18M9 21V9M21 3v18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
    </svg>
  );
  
  const CardsIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );

  // Right panel: Decoded JSON with validation highlights
  const rightPanel = (
    <div className="panel-content validator-right-new">
      <div className="panel-header-compact">
        <span className="panel-title">Decoded Transaction</span>
        {decodedTx && (
          <>
            <span className="panel-badge success">Parsed</span>
            <div className="tcv-view-toggle" style={{ marginLeft: 'auto' }}>
              <button
                className={`tcv-view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
                onClick={() => handleViewModeSelect('cards')}
                title="Card View"
              >
                <CardsIcon />
                Cards
              </button>
              <button
                className={`tcv-view-toggle-btn ${viewMode === 'tree' ? 'active' : ''}`}
                onClick={() => handleViewModeSelect('tree')}
                title="Tree View"
              >
                <TreeIcon />
                Tree
              </button>
            </div>
          </>
        )}
      </div>
      
      {decodedTx ? (
        viewMode === 'cards' ? (
          <TransactionCardView
            data={decodedTx}
            network={network}
            diagnostics={jsonViewerDiagnostics}
            focusedPath={focusedPath}
            extractedHashes={extractedHashes}
            inputUtxoInfoMap={inputUtxoInfoMap}
          />
        ) : (
          <ValidationJsonViewer 
            data={decodedTx} 
            expanded={3} 
            network={network}
            diagnostics={jsonViewerDiagnostics}
            focusedPath={focusedPath}
          />
        )
      ) : decodeError ? (
        <div className="empty-state">
          <p className="empty-hint error-text">{decodeError}</p>
        </div>
      ) : (
        <EmptyStatePlaceholder
          title="Transaction Validator"
          description="Paste transaction CBOR (hex or base64) in the left panel, enter your Koios API key, then click Validate to check Phase 1 & 2 validation rules."
          showArrow={false}
          icon="validator"
        />
      )}
    </div>
  );

  return (
    <div className="validator-layout-new">
      <ResizablePanels
        leftPanel={leftPanel}
        rightPanel={rightPanel}
        defaultLeftWidth={50}
        minLeftWidth={30}
        maxLeftWidth={70}
      />
      
      {/* View mode selection modal - shown on first decode */}
      <ViewModeSelectionModal
        isOpen={showViewModeModal}
        onSelect={handleViewModeSelect}
        onClose={handleViewModeModalClose}
      />
    </div>
  );
}
