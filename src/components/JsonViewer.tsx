"use client";

import { JsonViewer as TexteaJsonViewer, defineDataType } from "@textea/json-viewer";
import { useMemo } from "react";
import { bech32 } from "bech32";
import { blake2b } from "@noble/hashes/blake2.js";
import { getTransactionLink, getAddressLink, type CardanoNetwork } from "@/utils/cardanoscanLinks";

// Decode bech32 vkey and compute blake2b-224 hash
function computeVkeyHash(vkeyBech32: string): string | null {
  try {
    // Decode bech32 - vkey starts with "ed25519_pk"
    const decoded = bech32.decode(vkeyBech32, 100);
    // Convert from 5-bit words to 8-bit bytes
    const publicKeyBytes = bech32.fromWords(decoded.words);
    // Hash with blake2b-224 (28 bytes = 224 bits)
    const hash = blake2b(new Uint8Array(publicKeyBytes), { dkLen: 28 });
    // Convert to hex
    return Array.from(hash as Uint8Array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

interface JsonViewerProps {
  data: unknown;
  expanded?: number | boolean;
  network?: CardanoNetwork;
}


// Recursively convert BigInt and Uint8Array to serializable types
// Also enriches vkeys in witness_set with vkey_hash
function prepareData(data: unknown, parentKey?: string): unknown {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data === "bigint") {
    return data.toString();
  }
  if (data instanceof Uint8Array) {
    return Array.from(data);
  }
  if (Array.isArray(data)) {
    return data.map((item) => prepareData(item, parentKey));
  }
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(data);
    
    for (const [key, value] of entries) {
      result[key] = prepareData(value, key);
      
      // If this is a vkey field with bech32 format (ed25519_pk prefix), add vkey_hash
      if (key === "vkey" && typeof value === "string" && value.startsWith("ed25519_pk")) {
        const vkeyHash = computeVkeyHash(value);
        if (vkeyHash) {
          result["vkey_hash"] = vkeyHash;
        }
      }
    }
    return result;
  }
  return data;
}

export default function JsonViewer({ 
  data, 
  expanded = 3,
  network
}: JsonViewerProps) {
  const preparedData = prepareData(data);
  
  // Create custom data types for CardanoScan links
  const valueTypes = useMemo(() => {
    if (!network) return [];
    
    // Custom type for transaction_id (64 hex characters with key "transaction_id")
    const transactionIdType = defineDataType({
      is: (value, path) => {
        if (typeof value !== "string") return false;
        const key = path[path.length - 1];
        return key === "transaction_id" && /^[a-f0-9]{64}$/i.test(value);
      },
      Component: ({ value }) => (
        <a
          href={getTransactionLink(network, String(value))}
          target="_blank"
          rel="noopener noreferrer"
          style={{ 
            color: "#0969da", 
            textDecoration: "underline",
            fontFamily: "monospace"
          }}
          onClick={(e) => e.stopPropagation()}
          title={`Open in CardanoScan (${network})`}
        >
          &quot;{String(value)}&quot;
        </a>
      ),
    });
    
    // Custom type for address (starts with "addr")
    const addressType = defineDataType({
      is: (value, path) => {
        if (typeof value !== "string") return false;
        const key = path[path.length - 1];
        return key === "address" && value.startsWith("addr");
      },
      Component: ({ value }) => (
        <a
          href={getAddressLink(network, String(value))}
          target="_blank"
          rel="noopener noreferrer"
          style={{ 
            color: "#0969da", 
            textDecoration: "underline",
            fontFamily: "monospace"
          }}
          onClick={(e) => e.stopPropagation()}
          title={`Open in CardanoScan (${network})`}
        >
          &quot;{String(value)}&quot;
        </a>
      ),
    });
    
    return [transactionIdType, addressType];
  }, [network]);

  return (
    <div className="json-viewer-wrapper">
      <TexteaJsonViewer
        value={preparedData}
        defaultInspectDepth={expanded === true ? Infinity : (expanded as number)}
        valueTypes={valueTypes}
        rootName={false}
        displaySize={false}
        displayDataTypes={false}
        quotesOnKeys={false}
        enableClipboard
        theme="light"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "13px",
          backgroundColor: "transparent",
        }}
      />
    </div>
  );
}
