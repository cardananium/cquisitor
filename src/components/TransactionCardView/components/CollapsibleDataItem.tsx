"use client";

import React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import type { ValidationDiagnostic } from "../types";

interface CollapsibleDataItemProps {
  label: string;
  data: string;
  defaultOpen?: boolean;
  colorAccent?: string; // CSS color for left border
  diagnostics?: ValidationDiagnostic[];
}

// Helper to format JSON strings
function formatJsonString(str: string): { formatted: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(str);
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { formatted: str, isJson: false };
  }
}

export function CollapsibleDataItem({ 
  label, 
  data, 
  defaultOpen = false,
  colorAccent = "#6366f1", // default indigo
  diagnostics = []
}: CollapsibleDataItemProps) {
  const { formatted } = formatJsonString(data);
  const hasErrors = diagnostics.some(d => d.severity === 'error');
  
  return (
    <Collapsible.Root 
      className={`tcv-cdi ${hasErrors ? 'tcv-cdi-has-error' : ''}`} 
      defaultOpen={defaultOpen} 
      style={{ '--cdi-accent': colorAccent } as React.CSSProperties}
    >
      <Collapsible.Trigger className="tcv-cdi-trigger">
        <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
          <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
        <span className="tcv-cdi-label">{label}</span>
        <DiagnosticBadge diagnostics={diagnostics} />
      </Collapsible.Trigger>
      <Collapsible.Content className="tcv-cdi-content">
        <pre className="tcv-cdi-code">{formatted}</pre>
        <CopyButton text={data} className="tcv-cdi-copy" />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

