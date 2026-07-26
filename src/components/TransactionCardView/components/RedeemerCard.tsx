"use client";

import React, { useRef, useEffect } from "react";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { CollapsibleDataItem } from "./CollapsibleDataItem";
import { DeUplcButton, DEUPLC_ENABLED } from "./DeUplcButton";
import { getPathDiagnostics } from "../utils";
import { formatDexRole, dexThemeKey, type DexRedeemerNote } from "@/utils/protocols/dex";
import type { Redeemer, ValidationDiagnostic } from "../types";
import type { DeUplcResolved } from "@/utils/deUplcLink";

interface RedeemerCardProps {
  redeemer: Redeemer;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  /** "Open in de-uplc-web" link for this redeemer (null until Validate has run). */
  deUplcLink?: DeUplcResolved | null;
  /** Protocol annotation ("Minswap V2 Order · Cancel"), when the redeemer was attributed. */
  dexNote?: DexRedeemerNote;
}

const REDEEMER_ACCENT = "#f97316"; // orange

// "Minswap V2 Order · Cancel" for a spend, "Splash · batch validator" for a
// withdraw-zero. Cancels reuse the red cancel-tag styling so an order being
// cancelled vs executed is visible at a glance.
function DexRedeemerBadge({ note }: { note: DexRedeemerNote }) {
  const subject = note.role ? `${note.label} ${formatDexRole(note.role)}` : note.label;
  const action = note.action ?? note.purpose;
  const text = action ? `${subject} · ${action}` : subject;
  const isCancel = (note.action ?? "").toLowerCase().includes("cancel");
  const title = note.inputIndex !== undefined ? `${text} — spends input #${note.inputIndex}` : text;
  return (
    <span
      className={`tcv-tag ${isCancel ? "tcv-tag-sundae-cancel" : "tcv-tag-dex"}`}
      data-dex={dexThemeKey(note.adapterId)}
      title={title}
    >
      {text}
    </span>
  );
}

export function RedeemerCard({
  redeemer,
  path,
  diagnosticsMap,
  focusedPath,
  deUplcLink,
  dexNote,
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
        {dexNote && <DexRedeemerBadge note={dexNote} />}
        <DiagnosticBadge diagnostics={diagnostics} />
        {DEUPLC_ENABLED && (
          <span className="tcv-deuplc-slot">
            <DeUplcButton link={deUplcLink} />
          </span>
        )}
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
