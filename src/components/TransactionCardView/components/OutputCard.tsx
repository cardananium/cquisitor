"use client";

import React, { useRef, useEffect } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { HashWithTooltip } from "./HashWithTooltip";
import { AddressWithTooltip } from "../../AddressWithTooltip";
import { getPathDiagnostics, getAddressLink, formatAda, formatAssetName } from "../utils";
import type { TransactionOutput, ValidationDiagnostic, CardanoNetwork, DataOption } from "../types";
import type { InlineScriptInfo } from "@cardananium/cquisitor-lib";

/**
 * Extended script info that works with both lib and Koios types
 */
export interface ExtendedScriptInfo {
  hash: string;
  script_type?: "Native" | { Plutus: string } | string;
  size?: number;
}

interface OutputCardProps {
  output: TransactionOutput;
  index: number;
  network?: CardanoNetwork;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  /** Hash of inline datum from extractedHashes */
  inlineDatumHash?: string | null;
  /** Inline script info (hash and type) from extractedHashes or Koios */
  inlineScriptInfo?: InlineScriptInfo | ExtendedScriptInfo | null;
  /** When true, hides the header (used when wrapped by InputCard) */
  isInputCard?: boolean;
}

// Auto-truncate with tooltip
function AutoTruncateWithTooltip({ value }: { value: string }) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="tcv-auto-truncate">{value}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tcv-hash-tooltip" sideOffset={5} side="top">
            <div className="tcv-hash-tooltip-content">
              {value}
              <CopyButton text={value} className="tcv-tooltip-copy" />
            </div>
            <Tooltip.Arrow className="tcv-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// Asset name with decoded string and hex in tooltip
function AssetNameWithTooltip({ assetName }: { assetName: string }) {
  const formatted = formatAssetName(assetName);
  
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={`tcv-auto-truncate ${formatted.decoded ? 'tcv-decoded' : ''}`}>
            {formatted.display}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tcv-hash-tooltip" sideOffset={5} side="top">
            <div className="tcv-asset-tooltip-content">
              {formatted.decoded && (
                <div className="tcv-tooltip-row">
                  <span className="tcv-tooltip-label">String:</span>
                  <span className="tcv-tooltip-value">{formatted.decoded}</span>
                  <CopyButton text={formatted.decoded} className="tcv-tooltip-copy-sm" />
                </div>
              )}
              <div className="tcv-tooltip-row">
                <span className="tcv-tooltip-label">Hex:</span>
                <span className="tcv-tooltip-value tcv-tooltip-hex">{formatted.hex}</span>
                <CopyButton text={formatted.hex} className="tcv-tooltip-copy-sm" />
              </div>
            </div>
            <Tooltip.Arrow className="tcv-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// Format any value to string for display
function formatValue(value: unknown): { text: string; isJson: boolean } {
  if (typeof value === 'string') {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        return { text: JSON.stringify(parsed, null, 2), isJson: true };
      }
    } catch {
      // Not JSON, return as is
    }
    return { text: value, isJson: false };
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return { text: value.toString(), isJson: false };
  }
  if (value === null || value === undefined) {
    return { text: '', isJson: false };
  }
  // Object or array - format as JSON
  return { text: JSON.stringify(value, null, 2), isJson: true };
}

// Parse DataOption to determine if it's a hash or inline datum
function parseDataOption(data: DataOption | null | undefined): { 
  type: 'hash' | 'inline' | null; 
  value: string; 
  formatted: { text: string; isJson: boolean };
} {
  if (!data) return { type: null, value: '', formatted: { text: '', isJson: false } };
  
  if ('DataHash' in data) {
    return { 
      type: 'hash', 
      value: data.DataHash,
      formatted: { text: data.DataHash, isJson: false }
    };
  }
  
  if ('Data' in data) {
    return { 
      type: 'inline', 
      value: data.Data,
      formatted: formatValue(data.Data)
    };
  }
  
  return { type: null, value: '', formatted: { text: '', isJson: false } };
}

// Helper to format script type for display
function formatScriptType(info: InlineScriptInfo | ExtendedScriptInfo | null | undefined): string | null {
  if (!info || !info.script_type) return null;
  if (info.script_type === "Native") return "Native";
  if (typeof info.script_type === "string") {
    // Handle Koios type strings like "plutusV1", "plutusV2", etc.
    if (info.script_type.toLowerCase().startsWith("plutus")) {
      return info.script_type;
    }
    return info.script_type;
  }
  if (typeof info.script_type === "object" && "Plutus" in info.script_type) {
    return `Plutus ${info.script_type.Plutus}`;
  }
  return null;
}

export function OutputCard({ 
  output, 
  index, 
  network,
  path,
  diagnosticsMap,
  focusedPath,
  inlineDatumHash,
  inlineScriptInfo,
  isInputCard = false
}: OutputCardProps) {
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
  
  const hasMultiasset = output.amount.multiasset && Object.keys(output.amount.multiasset).length > 0;
  const hasScriptRef = !!output.script_ref;

  // Parse plutus data to determine type
  const plutusDataInfo = parseDataOption(output.plutus_data);
  const isDatumHash = plutusDataInfo.type === 'hash';
  const isInlineDatum = plutusDataInfo.type === 'inline';

  // Flatten multiassets for table display
  const assetRows: { policyId: string; assetName: string; quantity: string }[] = [];
  if (hasMultiasset) {
    Object.entries(output.amount.multiasset!).forEach(([policyId, assets]) => {
      Object.entries(assets).forEach(([assetName, quantity]) => {
        assetRows.push({ policyId, assetName, quantity });
      });
    });
  }

  const scriptRefFormatted = hasScriptRef ? formatValue(output.script_ref) : { text: '', isJson: false };

  // Get script size if available from extended info
  const scriptSize = inlineScriptInfo && 'size' in inlineScriptInfo ? inlineScriptInfo.size : null;
  
  return (
    <div 
      ref={cardRef}
      className={`tcv-item-card tcv-output ${isInputCard ? 'tcv-output-as-input' : ''} ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}
    >
      {/* Hide header when used as input card (InputCard provides its own header) */}
      {!isInputCard && (
        <div className="tcv-item-header">
          <span className="tcv-item-index">#{index}</span>
          <div className="tcv-output-tags">
            {hasMultiasset && <span className="tcv-tag tokens">Tokens</span>}
            {isDatumHash && <span className="tcv-tag datum-hash">Datum Hash</span>}
            {isInlineDatum && <span className="tcv-tag datum">Inline Datum</span>}
            {hasScriptRef && <span className="tcv-tag script">Script</span>}
          </div>
          <DiagnosticBadge diagnostics={diagnostics} />
        </div>
      )}
      
      <div className="tcv-item-row">
        <span className="tcv-item-label">Address</span>
        <div className="tcv-item-value-row">
          <AddressWithTooltip 
            address={output.address} 
            linkUrl={network ? getAddressLink(network, output.address) : null}
          />
        </div>
      </div>

      {/* Datum Hash - compact display */}
      {isDatumHash && (
        <div className="tcv-item-row">
          <span className="tcv-item-label">Datum Hash</span>
          <div className="tcv-item-value-row">
            <span className="tcv-datum-hash-value">{plutusDataInfo.value}</span>
            <CopyButton text={plutusDataInfo.value} />
          </div>
        </div>
      )}

      {/* Inline Datum - collapsible display with hash */}
      {isInlineDatum && (
        <div className="tcv-inline-collapsible-wrapper">
          <Collapsible.Root className="tcv-inline-collapsible">
            <Collapsible.Trigger className="tcv-inline-collapsible-trigger">
              <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
                <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
              <span>Inline Datum</span>
            </Collapsible.Trigger>
            <Collapsible.Content className="tcv-inline-collapsible-content">
              {/* Show datum hash if available */}
              {inlineDatumHash && (
                <div className="tcv-inline-hash-row">
                  <span className="tcv-inline-hash-label">Hash:</span>
                  <HashWithTooltip hash={inlineDatumHash} className="tcv-inline-hash-value" />
                </div>
              )}
              <div className={plutusDataInfo.formatted.isJson ? "tcv-data-value-json" : "tcv-data-value"}>
                {plutusDataInfo.formatted.text}
                <CopyButton text={plutusDataInfo.formatted.text} />
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        </div>
      )}

      {/* Script Reference Section - before balance */}
      {hasScriptRef && (
        <div className="tcv-inline-collapsible-wrapper">
          <Collapsible.Root className="tcv-inline-collapsible">
            <Collapsible.Trigger className="tcv-inline-collapsible-trigger">
              <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
                <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              </svg>
              <span>Script Reference</span>
              {inlineScriptInfo && formatScriptType(inlineScriptInfo) && (
                <span className="tcv-script-type-badge">{formatScriptType(inlineScriptInfo)}</span>
              )}
            </Collapsible.Trigger>
            <Collapsible.Content className="tcv-inline-collapsible-content">
              {/* Show script hash if available */}
              {inlineScriptInfo?.hash && (
                <div className="tcv-inline-hash-row">
                  <span className="tcv-inline-hash-label">Hash:</span>
                  <HashWithTooltip hash={inlineScriptInfo.hash} className="tcv-inline-hash-value" />
                </div>
              )}
              {/* Show script size if available (from Koios) */}
              {scriptSize && (
                <div className="tcv-inline-hash-row">
                  <span className="tcv-inline-hash-label">Size:</span>
                  <span className="tcv-inline-hash-value">{scriptSize.toLocaleString()} bytes</span>
                </div>
              )}
              <div className={scriptRefFormatted.isJson ? "tcv-data-value-json" : "tcv-data-value"}>
                {scriptRefFormatted.text}
                <CopyButton text={scriptRefFormatted.text} />
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        </div>
      )}
      
      <div className="tcv-item-row tcv-ada-row">
        <span className="tcv-item-label">ADA</span>
        <span className="tcv-ada-amount">₳ {formatAda(output.amount.coin)}</span>
      </div>
      
      {hasMultiasset && (
        <div className="tcv-assets-section">
          <span className="tcv-assets-label">Native Assets ({assetRows.length})</span>
          <div className="tcv-assets-table-wrapper">
            <table className="tcv-assets-table">
              <thead>
                <tr>
                  <th>Policy ID</th>
                  <th>Asset Name</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {assetRows.map((asset, i) => (
                  <tr key={`${asset.policyId}.${asset.assetName}.${i}`}>
                    <td className="tcv-table-policy">
                      <AutoTruncateWithTooltip value={asset.policyId} />
                    </td>
                    <td className="tcv-table-asset">
                      {asset.assetName ? (
                        <AssetNameWithTooltip assetName={asset.assetName} />
                      ) : (
                        <span className="tcv-empty-name">(empty)</span>
                      )}
                    </td>
                    <td className="tcv-table-qty">
                      {BigInt(asset.quantity).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
