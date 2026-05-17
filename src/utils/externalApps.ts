import type { NetworkType } from "@cardananium/cquisitor-lib";

const TX_STUDIO_BASE_URL = "https://www.transaction.studio";

export function buildTxStudioUrl(cborHex: string, network: NetworkType): string {
  const params = new URLSearchParams();
  params.set("cbor", cborHex);
  params.set("net", network);
  return `${TX_STUDIO_BASE_URL}/?${params.toString()}`;
}

export function buildValidatorUrl(cborHex: string, network: NetworkType): string {
  const params = new URLSearchParams();
  params.set("cbor", cborHex);
  params.set("net", network);
  if (typeof window === "undefined") {
    return `/#transaction-validator?${params.toString()}`;
  }
  const path = window.location.pathname.replace(/\/+$/, "");
  return `${window.location.origin}${path}/#transaction-validator?${params.toString()}`;
}

/**
 * Builds a link that opens the Cardano CBOR decoder tab pre-loaded with the
 * given CBOR hex. `type` (e.g. "PlutusData") pre-selects the decoded structure
 * so the type-selection modal is skipped when detection allows it.
 */
export function buildCardanoCborUrl(cborHex: string, type?: string): string {
  const params = new URLSearchParams();
  params.set("cbor", cborHex);
  if (type) params.set("type", type);
  if (typeof window === "undefined") {
    return `/#cardano-cbor?${params.toString()}`;
  }
  const path = window.location.pathname.replace(/\/+$/, "");
  return `${window.location.origin}${path}/#cardano-cbor?${params.toString()}`;
}

export function openExternalUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}
