"use client";

import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { bech32 } from "bech32";
import { blake2b } from "@noble/hashes/blake2.js";
import { ErrorFormatter } from "./ErrorDataFormatters";

type CardanoNetwork = "mainnet" | "preview" | "preprod";

// Diagnostic item structure (same as in TransactionValidatorContent)
export interface ValidationDiagnostic {
  severity: "error" | "warning";
  message: string;
  hint?: string | null;
  locations?: string[];
  phase?: string;
  errorType?: string;
  errorData?: Record<string, unknown>;
}

interface ValidationJsonViewerProps {
  data: unknown;
  network?: CardanoNetwork;
  diagnostics?: ValidationDiagnostic[];
  expanded?: number;
  focusedPath?: string[] | null;
}

// Build a map of paths to diagnostics for quick lookup
function buildDiagnosticsMap(diagnostics: ValidationDiagnostic[]): Map<string, ValidationDiagnostic[]> {
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

// Check if a path has diagnostics or any children with diagnostics
function pathHasDiagnostics(
  currentPath: string, 
  diagnosticsMap: Map<string, ValidationDiagnostic[]>
): ValidationDiagnostic[] {
  return diagnosticsMap.get(currentPath) || [];
}

// Check if any descendant path has diagnostics
function hasDescendantDiagnostics(
  currentPath: string,
  diagnosticsMap: Map<string, ValidationDiagnostic[]>
): boolean {
  for (const key of diagnosticsMap.keys()) {
    if (key.startsWith(currentPath + ".")) {
      return true;
    }
  }
  return false;
}

// Count descendant diagnostics by severity
function getDescendantDiagnosticCounts(
  currentPath: string,
  diagnosticsMap: Map<string, ValidationDiagnostic[]>
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  
  for (const [key, diagnostics] of diagnosticsMap.entries()) {
    if (key.startsWith(currentPath + ".")) {
      for (const d of diagnostics) {
        if (d.severity === "error") errors++;
        else if (d.severity === "warning") warnings++;
      }
    }
  }
  
  return { errors, warnings };
}

// Decode bech32 vkey and compute blake2b-224 hash
function computeVkeyHash(vkeyBech32: string): string | null {
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

// Get CardanoScan base URL for network
function getCardanoscanUrl(network: CardanoNetwork): string {
  switch (network) {
    case "mainnet":
      return "https://cardanoscan.io";
    case "preview":
      return "https://preview.cardanoscan.io";
    case "preprod":
      return "https://preprod.cardanoscan.io";
  }
}

// Prepare data: convert BigInt, Uint8Array, add vkey_hash
function prepareData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data === "bigint") {
    return data.toString();
  }
  if (data instanceof Uint8Array) {
    return Array.from(data);
  }
  if (Array.isArray(data)) {
    return data.map((item) => prepareData(item));
  }
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(data);
    
    for (const [key, value] of entries) {
      result[key] = prepareData(value);
      
      if (key === "vkey" && typeof value === "string" && value.startsWith("ed25519_pk")) {
        const vkeyHash = computeVkeyHash(value);
        if (vkeyHash) {
          result["vkey_hash"] = vkeyHash;
        }
      }
    }
    return result;
  }
  return data;
}

// Diagnostic indicator component
function DiagnosticIndicator({ diagnostics }: { diagnostics: ValidationDiagnostic[] }) {
  const hasErrors = diagnostics.some(d => d.severity === "error");
  const hasWarnings = diagnostics.some(d => d.severity === "warning");
  
  const errors = diagnostics.filter(d => d.severity === "error");
  const warnings = diagnostics.filter(d => d.severity === "warning");

  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="validation-indicator">
            {hasErrors && <span className="validation-icon error">⊗</span>}
            {hasWarnings && !hasErrors && <span className="validation-icon warning">⚠</span>}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="validation-tooltip" sideOffset={5} side="right">
            <div className="validation-tooltip-content">
              {errors.length > 0 && (
                <div className="validation-tooltip-section">
                  <div className="validation-tooltip-title error">
                    Errors ({errors.length})
                  </div>
                  {errors.map((err, i) => (
                    <div key={i} className="validation-tooltip-item">
                      <span className="validation-tooltip-phase">[{err.phase}]</span>
                      <span className="validation-tooltip-message">
                        {err.errorData ? (
                          <ErrorFormatter 
                            error={err.errorData} 
                            errorType={err.errorType}
                            message={err.message} 
                          />
                        ) : (
                          err.message
                        )}
                      </span>
                      {err.hint && (
                        <div className="validation-tooltip-hint">💡 {err.hint}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {warnings.length > 0 && (
                <div className="validation-tooltip-section">
                  <div className="validation-tooltip-title warning">
                    Warnings ({warnings.length})
                  </div>
                  {warnings.map((warn, i) => (
                    <div key={i} className="validation-tooltip-item">
                      <span className="validation-tooltip-phase">[{warn.phase}]</span>
                      <span className="validation-tooltip-message">
                        {warn.errorData ? (
                          <ErrorFormatter 
                            error={warn.errorData} 
                            errorType={warn.errorType}
                            message={warn.message} 
                          />
                        ) : (
                          warn.message
                        )}
                      </span>
                      {warn.hint && (
                        <div className="validation-tooltip-hint">💡 {warn.hint}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Tooltip.Arrow className="validation-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// Expandable string component for long values
function ExpandableString({ value, truncateAt = 80 }: { value: string; truncateAt?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const needsTruncation = value.length > truncateAt;
  
  if (!needsTruncation) {
    return <span className="vjv-string">&quot;{value}&quot;</span>;
  }
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };
  
  return (
    <span 
      className={`vjv-string vjv-expandable-string ${isExpanded ? 'vjv-expanded' : ''}`}
      onClick={handleClick}
      title={isExpanded ? "Click to collapse" : "Click to expand"}
    >
      &quot;{isExpanded ? value : `${value.slice(0, truncateAt)}...`}&quot;
    </span>
  );
}

// Format a primitive value for display
function formatValue(value: unknown, key: string, network?: CardanoNetwork): React.ReactNode {
  if (value === null) {
    return <span className="vjv-null">NULL</span>;
  }
  if (value === undefined) {
    return <span className="vjv-undefined">undefined</span>;
  }
  if (typeof value === "boolean") {
    return <span className="vjv-boolean">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span className="vjv-number">{value}</span>;
  }
  if (typeof value === "string") {
    // Check for linkable values
    if (network) {
      const baseUrl = getCardanoscanUrl(network);
      
      // Transaction ID
      if (key === "transaction_id" && /^[a-f0-9]{64}$/i.test(value)) {
        return (
          <a
            href={`${baseUrl}/transaction/${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="vjv-link"
            onClick={(e) => e.stopPropagation()}
            title={`Open in CardanoScan (${network})`}
          >
            &quot;{value}&quot;
          </a>
        );
      }
      
      // Address
      if (key === "address" && value.startsWith("addr")) {
        return (
          <a
            href={`${baseUrl}/address/${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="vjv-link"
            onClick={(e) => e.stopPropagation()}
            title={`Open in CardanoScan (${network})`}
          >
            &quot;{value}&quot;
          </a>
        );
      }
    }
    
    // Use expandable string for long values
    return <ExpandableString value={value} />;
  }
  return <span>{String(value)}</span>;
}

// JSON Tree Node component
interface TreeNodeProps {
  keyName: string | number;
  value: unknown;
  path: string;
  depth: number;
  defaultExpanded: number;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  network?: CardanoNetwork;
  isArrayItem?: boolean;
  focusedPath?: string[] | null;
}

function TreeNode({
  keyName,
  value,
  path,
  depth,
  defaultExpanded,
  diagnosticsMap,
  network,
  isArrayItem = false,
  focusedPath,
}: TreeNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const nodeDiagnostics = pathHasDiagnostics(path, diagnosticsMap);
  const hasDescendants = hasDescendantDiagnostics(path, diagnosticsMap);
  const descendantCounts = getDescendantDiagnosticCounts(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  
  // Check if this node is an ancestor of any focused path
  const hasFocusedDescendant = focusedPath?.some(fp => fp.startsWith(path + '.')) ?? false;
  
  const shouldDefaultExpand = depth < defaultExpanded || hasDescendants || nodeDiagnostics.length > 0;
  
  // Track expansion state
  const [isExpanded, setIsExpanded] = useState(shouldDefaultExpand);
  
  // When a focused descendant appears, expand the node
  useLayoutEffect(() => {
    if (hasFocusedDescendant) {
      // Use requestAnimationFrame to make this async and avoid linter warning
      requestAnimationFrame(() => {
        setIsExpanded(true);
      });
    }
  }, [hasFocusedDescendant]);
  
  // Scroll to focused element
  useEffect(() => {
    if (isFocused && nodeRef.current) {
      // Small delay to allow tree to expand first
      setTimeout(() => {
        nodeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isPrimitive = !isObject && !isArray;
  
  const hasIssue = nodeDiagnostics.length > 0;
  const hasError = nodeDiagnostics.some(d => d.severity === "error");
  const hasWarning = nodeDiagnostics.some(d => d.severity === "warning");

  const toggleExpand = () => {
    setIsExpanded(prev => !prev);
  };

  // Render primitive value
  if (isPrimitive) {
    return (
      <div 
        ref={nodeRef}
        className={`vjv-row vjv-primitive ${hasError ? 'vjv-error' : ''} ${hasWarning && !hasError ? 'vjv-warning' : ''} ${isFocused ? 'vjv-focused' : ''}`}
      >
        {hasIssue && <DiagnosticIndicator diagnostics={nodeDiagnostics} />}
        <span className="vjv-key">{isArrayItem ? `[${keyName}]` : keyName}:</span>
        {formatValue(value, String(keyName), network)}
      </div>
    );
  }

  // Render object or array
  const entries = isArray 
    ? (value as unknown[]).map((v, i) => [i, v] as [number, unknown])
    : Object.entries(value as Record<string, unknown>);
  
  const bracketOpen = isArray ? "[" : "{";
  const bracketClose = isArray ? "]" : "}";
  const isEmpty = entries.length === 0;

  return (
    <div 
      ref={nodeRef}
      className={`vjv-node ${hasError ? 'vjv-error-node' : ''} ${hasWarning && !hasError ? 'vjv-warning-node' : ''} ${isFocused ? 'vjv-focused-node' : ''}`}
    >
      <div 
        className={`vjv-row vjv-expandable ${hasError ? 'vjv-error' : ''} ${hasWarning && !hasError ? 'vjv-warning' : ''} ${isFocused ? 'vjv-focused' : ''}`}
        onClick={toggleExpand}
      >
        <span className="vjv-toggle">{isExpanded ? "▼" : "▶"}</span>
        {hasIssue && <DiagnosticIndicator diagnostics={nodeDiagnostics} />}
        <span className="vjv-key">{isArrayItem ? `[${keyName}]` : keyName}:</span>
        <span className="vjv-bracket">{bracketOpen}</span>
        {!isExpanded && (
          <>
            <span className="vjv-collapsed-info">
              {isEmpty ? "" : ` … `}
            </span>
            <span className="vjv-bracket">{bracketClose}</span>
            {hasDescendants && (
              <span className="vjv-hidden-issues">
                {descendantCounts.errors > 0 && (
                  <span className="vjv-hidden-errors" title={`${descendantCounts.errors} error(s) inside`}>
                    ⊗ {descendantCounts.errors}
                  </span>
                )}
                {descendantCounts.warnings > 0 && (
                  <span className="vjv-hidden-warnings" title={`${descendantCounts.warnings} warning(s) inside`}>
                    ⚠ {descendantCounts.warnings}
                  </span>
                )}
              </span>
            )}
          </>
        )}
      </div>
      
      {isExpanded && (
        <div className="vjv-children">
          {entries.map(([key, val]) => {
            const childPath = `${path}.${key}`;
            return (
              <TreeNode
                key={key}
                keyName={key}
                value={val}
                path={childPath}
                depth={depth + 1}
                defaultExpanded={defaultExpanded}
                diagnosticsMap={diagnosticsMap}
                network={network}
                focusedPath={focusedPath}
                isArrayItem={isArray}
              />
            );
          })}
          <div className="vjv-row">
            <span className="vjv-bracket">{bracketClose}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ValidationJsonViewer({
  data,
  network,
  diagnostics = [],
  expanded = 3,
  focusedPath,
}: ValidationJsonViewerProps) {
  const preparedData = useMemo(() => prepareData(data), [data]);
  const diagnosticsMap = useMemo(() => buildDiagnosticsMap(diagnostics), [diagnostics]);

  if (preparedData === null || preparedData === undefined) {
    return (
      <div className="vjv-wrapper">
        <div className="vjv-empty">No data</div>
      </div>
    );
  }

  const isObject = typeof preparedData === "object" && !Array.isArray(preparedData);
  const isArray = Array.isArray(preparedData);

  if (!isObject && !isArray) {
    return (
      <div className="vjv-wrapper">
        <div className="vjv-root">{formatValue(preparedData, "root", network)}</div>
      </div>
    );
  }

  const entries = isArray
    ? (preparedData as unknown[]).map((v, i) => [i, v] as [number, unknown])
    : Object.entries(preparedData as Record<string, unknown>);

  return (
    <div className="vjv-wrapper">
      <div className="vjv-root">
        {entries.map(([key, val]) => {
          // Root path starts without leading dot
          const basePath = isObject 
            ? (key === "transaction" ? "transaction" : String(key))
            : String(key);
          
          return (
            <TreeNode
              key={key}
              keyName={key}
              value={val}
              path={basePath}
              depth={0}
              defaultExpanded={expanded}
              diagnosticsMap={diagnosticsMap}
              network={network}
              isArrayItem={isArray}
              focusedPath={focusedPath}
            />
          );
        })}
      </div>
    </div>
  );
}

