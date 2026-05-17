"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import JsonDocumentView from "./JsonDocumentView";
import { CheckIcon, CopyIcon } from "@/components/Icons";
import {
  readJsonViewerPayload,
  type JsonViewerPayload,
} from "@/utils/jsonViewerHandoff";

/**
 * The URL hash is unavailable during the static prerender, so the payload
 * is exposed through `useSyncExternalStore`: the server snapshot is the
 * `"loading"` sentinel (a spinner in the prerendered HTML), the client
 * snapshot is the actual payload — read once and cached so the reference
 * stays stable across renders.
 */
type PayloadSnapshot = "loading" | JsonViewerPayload | null;

let cachedSnapshot: PayloadSnapshot | undefined;

function subscribeNoop(): () => void {
  // The payload never changes after the page opens — nothing to subscribe to.
  return () => {};
}

function getClientSnapshot(): PayloadSnapshot {
  if (cachedSnapshot === undefined) {
    cachedSnapshot = readJsonViewerPayload();
  }
  return cachedSnapshot;
}

function getServerSnapshot(): PayloadSnapshot {
  return "loading";
}

/**
 * Standalone, full-page JSON viewer. Opened in a separate browser tab from
 * the Transaction Validator (Script Context → JSON). The document to show is
 * carried in the URL hash; see `jsonViewerHandoff`.
 */
export default function JsonViewerPage() {
  const snapshot = useSyncExternalStore(
    subscribeNoop,
    getClientSnapshot,
    getServerSnapshot
  );
  const payload = snapshot === "loading" ? null : snapshot;
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

  if (snapshot === "loading") {
    return (
      <div className="json-viewer-page json-viewer-page-centered">
        <div className="animate-spin w-8 h-8 border-4 border-[#3182ce] border-t-transparent rounded-full" />
      </div>
    );
  }

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
