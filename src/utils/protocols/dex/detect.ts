// Generic output detection across all registered DEX adapters.
//
// Runs only when an output's address has a script payment credential (or carries
// an NFT whose policy a protocol claims). The first adapter that matches wins —
// adapters claim disjoint script hashes / NFT policies, so order is irrelevant.

import type { TransactionOutput, CardanoNetwork } from "@/components/TransactionCardView/types";
import { getPaymentScriptHash } from "./address";
import { resolveOutputDatum } from "./datum";
import { listDexAdapters, type DexAdapter, type DexRole, type DexOrderView } from "./registry";
import type { PD } from "./plutusData";

export interface DexDetection {
  adapterId: string;
  /** Protocol display label, e.g. "Minswap V2". */
  label: string;
  role: DexRole;
  /** How the adapter matched: by script hash, or by an NFT policy id. */
  matchedBy: "scriptHash" | "nftPolicy";
  /** Normalized view, when the datum was present and parsed. */
  view?: DexOrderView;
  /** Raw decoded datum tree, when present (for the raw-data disclosure). */
  rawDatum?: PD;
  /** Why we couldn't produce a view, when applicable. */
  parseError?: string;
}

// Lowercased (policyId → [assetName,…]) for every native asset in the value.
function assetsByPolicy(
  multiasset: Record<string, Record<string, string>> | null | undefined,
): Array<[string, string[]]> {
  if (!multiasset) return [];
  return Object.entries(multiasset).map(([pid, names]) => [
    pid.toLowerCase(),
    Object.keys(names).map((n) => n.toLowerCase()),
  ]);
}

function matchAdapter(
  adapter: DexAdapter,
  scriptHash: string | null,
  assets: Array<[string, string[]]>,
  network: CardanoNetwork | undefined,
): { role: DexRole; matchedBy: "scriptHash" | "nftPolicy" } | null {
  if (scriptHash && adapter.matchScriptHash) {
    const role = adapter.matchScriptHash(scriptHash, network);
    if (role) return { role, matchedBy: "scriptHash" };
  }
  if (adapter.matchNftPolicy) {
    for (const [pid, names] of assets) {
      const role = adapter.matchNftPolicy(pid, names, network);
      if (role) return { role, matchedBy: "nftPolicy" };
    }
  }
  return null;
}

export function detectDexOutput(
  output: TransactionOutput,
  network: CardanoNetwork | undefined,
  witnessDatums?: Map<string, PD> | null,
): DexDetection | null {
  const scriptHash = getPaymentScriptHash(output.address);
  const assets = assetsByPolicy(output.amount.multiasset);
  if (!scriptHash && assets.length === 0) return null;

  for (const adapter of listDexAdapters()) {
    const matched = matchAdapter(adapter, scriptHash, assets, network);
    if (!matched) continue;

    const detection: DexDetection = {
      adapterId: adapter.id,
      label: adapter.label,
      role: matched.role,
      matchedBy: matched.matchedBy,
    };

    const raw = resolveOutputDatum(output.plutus_data, witnessDatums);
    if (raw) {
      detection.rawDatum = raw;
      try {
        if (adapter.decode) detection.view = adapter.decode(raw, matched.role);
      } catch (e) {
        detection.parseError = e instanceof Error ? e.message : String(e);
      }
    } else if (matched.matchedBy === "nftPolicy") {
      // Matched only because the UTxO holds a protocol token, but it carries no
      // datum — almost certainly a plain token holder (wallet / collateral / fee
      // output), NOT the protocol's datum-bearing order/pool. Don't flag it.
      return null;
    } else if (output.script_ref && !output.plutus_data) {
      // A reference-script provider sitting at a protocol script address (common
      // as a reference input). It carries no order/pool datum, so don't surface
      // it as a missed protocol UTxO — let the normal Script Reference UI show it.
      return null;
    } else if (output.plutus_data && "DataHash" in output.plutus_data) {
      detection.parseError = "Datum referenced by hash with no matching witness-set datum";
    } else {
      detection.parseError = `Output is at a ${adapter.label} ${matched.role} address but has no datum`;
    }
    return detection;
  }
  return null;
}
