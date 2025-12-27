"use client";

import React, { useRef, useEffect } from "react";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { UtxoRef } from "../../UtxoRef";
import { OutputCard } from "./OutputCard";
import { getPathDiagnostics, getTransactionLink } from "../utils";
import type { TransactionInput, TransactionOutput, ValidationDiagnostic, CardanoNetwork, KoiosUtxoInfo } from "../types";

interface InputCardProps {
  input: TransactionInput;
  index: number;
  network?: CardanoNetwork;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  /** Fetched UTxO info from Koios */
  utxoInfo?: KoiosUtxoInfo;
}

/**
 * Convert KoiosUtxoInfo to TransactionOutput format for use with OutputCard
 */
function koiosUtxoToTransactionOutput(utxoInfo: KoiosUtxoInfo): TransactionOutput {
  // Build multiasset from asset_list
  let multiasset: Record<string, Record<string, string>> | undefined = undefined;
  
  if (utxoInfo.asset_list && utxoInfo.asset_list.length > 0) {
    multiasset = {};
    for (const asset of utxoInfo.asset_list) {
      if (!multiasset[asset.policy_id]) {
        multiasset[asset.policy_id] = {};
      }
      multiasset[asset.policy_id][asset.asset_name] = asset.quantity;
    }
  }

  // Build plutus_data - if inline_datum exists, use it; otherwise use datum_hash
  let plutus_data: TransactionOutput['plutus_data'] = undefined;
  
  if (utxoInfo.inline_datum) {
    // Inline datum - store as Data with JSON string
    plutus_data = { Data: JSON.stringify(utxoInfo.inline_datum.value) };
  } else if (utxoInfo.datum_hash) {
    // Just a datum hash
    plutus_data = { DataHash: utxoInfo.datum_hash };
  }

  // Build script_ref if present
  let script_ref: TransactionOutput['script_ref'] = undefined;
  if (utxoInfo.reference_script) {
    // Use PlutusScript format with the script bytes or hash
    script_ref = { PlutusScript: utxoInfo.reference_script.bytes || utxoInfo.reference_script.hash };
  }

  return {
    address: utxoInfo.address,
    amount: {
      coin: utxoInfo.value,
      multiasset,
    },
    plutus_data,
    script_ref,
  };
}

export function InputCard({ 
  input, 
  index, 
  network,
  path,
  diagnosticsMap,
  focusedPath,
  utxoInfo
}: InputCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const diagnostics = getPathDiagnostics(path, diagnosticsMap);
  const isFocused = focusedPath?.includes(path) ?? false;
  const txUrl = network ? getTransactionLink(network, input.transaction_id) : undefined;
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isFocused]);
  
  // If we don't have UTxO info, show the compact view
  if (!utxoInfo) {
    return (
      <div ref={cardRef} className={`tcv-item-card tcv-input tcv-input-compact ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
        <div className="tcv-input-compact-row">
          <span className="tcv-item-index">#{index}</span>
          <div className="tcv-utxo-ref">
            <UtxoRef 
              txHash={input.transaction_id}
              index={input.index}
              txUrl={txUrl}
            />
          </div>
          <DiagnosticBadge diagnostics={diagnostics} />
        </div>
      </div>
    );
  }

  // With UTxO info - convert to TransactionOutput and use OutputCard
  const output = koiosUtxoToTransactionOutput(utxoInfo);
  const isSpent = utxoInfo.is_spent;

  // For inline datum, datum_hash from Koios is already its hash
  const inlineDatumHash = utxoInfo.inline_datum ? utxoInfo.datum_hash : null;

  // Prepare inline script info from reference_script
  const inlineScriptInfo = utxoInfo.reference_script ? {
    hash: utxoInfo.reference_script.hash,
    script_type: utxoInfo.reference_script.type as "Native" | { Plutus: string } | undefined,
    size: utxoInfo.reference_script.size,
  } : null;

  return (
    <div ref={cardRef} className={`tcv-input-wrapper ${isSpent ? 'tcv-input-spent' : ''} ${isFocused ? 'is-focused' : ''}`}>
      {/* UTxO Reference header */}
      <div className={`tcv-input-utxo-header ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''}`}>
        <span className="tcv-item-index">#{index}</span>
        <div className="tcv-utxo-ref">
          <UtxoRef 
            txHash={input.transaction_id}
            index={input.index}
            txUrl={txUrl}
          />
        </div>
        {isSpent && <span className="tcv-tag tcv-tag-spent">Spent</span>}
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      
      {/* Reuse OutputCard for the UTxO content */}
      <OutputCard
        output={output}
        index={index}
        network={network}
        path={path}
        diagnosticsMap={diagnosticsMap}
        focusedPath={focusedPath}
        inlineDatumHash={inlineDatumHash}
        inlineScriptInfo={inlineScriptInfo}
        isInputCard={true}
      />
    </div>
  );
}
