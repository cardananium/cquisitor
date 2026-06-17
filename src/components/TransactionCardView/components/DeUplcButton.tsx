"use client";

import React from "react";
import { ExternalLinkIcon } from "@/components/Icons";
import { openExternalUrl } from "@/utils/externalApps";
import type { DeUplcResolved } from "@/utils/deUplcLink";

// Temporarily hide the de-uplc / step-debugger buttons across the UI. Flip to
// `true` to bring them back (all render sites are guarded by this flag; the
// underlying components and link-building code are left intact).
export const DEUPLC_ENABLED = false;

/**
 * "Open in de-uplc-web" button for a redeemer/script card. Renders nothing when `link` is
 * undefined/null (not validated yet); a disabled button with a tooltip when the link can't be
 * built or is ambiguous; and an enabled button that opens the step-debugger otherwise.
 */
export function DeUplcButton({
  link,
  label = "Step-debug",
}: {
  link: DeUplcResolved | "ambiguous" | null | undefined;
  label?: string;
}) {
  if (!link) return null; // not validated yet → no button
  if (link === "ambiguous") {
    return (
      <button
        type="button"
        className="external-link-btn tcv-deuplc-btn"
        disabled
        title="This script validates multiple redeemers — use the Step-debug button on a Redeemer card."
      >
        <ExternalLinkIcon size={12} />
        <span>{label}</span>
      </button>
    );
  }
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
      : "Step-debug this script + context in de-uplc-web";
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

/** Bytecode-only ("Open bytecode") button — opens the raw program in de-uplc-web (no context). */
export function DeUplcProgramButton({
  url,
  label = "Open bytecode",
}: {
  url: string | null | undefined;
  label?: string;
}) {
  if (!url) return null;
  return (
    <button
      type="button"
      className="external-link-btn tcv-deuplc-btn"
      title="Open this script's bytecode in de-uplc-web"
      onClick={(e) => {
        e.stopPropagation();
        openExternalUrl(url);
      }}
    >
      <ExternalLinkIcon size={12} />
      <span>{label}</span>
    </button>
  );
}
