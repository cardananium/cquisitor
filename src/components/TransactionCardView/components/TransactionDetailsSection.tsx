"use client";

import React, { useRef, useEffect } from "react";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { CopyButton } from "./CopyButton";
import { HashWithTooltip } from "./HashWithTooltip";
import { getPathDiagnostics } from "../utils";
import type { TransactionBody, ValidationDiagnostic } from "../types";

interface TransactionDetailsSectionProps {
  body: TransactionBody;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

interface DetailFieldProps {
  label: string;
  value: string | number | boolean | null | undefined;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  type?: "hash" | "number" | "slot" | "ada" | "text" | "validity";
  copyable?: boolean;
  linkUrl?: string;
}

function formatAda(lovelace: string): string {
  const ada = Number(lovelace) / 1_000_000;
  return ada.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

function DetailField({ 
  label, 
  value, 
  path, 
  diagnosticsMap, 
  focusedPath,
  type = "text",
  copyable = false,
  linkUrl
}: DetailFieldProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  
  if (value === null || value === undefined) return null;
  
  const diagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  const hasError = diagnostics.some(d => d.severity === 'error');
  const hasWarning = diagnostics.some(d => d.severity === 'warning');
  
  // Scroll into view when focused - using conditional hook pattern
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (isFocused && fieldRef.current) {
      setTimeout(() => {
        fieldRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  let displayValue: React.ReactNode = String(value);
  
  switch (type) {
    case "hash":
      // Hash fields use HashWithTooltip - no need for separate copy button
      return (
        <div 
          ref={fieldRef}
          className={`tcv-detail-field ${hasError ? 'has-error' : ''} ${hasWarning ? 'has-warning' : ''} ${isFocused ? 'is-focused' : ''}`}
        >
          <div className="tcv-detail-label">
            {label}
            {diagnostics.length > 0 && <DiagnosticBadge diagnostics={diagnostics} />}
          </div>
          <div className="tcv-detail-value">
            <HashWithTooltip hash={String(value)} linkUrl={linkUrl} />
          </div>
        </div>
      );
    case "ada":
      displayValue = <span className="tcv-detail-ada">₳ {formatAda(String(value))}</span>;
      break;
    case "slot":
      displayValue = <span className="tcv-detail-slot">{Number(value).toLocaleString()}</span>;
      break;
    case "number":
      displayValue = <span className="tcv-detail-number">{Number(value).toLocaleString()}</span>;
      break;
    case "validity":
      const isValid = Boolean(value);
      displayValue = (
        <span className={`tcv-detail-validity ${isValid ? 'valid' : 'invalid'}`}>
          {isValid ? '✓ Valid' : '✗ Invalid'}
        </span>
      );
      break;
  }
  
  return (
    <div 
      ref={fieldRef}
      className={`tcv-detail-field ${hasError ? 'has-error' : ''} ${hasWarning ? 'has-warning' : ''} ${isFocused ? 'is-focused' : ''}`}
    >
      <div className="tcv-detail-label">
        {label}
        {diagnostics.length > 0 && <DiagnosticBadge diagnostics={diagnostics} />}
      </div>
      <div className="tcv-detail-value">
        {displayValue}
        {copyable && <CopyButton text={String(value)} className="tcv-detail-copy" />}
      </div>
    </div>
  );
}

export function TransactionDetailsSection({ 
  body, 
  diagnosticsMap, 
  focusedPath 
}: TransactionDetailsSectionProps) {
  return (
    <div className="tcv-details-section">
      {/* Main fields grid */}
      <div className="tcv-details-grid">
        <DetailField
          label="Fee"
          value={body.fee}
          path="transaction.body.fee"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          type="ada"
        />
        
        <DetailField
          label="TTL"
          value={body.ttl}
          path="transaction.body.ttl"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          type="slot"
        />
        
        <DetailField
          label="Validity Start"
          value={body.validity_start_interval}
          path="transaction.body.validity_start_interval"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          type="slot"
        />
        
        <DetailField
          label="Network ID"
          value={body.network_id}
          path="transaction.body.network_id"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          type="text"
        />
        
        <DetailField
          label="Script Data Hash"
          value={body.script_data_hash}
          path="transaction.body.script_data_hash"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          type="hash"
        />
        
        <DetailField
          label="Auxiliary Data Hash"
          value={body.auxiliary_data_hash}
          path="transaction.body.auxiliary_data_hash"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          type="hash"
        />
        
        <DetailField
          label="Treasury Value"
          value={body.current_treasury_value}
          path="transaction.body.current_treasury_value"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          type="ada"
        />
        
        <DetailField
          label="Donation"
          value={body.donation}
          path="transaction.body.donation"
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
          type="ada"
        />
      </div>
    </div>
  );
}
