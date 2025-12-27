"use client";

import React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CopyButton } from "./CopyButton";
import { CollapsibleDataItem } from "./CollapsibleDataItem";
import type { AuxiliaryData, NativeScript } from "../types";

interface AuxiliaryDataSectionProps {
  auxData: AuxiliaryData;
}

// Unified accent color for aux data items
const AUX_DATA_ACCENT = "#ec4899"; // pink

// Recursive component to display native script structure
function NativeScriptDisplay({ script, depth = 0 }: { script: NativeScript; depth?: number }) {
  const indent = depth * 12;
  
  if ("ScriptPubkey" in script) {
    return (
      <div className="tcv-native-script-item" style={{ marginLeft: indent }}>
        <span className="tcv-ns-icon">🔑</span>
        <span className="tcv-ns-type">Signature</span>
        <code className="tcv-ns-hash">{script.ScriptPubkey.addr_keyhash}</code>
        <CopyButton text={script.ScriptPubkey.addr_keyhash} />
      </div>
    );
  }
  
  if ("ScriptAll" in script) {
    return (
      <div className="tcv-native-script-group" style={{ marginLeft: indent }}>
        <div className="tcv-ns-header">
          <span className="tcv-ns-icon">🔐</span>
          <span className="tcv-ns-type">ALL of ({script.ScriptAll.native_scripts.length})</span>
        </div>
        <div className="tcv-ns-children">
          {script.ScriptAll.native_scripts.map((child, i) => (
            <NativeScriptDisplay key={i} script={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }
  
  if ("ScriptAny" in script) {
    return (
      <div className="tcv-native-script-group" style={{ marginLeft: indent }}>
        <div className="tcv-ns-header">
          <span className="tcv-ns-icon">🔓</span>
          <span className="tcv-ns-type">ANY of ({script.ScriptAny.native_scripts.length})</span>
        </div>
        <div className="tcv-ns-children">
          {script.ScriptAny.native_scripts.map((child, i) => (
            <NativeScriptDisplay key={i} script={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }
  
  if ("ScriptNOfK" in script) {
    return (
      <div className="tcv-native-script-group" style={{ marginLeft: indent }}>
        <div className="tcv-ns-header">
          <span className="tcv-ns-icon">🔢</span>
          <span className="tcv-ns-type">{script.ScriptNOfK.n} of {script.ScriptNOfK.native_scripts.length}</span>
        </div>
        <div className="tcv-ns-children">
          {script.ScriptNOfK.native_scripts.map((child, i) => (
            <NativeScriptDisplay key={i} script={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }
  
  if ("TimelockStart" in script) {
    return (
      <div className="tcv-native-script-item" style={{ marginLeft: indent }}>
        <span className="tcv-ns-icon">⏰</span>
        <span className="tcv-ns-type">Valid after</span>
        <span className="tcv-ns-slot">slot {script.TimelockStart.slot}</span>
      </div>
    );
  }
  
  if ("TimelockExpiry" in script) {
    return (
      <div className="tcv-native-script-item" style={{ marginLeft: indent }}>
        <span className="tcv-ns-icon">⏱️</span>
        <span className="tcv-ns-type">Valid before</span>
        <span className="tcv-ns-slot">slot {script.TimelockExpiry.slot}</span>
      </div>
    );
  }
  
  return <div>Unknown script type</div>;
}

export function AuxiliaryDataSection({ auxData }: AuxiliaryDataSectionProps) {
  const hasMetadata = auxData.metadata && Object.keys(auxData.metadata).length > 0;
  const hasNativeScripts = auxData.native_scripts && auxData.native_scripts.length > 0;
  const hasPlutusScripts = auxData.plutus_scripts && auxData.plutus_scripts.length > 0;
  
  return (
    <div className="tcv-aux-data-section">
      {/* Metadata */}
      {hasMetadata && (
        <Collapsible.Root className="tcv-aux-collapsible" defaultOpen={true}>
          <Collapsible.Trigger className="tcv-aux-trigger">
            <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
              <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <span className="tcv-aux-trigger-icon">📝</span>
            <span>Metadata ({Object.keys(auxData.metadata!).length} labels)</span>
          </Collapsible.Trigger>
          <Collapsible.Content className="tcv-aux-content">
            <div className="tcv-metadata-list">
              {Object.entries(auxData.metadata!).map(([label, value]) => {
                const raw = typeof value === 'string' ? value : JSON.stringify(value);
                return (
                  <CollapsibleDataItem
                    key={label}
                    label={`Label ${label}`}
                    data={raw}
                    defaultOpen={Object.keys(auxData.metadata!).length === 1}
                    colorAccent={AUX_DATA_ACCENT}
                  />
                );
              })}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
      
      {/* Native Scripts */}
      {hasNativeScripts && (
        <Collapsible.Root className="tcv-aux-collapsible" defaultOpen={false}>
          <Collapsible.Trigger className="tcv-aux-trigger">
            <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
              <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <span className="tcv-aux-trigger-icon">📄</span>
            <span>Native Scripts ({auxData.native_scripts!.length})</span>
          </Collapsible.Trigger>
          <Collapsible.Content className="tcv-aux-content">
            <div className="tcv-native-scripts-list">
              {auxData.native_scripts!.map((script, i) => (
                <div key={i} className="tcv-native-script-wrapper">
                  <span className="tcv-ns-index">Script #{i}</span>
                  <NativeScriptDisplay script={script} />
                </div>
              ))}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
      
      {/* Plutus Scripts */}
      {hasPlutusScripts && (
        <Collapsible.Root className="tcv-aux-collapsible" defaultOpen={false}>
          <Collapsible.Trigger className="tcv-aux-trigger">
            <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
              <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <span className="tcv-aux-trigger-icon">📝</span>
            <span>Plutus Scripts ({auxData.plutus_scripts!.length})</span>
          </Collapsible.Trigger>
          <Collapsible.Content className="tcv-aux-content">
            <div className="tcv-plutus-scripts-list">
              {auxData.plutus_scripts!.map((script, i) => (
                <CollapsibleDataItem
                  key={i}
                  label={`Script #${i} (${script.length} chars)`}
                  data={script}
                  colorAccent={AUX_DATA_ACCENT}
                />
              ))}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
      
      {/* Alonzo format preference */}
      <div className="tcv-aux-format">
        <span className="tcv-aux-format-label">Format:</span>
        <span className="tcv-aux-format-value">
          {auxData.prefer_alonzo_format ? "Alonzo" : "Babbage"}
        </span>
      </div>
    </div>
  );
}

