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

export function openExternalUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}
