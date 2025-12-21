"use client";

import { useCallback, useEffect, useRef } from "react";
import CompactLayout from "@/components/CompactLayout";
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
} from "@/components/Icons";
import { ErrorFormatter } from "@/components/ErrorDataFormatters";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import {
  validateTransaction,
  type NetworkType,
} from "@/utils/transactionValidation";
import { decode_specific_type } from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import { reorderTransactionFields } from "@/utils/reorderTransactionFields";
import { useTransactionValidator, type DecodedTransaction } from "@/context/TransactionValidatorContext";
import type {
  ValidationPhase1Error,
  ValidationPhase2Error,
  ValidationPhase1Warning,
  ValidationPhase2Warning,
  EvalRedeemerResult,
} from "@cardananium/cquisitor-lib";

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
  const warningText = typeof warn.warning === "string" 
    ? warn.warning 
    : JSON.stringify(warn.warning);
  const { errorType, errorData } = extractErrorInfo(warn.warning);
  return {
    severity: "warning",
    message: warningText,
    hint: warn.hint,
    locations: warn.locations,
    phase: "Phase 1",
    errorType,
    errorData,
  };
}

function formatPhase2Warning(warn: ValidationPhase2Warning): DiagnosticItem {
  const warningText = typeof warn.warning === "object"
    ? JSON.stringify(warn.warning)
    : String(warn.warning);
  const { errorType, errorData } = extractErrorInfo(warn.warning);
  return {
    severity: "warning",
    message: warningText,
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

  // Items with details can be expanded
  const expandableItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.details || item.hint || (item.locations && item.locations.length > 0));
  
  const defaultExpanded = expandableItems.slice(0, 3).map(({ index }) => `diag-${index}`);

  return (
    <div className="diagnostics-container">
      <Accordion.Root 
        type="multiple" 
        defaultValue={defaultExpanded}
        className="diagnostics-accordion"
      >
        {items.map((item, index) => {
          const hasDetails = item.details || item.hint || (item.locations && item.locations.length > 0);
          
          return (
            <Accordion.Item 
              key={index} 
              value={`diag-${index}`}
              className={`diagnostic-accordion-item diagnostic-${item.severity}`}
              disabled={!hasDetails}
            >
              <Accordion.Header className="diagnostic-accordion-header">
                <Accordion.Trigger className="diagnostic-accordion-trigger">
                  <DiagnosticIcon severity={item.severity} />
                  <span className="diagnostic-phase">{item.phase}</span>
                  <span className="diagnostic-message">
                    {item.errorData ? (
                      <ErrorFormatter 
                        error={item.errorData} 
                        errorType={item.errorType}
                        message={item.message} 
                      />
                    ) : (
                      item.message
                    )}
                  </span>
                  {hasDetails && (
                    <ChevronDownIcon size={16} className="diagnostic-chevron" />
                  )}
                </Accordion.Trigger>
              </Accordion.Header>
              
              {hasDetails && (
                <Accordion.Content className="diagnostic-accordion-content">
                  <div className="diagnostic-details">
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
    handleApiKeyChange,
    clearAll,
  } = useTransactionValidator();
  
  const focusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Decode transaction when input changes
  useEffect(() => {
    if (!txInput.trim()) {
      setDecodedTx(null);
      setDecodeError(null);
      return;
    }

    const { hex } = processTransactionInput(txInput);
    
    try {
      const decoded = decode_specific_type(hex, "Transaction", {});
      let convertedResult = convertSerdeNumbers(decoded);
      convertedResult = reorderTransactionFields(convertedResult);
      setDecodedTx(convertedResult as DecodedTransaction);
      setDecodeError(null);
    } catch (e) {
      setDecodeError(e instanceof Error ? e.message : "Failed to decode transaction");
      setDecodedTx(null);
    }
  }, [txInput, setDecodedTx, setDecodeError]);

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

    try {
      // Process input - convert base64 to hex if needed
      const { hex } = processTransactionInput(txInput);

      const validationResult = await validateTransaction({
        txHex: hex,
        network,
        apiKey: apiKey.trim(),
      });
      setResult(validationResult);
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
      const warningText = typeof warn.warning === "string" 
        ? warn.warning 
        : JSON.stringify(warn.warning);
      const { errorType, errorData } = extractErrorInfo(warn.warning);
      jsonViewerDiagnostics.push({
        severity: "warning",
        message: warningText,
        hint: warn.hint,
        locations: warn.locations?.map(transformPathForJson),
        phase: "Phase 1",
        errorType,
        errorData,
      });
    });
    
    result.phase2_warnings.forEach(warn => {
      const warningText = typeof warn.warning === "object"
        ? JSON.stringify(warn.warning)
        : String(warn.warning);
      const { errorType, errorData } = extractErrorInfo(warn.warning);
      jsonViewerDiagnostics.push({
        severity: "warning",
        message: warningText,
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
        <textarea
          value={txInput}
          onChange={(e) => setTxInput(e.target.value)}
          placeholder="CBOR HEX or Base64..."
          className="validator-cbor-input"
          spellCheck={false}
          rows={3}
        />
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

  // Right panel: Decoded JSON with validation highlights
  const rightPanel = (
    <div className="panel-content validator-right-new">
      <div className="panel-header-compact">
        <span className="panel-title">Decoded Transaction</span>
        {decodedTx && (
          <span className="panel-badge success">Parsed</span>
        )}
      </div>
      
      {decodedTx ? (
        <ValidationJsonViewer 
          data={decodedTx} 
          expanded={3} 
          network={network}
          diagnostics={jsonViewerDiagnostics}
          focusedPath={focusedPath}
        />
      ) : (
        <div className="empty-state">
          {decodeError ? (
            <p className="empty-hint error-text">{decodeError}</p>
          ) : (
            <p className="empty-hint">
              Paste transaction CBOR to decode
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <CompactLayout>
      <div className="validator-layout-new">
        <ResizablePanels
          leftPanel={leftPanel}
          rightPanel={rightPanel}
          defaultLeftWidth={50}
          minLeftWidth={30}
          maxLeftWidth={70}
        />
      </div>
    </CompactLayout>
  );
}
