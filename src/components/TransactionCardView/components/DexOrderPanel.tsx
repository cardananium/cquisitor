"use client";

import React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CopyButton } from "./CopyButton";
import { HashWithTooltip } from "./HashWithTooltip";
import { AssetTooltipContent, AssetAmount } from "./AssetNameWithTooltip";
import { useAssetMeta } from "../AssetInfoContext";
import { usePoolPair, usePoolPairEnabled } from "../PoolInfoContext";
import { decodeAssetName } from "../utils";
import { formatDexRole, dexThemeKey } from "@/utils/protocols/dex";
import type { DexDetection } from "@/utils/protocols/dex";
import type { DexIssue, PoolPair, PoolRef } from "@/utils/protocols/dex";
import type { PD } from "@/utils/protocols/dex/plutusData";

interface DexOrderPanelProps {
  detection: DexDetection;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

// Human-readable asset name. Decoded text (plain ASCII or a CIP-68 name behind a
// label prefix) is shown with a hex-on-hover tooltip (String + Hex + copy),
// consistent with the asset table; genuinely binary names (LP-token hashes, raw
// ids) fall back to a truncating hash chip (also full hex on hover + copy).
function AssetName({ policyId, assetName }: { policyId: string; assetName: string }) {
  const d = decodeAssetName(assetName);
  const meta = useAssetMeta(policyId, assetName);
  // Readable label: decoded ASCII/CIP-68 → registry ticker → registry name.
  const readable = d.decoded ?? meta?.ticker ?? meta?.name ?? null;
  if (readable === null) {
    return <HashWithTooltip hash={assetName} className="tcv-dex-asset-name-hex" />;
  }
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="tcv-dex-asset-name">
            {readable}
            {d.standard && (
              <span className="tcv-dex-asset-std" title={`CIP-68 label ${d.standard}`}>
                {d.standard}
              </span>
            )}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tcv-hash-tooltip" sideOffset={5} side="top">
            <AssetTooltipContent policyId={policyId} assetName={assetName} decoded={d} meta={meta} />
            <Tooltip.Arrow className="tcv-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// Render an on-chain asset like the asset table: optional amount + decoded name
// + the full policy id on hover/copy, instead of a raw `policyId.name` string.
function AssetValue({
  policyId,
  assetName,
  amount,
}: {
  policyId: string;
  assetName: string;
  amount?: bigint;
}) {
  const isAda = policyId === "" && assetName === "";
  return (
    <span className="tcv-dex-asset">
      {amount !== undefined && (
        <AssetAmount policyId={policyId} assetName={assetName} raw={amount} className="tcv-dex-asset-amount" />
      )}
      {isAda ? (
        <span className="tcv-dex-asset-name">ADA</span>
      ) : (
        <>
          {assetName && <AssetName policyId={policyId} assetName={assetName} />}
          <HashWithTooltip hash={policyId} className="tcv-dex-asset-policy-chip" />
        </>
      )}
    </span>
  );
}

// The actual trading pair an order trades — "assetA / assetB" with the usual
// metadata tooltips. The order datum rarely carries it, so it comes either from
// a known per-pool registry (static `view.pair`) or is resolved from the chain
// (`view.poolRef` -> the pool UTxO's datum), streaming in when ready.
function PairAssets({ pair }: { pair: PoolPair }) {
  return (
    <div className="tcv-dex-section tcv-dex-pair">
      <div className="tcv-dex-row">
        <span className="tcv-dex-leg-label">Pair</span>
        <span className="tcv-dex-pair-assets">
          <AssetValue policyId={pair.assetA.policyId} assetName={pair.assetA.assetName} />
          <span className="tcv-dex-pair-sep">/</span>
          <AssetValue policyId={pair.assetB.policyId} assetName={pair.assetB.assetName} />
        </span>
      </div>
    </div>
  );
}

function ResolvedPoolPairRow({ poolRef, adapterId }: { poolRef: PoolRef; adapterId: string }) {
  const enabled = usePoolPairEnabled();
  const pair = usePoolPair(poolRef, adapterId);
  if (pair) return <PairAssets pair={pair} />;
  // While the fetch is in flight (only when enrichment is configured), show a
  // hint instead of nothing, so a slow/failed resolve isn't silently invisible.
  if (enabled && pair === undefined) {
    return (
      <div className="tcv-dex-section tcv-dex-pair">
        <div className="tcv-dex-row">
          <span className="tcv-dex-leg-label">Pool pair</span>
          <span className="tcv-dex-pair-loading">resolving…</span>
        </div>
      </div>
    );
  }
  return null;
}

function worstSeverity(issues: DexIssue[]): "ok" | "warning" | "error" {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "ok";
}

export function DexOrderPanel({ detection }: DexOrderPanelProps) {
  const { view, rawDatum, parseError, label, role } = detection;

  const status = view ? worstSeverity(view.issues) : parseError ? "error" : "ok";
  const statusText = view
    ? status === "ok"
      ? "OK"
      : `${view.issues.length} issue${view.issues.length === 1 ? "" : "s"}`
    : parseError
    ? "parse error"
    : "detected";

  return (
    <div className="tcv-dex-panel" data-dex={dexThemeKey(detection.adapterId)}>
      <div className="tcv-dex-banner">
        <span className="tcv-dex-icon">⇄</span>
        <span className="tcv-dex-title">{view?.protocol ?? label}</span>
        <span className="tcv-dex-role">{formatDexRole(role)}</span>
        <span className={`tcv-dex-status ${status}`}>{statusText}</span>
      </div>

      {view && (
        <>
          <div className="tcv-dex-header-row">
            <span className="tcv-dex-order-kind">{view.kind}</span>
          </div>

          {view.pair ? (
            <PairAssets pair={view.pair} />
          ) : view.poolRef ? (
            <ResolvedPoolPairRow poolRef={view.poolRef} adapterId={detection.adapterId} />
          ) : null}

          {view.assets && view.assets.length > 0 && (
            <div className="tcv-dex-section">
              {view.assets.map((asset, i) => (
                <div className="tcv-dex-row" key={i}>
                  <span className="tcv-dex-leg-label">{asset.label}</span>
                  <AssetValue policyId={asset.policyId} assetName={asset.assetName} amount={asset.amount} />
                </div>
              ))}
            </div>
          )}

          {view.rows.length > 0 && (
            <div className="tcv-dex-section tcv-dex-meta">
              {view.rows.map((row, i) => (
                <div className="tcv-dex-row" key={i}>
                  <span className="tcv-dex-leg-label">{row.label}</span>
                  {row.asset ? (
                    <AssetValue
                      policyId={row.asset.policyId}
                      assetName={row.asset.assetName}
                      amount={row.asset.amount}
                    />
                  ) : row.hash ? (
                    <HashWithTooltip hash={row.value ?? ""} className="tcv-dex-mono" />
                  ) : (
                    <span className={row.mono ? "tcv-dex-mono" : undefined}>{row.value ?? ""}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {view.issues.length > 0 && (
            <div className="tcv-dex-section">
              {view.issues.map((issue, i) => (
                <div className={`tcv-dex-issue ${issue.severity}`} key={i}>
                  {issue.message}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {parseError && !view && (
        <div className="tcv-dex-section">
          <div className="tcv-dex-issue warning">{parseError}</div>
        </div>
      )}

      {rawDatum && <RawDatumDisclosure data={rawDatum} />}
    </div>
  );
}

function RawDatumDisclosure({ data }: { data: PD }) {
  const json = React.useMemo(() => JSON.stringify(data, bigintReplacer, 2), [data]);
  return (
    <div className="tcv-dex-section">
      <Collapsible.Root>
        <Collapsible.Trigger className="tcv-inline-collapsible-trigger">
          <svg width="10" height="10" viewBox="0 0 10 10" className="tcv-collapsible-icon">
            <path d="M2 3L5 6L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <span>Raw datum</span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className="tcv-data-value-json">
            {json}
            <CopyButton text={json} />
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}
