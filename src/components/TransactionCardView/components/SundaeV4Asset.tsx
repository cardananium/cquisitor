"use client";

// Asset rendering shared by the V4 panels, banner and graph.
//
// Amounts go through the shared `AssetAmount`, which scales by the token's
// registered decimals and marks whether it did — so a V4 reserve reads the same
// way as the same token in the output table, and an unscaled figure is never
// mistaken for a scaled one.

import React from "react";
import { AssetAmount, AssetNameWithTooltip } from "./AssetNameWithTooltip";
import { formatAda } from "../utils";
import type { V4AssetEntry } from "@/utils/protocols/sundae";

export interface V4Asset {
  policyId: string;
  assetName: string;
}

export function isAdaAsset(asset: V4Asset): boolean {
  return asset.policyId === "" && asset.assetName === "";
}

/**
 * The pool mint policy of the deployment being rendered, so a pool's own
 * tokens can be named.
 *
 * A pool's LP token and NFT are CIP-68 names over the pool's 28-byte
 * identifier. The shared decoder strips a CIP-68 prefix only when what follows
 * is readable text, and an identifier is a hash — so without this they render
 * as 72 hex characters, which is both unreadable and wide enough to wreck a
 * table. Keying on the policy rather than the prefix alone keeps the "LP" label
 * off some other project's CIP-68 token.
 */
export const V4PoolMintContext = React.createContext<string | null>(null);

const CIP68_FUNGIBLE = "0014df10";
const CIP68_NFT = "000de140";

/** "LP 062ed6…7bc0" / "NFT 062ed6…7bc0" for a pool's own tokens, else null. */
function poolTokenLabel(asset: V4Asset, poolMintPolicy: string | null): string | null {
  if (!poolMintPolicy) return null;
  if (asset.policyId.toLowerCase() !== poolMintPolicy.toLowerCase()) return null;
  const prefix = asset.assetName.slice(0, 8).toLowerCase();
  const ident = asset.assetName.slice(8);
  if (ident.length !== 56) return null;
  const short = `${ident.slice(0, 6)}…${ident.slice(-4)}`;
  if (prefix === CIP68_FUNGIBLE) return `LP ${short}`;
  if (prefix === CIP68_NFT) return `NFT ${short}`;
  return null;
}

/** ADA, or a native asset's name with its metadata tooltip. */
export function V4AssetName({
  asset,
  className = "tcv-sundae-asset-symbol",
}: {
  asset: V4Asset;
  className?: string;
}) {
  const poolMintPolicy = React.useContext(V4PoolMintContext);
  if (isAdaAsset(asset)) return <span className={className}>ADA</span>;
  // The tooltip still carries the full name, hex and policy.
  const label = poolTokenLabel(asset, poolMintPolicy) ?? undefined;
  return (
    <AssetNameWithTooltip
      policyId={asset.policyId}
      assetName={asset.assetName}
      className={className}
      label={label}
    />
  );
}

/**
 * An amount with its asset. `signed` prefixes an explicit + or −, for deltas
 * where the direction is the point.
 */
export function V4AssetValue({
  asset,
  amount,
  signed = false,
}: {
  asset: V4Asset;
  amount: bigint;
  signed?: boolean;
}) {
  const negative = amount < BigInt(0);
  const magnitude = negative ? -amount : amount;
  // A zero takes no sign: "+0" reads as a movement that did not happen.
  const sign = negative ? "−" : signed && amount > BigInt(0) ? "+" : "";

  if (isAdaAsset(asset)) {
    return (
      <span className="tcv-sundae-asset">
        <span className="tcv-ada-amount">
          {sign}₳ {formatAda(magnitude.toString())}
        </span>
      </span>
    );
  }
  return (
    <span className="tcv-sundae-asset">
      <AssetAmount
        policyId={asset.policyId}
        assetName={asset.assetName}
        raw={magnitude}
        prefix={sign}
        className="tcv-sundae-asset-amount"
      />
      <V4AssetName asset={asset} />
    </span>
  );
}

/** A list of asset entries, one per row, with an optional leading label. */
export function V4AssetList({
  entries,
  label,
  signed = false,
  empty = "(none)",
}: {
  entries: V4AssetEntry[];
  label?: string;
  signed?: boolean;
  empty?: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="tcv-sundae-row">
        {label && <span className="tcv-sundae-leg-label">{label}</span>}
        <span className="tcv-sundae-estimate-dim">{empty}</span>
      </div>
    );
  }
  return (
    <>
      {entries.map((entry, i) => (
        <div className="tcv-sundae-row" key={`${entry.asset.policyId}.${entry.asset.assetName}.${i}`}>
          <span className="tcv-sundae-leg-label">{i === 0 ? (label ?? "") : ""}</span>
          <V4AssetValue asset={entry.asset} amount={entry.amount} signed={signed} />
        </div>
      ))}
    </>
  );
}

/** A compact one-line summary like "482.24 USDCx → 482.00 USDr". */
export function V4FlowSummary({
  given,
  received,
}: {
  given: V4AssetEntry[];
  received: V4AssetEntry[];
}) {
  return (
    <span className="tcv-sundae-v4-flow-inline">
      {given.map((g, i) => (
        <React.Fragment key={`g${i}`}>
          {i > 0 && <span className="tcv-sundae-estimate-dim"> + </span>}
          <V4AssetValue asset={g.asset} amount={g.amount < BigInt(0) ? -g.amount : g.amount} />
        </React.Fragment>
      ))}
      <span className="tcv-sundae-arrow">→</span>
      {received.map((r, i) => (
        <React.Fragment key={`r${i}`}>
          {i > 0 && <span className="tcv-sundae-estimate-dim"> + </span>}
          <V4AssetValue asset={r.asset} amount={r.amount} />
        </React.Fragment>
      ))}
    </span>
  );
}
