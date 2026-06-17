"use client";

import React, { useRef, useEffect } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CopyButton } from "./CopyButton";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { getPathDiagnostics } from "../utils";
import { AssetNameWithTooltip, AssetAmount } from "./AssetNameWithTooltip";
import type { ValidationDiagnostic } from "../types";

interface MintSectionProps {
  mint: [string, Record<string, string>][];
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
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

export function MintSection({
  mint, 
  path,
  diagnosticsMap,
  focusedPath
}: MintSectionProps) {
  // Flatten mint data for table display
  const mintRows: { policyId: string; assetName: string; quantity: bigint; isMint: boolean; policyIndex: number }[] = [];
  mint.forEach(([policyId, assets], policyIndex) => {
    Object.entries(assets).forEach(([assetName, quantity]) => {
      const qty = BigInt(quantity);
      mintRows.push({ 
        policyId, 
        assetName, 
        quantity: qty, 
        isMint: qty > BigInt(0),
        policyIndex 
      });
    });
  });

  // Get diagnostics for the section
  const sectionRef = useRef<HTMLDivElement>(null);
  const sectionDiagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isSectionFocused = focusedPath?.includes(path) ?? false;

  // Scroll into view when section is focused
  useEffect(() => {
    if (isSectionFocused && sectionRef.current) {
      setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isSectionFocused]);

  return (
    <div ref={sectionRef} className={`tcv-mint-table-wrapper ${sectionDiagnostics.length > 0 ? 'has-error' : ''} ${isSectionFocused ? 'is-focused' : ''}`}>
      <table className="tcv-mint-table">
        <thead>
          <tr>
            <th>Policy ID</th>
            <th>Asset Name</th>
            <th>Action</th>
            <th>Quantity</th>
          </tr>
        </thead>
        <tbody>
          {mintRows.map((row, i) => {
            const rowPath = `${path}.${row.policyIndex}`;
            const rowDiagnostics = getPathDiagnostics(rowPath, diagnosticsMap);
            const isRowFocused = focusedPath?.includes(rowPath) ?? false;
            
            return (
              <tr 
                key={`${row.policyId}.${row.assetName}.${i}`}
                className={`${rowDiagnostics.length > 0 ? 'has-error' : ''} ${isRowFocused ? 'is-focused' : ''}`}
              >
                <td className="tcv-table-policy">
                  <AutoTruncateWithTooltip value={row.policyId} />
                </td>
                <td className="tcv-table-asset">
                  {row.assetName ? (
                    <AssetNameWithTooltip
                      policyId={row.policyId}
                      assetName={row.assetName}
                      className="tcv-auto-truncate"
                    />
                  ) : (
                    <span className="tcv-empty-name">(empty)</span>
                  )}
                </td>
                <td>
                  <span className={`tcv-mint-action ${row.isMint ? 'mint' : 'burn'}`}>
                    {row.isMint ? 'MINT' : 'BURN'}
                  </span>
                </td>
                <td className={`tcv-table-qty ${row.isMint ? 'mint' : 'burn'}`}>
                  <AssetAmount
                    policyId={row.policyId}
                    assetName={row.assetName}
                    raw={row.quantity}
                    prefix={row.isMint ? '+' : ''}
                  />
                  {rowDiagnostics.length > 0 && (
                    <DiagnosticBadge diagnostics={rowDiagnostics} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
