"use client";

import React from "react";
import { ExternalLinkIcon } from "@/components/Icons";
import { openExternalUrl, openExternalUrlDeferred } from "@/utils/externalApps";
import {
  fieldsFromDecompile,
  fieldsToDecompileUrl,
  type DeUplcResolved,
} from "@/utils/deUplcLink";

// Toggle the de-uplc / step-debugger buttons across the UI. Now that de-uplc-web
// is deployed (https://cardananium.github.io/de-uplc-web/), the buttons are on.
// All render sites are guarded by this flag.
export const DEUPLC_ENABLED = true;

/**
 * "Open in de-uplc-web" button for a redeemer / eval-result card. Renders nothing when `link` is
 * undefined/null (not validated yet); a disabled button with a tooltip when the link can't be built;
 * and an enabled button that opens the step-debugger otherwise.
 */
export function DeUplcButton({
  link,
  label = "Debug in de-uplc",
}: {
  link: DeUplcResolved | null | undefined;
  label?: string;
}) {
  if (!link) return null; // not validated yet → no button
  if (!link.ok) {
    return (
      <button type="button" className="external-link-btn tcv-deuplc-btn" disabled title={link.reason}>
        <ExternalLinkIcon size={12} />
        <span>{label}</span>
      </button>
    );
  }
  const title =
    link.fidelity === "program-only"
      ? "Open the script bytecode in de-uplc-web (no context — evaluation produced none)"
      : "Debug this script + context in de-uplc-web";
  return (
    <button
      type="button"
      className="external-link-btn tcv-deuplc-btn"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        openExternalUrl(link.url);
      }}
    >
      <ExternalLinkIcon size={12} />
      <span>{label}</span>
    </button>
  );
}

/** Decompiler tab — not the debugger (`#decompile=` / `#d=`+`view`, never `#script=`). */
export function DecompileButton({
  hex,
  version,
  purpose,
}: {
  hex: string | null | undefined;
  version?: string | null;
  purpose?: string | null;
}) {
  const fields = fieldsFromDecompile({ hex, version, purpose });
  if (!fields) {
    return (
      <button
        type="button"
        className="external-link-btn tcv-deuplc-btn"
        disabled
        title="Compiled script hex is not available"
      >
        <ExternalLinkIcon size={12} />
        <span>Decompile</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="external-link-btn tcv-deuplc-btn"
      title="Decompile this script in de-uplc-web"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternalUrlDeferred(() => fieldsToDecompileUrl(fields));
      }}
    >
      <ExternalLinkIcon size={12} />
      <span>Decompile</span>
    </button>
  );
}
