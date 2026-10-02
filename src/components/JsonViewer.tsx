"use client";

import { JsonViewer as TexteaJsonViewer, defineDataType } from "@textea/json-viewer";
import { useMemo } from "react";
import { getTransactionLink, getAddressLink, type CardanoNetwork } from "@cardananium/cquisitor-lib";
import { boundedJson } from "@/utils/boundedJson";
import { prepareViewData } from "@/utils/prepareViewData";

interface JsonViewerProps {
  data: unknown;
  expanded?: number | boolean;
  network?: CardanoNetwork;
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

/** One-line JSON of a cell, cut at `max`; depth-safe (see `boundedJson`). */
function compactJson(v: unknown, max = 80): string {
  return boundedJson(v, max);
}

/** Tooltip text of a cell: longer than the cell, still bounded. */
const TITLE_MAX = 2_000;

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
              const fullKey = boundedJson(e.key, TITLE_MAX);
              const fullValue = boundedJson(e.value, TITLE_MAX);
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


export default function JsonViewer({
  data,
  expanded = 3,
  network,
}: JsonViewerProps) {
  const preparedData = useMemo(() => prepareViewData(data), [data]);
  
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
