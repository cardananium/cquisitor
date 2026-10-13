// Links that name a transaction by its hash instead of carrying its CBOR.
//
// Two spellings open the Transaction Validator on an on-chain transaction:
//
//   <origin><basePath>/#transaction-validator?tx=<hash>&net=<network>
//   <origin><basePath>/tx/<hash>?net=<network>
//
// The hash form is what the app reads. The path form is the short one people share; the site is
// a static export, so `/tx/<hash>` is served by the not-found page, which forwards to the hash
// form. `net` defaults to mainnet in both.

import type { BuildLinkOpts, NetworkType } from "@cardananium/cquisitor-lib";

export const TX_HASH_PARAM = "tx";

const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;
const NETWORKS: readonly NetworkType[] = ["mainnet", "preprod", "preview"];

export interface TxLinkTarget {
  hash: string;
  net: NetworkType;
}

export function isTxHash(value: string): boolean {
  return TX_HASH_RE.test(value);
}

export function parseNetwork(value: string | null | undefined): NetworkType | null {
  return value && (NETWORKS as readonly string[]).includes(value) ? (value as NetworkType) : null;
}

/** The `tx` + `net` parameters of a validator link, or null when there is no valid `tx`. */
export function readTxLinkParams(params: URLSearchParams): TxLinkTarget | null {
  const hash = params.get(TX_HASH_PARAM)?.trim() ?? "";
  if (!isTxHash(hash)) return null;
  return { hash: hash.toLowerCase(), net: parseNetwork(params.get("net")) ?? "mainnet" };
}

/**
 * Reads a `/tx/<hash>` path (optionally under a base path, e.g. `/cquisitor/tx/<hash>`).
 * Returns the base path in front of `/tx/` so the forward can stay on the same deployment.
 */
export function parseTxPath(
  pathname: string,
  search: string,
): (TxLinkTarget & { basePath: string }) | null {
  const m = /^(.*?)\/tx\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  const hash = decodeURIComponent(m[2]).trim();
  if (!isTxHash(hash)) return null;
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  return {
    basePath: m[1].replace(/\/+$/, ""),
    hash: hash.toLowerCase(),
    net: parseNetwork(params.get("net")) ?? "mainnet",
  };
}

/** The hash-routed form of a tx link, relative to `basePath`. */
export function txLinkHash({ hash, net }: TxLinkTarget): string {
  const params = new URLSearchParams({ [TX_HASH_PARAM]: hash });
  if (net !== "mainnet") params.set("net", net);
  return `#transaction-validator?${params.toString()}`;
}

/** The short `/tx/<hash>` form, for sharing. */
export function buildTxLink(opts: BuildLinkOpts, target: TxLinkTarget): string {
  const base = `${opts.origin}${opts.basePath.replace(/\/+$/, "")}`;
  const query = target.net === "mainnet" ? "" : `?net=${target.net}`;
  return `${base}/tx/${target.hash}${query}`;
}
