"use client";

import React from "react";
import type { SundaeScoopInfo, V3Order } from "@/utils/protocols/sundae";

interface SundaeScoopBannerProps {
  scoop: SundaeScoopInfo;
}

function summarizeOrder(order: V3Order): string {
  switch (order.kind) {
    case "Swap":
      return `Swap ${order.offer.amount.toString()} → ≥${order.minReceived.amount.toString()}`;
    case "Deposit":
      return `Deposit (${order.assets[0].amount.toString()} / ${order.assets[1].amount.toString()})`;
    case "Withdrawal":
      return `Withdraw ${order.lpAmount.amount.toString()} LP`;
    case "Donation":
      return `Donation (${order.assets[0].amount.toString()} / ${order.assets[1].amount.toString()})`;
    case "Record":
      return `Record (policy ${order.policy.policyId.slice(0, 8)}…)`;
    case "Strategy":
      return `Strategy (${order.auth.kind})`;
  }
}

function shortHash(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function describeBound(b: { kind: "NegativeInfinity" } | { kind: "PositiveInfinity" } | { kind: "Finite"; time: bigint }): string {
  if (b.kind === "Finite") return b.time.toString();
  if (b.kind === "NegativeInfinity") return "-∞";
  return "+∞";
}

export function SundaeScoopBanner({ scoop }: SundaeScoopBannerProps) {
  const orderCount = scoop.orders.length;
  const strategyCount = scoop.orders.filter((o) => o.hasStrategy).length;

  return (
    <div className="tcv-sundae-scoop-banner">
      <div className="tcv-sundae-scoop-banner-header">
        <span className="tcv-sundae-icon" aria-hidden>🍨</span>
        <span className="tcv-sundae-scoop-banner-title">
          Sundae {scoop.match.protocol} Scoop
        </span>
        <span className="tcv-sundae-scoop-banner-count">
          {orderCount} order{orderCount === 1 ? "" : "s"}
          {strategyCount > 0 && ` · ${strategyCount} strategy`}
        </span>
        <span className="tcv-sundae-scoop-banner-meta">
          pool input #{scoop.poolInputIndex} · signatory idx {scoop.signatoryIndex} · scooper idx {scoop.scooperIndex}
        </span>
      </div>
      <details className="tcv-sundae-scoop-banner-detail">
        <summary>Order processing sequence</summary>
        <table className="tcv-sundae-scoop-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Sorted idx</th>
              <th>Body idx</th>
              <th>Strategy</th>
              <th>Payout hint</th>
            </tr>
          </thead>
          <tbody>
            {scoop.orders.map((o, i) => (
              <React.Fragment key={i}>
                <tr>
                  <td>{i}</td>
                  <td>{o.sortedInputIndex}</td>
                  <td>{o.bodyInputIndex ?? "—"}</td>
                  <td>{o.hasStrategy ? "yes" : ""}</td>
                  <td>{o.payoutHint}</td>
                </tr>
                {o.strategy && (
                  <tr className="tcv-sundae-scoop-strategy-row">
                    <td></td>
                    <td colSpan={4}>
                      <div className="tcv-sundae-scoop-strategy">
                        <span className="tcv-sundae-leg-label">Resolves to</span>
                        <span className="tcv-sundae-mono">
                          {summarizeOrder(o.strategy.execution.details)}
                        </span>
                        <span className="tcv-sundae-estimate-dim">
                          tx ref {shortHash(o.strategy.execution.txRef.transactionId)}#{o.strategy.execution.txRef.outputIndex.toString()}
                        </span>
                        <span className="tcv-sundae-estimate-dim">
                          valid {describeBound(o.strategy.execution.validityRange.lowerBound.bound)}–{describeBound(o.strategy.execution.validityRange.upperBound.bound)}
                        </span>
                        <span className="tcv-sundae-estimate-dim">
                          {o.strategy.signature ? `signed ${shortHash(o.strategy.signature, 8, 6)}` : "unsigned"}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
