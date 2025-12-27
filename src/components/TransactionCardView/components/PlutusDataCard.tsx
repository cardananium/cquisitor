"use client";

import React, { useRef, useEffect } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { HashWithTooltip } from "./HashWithTooltip";
import { getPathDiagnostics } from "../utils";
import type { ValidationDiagnostic } from "../types";

const DATUM_ACCENT = "#6366f1"; // indigo

export interface PlutusDataCardProps {
  /** Datum content (JSON string or hex) */
  datum: string;
  /** Index in the data array */
  index: number;
  /** Base path for diagnostics */
  path: string;
  /** Map of path -> diagnostics */
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  /** Currently focused path for highlighting */
  focusedPath?: string[] | null;
  /** Datum hash */
  datumHash?: string | null;
}

export function PlutusDataCard({
  datum,
  index,
  path,
  diagnosticsMap,
  focusedPath,
  datumHash
}: PlutusDataCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const datumPath = `${path}.${index}`;
  const diagnostics = getPathDiagnostics(datumPath, diagnosticsMap);
  const isFocused = focusedPath?.includes(datumPath) ?? false;
  const hasErrors = diagnostics.some(d => d.severity === 'error');
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  // Format datum content for display
  let formattedDatum = datum;
  try {
    const parsed = JSON.parse(datum);
    formattedDatum = JSON.stringify(parsed, null, 2);
  } catch {
    // Not JSON, use as-is
  }
  
  return (
    <div ref={cardRef} className={`${isFocused ? 'tcv-cdi-is-focused' : ''}`}>
      <Collapsible.Root 
        className={`tcv-cdi ${hasErrors ? 'tcv-cdi-has-error' : ''}`} 
        style={{ '--cdi-accent': DATUM_ACCENT } as React.CSSProperties}
      >
        <Collapsible.Trigger className="tcv-cdi-trigger tcv-datum-trigger">
          <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
            <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span className="tcv-cdi-label">Datum #{index}</span>
          {datumHash && (
            <>
              <span className="tcv-datum-hash-label">Hash:</span>
              <HashWithTooltip hash={datumHash} className="tcv-datum-hash-inline" />
            </>
          )}
          <DiagnosticBadge diagnostics={diagnostics} />
        </Collapsible.Trigger>
        <Collapsible.Content className="tcv-cdi-content">
          <pre className="tcv-cdi-code">{formattedDatum}</pre>
          <CopyButton text={datum} className="tcv-cdi-copy" />
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

