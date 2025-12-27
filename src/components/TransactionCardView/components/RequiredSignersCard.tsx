"use client";

import React, { useRef, useEffect } from "react";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { CopyButton } from "./CopyButton";
import { getPathDiagnostics } from "../utils";
import type { ValidationDiagnostic } from "../types";

interface RequiredSignersCardProps {
  signers: string[];
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

// Individual signer card with scroll functionality
function SignerCard({ 
  signer, 
  index, 
  path, 
  diagnosticsMap, 
  focusedPath 
}: { 
  signer: string; 
  index: number; 
  path: string; 
  diagnosticsMap: Map<string, ValidationDiagnostic[]>; 
  focusedPath?: string[] | null;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const signerPath = `${path}.${index}`;
  const signerDiagnostics = getPathDiagnostics(signerPath, diagnosticsMap);
  const isFocused = focusedPath?.includes(signerPath) ?? false;
  const hasError = signerDiagnostics.some(d => d.severity === 'error');
  const hasWarning = signerDiagnostics.some(d => d.severity === 'warning');
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  return (
    <div 
      ref={cardRef}
      className={`tcv-signer-card ${hasError ? 'has-error' : ''} ${hasWarning ? 'has-warning' : ''} ${isFocused ? 'is-focused' : ''}`}
    >
      <div className="tcv-signer-header">
        <span className="tcv-signer-index">#{index}</span>
        <DiagnosticBadge diagnostics={signerDiagnostics} />
      </div>
      <div className="tcv-signer-hash">
        <span className="tcv-signer-hash-value" title={signer}>
          {signer}
        </span>
        <CopyButton text={signer} className="tcv-signer-copy" />
      </div>
    </div>
  );
}

export function RequiredSignersCard({ 
  signers, 
  path, 
  diagnosticsMap, 
  focusedPath 
}: RequiredSignersCardProps) {
  return (
    <div className="tcv-required-signers-grid">
      {signers.map((signer, i) => (
        <SignerCard
          key={i}
          signer={signer}
          index={i}
          path={path}
          diagnosticsMap={diagnosticsMap}
          focusedPath={focusedPath}
        />
      ))}
    </div>
  );
}

