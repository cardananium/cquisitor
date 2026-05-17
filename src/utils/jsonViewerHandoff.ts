/**
 * Hand-off for opening a JSON document in the JSON viewer in a new browser
 * tab.
 *
 * The viewer lives at the `#json-viewer` hash route of the SPA (consistent
 * with `#cardano-cbor` etc.), and the payload travels in the hash query —
 * the same approach the other links use for their CBOR. Keeping it in the
 * URL makes the viewer tab self-contained: it survives a refresh and can be
 * copied or shared, and the — potentially large — JSON never reaches the
 * server or referrer headers.
 */

const TAB = "json-viewer";

export interface JsonViewerPayload {
  /** Heading shown above the tree, e.g. "Script Context". */
  title: string;
  /** Raw JSON string; the viewer parses it. */
  json: string;
}

/** Absolute URL of the JSON viewer carrying the payload in its hash. */
export function buildJsonViewerUrl(payload: JsonViewerPayload): string {
  const params = new URLSearchParams();
  params.set("title", payload.title);
  params.set("json", payload.json);
  const base =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname.replace(/\/+$/, "")}`;
  return `${base}/#${TAB}?${params.toString()}`;
}

/** Reads the payload back out of the current page's URL hash. */
export function readJsonViewerPayload(): JsonViewerPayload | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  const qIdx = hash.indexOf("?");
  if (qIdx < 0 || hash.slice(0, qIdx) !== TAB) return null;
  try {
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    const json = params.get("json");
    if (json === null) return null;
    return { title: params.get("title") || "JSON", json };
  } catch {
    return null;
  }
}
