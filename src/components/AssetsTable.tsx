"use client";

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CopyIcon, CheckIcon } from "./Icons";
// Reuse the shared CIP-68-aware decoder so this table matches the rest of the UI.
import { decodeAssetName as formatAssetName } from "./TransactionCardView/utils";

// ============================================================================
// Types
// ============================================================================

export interface AssetRow {
  policyId: string;
  assetName: string;
  quantity: bigint | number | string;
}

interface AssetsTableProps {
  assets: AssetRow[];
  /** Shows +/- sign and colors for positive/negative quantities */
  showSign?: boolean;
  /** Label shown above the table */
  label?: string;
  /** Compact mode for use in error formatters */
  compact?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

// ============================================================================
// Sub-Components
// ============================================================================

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      className={`assets-table-copy-btn ${copied ? "copied" : ""} ${className}`}
      onClick={handleCopy}
      onKeyDown={(e) => e.key === "Enter" && handleCopy(e as unknown as React.MouseEvent)}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </span>
  );
}

// Auto-truncate with tooltip
function PolicyIdWithTooltip({ value }: { value: string }) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="assets-table-truncate">{value}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="assets-table-tooltip" sideOffset={5} side="top">
            <div className="assets-table-tooltip-content">
              <span className="assets-table-tooltip-value">{value}</span>
              <CopyButton text={value} className="assets-table-tooltip-copy" />
            </div>
            <Tooltip.Arrow className="assets-table-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// Asset name with decoded string and hex in tooltip
function AssetNameWithTooltip({ assetName }: { assetName: string }) {
  const formatted = formatAssetName(assetName);
  const isEmpty = !assetName || assetName === "";
  
  if (isEmpty) {
    return <span className="assets-table-empty-name">(empty)</span>;
  }
  
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={`assets-table-truncate ${formatted.decoded ? "assets-table-decoded" : ""}`}>
            {formatted.display}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="assets-table-tooltip" sideOffset={5} side="top">
            <div className="assets-table-tooltip-rows">
              {formatted.decoded && (
                <div className="assets-table-tooltip-row">
                  <span className="assets-table-tooltip-label">String:</span>
                  <span className="assets-table-tooltip-value">{formatted.decoded}</span>
                  <CopyButton text={formatted.decoded} className="assets-table-tooltip-copy" />
                </div>
              )}
              <div className="assets-table-tooltip-row">
                <span className="assets-table-tooltip-label">Hex:</span>
                <span className="assets-table-tooltip-value assets-table-tooltip-hex">{formatted.hex}</span>
                <CopyButton text={formatted.hex} className="assets-table-tooltip-copy" />
              </div>
            </div>
            <Tooltip.Arrow className="assets-table-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AssetsTable({ 
  assets, 
  showSign = false, 
  label,
  compact = false
}: AssetsTableProps) {
  if (assets.length === 0) return null;
  
  return (
    <div className={`assets-table-wrapper ${compact ? "assets-table-compact" : ""}`}>
      {label && (
        <span className="assets-table-label">{label}</span>
      )}
      <div className="assets-table-scroll">
        <table className="assets-table">
          <thead>
            <tr>
              <th>Policy ID</th>
              <th>Asset Name</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset, i) => {
              const qty = typeof asset.quantity === "bigint" 
                ? asset.quantity 
                : BigInt(asset.quantity);
              const isPositive = qty > BigInt(0);
              const isNegative = qty < BigInt(0);
              
              return (
                <tr key={`${asset.policyId}.${asset.assetName}.${i}`}>
                  <td className="assets-table-policy">
                    <PolicyIdWithTooltip value={asset.policyId} />
                  </td>
                  <td className="assets-table-asset">
                    <AssetNameWithTooltip assetName={asset.assetName} />
                  </td>
                  <td className={`assets-table-qty ${isPositive ? "positive" : ""} ${isNegative ? "negative" : ""}`}>
                    {showSign && isPositive ? "+" : ""}{qty.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AssetsTable;

