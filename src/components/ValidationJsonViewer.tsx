"use client";

// Adapter over the shared `JsonTreeView` that adds the Transaction
// Validator's domain-specific concerns:
//   - per-node diagnostic indicators (errors/warnings) with descendant counts
//   - expandable long string values
//   - CardanoScan links for known fields (transaction_id, address)
//   - vkey → vkey_hash auto-injection
//   - scroll-into-view on focused path
// Path scheme: dot-joined ("transaction.body.0"), no "$" prefix.

import { useCallback, useMemo, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { bech32 } from "bech32";
import { blake2b } from "@noble/hashes/blake2.js";
import { ErrorFormatter } from "./ErrorDataFormatters";
import { getTransactionLink, getAddressLink, type CardanoNetwork } from "@/utils/cardanoscanLinks";
import {
  JsonTreeView,
  dotIsPathAncestor,
  dotJoinKey,
  dotPathsEqual,
  type RenderRowArgs,
} from "@/components/jsonTree";

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

function buildDiagnosticsMap(diagnostics: ValidationDiagnostic[]): Map<string, ValidationDiagnostic[]> {
  const map = new Map<string, ValidationDiagnostic[]>();
  for (const diag of diagnostics) {
    if (!diag.locations) continue;
    for (const location of diag.locations) {
      const existing = map.get(location) ?? [];
      existing.push(diag);
      map.set(location, existing);
    }
  }
  return map;
}

function hasDescendantDiagnostics(
  currentPath: string,
  diagnosticsMap: Map<string, ValidationDiagnostic[]>,
): boolean {
  for (const key of diagnosticsMap.keys()) {
    if (key.startsWith(currentPath + ".")) return true;
  }
  return false;
}

function getDescendantDiagnosticCounts(
  currentPath: string,
  diagnosticsMap: Map<string, ValidationDiagnostic[]>,
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const [key, diagnostics] of diagnosticsMap.entries()) {
    if (!key.startsWith(currentPath + ".")) continue;
    for (const d of diagnostics) {
      if (d.severity === "error") errors++;
      else if (d.severity === "warning") warnings++;
    }
  }
  return { errors, warnings };
}

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

function prepareData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "bigint") return data.toString();
  if (data instanceof Uint8Array) return Array.from(data);
  if (Array.isArray(data)) return data.map((item) => prepareData(item));
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = prepareData(value);
      if (key === "vkey" && typeof value === "string" && value.startsWith("ed25519_pk")) {
        const vkeyHash = computeVkeyHash(value);
        if (vkeyHash) result["vkey_hash"] = vkeyHash;
      }
    }
    return result;
  }
  return data;
}

function DiagnosticIndicator({ diagnostics }: { diagnostics: ValidationDiagnostic[] }) {
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const hasWarnings = diagnostics.some((d) => d.severity === "warning");

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

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
                  <div className="validation-tooltip-title error">Errors ({errors.length})</div>
                  {errors.map((err, i) => (
                    <div key={i} className="validation-tooltip-item">
                      <span className="validation-tooltip-phase">[{err.phase}]</span>
                      <span className="validation-tooltip-message">
                        {err.errorData ? (
                          <ErrorFormatter
                            error={err.errorData}
                            errorType={err.errorType}
                            message={err.message}
                            hint={err.hint}
                          />
                        ) : (
                          err.message
                        )}
                      </span>
                      {err.hint && <div className="validation-tooltip-hint">💡 {err.hint}</div>}
                    </div>
                  ))}
                </div>
              )}
              {warnings.length > 0 && (
                <div className="validation-tooltip-section">
                  <div className="validation-tooltip-title warning">Warnings ({warnings.length})</div>
                  {warnings.map((warn, i) => (
                    <div key={i} className="validation-tooltip-item">
                      <span className="validation-tooltip-phase">[{warn.phase}]</span>
                      <span className="validation-tooltip-message">
                        {warn.errorData ? (
                          <ErrorFormatter
                            error={warn.errorData}
                            errorType={warn.errorType}
                            message={warn.message}
                            hint={warn.hint}
                          />
                        ) : (
                          warn.message
                        )}
                      </span>
                      {warn.hint && <div className="validation-tooltip-hint">💡 {warn.hint}</div>}
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
      className={`vjv-string vjv-expandable-string ${isExpanded ? "vjv-expanded" : ""}`}
      onClick={handleClick}
      title={isExpanded ? "Click to collapse" : "Click to expand"}
    >
      &quot;{isExpanded ? value : `${value.slice(0, truncateAt)}...`}&quot;
    </span>
  );
}

interface ValidationRowProps {
  ctx: RenderRowArgs;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  network?: CardanoNetwork;
}

function ValidationRow({ ctx, diagnosticsMap, network }: ValidationRowProps) {
  const { keyLabel, value, path, isArrayItem, isComplex, isOpen, kind, childCount } = ctx;
  // Synthetic root in skipRoot mode renders nothing visible.
  if (keyLabel === null) return null;

  const nodeDiagnostics = diagnosticsMap.get(path) ?? [];
  const hasIssue = nodeDiagnostics.length > 0;

  const keySpan = (
    <span className="vjv-key">{isArrayItem ? `[${keyLabel}]` : keyLabel}:</span>
  );

  if (!isComplex) {
    return (
      <>
        {hasIssue && <DiagnosticIndicator diagnostics={nodeDiagnostics} />}
        {keySpan}
        {formatValue(value, String(keyLabel), network)}
      </>
    );
  }

  const isArray = kind === "array";
  const bracketOpen = isArray ? "[" : "{";
  const bracketClose = isArray ? "]" : "}";
  const isEmpty = childCount === 0;
  const counts = getDescendantDiagnosticCounts(path, diagnosticsMap);
  const hasDescendants = counts.errors > 0 || counts.warnings > 0;

  return (
    <>
      <span className="vjv-toggle">{isOpen ? "▼" : "▶"}</span>
      {hasIssue && <DiagnosticIndicator diagnostics={nodeDiagnostics} />}
      {keySpan}
      <span className="vjv-bracket">{bracketOpen}</span>
      {!isOpen && (
        <>
          <span className="vjv-collapsed-info">{isEmpty ? "" : ` … `}</span>
          <span className="vjv-bracket">{bracketClose}</span>
          {hasDescendants && (
            <span className="vjv-hidden-issues">
              {counts.errors > 0 && (
                <span className="vjv-hidden-errors" title={`${counts.errors} error(s) inside`}>
                  ⊗ {counts.errors}
                </span>
              )}
              {counts.warnings > 0 && (
                <span className="vjv-hidden-warnings" title={`${counts.warnings} warning(s) inside`}>
                  ⚠ {counts.warnings}
                </span>
              )}
            </span>
          )}
        </>
      )}
    </>
  );
}

function formatValue(value: unknown, key: string, network?: CardanoNetwork): React.ReactNode {
  if (value === null) return <span className="vjv-null">NULL</span>;
  if (value === undefined) return <span className="vjv-undefined">undefined</span>;
  if (typeof value === "boolean") return <span className="vjv-boolean">{value ? "true" : "false"}</span>;
  if (typeof value === "number") return <span className="vjv-number">{value}</span>;
  if (typeof value === "string") {
    if (network) {
      if (key === "transaction_id" && /^[a-f0-9]{64}$/i.test(value)) {
        return (
          <a
            href={getTransactionLink(network, value)}
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
      if (key === "address" && value.startsWith("addr")) {
        return (
          <a
            href={getAddressLink(network, value)}
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
    return <ExpandableString value={value} />;
  }
  return <span>{String(value)}</span>;
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

  const highlightedPaths = useMemo(() => focusedPath ?? [], [focusedPath]);

  const shouldDefaultExpand = useMemo(
    () =>
      ({ path }: { path: string }) => {
        if (diagnosticsMap.has(path)) return true;
        if (hasDescendantDiagnostics(path, diagnosticsMap)) return true;
        return false;
      },
    [diagnosticsMap],
  );

  const renderRow = useCallback(
    (ctx: RenderRowArgs) => (
      <ValidationRow ctx={ctx} diagnosticsMap={diagnosticsMap} network={network} />
    ),
    [diagnosticsMap, network],
  );

  // Per-row severity/focus classes — applied to the walker's row + block
  // wrappers so background tinting reaches the whole row (matches original).
  const getRowClassName = useMemo(
    () => (ctx: RenderRowArgs) => {
      const { path, isComplex } = ctx;
      const diags = diagnosticsMap.get(path) ?? [];
      const hasError = diags.some((d) => d.severity === "error");
      const hasWarning = diags.some((d) => d.severity === "warning");
      const cls: string[] = [];
      if (!isComplex) cls.push("vjv-primitive");
      else cls.push("vjv-expandable");
      if (hasError) cls.push("vjv-error");
      else if (hasWarning) cls.push("vjv-warning");
      return cls.join(" ");
    },
    [diagnosticsMap],
  );

  const getNodeBlockClassName = useMemo(
    () => (ctx: RenderRowArgs) => {
      const { path, isHighlighted } = ctx;
      const diags = diagnosticsMap.get(path) ?? [];
      const hasError = diags.some((d) => d.severity === "error");
      const hasWarning = diags.some((d) => d.severity === "warning");
      const cls: string[] = [];
      if (hasError) cls.push("vjv-error-node");
      else if (hasWarning) cls.push("vjv-warning-node");
      if (isHighlighted) cls.push("vjv-focused-node");
      return cls.join(" ");
    },
    [diagnosticsMap],
  );

  // Whole-row click toggles complex nodes (matches original behavior).
  const handleRowClick = useMemo(
    () => (ctx: RenderRowArgs, e: React.MouseEvent) => {
      if (!ctx.isComplex) return;
      // Don't hijack clicks on inner anchors / interactive controls.
      const target = e.target as HTMLElement | null;
      if (target && target.closest("a, button")) return;
      ctx.toggle();
    },
    [],
  );

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

  return (
    <div className="vjv-wrapper">
      <JsonTreeView
        data={preparedData}
        expanded={expanded}
        rootPath=""
        joinKey={dotJoinKey}
        pathsEqual={dotPathsEqual}
        isPathAncestor={dotIsPathAncestor}
        highlightedPaths={highlightedPaths}
        renderRow={renderRow}
        shouldDefaultExpand={shouldDefaultExpand}
        onRowClick={handleRowClick}
        scrollOnHighlight
        skipRoot
        wrapperClassName="vjv-root"
        rowClassName="vjv-row"
        highlightedRowClassName="vjv-focused"
        childrenClassName="vjv-children"
        nodeBlockClassName="vjv-node"
        getRowClassName={getRowClassName}
        getNodeBlockClassName={getNodeBlockClassName}
        renderClosingRow={({ kind }) => (
          <div className="vjv-row">
            <span className="vjv-bracket">{kind === "array" ? "]" : "}"}</span>
          </div>
        )}
      />
    </div>
  );
}
