"use client";

import React, { useState } from "react";
import { CopyIcon, CheckIcon } from "./Icons";

export interface UtxoRefProps {
  txHash: string;
  index: number;
  /** Optional link URL for the transaction */
  txUrl?: string;
  /** Show copy button (default: true) */
  showCopy?: boolean;
  /** Display variant: 'default' for cards, 'error' for validation errors, 'tooltip' for dark backgrounds */
  variant?: "default" | "error" | "tooltip";
  /** Optional className for styling */
  className?: string;
}

/**
 * Unified component for displaying UTxO references (txid#index)
 * Used in both TransactionCardView and ErrorDataFormatters
 */
export function UtxoRef({ 
  txHash, 
  index, 
  txUrl, 
  showCopy = true,
  variant = "default",
  className = ""
}: UtxoRefProps) {
  const [copied, setCopied] = useState(false);
  const fullValue = `${txHash}#${index}`;
  
  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(fullValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const content = (
    <>
      <span className="utxo-ref-txhash">{txHash}</span>
      <span className="utxo-ref-separator"> # </span>
      <span className="utxo-ref-index">{index}</span>
    </>
  );

  return (
    <span className={`utxo-ref utxo-ref-${variant} ${className}`}>
      {txUrl ? (
        <a 
          href={txUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="utxo-ref-link"
        >
          {content}
        </a>
      ) : (
        <span className="utxo-ref-text">{content}</span>
      )}
      
      {showCopy && (
        <span 
          role="button"
          tabIndex={0}
          className={`utxo-ref-copy ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          onKeyDown={(e) => e.key === 'Enter' && handleCopy(e as unknown as React.MouseEvent)}
          title={copied ? 'Copied!' : 'Copy UTxO reference'}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </span>
      )}
    </span>
  );
}

