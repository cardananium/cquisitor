// Where share links point. The codec (@cardananium/cquisitor-lib) takes the
// origin and path as an argument; only this page knows its own location.

import type { BuildLinkOpts } from "@cardananium/cquisitor-lib";

/** This page's origin + path (relative links when there is no window). */
export function getBuildLinkOpts(): BuildLinkOpts {
  if (typeof window === "undefined") return { origin: "", basePath: "" };
  const path = window.location.pathname.replace(/\/+$/, "");
  return {
    origin: window.location.origin,
    basePath: path,
  };
}
