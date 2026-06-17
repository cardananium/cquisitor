// Generic DEX/dApp adapter registry.
//
// Each protocol decoder is one self-registering module that calls
// `registerDexAdapter({ ... })`. The transaction card view then iterates the
// registered adapters instead of hard-coding any single protocol. An adapter
// matches a UTxO by its 28-byte PAYMENT script hash and/or by a pool/order/
// validity NFT policy id, and turns a parsed datum into a normalized
// `DexOrderView` the generic panel can render.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { PD } from "./plutusData";

// "order"/"pool" for DEXs; protocols of other shapes use their own role label
// ("vault", "position", "loan", "feed", "listing", …). The string-union trick
// keeps autocomplete for the common values while allowing any string.
export type DexRole = "order" | "pool" | (string & {});

export interface DexIssue {
  severity: "error" | "warning" | "info";
  message: string;
}

export interface DexRow {
  label: string;
  /** Plain text value. Omit when using `asset` instead. */
  value?: string;
  /** Render the value in a monospace font (hashes, hex, policy ids). */
  mono?: boolean;
  /**
   * The value is a full hash / hex / address string. The panel renders it with
   * the shared HashWithTooltip (CSS truncation + hover tooltip + copy), so
   * adapters should pass the FULL value here, never a pre-shortened one.
   */
  hash?: boolean;
  /**
   * An on-chain asset. The panel renders it like the asset table — decoded
   * (human-readable) asset name with the full policy id on hover + copy —
   * instead of a raw `policyId.name` string. ada = ("", "").
   */
  asset?: { policyId: string; assetName: string; amount?: bigint };
}

export interface DexAssetRow {
  label: string;
  policyId: string;
  assetName: string;
  /** Raw on-chain amount, when the datum carries one. */
  amount?: bigint;
}

/** Normalized, protocol-agnostic view a panel can render for any decoded UTxO. */
export interface DexOrderView {
  /** Protocol + version label, e.g. "Minswap V2". */
  protocol: string;
  role: DexRole;
  /** Human action label, e.g. "Swap (exact in)", "Deposit", "Withdraw". */
  kind: string;
  rows: DexRow[];
  assets?: DexAssetRow[];
  issues: DexIssue[];
}

export interface DexAdapter {
  /** Stable id, e.g. "minswap-v2". */
  id: string;
  /** Display label, e.g. "Minswap V2". */
  label: string;
  /** Match a 28-byte payment script hash (lowercased hex) → role, or null.
   * Optional: some protocols (parameterized validators) match only by NFT. */
  matchScriptHash?(hash: string, network?: CardanoNetwork): DexRole | null;
  /**
   * Optional match by a native asset the output holds: the policy id plus the
   * (lowercased hex) asset names minted under it in this output. Needed for
   * protocols that identify pools by a validity NFT (policy + a specific asset
   * name), where matching the policy alone would false-positive on LP tokens.
   */
  matchNftPolicy?(policyId: string, assetNames: string[], network?: CardanoNetwork): DexRole | null;
  /** Decode a datum for the matched role into the normalized view. May throw. */
  decode?(datum: PD, role: DexRole): DexOrderView;
  /** Classify a spend redeemer for the matched role (e.g. "Apply", "Cancel"). */
  classifyRedeemer?(redeemer: PD, role: DexRole): string | null;
}

const adapters: DexAdapter[] = [];

export function registerDexAdapter(adapter: DexAdapter): void {
  if (adapters.some((a) => a.id === adapter.id)) return; // idempotent on HMR
  adapters.push(adapter);
}

export function listDexAdapters(): readonly DexAdapter[] {
  return adapters;
}

export function getDexAdapter(id: string): DexAdapter | undefined {
  return adapters.find((a) => a.id === id);
}

/** Human-friendly label for a role tag ("order" → "Order", "v1-pool" → "V1 Pool"). */
export function formatDexRole(role: DexRole): string {
  if (!role) return "";
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
