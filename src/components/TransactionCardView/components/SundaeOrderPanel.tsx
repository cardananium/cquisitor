"use client";

import React, { useEffect, useState } from "react";
import { CopyButton } from "./CopyButton";
import { HashWithTooltip } from "./HashWithTooltip";
import { AssetNameWithTooltip } from "./AssetNameWithTooltip";
import { SlotWithTooltip } from "./SlotWithTooltip";
import { formatAda, formatAssetName, truncateHash } from "../utils";
import {
  loadPool,
  getCachedPool,
  estimateV3Swap,
  estimateV3Deposit,
  estimateV3Withdraw,
  estimateStableswapSwap,
  estimateStableswapDeposit,
  estimateStableswapWithdraw,
} from "@/utils/protocols/sundae";
import type {
  SundaeOutputDetection,
  SundaePoolInfo,
  SundaeAsset,
  SwapEstimate,
  DepositEstimate,
  WithdrawEstimate,
  StableswapEstimate,
} from "@/utils/protocols/sundae";
import type {
  V3OrderDatum,
  V3Order,
  V3Destination,
  V3Multisig,
  V3AssetAmount,
  SundaeIssue,
  SundaePoolDatum,
} from "@/utils/protocols/sundae";

interface SundaeOrderPanelProps {
  detection: SundaeOutputDetection;
}

// Resolve a pool ident through the cache. Triggers a fetch on first use; the
// hook re-renders once the network request resolves.
function usePoolInfo(poolIdent: string | null | undefined): {
  pool: SundaePoolInfo | null | undefined;
  loading: boolean;
} {
  const [pool, setPool] = useState<SundaePoolInfo | null | undefined>(() =>
    poolIdent ? getCachedPool(poolIdent) : undefined
  );
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!poolIdent) {
      setPool(undefined);
      return;
    }
    const cached = getCachedPool(poolIdent);
    if (cached !== undefined) {
      setPool(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadPool(poolIdent)
      .then((info) => {
        if (!cancelled) setPool(info);
      })
      .catch(() => {
        if (!cancelled) setPool(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [poolIdent]);
  return { pool, loading };
}

// Format raw on-chain (policy, name, amount) using pool-side metadata when we
// can match. Falls back to the on-chain hex when there's no metadata.
function matchAsset(asset: V3AssetAmount, pool: SundaePoolInfo | null | undefined): SundaeAsset | null {
  if (!pool) return null;
  for (const candidate of [pool.assetA, pool.assetB]) {
    if (
      candidate.policyId === asset.policyId &&
      (candidate.assetNameHex === asset.assetName || (candidate.policyId === "" && asset.policyId === ""))
    ) {
      return candidate;
    }
  }
  return null;
}

function formatWithDecimals(amount: bigint, decimals: number): string {
  if (decimals <= 0) return amount.toLocaleString();
  const negative = amount < BigInt(0);
  const abs = negative ? -amount : amount;
  const s = abs.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  const formatted = frac
    ? `${BigInt(intPart).toLocaleString()}.${frac}`
    : BigInt(intPart).toLocaleString();
  return negative ? `-${formatted}` : formatted;
}

function isAda(asset: V3AssetAmount): boolean {
  return asset.policyId === "" && asset.assetName === "";
}

function formatAssetAmount(
  asset: V3AssetAmount,
  pool: SundaePoolInfo | null | undefined
): React.ReactNode {
  if (isAda(asset)) {
    return (
      <span className="tcv-sundae-asset">
        <span className="tcv-ada-amount">₳ {formatAda(asset.amount.toString())}</span>
      </span>
    );
  }
  const meta = matchAsset(asset, pool);
  const decimals = meta?.decimals ?? 0;
  const amountText = decimals > 0
    ? formatWithDecimals(asset.amount, decimals)
    : asset.amount.toLocaleString();
  // Prefer the pool's authoritative ticker as the label; the shared component
  // adds the rich tooltip (hex, policy, decimals, fingerprint, registry, …) and
  // falls back to its own decode when the pool has no ticker.
  const label = meta?.ticker || meta?.name || undefined;
  return (
    <span className="tcv-sundae-asset">
      <span className="tcv-sundae-asset-amount">{amountText}</span>
      <AssetNameWithTooltip
        policyId={asset.policyId}
        assetName={asset.assetName}
        className="tcv-sundae-asset-symbol"
        label={label}
      />
    </span>
  );
}

function describeOrder(
  order: V3Order,
  pool: SundaePoolInfo | null | undefined
): { label: string; body: React.ReactNode } {
  switch (order.kind) {
    case "Swap":
      return {
        label: "Swap",
        body: (
          <div className="tcv-sundae-swap-flow">
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Offer</span>
              {formatAssetAmount(order.offer, pool)}
            </div>
            <div className="tcv-sundae-arrow">→</div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Min received</span>
              {formatAssetAmount(order.minReceived, pool)}
            </div>
          </div>
        ),
      };
    case "Deposit":
      return {
        label: "Deposit",
        body: (
          <div className="tcv-sundae-flow">
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Asset A</span>
              {formatAssetAmount(order.assets[0], pool)}
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Asset B</span>
              {formatAssetAmount(order.assets[1], pool)}
            </div>
          </div>
        ),
      };
    case "Withdrawal":
      return {
        label: "Withdraw",
        body: (
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">LP burned</span>
            {formatAssetAmount(order.lpAmount, pool)}
          </div>
        ),
      };
    case "Donation":
      return {
        label: "Donation",
        body: (
          <div className="tcv-sundae-flow">
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Asset A</span>
              {formatAssetAmount(order.assets[0], pool)}
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Asset B</span>
              {formatAssetAmount(order.assets[1], pool)}
            </div>
          </div>
        ),
      };
    case "Strategy":
      return {
        label: "Strategy",
        body: (
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">Auth</span>
            <span className="tcv-sundae-mono">
              {order.auth.kind === "Signature"
                ? `Signature ${truncateHash(order.auth.signer)}`
                : `Script ${truncateHash(order.auth.scriptHash)}`}
            </span>
          </div>
        ),
      };
    case "Record":
      return {
        label: "Record",
        body: (
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">Policy</span>
            <span className="tcv-sundae-mono">
              {truncateHash(order.policy.policyId)}
              {order.policy.assetName ? `.${order.policy.assetName}` : ""}
            </span>
          </div>
        ),
      };
  }
}

function describeOwner(owner: V3Multisig): React.ReactNode {
  switch (owner.kind) {
    case "Signature":
      return (
        <span className="tcv-sundae-mono">
          Signature <HashWithTooltip hash={owner.keyHash} />
        </span>
      );
    case "Script":
      return (
        <span className="tcv-sundae-mono">
          Script <HashWithTooltip hash={owner.scriptHash} />
        </span>
      );
    case "AllOf":
      return <span>AllOf [{owner.scripts.length} signers]</span>;
    case "AnyOf":
      return <span>AnyOf [{owner.scripts.length} signers]</span>;
    case "AtLeast":
      return (
        <span>
          AtLeast {owner.required.toString()} of {owner.scripts.length}
        </span>
      );
    case "Before":
      return <span>Before slot <SlotWithTooltip slot={owner.time.toString()} /></span>;
    case "After":
      return <span>After slot <SlotWithTooltip slot={owner.time.toString()} /></span>;
  }
}

function describeDestination(dest: V3Destination): React.ReactNode {
  if (dest.kind === "Self") {
    return <span className="tcv-sundae-self">Self (returns to order address)</span>;
  }
  const cred = dest.address.paymentCredential;
  return (
    <div className="tcv-sundae-dest">
      <div className="tcv-sundae-row">
        <span className="tcv-sundae-leg-label">Payment</span>
        <span className="tcv-sundae-mono">
          {cred.kind === "VKey" ? "VKey " : "Script "}
          <HashWithTooltip hash={cred.hash} />
        </span>
      </div>
      {dest.address.stakeCredential && dest.address.stakeCredential.kind === "Inline" && (
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Stake</span>
          <span className="tcv-sundae-mono">
            {dest.address.stakeCredential.credential.kind === "VKey" ? "VKey " : "Script "}
            <HashWithTooltip hash={dest.address.stakeCredential.credential.hash} />
          </span>
        </div>
      )}
      <div className="tcv-sundae-row">
        <span className="tcv-sundae-leg-label">Datum</span>
        <span>
          {dest.datum.kind === "NoDatum"
            ? "None"
            : dest.datum.kind === "DatumHash"
            ? `Hash ${truncateHash(dest.datum.hash)}`
            : "Inline"}
        </span>
      </div>
    </div>
  );
}

function IssuesList({ issues }: { issues: SundaeIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="tcv-sundae-issues">
      {issues.map((issue, i) => (
        <div
          key={i}
          className={`tcv-sundae-issue tcv-sundae-issue-${issue.severity}`}
        >
          <span className="tcv-sundae-issue-icon">
            {issue.severity === "error" ? "⊗" : issue.severity === "warning" ? "△" : "ⓘ"}
          </span>
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function EstimatedOutcome({
  estimate,
  pool,
  takeAsset,
  minReceivedAmount,
}: {
  estimate: SwapEstimate;
  pool: SundaePoolInfo;
  takeAsset: SundaeAsset;
  minReceivedAmount: bigint;
}) {
  const decimals = takeAsset.decimals ?? 0;
  const symbol = takeAsset.ticker || takeAsset.name || "?";
  const giveAsset = estimate.direction === "AtoB" ? pool.assetA : pool.assetB;
  const giveSymbol = giveAsset.ticker || giveAsset.name || "?";
  const takesText =
    decimals > 0 ? formatWithDecimals(estimate.takes, decimals) : estimate.takes.toLocaleString();
  const cushionPct = estimate.cushion !== null ? estimate.cushion * 100 : null;
  const feePct = (estimate.feeNumer / estimate.feeDenom) * 100;
  const slippagePct =
    estimate.midPrice && estimate.effectivePrice
      ? ((estimate.midPrice - estimate.effectivePrice) / estimate.midPrice) * 100
      : null;

  return (
    <div className="tcv-sundae-estimate">
      <div className="tcv-sundae-estimate-headline">
        <span className="tcv-sundae-leg-label">Est. receive</span>
        <span className="tcv-sundae-asset">
          <span className="tcv-sundae-asset-amount">{takesText}</span>
          <span className="tcv-sundae-asset-symbol">{symbol}</span>
        </span>
        {!estimate.meetsMinReceived ? (
          <span className="tcv-sundae-status error">below minReceived</span>
        ) : cushionPct !== null && cushionPct >= 0 ? (
          <span className="tcv-sundae-cushion">+{cushionPct.toFixed(2)}% over floor</span>
        ) : null}
      </div>
      <div className="tcv-sundae-estimate-meta">
        {estimate.effectivePrice !== null && (
          <span>
            1 {giveSymbol} → {formatPrice(estimate.effectivePrice)} {symbol}
          </span>
        )}
        {estimate.midPrice !== null && (
          <span className="tcv-sundae-estimate-dim">
            mid {formatPrice(estimate.midPrice)} {symbol}
          </span>
        )}
        {slippagePct !== null && (
          <span className="tcv-sundae-estimate-dim">
            slippage {slippagePct.toFixed(3)}%
          </span>
        )}
        <span className="tcv-sundae-estimate-dim">
          {estimate.direction === "AtoB" ? "bid fee" : "ask fee"} {feePct.toFixed(2)}%
        </span>
        {!estimate.meetsMinReceived && (
          <span>
            min {formatWithDecimals(minReceivedAmount, decimals)} {symbol}
          </span>
        )}
      </div>
    </div>
  );
}

function StableswapOutcome({
  estimate,
  pool,
  takeAsset,
  minReceivedAmount,
}: {
  estimate: StableswapEstimate;
  pool: SundaePoolInfo;
  takeAsset: SundaeAsset;
  minReceivedAmount: bigint;
}) {
  const decimals = takeAsset.decimals ?? 0;
  const symbol = takeAsset.ticker || takeAsset.name || "?";
  const giveAsset = estimate.direction === "AtoB" ? pool.assetA : pool.assetB;
  const giveSymbol = giveAsset.ticker || giveAsset.name || "?";
  const takesText =
    decimals > 0 ? formatWithDecimals(estimate.takes, decimals) : estimate.takes.toLocaleString();
  const cushionPct = estimate.cushion !== null ? estimate.cushion * 100 : null;
  const totalFeePct = (estimate.totalFeeNumer / estimate.totalFeeDenom) * 100;
  const slippagePct =
    estimate.midPrice && estimate.effectivePrice
      ? ((estimate.midPrice - estimate.effectivePrice) / estimate.midPrice) * 100
      : null;
  const lpFee = estimate.totalLpFee;
  const protoFee = estimate.totalProtocolFee;

  return (
    <div className="tcv-sundae-estimate">
      <div className="tcv-sundae-estimate-headline">
        <span className="tcv-sundae-leg-label">Est. receive</span>
        <span className="tcv-sundae-asset">
          <span className="tcv-sundae-asset-amount">{takesText}</span>
          <span className="tcv-sundae-asset-symbol">{symbol}</span>
        </span>
        {!estimate.meetsMinReceived ? (
          <span className="tcv-sundae-status error">below minReceived</span>
        ) : cushionPct !== null && cushionPct >= 0 ? (
          <span className="tcv-sundae-cushion">+{cushionPct.toFixed(2)}% over floor</span>
        ) : null}
      </div>
      <div className="tcv-sundae-estimate-meta">
        {estimate.effectivePrice !== null && (
          <span>
            1 {giveSymbol} → {formatPrice(estimate.effectivePrice)} {symbol}
          </span>
        )}
        {estimate.midPrice !== null && (
          <span className="tcv-sundae-estimate-dim">
            mid {formatPrice(estimate.midPrice)} {symbol}
          </span>
        )}
        {slippagePct !== null && (
          <span className="tcv-sundae-estimate-dim">
            slippage {slippagePct.toFixed(4)}%
          </span>
        )}
        <span className="tcv-sundae-estimate-dim">
          fee {totalFeePct.toFixed(2)}% (LP {formatWithDecimals(lpFee, decimals)} {symbol}, protocol {formatWithDecimals(protoFee, decimals)} {symbol})
        </span>
        {!estimate.meetsMinReceived && (
          <span>
            min {formatWithDecimals(minReceivedAmount, decimals)} {symbol}
          </span>
        )}
      </div>
    </div>
  );
}

function DepositOutcome({
  estimate,
  pool,
}: {
  estimate: DepositEstimate;
  pool: SundaePoolInfo;
}) {
  const lpDecimals = pool.assetLP.decimals ?? 0;
  const aDecimals = pool.assetA.decimals ?? 0;
  const bDecimals = pool.assetB.decimals ?? 0;
  const lpSymbol = pool.assetLP.ticker || pool.assetLP.name || "LP";
  const aSymbol = pool.assetA.ticker || pool.assetA.name || "A";
  const bSymbol = pool.assetB.ticker || pool.assetB.name || "B";
  const sharePct = estimate.shareOfPool !== null ? estimate.shareOfPool * 100 : null;
  const hasChange = estimate.changeA > BigInt(0) || estimate.changeB > BigInt(0);
  return (
    <div className="tcv-sundae-estimate">
      <div className="tcv-sundae-estimate-headline">
        <span className="tcv-sundae-leg-label">Est. LP minted</span>
        <span className="tcv-sundae-asset">
          <span className="tcv-sundae-asset-amount">
            {lpDecimals > 0
              ? formatWithDecimals(estimate.issuedLp, lpDecimals)
              : estimate.issuedLp.toLocaleString()}
          </span>
          <span className="tcv-sundae-asset-symbol">{lpSymbol}</span>
        </span>
        {sharePct !== null && (
          <span className="tcv-sundae-cushion">{formatPrice(sharePct)}% of pool</span>
        )}
      </div>
      <div className="tcv-sundae-estimate-meta">
        <span>
          deposits {formatWithDecimals(estimate.depositedA, aDecimals)} {aSymbol}
        </span>
        <span>
          {formatWithDecimals(estimate.depositedB, bDecimals)} {bSymbol}
        </span>
        {hasChange && (
          <span className="tcv-sundae-estimate-dim">
            change{" "}
            {estimate.changeA > BigInt(0)
              ? `${formatWithDecimals(estimate.changeA, aDecimals)} ${aSymbol}`
              : `${formatWithDecimals(estimate.changeB, bDecimals)} ${bSymbol}`}
          </span>
        )}
      </div>
    </div>
  );
}

function WithdrawOutcome({
  estimate,
  pool,
}: {
  estimate: WithdrawEstimate;
  pool: SundaePoolInfo;
}) {
  const aDecimals = pool.assetA.decimals ?? 0;
  const bDecimals = pool.assetB.decimals ?? 0;
  const aSymbol = pool.assetA.ticker || pool.assetA.name || "A";
  const bSymbol = pool.assetB.ticker || pool.assetB.name || "B";
  const sharePct = estimate.shareOfPool !== null ? estimate.shareOfPool * 100 : null;
  return (
    <div className="tcv-sundae-estimate">
      <div className="tcv-sundae-estimate-headline">
        <span className="tcv-sundae-leg-label">Est. receive</span>
        <span className="tcv-sundae-asset">
          <span className="tcv-sundae-asset-amount">
            {formatWithDecimals(estimate.withdrawnA, aDecimals)}
          </span>
          <span className="tcv-sundae-asset-symbol">{aSymbol}</span>
        </span>
        <span className="tcv-sundae-asset">
          <span className="tcv-sundae-asset-amount">
            {formatWithDecimals(estimate.withdrawnB, bDecimals)}
          </span>
          <span className="tcv-sundae-asset-symbol">{bSymbol}</span>
        </span>
        {sharePct !== null && (
          <span className="tcv-sundae-cushion">{formatPrice(sharePct)}% of pool</span>
        )}
        {estimate.lpMismatch && (
          <span className="tcv-sundae-status error">LP doesn&apos;t match pool</span>
        )}
      </div>
    </div>
  );
}

function formatPrice(p: number): string {
  if (p === 0) return "0";
  if (p >= 1) return p.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return p.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

function V3Body({
  datum,
  issues,
  protocol,
}: {
  datum: V3OrderDatum;
  issues: SundaeIssue[];
  protocol: "V3" | "Stableswap";
}) {
  const { pool, loading } = usePoolInfo(datum.poolIdent);
  const order = describeOrder(datum.details, pool);
  const pairLabel = pool
    ? `${pool.assetA.ticker || pool.assetA.name || "?"} / ${pool.assetB.ticker || pool.assetB.name || "?"}`
    : null;
  // Compute swap outcome when we have a pool and the order is a swap.
  const swapEstimate =
    pool && datum.details.kind === "Swap" && protocol === "V3"
      ? estimateV3Swap(datum.details.offer, datum.details.minReceived, pool)
      : null;
  const stableEstimate =
    pool && datum.details.kind === "Swap" && protocol === "Stableswap"
      ? estimateStableswapSwap(datum.details.offer, datum.details.minReceived, pool)
      : null;
  const swapDirection = swapEstimate?.direction ?? stableEstimate?.direction ?? null;
  const takeAsset =
    swapDirection && pool
      ? swapDirection === "AtoB"
        ? pool.assetB
        : pool.assetA
      : null;
  const depositEstimate =
    pool && datum.details.kind === "Deposit"
      ? protocol === "Stableswap"
        ? estimateStableswapDeposit(datum.details.assets[0], datum.details.assets[1], pool)
        : estimateV3Deposit(datum.details.assets[0], datum.details.assets[1], pool)
      : null;
  const withdrawEstimate =
    pool && datum.details.kind === "Withdrawal"
      ? protocol === "Stableswap"
        ? estimateStableswapWithdraw(datum.details.lpAmount, pool)
        : estimateV3Withdraw(datum.details.lpAmount, pool)
      : null;
  return (
    <>
      <div className="tcv-sundae-header-row">
        <span className="tcv-sundae-order-kind">{order.label}</span>
        {pairLabel && <span className="tcv-sundae-pair">{pairLabel}</span>}
        {loading && !pool && <span className="tcv-sundae-pair tcv-sundae-pair-loading">loading pool…</span>}
        {issues.some((i) => i.severity === "error") ? (
          <span className="tcv-sundae-status error">{issues.filter((i) => i.severity === "error").length} error(s)</span>
        ) : issues.some((i) => i.severity === "warning") ? (
          <span className="tcv-sundae-status warning">{issues.filter((i) => i.severity === "warning").length} warning(s)</span>
        ) : (
          <span className="tcv-sundae-status ok">looks valid</span>
        )}
      </div>

      <div className="tcv-sundae-section">
        {order.body}
        {swapEstimate && pool && takeAsset && datum.details.kind === "Swap" && (
          <EstimatedOutcome
            estimate={swapEstimate}
            pool={pool}
            takeAsset={takeAsset}
            minReceivedAmount={datum.details.minReceived.amount}
          />
        )}
        {stableEstimate && pool && takeAsset && datum.details.kind === "Swap" && (
          <StableswapOutcome
            estimate={stableEstimate}
            pool={pool}
            takeAsset={takeAsset}
            minReceivedAmount={datum.details.minReceived.amount}
          />
        )}
        {depositEstimate && pool && datum.details.kind === "Deposit" && (
          <DepositOutcome estimate={depositEstimate} pool={pool} />
        )}
        {withdrawEstimate && pool && datum.details.kind === "Withdrawal" && (
          <WithdrawOutcome estimate={withdrawEstimate} pool={pool} />
        )}
      </div>

      <div className="tcv-sundae-section tcv-sundae-meta">
        {datum.poolIdent && (
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">Pool ident</span>
            <span className="tcv-sundae-mono">
              <HashWithTooltip hash={datum.poolIdent} />
            </span>
          </div>
        )}
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Max protocol fee</span>
          <span className="tcv-ada-amount">
            ₳ {formatAda(datum.maxProtocolFee.toString())}
          </span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Owner</span>
          {describeOwner(datum.owner)}
        </div>
        <div className="tcv-sundae-row tcv-sundae-row-block">
          <span className="tcv-sundae-leg-label">Destination</span>
          {describeDestination(datum.destination)}
        </div>
      </div>

      <IssuesList issues={issues} />
    </>
  );
}

function PoolBody({ datum }: { datum: SundaePoolDatum }) {
  const { pool, loading } = usePoolInfo(datum.identifier);
  const aSym = pool?.assetA.ticker || pool?.assetA.name;
  const bSym = pool?.assetB.ticker || pool?.assetB.name;
  const pairLabel =
    aSym && bSym
      ? `${aSym} / ${bSym}`
      : `${formatAssetName(datum.assetA.assetName).display || "?"} / ${formatAssetName(datum.assetB.assetName).display || "?"}`;
  const aDecimals = pool?.assetA.decimals ?? 0;
  const bDecimals = pool?.assetB.decimals ?? 0;
  const aLabel = aSym || formatAssetName(datum.assetA.assetName).display || "A";
  const bLabel = bSym || formatAssetName(datum.assetB.assetName).display || "B";
  return (
    <>
      <div className="tcv-sundae-header-row">
        <span className="tcv-sundae-order-kind">{datum.kind} Pool</span>
        <span className="tcv-sundae-pair">{pairLabel}</span>
        {loading && !pool && (
          <span className="tcv-sundae-pair tcv-sundae-pair-loading">loading pool…</span>
        )}
      </div>

      <div className="tcv-sundae-section tcv-sundae-meta">
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Pool ident</span>
          <span className="tcv-sundae-mono">
            <HashWithTooltip hash={datum.identifier} />
          </span>
        </div>
        <div className="tcv-sundae-row">
          <span className="tcv-sundae-leg-label">Circulating LP</span>
          <span>{formatWithDecimals(datum.circulatingLp, pool?.assetLP.decimals ?? 0)}</span>
        </div>
        {datum.kind === "V1" ? (
          <div className="tcv-sundae-row">
            <span className="tcv-sundae-leg-label">Swap fee</span>
            <span>
              {datum.feeNumerator.toString()} / {datum.feeDenominator.toString()}
              {datum.feeDenominator > BigInt(0) &&
                ` (${((Number(datum.feeNumerator) / Number(datum.feeDenominator)) * 100).toFixed(2)}%)`}
            </span>
          </div>
        ) : datum.kind === "Stableswap" ? (
          <>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">A factor</span>
              <span>{datum.linearAmplification.toString()}</span>
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">D (cached)</span>
              <span className="tcv-sundae-mono">{datum.sumInvariant.toString()}</span>
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">LP fee</span>
              <span>
                bid {(Number(datum.lpBidFeesPer10K) / 100).toFixed(3)}% · ask {(Number(datum.lpAskFeesPer10K) / 100).toFixed(3)}%
              </span>
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Protocol fee</span>
              <span>
                bid {(Number(datum.protocolBidFeesPer10K) / 100).toFixed(3)}% · ask {(Number(datum.protocolAskFeesPer10K) / 100).toFixed(3)}%
              </span>
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Accumulated fees</span>
              <span className="tcv-sundae-estimate-dim">
                flat ₳ {formatAda(datum.protocolFeesFlat.toString())} · A {formatWithDecimals(datum.protocolFeesA, aDecimals)} {aLabel} · B {formatWithDecimals(datum.protocolFeesB, bDecimals)} {bLabel}
              </span>
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Market opens</span>
              <span className="tcv-sundae-mono">slot <SlotWithTooltip slot={datum.marketOpenSlot.toString()} /></span>
            </div>
          </>
        ) : (
          <>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Bid fee (A→B)</span>
              <span>{(Number(datum.bidFeesPer10K) / 100).toFixed(2)}%</span>
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Ask fee (B→A)</span>
              <span>{(Number(datum.askFeesPer10K) / 100).toFixed(2)}%</span>
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Accumulated fees</span>
              <span>₳ {formatAda(datum.protocolFees.toString())}</span>
            </div>
            <div className="tcv-sundae-row">
              <span className="tcv-sundae-leg-label">Market opens</span>
              <span className="tcv-sundae-mono">slot <SlotWithTooltip slot={datum.marketOpenSlot.toString()} /></span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function SundaeOrderPanel({ detection }: SundaeOrderPanelProps) {
  const { match } = detection;
  const headerLabel = `Sundae ${match.protocol} ${match.role === "order" ? "Order" : "Pool"}`;

  return (
    <div className="tcv-sundae-panel">
      <div className="tcv-sundae-banner">
        <span className="tcv-sundae-icon" aria-hidden>🍨</span>
        <span className="tcv-sundae-title">{headerLabel}</span>
        <span className="tcv-sundae-script-hash" title={match.hash}>
          <HashWithTooltip hash={match.hash} />
          <CopyButton text={match.hash} />
        </span>
      </div>

      {detection.v3Order ? (
        <V3Body
          datum={detection.v3Order.datum}
          issues={detection.v3Order.issues}
          protocol={match.protocol === "Stableswap" ? "Stableswap" : "V3"}
        />
      ) : detection.pool ? (
        <PoolBody datum={detection.pool} />
      ) : detection.parseError ? (
        <div className="tcv-sundae-issues">
          <div className="tcv-sundae-issue tcv-sundae-issue-warning">
            <span className="tcv-sundae-issue-icon">△</span>
            <span>{detection.parseError}</span>
          </div>
        </div>
      ) : (
        <div className="tcv-sundae-issues">
          <div className="tcv-sundae-issue tcv-sundae-issue-info">
            <span className="tcv-sundae-issue-icon">ⓘ</span>
            <span>
              Detected by script hash. Detailed parsing for {match.protocol} {match.role} is not implemented yet.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
