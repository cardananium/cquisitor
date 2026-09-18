"use client";

import React, { useMemo, useRef, useEffect } from "react";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { AddressWithTooltip } from "../../AddressWithTooltip";
import { getPathDiagnostics, formatAda, getStakeKeyLink } from "../utils";
import { useDecodedAddress, useDecodedAddressVersion } from "@/lib/useDecodedAddress";
import { stakeCredentialOf } from "@/utils/addressTypes";
import { detectDexWithdrawal, dexThemeKey } from "@/utils/protocols/dex";
import type { ValidationDiagnostic, CardanoNetwork } from "../types";

interface WithdrawalCardProps {
  address: string;
  amount: string;
  index: number;
  network?: CardanoNetwork;
  path: string;
  diagnosticsMap: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
}

export function WithdrawalCard({ 
  address,
  amount,
  index,
  network,
  path,
  diagnosticsMap,
  focusedPath
}: WithdrawalCardProps) {
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
  
  // Decoded off the render path — see `@/lib/decodedAddresses`.
  const decoded = useDecodedAddress(address);
  const addressVersion = useDecodedAddressVersion();

  const isScript = stakeCredentialOf(decoded)?.type === "ScriptHash";

  // A 0-amount withdrawal to a DEX's staking validator is its batcher: the
  // order/pool spends defer the swap/batch validation to this withdraw-zero.
  // Detection reads the decode, so a decode that lands later has to re-run it.
  const dexBatcher = useMemo(() => {
    void addressVersion;
    return detectDexWithdrawal(address, network);
  }, [address, network, addressVersion]);

  return (
    <div ref={cardRef} className={`tcv-item-card tcv-withdrawal ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header">
        <span className="tcv-item-index">#{index}</span>
        <span className={`tcv-cred-type ${isScript ? 'script' : 'key'}`}>
          {isScript ? 'Script' : 'Key'}
        </span>
        {dexBatcher && (
          <span className="tcv-tag tcv-tag-dex" data-dex={dexThemeKey(dexBatcher.adapterId)}>
            {dexBatcher.label} {dexBatcher.purpose}
          </span>
        )}
        <DiagnosticBadge diagnostics={diagnostics} />
      </div>
      
      <div className="tcv-withdrawal-details">
        <div className="tcv-withdrawal-row">
          <span className="tcv-withdrawal-label">Stake Address</span>
          <div className="tcv-withdrawal-value-row">
            <AddressWithTooltip 
              address={address}
              linkUrl={network ? getStakeKeyLink(network, address) : null}
            />
          </div>
        </div>
        
        <div className="tcv-withdrawal-amount-row">
          <span className="tcv-withdrawal-label">Amount</span>
          <span className="tcv-ada-amount tcv-withdrawal-amount">₳ {formatAda(amount)}</span>
        </div>
      </div>
    </div>
  );
}

