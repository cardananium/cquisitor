"use client";

// Shared asset display used everywhere assets render (output/input/mint tables,
// DEX & Sundae panels, AssetsTable). The name shows the readable label (decoded
// ASCII / CIP-68 / registry ticker); the tooltip shows a header (logo + name +
// ticker + decimals) over the identity rows (on-chain name, hex, policy,
// fingerprint, supply, registry, description). `AssetAmount` renders a raw
// integer scaled by the token's decimals with a badge marking whether it was
// decimals-formatted or shown raw. Metadata is fetched batched via the
// AssetInfo context.

import * as Tooltip from "@radix-ui/react-tooltip";
import { CopyButton } from "./CopyButton";
import { decodeAssetName } from "../utils";
import { useAssetMeta, type AssetMetaState } from "../AssetInfoContext";

type Decoded = ReturnType<typeof decodeAssetName>;

// Render a raw integer amount scaled by `decimals` (e.g. 1500000, 6 → "1.5").
export function formatTokenAmount(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toLocaleString();
  const neg = raw < BigInt(0);
  const abs = neg ? -raw : raw;
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = frac.length > 0 ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
  return neg ? `-${body}` : body;
}

function shortText(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function TipRow({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: string;
}) {
  return (
    <div className="tcv-asset-tip-row">
      <span className="tcv-asset-tip-key">{label}</span>
      <span className={`tcv-asset-tip-val${mono ? " tcv-asset-tip-mono" : ""}`}>{value}</span>
      {copy && <CopyButton text={copy} className="tcv-tooltip-copy-sm" />}
    </div>
  );
}

/** The full asset tooltip body (header + identity rows). Presentational. */
export function AssetTooltipContent({
  policyId,
  assetName,
  decoded,
  meta,
}: {
  policyId: string;
  assetName: string;
  decoded: Decoded;
  meta: AssetMetaState;
}) {
  const headName = meta?.name ?? decoded.decoded ?? meta?.ticker ?? null;
  const hasHeader = !!(meta?.logo || headName);
  return (
    <div className="tcv-asset-tip">
      {hasHeader && (
        <div className="tcv-asset-tip-head">
          {meta?.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="tcv-asset-tip-logo"
              src={`data:image/png;base64,${meta.logo}`}
              alt={meta.ticker ?? "logo"}
            />
          )}
          <div className="tcv-asset-tip-headtext">
            {headName && <div className="tcv-asset-tip-name">{headName}</div>}
            <div className="tcv-asset-tip-sub">
              {meta?.ticker && <span className="tcv-asset-tip-ticker">{meta.ticker}</span>}
              {meta?.decimals != null && (
                <span className="tcv-asset-tip-dim">{meta.decimals} decimals</span>
              )}
              {decoded.standard && <span className="tcv-asset-tip-dim">CIP-68 {decoded.standard}</span>}
            </div>
          </div>
        </div>
      )}
      <div className="tcv-asset-tip-rows">
        {decoded.decoded && <TipRow label="On-chain" value={decoded.decoded} copy={decoded.decoded} />}
        <TipRow label="Hex" value={assetName || "(empty)"} mono copy={assetName || undefined} />
        {policyId && <TipRow label="Policy" value={policyId} mono copy={policyId} />}
        {meta?.fingerprint && <TipRow label="Fingerprint" value={meta.fingerprint} mono copy={meta.fingerprint} />}
        {meta?.totalSupply && (
          <TipRow
            label="Supply"
            value={
              meta.decimals != null
                ? formatTokenAmount(BigInt(meta.totalSupply), meta.decimals)
                : BigInt(meta.totalSupply).toLocaleString()
            }
          />
        )}
        {meta?.url && (
          <div className="tcv-asset-tip-row">
            <span className="tcv-asset-tip-key">Registry</span>
            <a
              className="tcv-asset-tip-val tcv-tooltip-link"
              href={meta.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {meta.url.replace(/^https?:\/\//, "")}
            </a>
          </div>
        )}
      </div>
      {meta?.description && <div className="tcv-asset-tip-desc">{shortText(meta.description)}</div>}
    </div>
  );
}

export function AssetNameWithTooltip({
  policyId,
  assetName,
  className = "",
  label,
}: {
  policyId: string;
  assetName: string;
  className?: string;
  /** Force the visible label (e.g. a protocol-authoritative ticker); the
   * tooltip still shows the decoded name + fetched metadata. */
  label?: string;
}) {
  const decoded = decodeAssetName(assetName);
  const meta = useAssetMeta(policyId, assetName);
  const readable = label ?? decoded.decoded ?? meta?.ticker ?? meta?.name ?? null;
  const display = readable ?? assetName;

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={`${readable ? "tcv-decoded" : ""} ${className}`.trim()}>
            {display}
            {decoded.standard && (
              <span className="tcv-asset-std" title={`CIP-68 label ${decoded.standard}`}>
                {decoded.standard}
              </span>
            )}
            {meta?.ticker && readable !== meta.ticker && (
              <span className="tcv-asset-ticker">{meta.ticker}</span>
            )}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tcv-hash-tooltip" sideOffset={5} side="top">
            <AssetTooltipContent policyId={policyId} assetName={assetName} decoded={decoded} meta={meta} />
            <Tooltip.Arrow className="tcv-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/**
 * A token amount: scaled by the asset's decimals when known (with a small badge
 * marking it as decimals-formatted), otherwise the raw on-chain integer (marked
 * `raw`). Hover shows the alternate representation. `prefix` is an optional sign
 * (e.g. "+"/"−" for mint/burn).
 */
export function AssetAmount({
  policyId,
  assetName,
  raw,
  prefix = "",
  className = "",
}: {
  policyId: string;
  assetName: string;
  raw: bigint;
  prefix?: string;
  className?: string;
}) {
  const meta = useAssetMeta(policyId, assetName);
  const decimals = meta?.decimals ?? null;
  const cls = `tcv-amt ${className}`.trim();
  const rawStr = raw.toLocaleString();

  const formatted = decimals != null && decimals > 0;
  const display = formatted ? formatTokenAmount(raw, decimals) : rawStr;
  const badge = formatted ? (
    <span className="tcv-amt-tag tcv-amt-fmt">d{decimals}</span>
  ) : decimals === 0 ? null : (
    <span className="tcv-amt-tag tcv-amt-raw">raw</span>
  );

  // Tooltip explains the badge and always shows the original raw amount.
  const title = formatted
    ? "Decimals-formatted"
    : decimals === 0
      ? "Exact integer"
      : "Raw on-chain integer";
  const body = formatted
    ? `Shown divided by 10^${decimals} — this token has ${decimals} decimals.`
    : decimals === 0
      ? "This token has 0 decimals, so the integer is the exact amount."
      : "Shown as-is, NOT divided by decimals — this token's decimals are unknown to the registry.";

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={cls}>
            {prefix}
            {display}
            {badge}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tcv-hash-tooltip" sideOffset={5} side="top">
            <div className="tcv-amt-tip">
              <div className="tcv-amt-tip-title">{title}</div>
              <div className="tcv-amt-tip-body">{body}</div>
              <div className="tcv-asset-tip-row">
                <span className="tcv-asset-tip-key">Raw</span>
                <span className="tcv-asset-tip-val tcv-asset-tip-mono">{rawStr}</span>
                <CopyButton text={raw.toString()} className="tcv-tooltip-copy-sm" />
              </div>
              {formatted && (
                <div className="tcv-asset-tip-row">
                  <span className="tcv-asset-tip-key">Formatted</span>
                  <span className="tcv-asset-tip-val">{display}</span>
                </div>
              )}
            </div>
            <Tooltip.Arrow className="tcv-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
