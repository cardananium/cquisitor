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

const CARDANOSCAN_HOSTS: Record<NetworkType, string> = {
  mainnet: "https://cardanoscan.io",
  preview: "https://preview.cardanoscan.io",
  preprod: "https://preprod.cardanoscan.io",
};

export function buildExplorerTxUrl(txHash: string, network: NetworkType): string {
  return `${CARDANOSCAN_HOSTS[network]}/transaction/${txHash}`;
}

export function openExternalUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Opens a URL that is only known asynchronously (e.g. after compression). The tab is opened
 * synchronously inside the click handler so it still counts as a user gesture, then navigated
 * once the URL resolves; opening it after the await is blocked as a popup.
 */
export function openExternalUrlDeferred(build: () => Promise<string>): void {
  if (typeof window === "undefined") return;
  // `noopener` would make window.open return null, so drop the reference by hand instead.
  const tab = window.open("about:blank", "_blank");
  if (tab) {
    try {
      tab.opener = null;
    } catch {
      /* cross-origin about:blank in some browsers */
    }
  }
  void build().then(
    (url) => {
      if (tab && !tab.closed) tab.location.replace(url);
      else openExternalUrl(url);
    },
    (err) => {
      tab?.close();
      console.error("Failed to build external link", err);
    },
  );
}
