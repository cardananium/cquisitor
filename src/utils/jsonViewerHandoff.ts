/**
 * Hand-off for opening a JSON document in the standalone `/json-viewer`
 * page in a new browser tab.
 *
 * The payload travels in the URL hash — the same approach the Cardano CBOR
 * / Transaction Validator links use for their CBOR. Keeping it in the URL
 * (rather than `localStorage`) makes the viewer tab self-contained: it
 * survives a refresh and can be copied or shared. The hash is used (not a
 * query string) so the — potentially large — JSON never reaches the server
 * or referrer headers.
 */

export interface JsonViewerPayload {
  /** Heading shown above the tree, e.g. "Script Context". */
  title: string;
  /** Raw JSON string; the viewer parses it. */
  json: string;
}

/** Absolute URL of the JSON viewer page carrying the payload in its hash. */
export function buildJsonViewerUrl(payload: JsonViewerPayload): string {
  const params = new URLSearchParams();
  params.set("title", payload.title);
  params.set("json", payload.json);
  const base =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname.replace(/\/+$/, "")}`;
  return `${base}/json-viewer#${params.toString()}`;
}

/** Reads the payload back out of the current page's URL hash. */
export function readJsonViewerPayload(): JsonViewerPayload | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  try {
    const params = new URLSearchParams(hash);
    const json = params.get("json");
    if (json === null) return null;
    return { title: params.get("title") || "JSON", json };
  } catch {
    return null;
  }
}
