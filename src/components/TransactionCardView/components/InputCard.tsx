"use client";

import React, { useRef, useEffect } from "react";
import JSONBig from "json-bigint";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { UtxoRef } from "../../UtxoRef";
import { OutputCard } from "./OutputCard";
import { getPathDiagnostics, getTransactionLink } from "../utils";
import type { TransactionInput, TransactionOutput, ValidationDiagnostic, CardanoNetwork, KoiosUtxoInfo } from "../types";
import { detectSundaeOutput, type SundaeInputDetection } from "@/utils/protocols/sundae";
import { detectDexOutput, formatDexRole, dexThemeKey, type DexInputDetection } from "@/utils/protocols/dex";
import "@/utils/protocols/dex/adapters";

interface InputCardProps {
  input: TransactionInput;
  index: number;
  network?: CardanoNetwork;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  /** Fetched UTxO info from Koios */
  utxoInfo?: KoiosUtxoInfo;
  /** Pre-computed sundae context for this input (Cancel / Scoop, etc.) */
  sundaeDetection?: SundaeInputDetection;
  /** Pre-computed generic DEX context for this input (Apply / Cancel, etc.) */
  dexDetection?: DexInputDetection;
  /** Witness-set datum lookup map (forwarded to the wrapped OutputCard). */
  witnessDatums?: Map<string, import("@/utils/protocols/sundae/plutusData").PD> | null;
}

/**
 * Check if a Koios script type is a native script type
 */
function isNativeScriptType(type: string | undefined): boolean {
  if (!type) return false;
  const lowerType = type.toLowerCase();
  return lowerType === 'native' || lowerType === 'timelock' || lowerType === 'multisig';
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
    // Plutus int datums can exceed MAX_SAFE_INTEGER, so the parsed value
    // may contain BigInts that native JSON.stringify rejects.
    plutus_data = { Data: JSONBig({ useNativeBigInt: true }).stringify(utxoInfo.inline_datum.value) };
  } else if (utxoInfo.datum_hash) {
    // Just a datum hash
    plutus_data = { DataHash: utxoInfo.datum_hash };
  }

  // Build script_ref if present
  // Only set script_ref if we have actual script content (not just hash)
  // Hash/type/size are shown separately via inlineScriptInfo
  let script_ref: TransactionOutput['script_ref'] = undefined;
  if (utxoInfo.reference_script) {
    const scriptType = utxoInfo.reference_script.type;
    
    if (isNativeScriptType(scriptType) && utxoInfo.reference_script.value) {
      // For native scripts with parsed value from Koios
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      script_ref = { NativeScript: utxoInfo.reference_script.value as any };
    } else if (!isNativeScriptType(scriptType) && utxoInfo.reference_script.bytes) {
      // For Plutus scripts with actual bytes (not just hash)
      script_ref = { PlutusScript: utxoInfo.reference_script.bytes };
    }
    // If we only have hash - don't set script_ref
    // The hash/type/size will be shown via inlineScriptInfo
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

function SundaeInputBadge({ detection }: { detection: SundaeInputDetection }) {
  const protocolLabel = `Sundae ${detection.match.protocol} ${
    detection.match.role === "order" ? "Order" : "Pool"
  }`;
  if (detection.redeemer?.kind === "Cancel") {
    return (
      <span className="tcv-tag tcv-tag-sundae-cancel" title={`${protocolLabel} cancellation`}>
        🚫 Cancel
      </span>
    );
  }
  if (detection.redeemer?.kind === "Scoop") {
    return (
      <span className="tcv-tag tcv-tag-sundae-scoop" title={`${protocolLabel} being scooped`}>
        🍨 Scoop
      </span>
    );
  }
  return (
    <span className="tcv-tag tcv-tag-sundae" title={protocolLabel}>
      🍨 {detection.match.protocol} {detection.match.role === "order" ? "Order" : "Pool"}
    </span>
  );
}

function DexInputBadge({ detection }: { detection: DexInputDetection }) {
  const roleLabel = formatDexRole(detection.role);
  const title = `${detection.label} ${roleLabel}${detection.redeemer ? ` · ${detection.redeemer}` : ""}`;
  const isCancel = detection.redeemer?.toLowerCase().includes("cancel");
  return (
    <span
      className={`tcv-tag ${isCancel ? "tcv-tag-sundae-cancel" : "tcv-tag-dex"}`}
      data-dex={dexThemeKey(detection.adapterId)}
      title={title}
    >
      {detection.label} {roleLabel}
      {detection.redeemer ? ` · ${detection.redeemer}` : ""}
    </span>
  );
}

export function InputCard({
  input,
  index,
  network,
  path,
  diagnosticsMap,
  focusedPath,
  utxoInfo,
  sundaeDetection,
  dexDetection,
  witnessDatums = null,
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
          {sundaeDetection && <SundaeInputBadge detection={sundaeDetection} />}
          {dexDetection && <DexInputBadge detection={dexDetection} />}
          <DiagnosticBadge diagnostics={diagnostics} />
        </div>
      </div>
    );
  }

  // With UTxO info - convert to TransactionOutput and use OutputCard
  const output = koiosUtxoToTransactionOutput(utxoInfo);
  const isSpent = utxoInfo.is_spent;

  // Spending inputs get a precomputed detection (with redeemer) from the tx
  // context. Collateral and reference inputs do NOT, so self-detect from the
  // resolved UTxO to still surface a protocol badge for them. The wrapped
  // OutputCard renders the full decoded panel either way.
  const selfDex = !dexDetection ? detectDexOutput(output, network, witnessDatums) : null;
  const selfSundae = !sundaeDetection ? detectSundaeOutput(output, network, witnessDatums) : null;
  const badgeDex: DexInputDetection | undefined =
    dexDetection ?? (selfDex ? { adapterId: selfDex.adapterId, label: selfDex.label, role: selfDex.role } : undefined);
  const badgeSundae: SundaeInputDetection | undefined =
    sundaeDetection ?? (selfSundae ? { match: selfSundae.match } : undefined);

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
        {badgeSundae && <SundaeInputBadge detection={badgeSundae} />}
        {badgeDex && <DexInputBadge detection={badgeDex} />}
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
        witnessDatums={witnessDatums}
      />
    </div>
  );
}
