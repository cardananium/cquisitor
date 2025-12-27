"use client";

import React, { useRef, useEffect } from "react";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { HashWithTooltip } from "./HashWithTooltip";
import { getPathDiagnostics } from "../utils";
import type { NativeScript, ValidationDiagnostic } from "../types";

interface NativeScriptCardProps {
  script: NativeScript;
  index: number;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  /** Script hash from extractedHashes */
  scriptHash?: string | null;
}

function getScriptType(script: NativeScript): { type: string; icon: string; description: string } {
  if ("ScriptPubkey" in script) {
    return { type: "ScriptPubkey", icon: "🔑", description: "Signature required" };
  }
  if ("ScriptAll" in script) {
    return { type: "ScriptAll", icon: "🔐", description: `ALL of ${script.ScriptAll.native_scripts.length}` };
  }
  if ("ScriptAny" in script) {
    return { type: "ScriptAny", icon: "🔓", description: `ANY of ${script.ScriptAny.native_scripts.length}` };
  }
  if ("ScriptNOfK" in script) {
    return { type: "ScriptNOfK", icon: "🔢", description: `${script.ScriptNOfK.n} of ${script.ScriptNOfK.native_scripts.length}` };
  }
  if ("TimelockStart" in script) {
    return { type: "TimelockStart", icon: "⏰", description: `Valid after slot ${script.TimelockStart.slot}` };
  }
  if ("TimelockExpiry" in script) {
    return { type: "TimelockExpiry", icon: "⏱️", description: `Valid before slot ${script.TimelockExpiry.slot}` };
  }
  return { type: "Unknown", icon: "❓", description: "Unknown script type" };
}

// Recursive component to display native script structure
function NativeScriptDisplay({ script, depth = 0 }: { script: NativeScript; depth?: number }) {
  const indent = depth * 16;
  
  if ("ScriptPubkey" in script) {
    return (
      <div className="tcv-ns-item tcv-ns-pubkey" style={{ marginLeft: indent }}>
        <span className="tcv-ns-item-icon">🔑</span>
        <code className="tcv-ns-hash">{script.ScriptPubkey.addr_keyhash}</code>
        <CopyButton text={script.ScriptPubkey.addr_keyhash} />
      </div>
    );
  }
  
  if ("ScriptAll" in script) {
    return (
      <div className="tcv-ns-group" style={{ marginLeft: indent }}>
        <div className="tcv-ns-group-header tcv-ns-all">
          <span className="tcv-ns-item-icon">🔐</span>
          <span className="tcv-ns-group-type">ALL ({script.ScriptAll.native_scripts.length})</span>
        </div>
        <div className="tcv-ns-group-children">
          {script.ScriptAll.native_scripts.map((child, i) => (
            <NativeScriptDisplay key={i} script={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }
  
  if ("ScriptAny" in script) {
    return (
      <div className="tcv-ns-group" style={{ marginLeft: indent }}>
        <div className="tcv-ns-group-header tcv-ns-any">
          <span className="tcv-ns-item-icon">🔓</span>
          <span className="tcv-ns-group-type">ANY ({script.ScriptAny.native_scripts.length})</span>
        </div>
        <div className="tcv-ns-group-children">
          {script.ScriptAny.native_scripts.map((child, i) => (
            <NativeScriptDisplay key={i} script={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }
  
  if ("ScriptNOfK" in script) {
    return (
      <div className="tcv-ns-group" style={{ marginLeft: indent }}>
        <div className="tcv-ns-group-header tcv-ns-nofk">
          <span className="tcv-ns-item-icon">🔢</span>
          <span className="tcv-ns-group-type">{script.ScriptNOfK.n} of {script.ScriptNOfK.native_scripts.length}</span>
        </div>
        <div className="tcv-ns-group-children">
          {script.ScriptNOfK.native_scripts.map((child, i) => (
            <NativeScriptDisplay key={i} script={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }
  
  if ("TimelockStart" in script) {
    return (
      <div className="tcv-ns-item tcv-ns-timelock" style={{ marginLeft: indent }}>
        <span className="tcv-ns-item-icon">⏰</span>
        <span className="tcv-ns-timelock-label">Valid after</span>
        <span className="tcv-ns-slot">{script.TimelockStart.slot}</span>
      </div>
    );
  }
  
  if ("TimelockExpiry" in script) {
    return (
      <div className="tcv-ns-item tcv-ns-timelock" style={{ marginLeft: indent }}>
        <span className="tcv-ns-item-icon">⏱️</span>
        <span className="tcv-ns-timelock-label">Valid before</span>
        <span className="tcv-ns-slot">{script.TimelockExpiry.slot}</span>
      </div>
    );
  }
  
  return <div>Unknown script type</div>;
}

export function NativeScriptCard({ 
  script, 
  index,
  path,
  diagnosticsMap,
  focusedPath,
  scriptHash
}: NativeScriptCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const diagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  const { type, icon, description } = getScriptType(script);
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  return (
    <div ref={cardRef} className={`tcv-item-card tcv-native-script ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header tcv-ns-header">
        <span className="tcv-item-index">#{index}</span>
        <span className="tcv-ns-type-badge">
          <span className="tcv-ns-badge-icon">{icon}</span>
          {type}
        </span>
        {scriptHash && (
          <>
            <span className="tcv-ns-hash-label">Hash:</span>
            <HashWithTooltip hash={scriptHash} className="tcv-ns-script-hash" />
          </>
        )}
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      
      <div className="tcv-ns-description">{description}</div>
      
      <div className="tcv-ns-content">
        <NativeScriptDisplay script={script} />
      </div>
    </div>
  );
}

