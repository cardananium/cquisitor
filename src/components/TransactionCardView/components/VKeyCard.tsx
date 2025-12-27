"use client";

import React, { useMemo } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { getPathDiagnostics, computeVkeyHash } from "../utils";
import type { VkeyWitness, ValidationDiagnostic } from "../types";

interface VKeyCardProps {
  vkey: VkeyWitness;
  index: number;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

export function VKeyCard({ 
  vkey, 
  index,
  path,
  diagnosticsMap,
  focusedPath
}: VKeyCardProps) {
  const diagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  
  // Compute vkey_hash from vkey if not present
  const vkeyHash = useMemo(() => {
    if (vkey.vkey_hash) return vkey.vkey_hash;
    if (vkey.vkey && vkey.vkey.startsWith("ed25519_pk")) {
      return computeVkeyHash(vkey.vkey);
    }
    return null;
  }, [vkey.vkey, vkey.vkey_hash]);
  
  return (
    <div className={`tcv-item-card tcv-vkey ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header">
        <span className="tcv-item-index">#{index}</span>
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      
      {vkeyHash && (
        <div className="tcv-vkey-hash-row">
          <span className="tcv-vkey-hash-label">🔑 Key Hash</span>
          <div className="tcv-vkey-hash-value">
            <span className="tcv-hash-full">{vkeyHash}</span>
            <CopyButton text={vkeyHash} />
          </div>
        </div>
      )}
      
      <div className="tcv-vkey-pubkey-row">
        <span className="tcv-vkey-pubkey-label">🔐 Public Key</span>
        <div className="tcv-vkey-pubkey-value">
          <span className="tcv-hash-full">{vkey.vkey}</span>
          <CopyButton text={vkey.vkey} />
        </div>
      </div>
      
      <Collapsible.Root className="tcv-collapsible">
        <Collapsible.Trigger className="tcv-collapsible-trigger">
          <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
            <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span>Signature</span>
        </Collapsible.Trigger>
        <Collapsible.Content className="tcv-collapsible-content">
          <div className="tcv-signature-value">
            {vkey.signature}
            <CopyButton text={vkey.signature} className="tcv-signature-copy" />
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}
