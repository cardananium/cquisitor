// Links opened in a tab that already shows the app.
//
// The tabs read a share link once, when they mount. Opening another link in the same browser tab
// changes only the hash, which the browser handles without loading the page again, so the new
// link would never be read. The app itself only ever writes bare `#tab` hashes, so a hash that
// carries parameters always comes from outside: a pasted or followed link, or history traversal
// to one.

/** `hash` when it carries link parameters (`#tab?…`), else null. */
export function linkHashOf(hash: string): string | null {
  const query = hash.indexOf("?");
  if (query < 0) return null;
  return new URLSearchParams(hash.slice(query + 1)).toString() === "" ? null : hash;
}

/**
 * Whether moving to `nextHash` opens a link other than `appliedHash`, the link the page was
 * loaded with (null when it was loaded without one). Returning to the applied link — e.g. Back
 * after switching tabs — is not a new link.
 */
export function opensNewLink(appliedHash: string | null, nextHash: string): boolean {
  const next = linkHashOf(nextHash);
  return next !== null && next !== appliedHash;
}
