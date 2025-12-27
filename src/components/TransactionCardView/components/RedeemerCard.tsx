"use client";

import React, { useRef, useEffect } from "react";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { CollapsibleDataItem } from "./CollapsibleDataItem";
import { getPathDiagnostics } from "../utils";
import type { Redeemer, ValidationDiagnostic } from "../types";

interface RedeemerCardProps {
  redeemer: Redeemer;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

const REDEEMER_ACCENT = "#f97316"; // orange

export function RedeemerCard({ 
  redeemer, 
  path,
  diagnosticsMap,
  focusedPath
}: RedeemerCardProps) {
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
  
  const memUsage = BigInt(redeemer.ex_units.mem);
  const stepsUsage = BigInt(redeemer.ex_units.steps);
  
  return (
    <div ref={cardRef} className={`tcv-item-card tcv-redeemer ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header">
        <span className="tcv-redeemer-tag">{redeemer.tag}</span>
        <span className="tcv-redeemer-index">[{redeemer.index}]</span>
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      <div className="tcv-exunits-bar">
        <div className="tcv-exunit">
          <span className="tcv-exunit-label">Memory</span>
          <span className="tcv-exunit-value">{memUsage.toLocaleString()}</span>
        </div>
        <div className="tcv-exunit">
          <span className="tcv-exunit-label">CPU</span>
          <span className="tcv-exunit-value">{stepsUsage.toLocaleString()}</span>
        </div>
      </div>
      
      <CollapsibleDataItem
        label="Redeemer Data"
        data={redeemer.data}
        colorAccent={REDEEMER_ACCENT}
      />
    </div>
  );
}
