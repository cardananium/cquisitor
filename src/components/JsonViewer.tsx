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
  /**
   * Right-click on a JSON node → fired with the JSONPath-style decoded
   * path (e.g. `$.transaction_body[0]`). Walks up from the click target,
   * collects keys from textea's `data-key-pair`/`data-key-key` attributes.
   */
  onPinPath?: (decodedPath: string) => void;
}

// `decode_cbor_against_cddl` switches map output to this shape when JSON
// objects can't represent the data losslessly: duplicate cbor keys (RFC
// 8949 §5.6) or complex (Array / Map / Tag) keys. Each entry carries a
// `match` field describing how the schema accepted that key.
interface EntriesMapMatch {
  via: "literal" | "type" | "unmatched";
  label: string | null;
}
interface EntriesMapEntry {
  key: unknown;
  value: unknown;
  match?: EntriesMapMatch;
}
interface EntriesMap {
  "@entries": EntriesMapEntry[];
}

function isEntriesMap(v: unknown): v is EntriesMap {
  return !!v && typeof v === "object" && !Array.isArray(v)
    && Array.isArray((v as Record<string, unknown>)["@entries"]);
}

function compactJson(v: unknown, max = 80): string {
  let s: string;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (typeof s !== "string") s = String(s);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const entriesMapType = defineDataType<EntriesMap>({
  is: (v): v is EntriesMap => isEntriesMap(v),
  Component: ({ value }) => {
    const entries = value["@entries"];
    return (
      <div className="cq-entries-map">
        <div className="cq-entries-summary">
          <span className="cq-entries-count">{entries.length}</span>
          {entries.length === 1 ? " wire-order entry" : " wire-order entries"}
        </div>
        <table className="cq-entries-table">
          <tbody>
            {entries.map((e, i) => {
              const via = e.match?.via;
              const fullKey = JSON.stringify(e.key);
              const fullValue = JSON.stringify(e.value);
              return (
                <tr key={i} className="cq-entries-row">
                  <td className="cq-entries-index">[{i}]</td>
                  <td className="cq-entries-key" title={fullKey}>{compactJson(e.key)}</td>
                  <td className="cq-entries-arrow">→</td>
                  <td className="cq-entries-value" title={fullValue}>{compactJson(e.value)}</td>
                  {via && (
                    <td>
                      <span className={`cq-entries-via cq-entries-via-${via}`}>
                        {via}{e.match?.label ? `: ${e.match.label}` : ""}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  },
});


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

/**
 * Walks up the DOM from `target` through textea's `[data-testid^=data-key-pair]`
 * ancestors and assembles the JSONPath of the clicked node. Returns null
 * when the click landed outside any key-value pair (e.g. on the root
 * brace, on whitespace).
 */
function pathFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const keys: string[] = [];
  let el: Element | null = target.closest('[data-testid^="data-key-pair"]');
  while (el) {
    const keyEl = el.querySelector(":scope > .data-key > .data-key-key");
    const key = keyEl?.textContent ?? "";
    // Empty `.data-key-key` belongs to the root pair — skip it.
    if (key) keys.unshift(key);
    el = el.parentElement?.closest('[data-testid^="data-key-pair"]') ?? null;
  }
  if (keys.length === 0) return null;
  return "$" + keys.map(k => {
    if (/^[a-zA-Z_][\w-]*$/.test(k)) return "." + k;
    if (/^\d+$/.test(k)) return `["${k}"]`;
    return `["${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  }).join("");
}

export default function JsonViewer({
  data,
  expanded = 3,
  network,
  onPinPath,
}: JsonViewerProps) {
  const preparedData = prepareData(data);
  
  // Create custom data types for CardanoScan links + the wire-order
  // map shape produced by `decode_cbor_against_cddl` when keys are
  // duplicates or complex.
  const valueTypes = useMemo(() => {
    // `defineDataType<T>` is invariant in T; cast to the unknown-typed slot
    // so it sits next to the generic CardanoScan types in the same array.
    const types: ReturnType<typeof defineDataType>[] = [
      entriesMapType as unknown as ReturnType<typeof defineDataType>,
    ];

    if (network) {
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
              fontFamily: "monospace",
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
              fontFamily: "monospace",
            }}
            onClick={(e) => e.stopPropagation()}
            title={`Open in CardanoScan (${network})`}
          >
            &quot;{String(value)}&quot;
          </a>
        ),
      });

      types.push(transactionIdType, addressType);
    }

    return types;
  }, [network]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onPinPath) return;
    const path = pathFromTarget(e.target);
    if (!path) return;
    e.preventDefault();
    onPinPath(path);
  };

  return (
    <div className="json-viewer-wrapper" onContextMenu={handleContextMenu}>
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
