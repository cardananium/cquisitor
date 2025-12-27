"use client";

import React, { useMemo, useRef, useEffect } from "react";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { AddressWithTooltip } from "../../AddressWithTooltip";
import { getPathDiagnostics, formatAda, getStakeKeyLink } from "../utils";
import { decode_specific_type } from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import type { DecodedAddress } from "@/utils/addressTypes";
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
  
  // Decode address using cquisitor-lib for accurate credential info
  const decoded = useMemo((): DecodedAddress | null => {
    if (!address) return null;
    try {
      const result = decode_specific_type(address, "Address", {});
      return convertSerdeNumbers(result) as DecodedAddress;
    } catch {
      return null;
    }
  }, [address]);
  
  const isScript = decoded?.details?.staking_cred?.type === "ScriptHash";
  
  return (
    <div ref={cardRef} className={`tcv-item-card tcv-withdrawal ${diagnostics.length > 0 ? (diagnostics.some(d => d.severity === 'error') ? 'has-error' : 'has-warning') : ''} ${isFocused ? 'is-focused' : ''}`}>
      <div className="tcv-item-header">
        <span className="tcv-item-index">#{index}</span>
        <span className={`tcv-cred-type ${isScript ? 'script' : 'key'}`}>
          {isScript ? 'Script' : 'Key'}
        </span>
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

