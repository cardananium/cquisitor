"use client";

import React, { useRef, useEffect } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { HashWithTooltip } from "./HashWithTooltip";
import { getPathDiagnostics } from "../utils";
import type { ValidationDiagnostic } from "../types";
import type { PlutusScriptInfo } from "@cardananium/cquisitor-lib";

const SCRIPT_ACCENT = "#8b5cf6"; // purple

export interface PlutusScriptCardProps {
  /** Hex-encoded script */
  script: string;
  /** Index in the scripts array */
  index: number;
  /** Base path for diagnostics */
  path: string;
  /** Map of path -> diagnostics */
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  /** Currently focused path for highlighting */
  focusedPath?: string[] | null;
  /** Script info with hash and version */
  scriptInfo?: PlutusScriptInfo | null;
}

export function PlutusScriptCard({
  script,
  index,
  path,
  diagnosticsMap,
  focusedPath,
  scriptInfo
}: PlutusScriptCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const scriptPath = `${path}.${index}`;
  const diagnostics = getPathDiagnostics(scriptPath, diagnosticsMap);
  const isFocused = focusedPath?.includes(scriptPath) ?? false;
  const hasErrors = diagnostics.some(d => d.severity === 'error');
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  // Format script content for display
  let formattedScript = script;
  try {
    const parsed = JSON.parse(script);
    formattedScript = JSON.stringify(parsed, null, 2);
  } catch {
    // Not JSON, use as-is (likely hex-encoded CBOR)
  }
  
  return (
    <div ref={cardRef} className={`${isFocused ? 'tcv-cdi-is-focused' : ''}`}>
      <Collapsible.Root 
        className={`tcv-cdi ${hasErrors ? 'tcv-cdi-has-error' : ''}`} 
        style={{ '--cdi-accent': SCRIPT_ACCENT } as React.CSSProperties}
      >
        <Collapsible.Trigger className="tcv-cdi-trigger tcv-script-trigger">
          <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
            <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span className="tcv-cdi-label">Script #{index}</span>
          {scriptInfo?.version && (
            <span className="tcv-plutus-version-badge">{scriptInfo.version}</span>
          )}
          {scriptInfo?.hash && (
            <>
              <span className="tcv-script-hash-label">Hash:</span>
              <HashWithTooltip hash={scriptInfo.hash} className="tcv-script-hash-inline" />
            </>
          )}
          <span className="tcv-script-size">({script.length} bytes)</span>
          <DiagnosticBadge diagnostics={diagnostics} />
        </Collapsible.Trigger>
        <Collapsible.Content className="tcv-cdi-content">
          <pre className="tcv-cdi-code">{formattedScript}</pre>
          <CopyButton text={script} className="tcv-cdi-copy" />
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

