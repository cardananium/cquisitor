// Deployed SundaeSwap V4 script hashes, resolved by validator title.
//
// V4 is modular: an order does not say what kind of order it is. It carries a
// list of constraints keyed by the SCRIPT HASH of the withdraw validator that
// enforces each one, and a pool's action map points at module hashes. So every
// V4 datum is only readable against the deployment it belongs to — a hash is
// the name of a behaviour.
//
// The authoritative source is the `protocols` query on the environment-specific
// GraphQL API. Detection runs synchronously inside the render path, so this
// module keeps a static snapshot (`v4Hashes.generated.ts`) for the synchronous
// answer and refreshes from the API in the background. After a redeploy the
// snapshot misses, the refresh lands, and subsequent renders resolve.

import type { CardanoNetwork } from "@cardananium/cquisitor-lib";
import { V4_HASHES } from "./v4Hashes.generated";

/** Validator title (the API's own, e.g. "order.spend") → 28-byte hash, lowercased hex. */
export type V4ValidatorTable = Record<string, string>;

export type V4Network = "mainnet" | "preview" | "preprod";

const NETWORKS: V4Network[] = ["mainnet", "preview", "preprod"];

function endpointFor(network: V4Network): string {
  return network === "mainnet"
    ? "https://api.sundae.fi/graphql"
    : `https://api.${network}.sundae.fi/graphql`;
}

// `environment` and `settings` are V4-era additions; older protocol versions
// report them empty. We ask for the pieces we can use and tolerate absence.
const PROTOCOLS_QUERY = `
  query Protocols {
    protocols {
      version
      environment
      blueprint { validators { title hash } }
      references { key txIn { hash index } }
      settings { datum }
    }
  }
`;

/** A reference input the deployment publishes for a validator's script. */
export interface V4Reference {
  /** Validator title the reference script carries. */
  key: string;
  txHash: string;
  index: number;
}

export interface V4Deployment {
  network: V4Network;
  /** title → hash */
  byTitle: V4ValidatorTable;
  /** hash → title. A hash may back several titles (one script, several endpoints). */
  byHash: Map<string, string[]>;
  references: V4Reference[];
  /**
   * Raw settings-node datums (hex CBOR) the API reports for this deployment.
   * Parsed lazily by `v4Settings.ts` — this layer stays transport-only.
   */
  settingsDatums: string[];
  /** True when this came from the API rather than the bundled snapshot. */
  live: boolean;
}

function indexByHash(byTitle: V4ValidatorTable): Map<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const [title, hash] of Object.entries(byTitle)) {
    const key = hash.toLowerCase();
    const titles = byHash.get(key);
    if (titles) titles.push(title);
    else byHash.set(key, [title]);
  }
  // Stable order so a multi-title hash renders the same way every time.
  for (const titles of byHash.values()) titles.sort();
  return byHash;
}

function snapshotDeployment(network: V4Network): V4Deployment {
  const byTitle = V4_HASHES[network];
  return {
    network,
    byTitle,
    byHash: indexByHash(byTitle),
    references: [],
    settingsDatums: [],
    live: false,
  };
}

const deployments = new Map<V4Network, V4Deployment>(
  NETWORKS.map((n) => [n, snapshotDeployment(n)]),
);

const inflight = new Map<V4Network, Promise<V4Deployment>>();
/** Networks whose refresh failed, so we stop retrying on every render. */
const failed = new Set<V4Network>();

interface RawProtocol {
  version: string;
  environment: string | null;
  blueprint: { validators: Array<{ title: string; hash: string }> | null } | null;
  references: Array<{ key: string; txIn: { hash: string; index: number } }> | null;
  settings: Array<{ datum: string | null }> | null;
}

async function fetchDeployment(network: V4Network): Promise<V4Deployment> {
  const res = await fetch(endpointFor(network), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: PROTOCOLS_QUERY }),
  });
  if (!res.ok) throw new Error(`sundae protocols: ${res.status}`);
  const json = (await res.json()) as {
    data?: { protocols?: RawProtocol[] | null };
    errors?: Array<{ message: string }>;
  };
  if (json.errors && json.errors.length > 0) throw new Error(json.errors[0].message);
  const v4 = (json.data?.protocols ?? []).find((p) => p.version === "V4");
  if (!v4) throw new Error(`no V4 protocol reported for ${network}`);

  const byTitle: V4ValidatorTable = {};
  for (const v of v4.blueprint?.validators ?? []) {
    if (v.title && v.hash) byTitle[v.title] = v.hash.toLowerCase();
  }
  if (Object.keys(byTitle).length === 0) {
    throw new Error(`V4 blueprint for ${network} carries no validators`);
  }

  return {
    network,
    byTitle,
    byHash: indexByHash(byTitle),
    references: (v4.references ?? []).map((r) => ({
      key: r.key,
      txHash: r.txIn.hash,
      index: r.txIn.index,
    })),
    settingsDatums: (v4.settings ?? [])
      .map((s) => s.datum)
      .filter((d): d is string => typeof d === "string" && d.length > 0),
    live: true,
  };
}

/**
 * Kick off a background refresh for `network`. Returns immediately; callers
 * read the result through `getV4Deployment` on a later render.
 */
export function refreshV4Deployment(network: V4Network): Promise<V4Deployment> {
  const existing = inflight.get(network);
  if (existing) return existing;
  const promise = fetchDeployment(network)
    .then((d) => {
      deployments.set(network, d);
      failed.delete(network);
      return d;
    })
    .catch((err) => {
      // Keep the snapshot in place and stop retrying this network; the bundled
      // table is still a usable answer.
      failed.add(network);
      throw err;
    })
    .finally(() => {
      inflight.delete(network);
    });
  inflight.set(network, promise);
  return promise;
}

/**
 * The deployment for `network`, from the snapshot until a refresh lands. Starts
 * a refresh on first use; never throws and never blocks.
 */
export function getV4Deployment(network: V4Network): V4Deployment {
  const current = deployments.get(network)!;
  if (!current.live && !failed.has(network) && !inflight.has(network)) {
    // Fire and forget — the snapshot answers this render.
    void refreshV4Deployment(network).catch(() => {});
  }
  return current;
}

/** Networks to search when the caller's network is unknown. */
function candidateNetworks(network: CardanoNetwork | undefined): V4Network[] {
  if (network === "mainnet" || network === "preview" || network === "preprod") {
    return [network];
  }
  return NETWORKS;
}

export interface V4ScriptMatch {
  network: V4Network;
  /** Every validator title this hash backs, e.g. ["pool.mint", "pool.spend"]. */
  titles: string[];
  /** The title we treat as primary for labelling. */
  title: string;
  hash: string;
}

/**
 * Resolve a 28-byte script hash against the V4 deployments. Searches the given
 * network, or all three when the network is unknown.
 */
export function lookupV4Script(
  hash: string,
  network: CardanoNetwork | undefined,
): V4ScriptMatch | null {
  const key = hash.toLowerCase();
  for (const net of candidateNetworks(network)) {
    const deployment = getV4Deployment(net);
    const titles = deployment.byHash.get(key);
    if (titles && titles.length > 0) {
      return { network: net, titles, title: primaryTitle(titles), hash: key };
    }
  }
  return null;
}

// A hash can back several endpoints of one validator (pool.spend and pool.mint
// are often the same script). Prefer the spend endpoint for labelling, since
// that is the one a UTxO sits at.
function primaryTitle(titles: string[]): string {
  return (
    titles.find((t) => t.endsWith(".spend")) ??
    titles.find((t) => t.endsWith(".withdraw")) ??
    titles[0]
  );
}

/** Hash for a validator title in the given network's deployment, if deployed. */
export function v4HashFor(
  title: string,
  network: CardanoNetwork | undefined,
): string | null {
  for (const net of candidateNetworks(network)) {
    const hash = getV4Deployment(net).byTitle[title];
    if (hash) return hash.toLowerCase();
  }
  return null;
}

/**
 * The module/constraint name a hash stands for, as a readable label — the
 * validator title with its endpoint suffix and `.supersededN` marker stripped,
 * underscores turned into spaces. "basic_order.withdraw" → "basic order".
 * Returns null when the hash is not part of a known V4 deployment.
 */
export function v4ModuleLabel(
  hash: string,
  network: CardanoNetwork | undefined,
): string | null {
  const match = lookupV4Script(hash, network);
  if (!match) return null;
  return moduleLabelFromTitle(match.title);
}

export function moduleLabelFromTitle(title: string): string {
  return title
    .replace(/\.(spend|withdraw|mint|publish)(\.superseded\d+)?$/, "")
    .replace(/_/g, " ");
}

/** True when the title names a retired deployment the API still reports. */
export function isSupersededTitle(title: string): boolean {
  return /\.superseded\d+$/.test(title);
}
