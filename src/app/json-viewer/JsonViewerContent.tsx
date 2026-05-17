"use client";

import { useEffect, useMemo, useState } from "react";
import JsonDocumentView from "./JsonDocumentView";
import { CheckIcon, CopyIcon } from "@/components/Icons";
import { readJsonViewerPayload } from "@/utils/jsonViewerHandoff";

/**
 * The `#json-viewer` view: a focused, full-page JSON viewer opened in a
 * separate browser tab from the Transaction Validator (Script Context →
 * JSON). The document to show is carried in the URL hash; see
 * `jsonViewerHandoff`. Rendered only on the client (inside the ssr:false SPA
 * shell), so the hash payload can be read directly on mount.
 */
export default function JsonViewerContent() {
  const [payload] = useState(() => readJsonViewerPayload());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (payload?.title) document.title = `${payload.title} — JSON — CQuisitor`;
  }, [payload]);

  const parsed = useMemo<{ data: unknown; error: string | null }>(() => {
    if (!payload) return { data: null, error: null };
    try {
      return { data: JSON.parse(payload.json) as unknown, error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [payload]);

  const byteCount = useMemo(
    () => (payload ? new TextEncoder().encode(payload.json).length : 0),
    [payload]
  );

  const handleCopy = () => {
    if (!payload) return;
    // Pretty-print when possible so the clipboard copy is readable.
    let text = payload.json;
    try {
      text = JSON.stringify(JSON.parse(payload.json), null, 2);
    } catch {
      /* fall back to the raw string */
    }
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!payload) {
    return (
      <div className="json-viewer-page json-viewer-page-centered">
        <div className="json-viewer-page-empty">
          <h1>Nothing to display</h1>
          <p>
            This page shows JSON opened from another CQuisitor tab. Open it via
            the &ldquo;open in new tab&rdquo; action next to a JSON document.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="json-viewer-page">
      <header className="json-viewer-page-header">
        <span className="json-viewer-page-title">{payload.title}</span>
        <span className="json-viewer-page-size">
          ({byteCount.toLocaleString()} bytes)
        </span>
        <button
          type="button"
          className={`json-viewer-page-copy ${copied ? "copied" : ""}`}
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy JSON"}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          <span>{copied ? "Copied" : "Copy JSON"}</span>
        </button>
      </header>
      {parsed.error ? (
        <main className="json-viewer-page-body">
          <div className="json-viewer-page-error">
            Failed to parse JSON: {parsed.error}
          </div>
        </main>
      ) : (
        <JsonDocumentView data={parsed.data} />
      )}
    </div>
  );
}
