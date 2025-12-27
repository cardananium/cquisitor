"use client";

import React, { useMemo } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { decode_specific_type } from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import type { DecodedAddress } from "@/utils/addressTypes";
import { CopyIcon, CheckIcon } from "./Icons";

interface AddressWithTooltipProps {
  address: string;
  linkUrl?: string | null;
  showCopy?: boolean;
}

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
      onClick={handleCopy}
      onKeyDown={(e) => e.key === 'Enter' && handleCopy(e as unknown as React.MouseEvent)}
      className={`address-tooltip-copy ${copied ? 'copied' : ''} ${className}`}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </span>
  );
}


function getAddressTypeIcon(type: string): string {
  switch (type) {
    case "Base": return "🏠";
    case "Enterprise": return "🏢";
    case "Reward": return "🏆";
    case "Pointer": return "👆";
    case "Byron": return "🏛️";
    default: return "📍";
  }
}

function getCredentialTypeIcon(type: string): string {
  return type === "ScriptHash" ? "📜" : "🔑";
}

export function AddressWithTooltip({ 
  address, 
  linkUrl, 
  showCopy = true 
}: AddressWithTooltipProps) {
  // Decode address using cquisitor-lib
  const decoded = useMemo((): DecodedAddress | null => {
    if (!address) return null;
    try {
      const result = decode_specific_type(address, "Address", {});
      // Convert serde_json numbers to native JS numbers
      return convertSerdeNumbers(result) as DecodedAddress;
    } catch {
      return null;
    }
  }, [address]);

  const addressContent = linkUrl ? (
    <a 
      href={linkUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="address-link"
    >
      {address}
    </a>
  ) : (
    <span className="address-text">{address}</span>
  );

  if (!decoded) {
    // If decoding failed, just show the address without tooltip
    return (
      <div className="address-with-tooltip-wrapper">
        {addressContent}
        {showCopy && <CopyButton text={address} />}
      </div>
    );
  }

  const { address_type, details } = decoded;

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="address-with-tooltip-wrapper">
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            {addressContent}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content 
              className="address-decoded-tooltip" 
              sideOffset={8} 
              side="top"
              align="start"
            >
              <div className="address-tooltip-header">
                <span className="address-tooltip-icon">{getAddressTypeIcon(address_type)}</span>
                <span className="address-tooltip-type">{address_type} Address</span>
                {details.network_id !== undefined && (
                  <span className={`address-tooltip-network ${details.network_id === 1 ? 'mainnet' : 'testnet'}`}>
                    Network: {details.network_id}
                  </span>
                )}
              </div>

              <div className="address-tooltip-details">
                {/* Payment Credential */}
                {details.payment_cred && (
                  <div className="address-tooltip-row">
                    <span className="address-tooltip-label">
                      {getCredentialTypeIcon(details.payment_cred.type)} Payment ({details.payment_cred.type})
                    </span>
                    <div className="address-tooltip-hash-row">
                      <code className="address-tooltip-hash">
                        {details.payment_cred.credential}
                      </code>
                      <CopyButton text={details.payment_cred.credential} className="address-tooltip-copy-sm" />
                    </div>
                  </div>
                )}

                {/* Staking Credential */}
                {details.staking_cred && (
                  <div className="address-tooltip-row">
                    <span className="address-tooltip-label">
                      {getCredentialTypeIcon(details.staking_cred.type)} Staking ({details.staking_cred.type})
                    </span>
                    <div className="address-tooltip-hash-row">
                      <code className="address-tooltip-hash">
                        {details.staking_cred.credential}
                      </code>
                      <CopyButton text={details.staking_cred.credential} className="address-tooltip-copy-sm" />
                    </div>
                  </div>
                )}

                {/* Stake Pointer (for Pointer addresses) */}
                {details.stake_pointer && (
                  <div className="address-tooltip-row">
                    <span className="address-tooltip-label">👆 Stake Pointer</span>
                    <div className="address-tooltip-pointer">
                      <span>Slot: {String(details.stake_pointer.slot)}</span>
                      <span>Tx: {String(details.stake_pointer.transaction_index)}</span>
                      <span>Cert: {String(details.stake_pointer.cert_index)}</span>
                    </div>
                  </div>
                )}

                {/* Byron specific fields */}
                {address_type === "Byron" && (
                  <>
                    {details.type && (
                      <div className="address-tooltip-row">
                        <span className="address-tooltip-label">Type</span>
                        <span className="address-tooltip-value">{details.type}</span>
                      </div>
                    )}
                    {details.derivation_path && details.derivation_path !== "None" && (
                      <div className="address-tooltip-row">
                        <span className="address-tooltip-label">Derivation Path</span>
                        <span className="address-tooltip-value">{details.derivation_path}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <Tooltip.Arrow className="address-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        {showCopy && <CopyButton text={address} />}
      </div>
    </Tooltip.Provider>
  );
}

export default AddressWithTooltip;

