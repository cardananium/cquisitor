"use client";

import React, { useRef, useEffect } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { getPathDiagnostics } from "../utils";
import type { BootstrapWitness, ValidationDiagnostic } from "../types";

interface BootstrapWitnessCardProps {
  witness: BootstrapWitness;
  index: number;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function BootstrapWitnessCard({ 
  witness, 
  index,
  path,
  diagnosticsMap,
  focusedPath
}: BootstrapWitnessCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const diagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  const chainCodeHex = bytesToHex(witness.chain_code);
  const attributesHex = bytesToHex(witness.attributes);
  
  return (
    <div ref={cardRef} className={`tcv-item-card tcv-bootstrap ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header">
        <span className="tcv-item-index">#{index}</span>
        <span className="tcv-bootstrap-badge">Byron</span>
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      
      <div className="tcv-bootstrap-vkey-row">
        <span className="tcv-bootstrap-label">🔑 Public Key</span>
        <div className="tcv-bootstrap-value">
          <code className="tcv-hash-full">{witness.vkey}</code>
          <CopyButton text={witness.vkey} />
        </div>
      </div>
      
      <div className="tcv-bootstrap-chain-row">
        <span className="tcv-bootstrap-label">🔗 Chain Code</span>
        <div className="tcv-bootstrap-value">
          <code className="tcv-hash-full">{chainCodeHex}</code>
          <CopyButton text={chainCodeHex} />
        </div>
      </div>
      
      {attributesHex && attributesHex.length > 0 && (
        <div className="tcv-bootstrap-attrs-row">
          <span className="tcv-bootstrap-label">📋 Attributes</span>
          <div className="tcv-bootstrap-value">
            <code className="tcv-hash-full">{attributesHex}</code>
            <CopyButton text={attributesHex} />
          </div>
        </div>
      )}
      
      <Collapsible.Root className="tcv-collapsible">
        <Collapsible.Trigger className="tcv-collapsible-trigger">
          <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
            <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span>Signature</span>
        </Collapsible.Trigger>
        <Collapsible.Content className="tcv-collapsible-content">
          <div className="tcv-signature-value">
            {witness.signature}
            <CopyButton text={witness.signature} className="tcv-signature-copy" />
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

