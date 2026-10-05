"use client";

// The top-level summary of a SundaeSwap V4 scoop.
//
// A V3 scoop banner could just count orders, because one scoop meant one pool
// and the redeemer listed the orders in processing sequence. A V4 scoop is a
// batch over one or more pools, each pool spend carrying a transcript of
// successive states, and the order validator's withdraw redeemer is the only
// thing that ties an order to its payout output. So the banner reports three
// things the reader cannot get elsewhere: how many pools and steps ran, what
// each order gave and received, and the flow graph connecting them.

import React from "react";
import { HashWithTooltip } from "./HashWithTooltip";
import { V4AssetValue, V4PoolMintContext } from "./SundaeV4Asset";
import { SundaeV4ScoopBalance, SundaeV4ScoopGraph } from "./SundaeV4ScoopGraph";
import { formatAda, truncateHash } from "../utils";
import {
  describePoolRedeemer,
  getV4Deployment,
  orderConstraintLabel,
  totalFee,
  totalSteps,
  type V4PoolStep,
  type V4ScoopInfo,
  type V4ScoopOrder,
} from "@/utils/protocols/sundae";

interface SundaeV4ScoopBannerProps {
  scoop: V4ScoopInfo;
}

function OrderRow({ order }: { order: V4ScoopOrder }) {
  const given = (order.payoutDelta ?? []).filter((d) => d.amount < BigInt(0));
  const received = (order.payoutDelta ?? []).filter((d) => d.amount > BigInt(0));

  return (
    <>
      <tr>
        <td>{order.orderIndex}</td>
        <td>#{order.bodyInputIndex}</td>
        <td>
          <span className="tcv-sundae-v4-order-kind">{order.kind}</span>
          {order.redeemer?.kind === "Cancel" && (
            <span className="tcv-sundae-status warning">cancel</span>
          )}
        </td>
        <td>{orderConstraintLabel(order)}</td>
        <td>
          {order.payoutOutputIndex === null ? (
            <span className="tcv-sundae-estimate-dim">—</span>
          ) : (
            <>
              #{order.payoutOutputIndex}
              {order.isContinuation && (
                <span className="tcv-sundae-status ok">partial</span>
              )}
            </>
          )}
        </td>
        <td>
          {order.feeDeducted === null ? (
            <span className="tcv-sundae-estimate-dim">—</span>
          ) : (
            <span className="tcv-ada-amount">
              ₳ {formatAda(order.feeDeducted.toString())}
            </span>
          )}
        </td>
      </tr>
      {order.payoutDelta && order.payoutDelta.length > 0 && (
        <tr className="tcv-sundae-v4-order-flow-row">
          <td />
          <td colSpan={5}>
            <span className="tcv-sundae-v4-flow-inline">
              {given.map((g, i) => (
                <React.Fragment key={`g${i}`}>
                  {i > 0 && <span className="tcv-sundae-estimate-dim">+</span>}
                  <V4AssetValue asset={g.asset} amount={-g.amount} />
                </React.Fragment>
              ))}
              {given.length === 0 && <span className="tcv-sundae-estimate-dim">nothing</span>}
              <span className="tcv-sundae-arrow">→</span>
              {received.map((r, i) => (
                <React.Fragment key={`r${i}`}>
                  {i > 0 && <span className="tcv-sundae-estimate-dim">+</span>}
                  <V4AssetValue asset={r.asset} amount={r.amount} />
                </React.Fragment>
              ))}
              {received.length === 0 && (
                <span className="tcv-sundae-estimate-dim">nothing</span>
              )}
            </span>
          </td>
        </tr>
      )}
      {order.parseError && (
        <tr className="tcv-sundae-v4-order-flow-row">
          <td />
          <td colSpan={5}>
            <span className="tcv-sundae-estimate-dim">{order.parseError}</span>
          </td>
        </tr>
      )}
    </>
  );
}

function StepRow({ step, poolIndex }: { step: V4PoolStep; poolIndex: number }) {
  return (
    <tr>
      <td>#{poolIndex}</td>
      <td>{step.stepIndex}</td>
      <td>{String(step.operationTag)}</td>
      <td>
        <span className="tcv-sundae-v4-flow-inline">
          {step.deltas.length === 0 ? (
            <span className="tcv-sundae-estimate-dim">no reserve change</span>
          ) : (
            step.deltas.map((d, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="tcv-sundae-estimate-dim">·</span>}
                <V4AssetValue asset={d.asset} amount={d.amount} signed />
              </React.Fragment>
            ))
          )}
        </span>
      </td>
      <td>
        <span className="tcv-ada-amount">₳ {formatAda(step.feeBudget.toString())}</span>
      </td>
    </tr>
  );
}

export function SundaeV4ScoopBanner({ scoop }: SundaeV4ScoopBannerProps) {
  const orderCount = scoop.orders.length;
  const scoopedCount = scoop.orders.filter((o) => o.redeemer?.kind !== "Cancel").length;
  const cancelCount = orderCount - scoopedCount;
  const steps = totalSteps(scoop);
  const fee = totalFee(scoop);

  // A transaction that only cancels an order is not a scoop; say what it is.
  const isCancelOnly = scoop.pools.length === 0 && cancelCount > 0;

  // Pool LP tokens and NFTs are CIP-68 names over the pool identifier; the
  // deployment's mint policy is what lets them be named rather than shown raw.
  const poolMintPolicy =
    getV4Deployment(scoop.network).byTitle["pool.mint"] ?? null;

  // A busy scoop outgrows the transaction pane: six pools of parallel lanes
  // scroll sideways in a column that is a third of the window. Maximizing
  // hands the whole viewport to the graph, and the graph re-measures itself
  // because its container resized.
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    document.addEventListener("keydown", onKey);
    // Stop the page behind the overlay from scrolling with it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [maximized]);

  return (
    <V4PoolMintContext.Provider value={poolMintPolicy}>
    {maximized && (
      <div
        className="tcv-sundae-v4-backdrop"
        onClick={() => setMaximized(false)}
        aria-hidden
      />
    )}
    <div
      className={`tcv-sundae-scoop-banner${maximized ? " tcv-sundae-v4-maximized" : ""}`}
      role={maximized ? "dialog" : undefined}
      aria-modal={maximized || undefined}
      aria-label={maximized ? "Sundae V4 scoop, maximized" : undefined}
    >
      <div className="tcv-sundae-scoop-banner-header">
        <span className="tcv-sundae-icon" aria-hidden>
          🍨
        </span>
        <span className="tcv-sundae-scoop-banner-title">
          Sundae V4 {isCancelOnly ? "Order Cancel" : "Scoop"}
        </span>
        {!isCancelOnly && (
          <span className="tcv-sundae-scoop-banner-count">
            {scoopedCount} order{scoopedCount === 1 ? "" : "s"}
            {cancelCount > 0 && ` · ${cancelCount} cancelled`}
            {" · "}
            {scoop.pools.length} pool{scoop.pools.length === 1 ? "" : "s"}
            {" · "}
            {steps} step{steps === 1 ? "" : "s"}
          </span>
        )}
        <span className="tcv-sundae-scoop-banner-meta">
          {scoop.network}
          {fee !== null && ` · fee ₳ ${formatAda(fee.toString())}`}
        </span>
        <button
          type="button"
          className="tcv-sundae-v4-maximize"
          onClick={() => setMaximized((m) => !m)}
          title={maximized ? "Restore (Esc)" : "Maximize"}
          aria-label={maximized ? "Restore scoop view" : "Maximize scoop view"}
        >
          {maximized ? "⤡" : "⤢"}
        </button>
      </div>

      {scoop.issues.length > 0 && (
        <div className="tcv-sundae-issues">
          {scoop.issues.map((issue, i) => (
            <div className="tcv-sundae-issue tcv-sundae-issue-warning" key={i}>
              <span className="tcv-sundae-issue-icon" aria-hidden>
                ⚠
              </span>
              <span>{issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* The graph earns its place once there is something to connect: a pool
          step and an order. A bare cancel has neither. */}
      {scoop.pools.length > 0 && scoopedCount > 0 && (
        <SundaeV4ScoopGraph scoop={scoop} />
      )}

      {orderCount > 0 && (
        <details className="tcv-sundae-scoop-banner-detail" open={orderCount <= 6}>
          <summary title="In the batch manifest's order, which follows the script context's sorted inputs.">
            Orders · {orderCount}
          </summary>
          <table className="tcv-sundae-scoop-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Input</th>
                <th>Kind</th>
                <th>Constraint</th>
                <th>Payout</th>
                <th>Fee</th>
              </tr>
            </thead>
            <tbody>
              {scoop.orders.map((order) => (
                <OrderRow key={order.orderIndex} order={order} />
              ))}
            </tbody>
          </table>
        </details>
      )}

      {scoop.pools.length > 0 && (
        <details className="tcv-sundae-scoop-banner-detail">
          <summary>
            Pool transcripts · {steps} step{steps === 1 ? "" : "s"} across{" "}
            {scoop.pools.length} pool{scoop.pools.length === 1 ? "" : "s"}
          </summary>

          {scoop.pools.map((pool) => (
            <div className="tcv-sundae-v4-pool-block" key={pool.bodyInputIndex}>
              <div className="tcv-sundae-row">
                <span className="tcv-sundae-leg-label">Pool</span>
                <span className="tcv-sundae-mono">
                  <HashWithTooltip hash={pool.datum.identifier} />
                </span>
                <span className="tcv-sundae-estimate-dim">
                  input #{pool.bodyInputIndex}
                  {pool.poolOutputIndex !== null && ` → output #${pool.poolOutputIndex}`}
                  {" · "}
                  {describePoolRedeemer(pool.redeemer)}
                </span>
              </div>
              {pool.steps.length === 0 ? (
                <div className="tcv-sundae-row">
                  <span className="tcv-sundae-estimate-dim">
                    {pool.redeemer.kind === "Action"
                      ? "The transcript did not decode; a module may use a shape this build does not know."
                      : "This spend is not a scoop, so it carries no transcript."}
                  </span>
                </div>
              ) : (
                <table className="tcv-sundae-scoop-table">
                  <thead>
                    <tr>
                      <th>Pool</th>
                      <th>Step</th>
                      <th>Op</th>
                      <th title="Stated from the order's side: positive means the asset left the pool. LP is the other way round, since newly minted LP flows out to a depositor.">
          Reserve change
        </th>
                      <th>Fee budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pool.steps.map((step) => (
                      <StepRow
                        key={step.stepIndex}
                        step={step}
                        poolIndex={pool.bodyInputIndex}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

        </details>
      )}

      {scoop.manifest && (
        <details className="tcv-sundae-scoop-banner-detail">
          <summary title="Entries pair one-to-one with the order inputs in the script context's sorted order, which is why the numbering here can differ from the body input numbering.">
            Batch manifest · {scoop.manifest.entries.length} entr
            {scoop.manifest.entries.length === 1 ? "y" : "ies"}
          </summary>
          <table className="tcv-sundae-scoop-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Output</th>
                <th>Config</th>
              </tr>
            </thead>
            <tbody>
              {scoop.manifest.entries.map((entry, i) => {
                const config = scoop.manifest!.configs[Number(entry.configIndex)];
                return (
                  <tr key={i}>
                    <td>{i}</td>
                    <td>#{String(entry.outputIndex)}</td>
                    <td>
                      {config ? (
                        <span title={config.token}>
                          ref input #{String(config.refIndex)} ·{" "}
                          {truncateHash(config.token, 8, 4)}
                        </span>
                      ) : (
                        <span className="tcv-sundae-estimate-dim">
                          index {String(entry.configIndex)} is not in the config list
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}

      {scoop.pools.length > 0 && <SundaeV4ScoopBalance scoop={scoop} />}
    </div>
    </V4PoolMintContext.Provider>
  );
}
