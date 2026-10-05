"use client";

// The scoop drawn as a flow graph: orders on the left, the pool transcript
// steps they fed in the middle, and the same orders on the right receiving
// their payouts.
//
// Layout follows the Sundae DEX's route picker (dex-v2 RoutePicker/PlanChain):
// flexbox places the nodes, then the edges are traced as SVG curves over the
// nodes' MEASURED boxes and re-measured whenever the container resizes. Doing
// it that way means a node can be any width — an asset name, a pool ident —
// without the edge geometry needing to know.
//
// Edge style carries the evidence, which matters more here than in the DEX. A
// solid edge was declared by a route constraint. A dashed edge was deduced:
// only one pool step moved that asset in at least that amount, so only one
// pairing was possible. A dotted edge is an order's own measured payout, drawn
// when nothing ties it to a particular step. The legend says so, because a
// reader who assumes a dashed edge is a fact would be over-reading the
// transaction.

import React from "react";
import { V4AssetName, V4AssetValue } from "./SundaeV4Asset";
import { truncateHash } from "../utils";
import {
  buildV4ScoopGraph,
  type V4EdgeBasis,
  type V4GraphEdge,
  type V4ScoopGraph,
  type V4ScoopInfo,
} from "@/utils/protocols/sundae";

interface SundaeV4ScoopGraphProps {
  scoop: V4ScoopInfo;
}

interface TracedEdge {
  d: string;
  edge: V4GraphEdge;
  width: number;
}

const BASIS_CLASS: Record<V4EdgeBasis, string> = {
  declared: "tcv-sundae-v4-edge-declared",
  transcript: "tcv-sundae-v4-edge-transcript",
  deduced: "tcv-sundae-v4-edge-deduced",
  observed: "tcv-sundae-v4-edge-observed",
};

/**
 * Stroke width from this edge's share of the largest flow OF THE SAME ASSET.
 *
 * Normalising across every asset made the widest line whichever token had the
 * largest raw number — 19 billion of a 0-decimal token drew thick while 5 ADA
 * drew hairline, which says nothing about either. Amounts are only comparable
 * within one asset, so that is the only place thickness carries meaning: where
 * an order splits across pools, the branches show their relative sizes.
 */
function edgeWidth(amount: bigint, max: bigint): number {
  if (max <= BigInt(0)) return 2;
  const share = Number((amount * BigInt(1000)) / max) / 1000;
  return 1.4 + Math.sqrt(Math.max(share, 0)) * 1.8;
}

export function SundaeV4ScoopGraph({ scoop }: SundaeV4ScoopGraphProps) {
  const graph = React.useMemo(() => buildV4ScoopGraph(scoop), [scoop]);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const nodeRefs = React.useRef(new Map<string, HTMLElement>());
  const setNodeRef = React.useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) nodeRefs.current.set(key, el);
      else nodeRefs.current.delete(key);
    },
    [],
  );

  const [traced, setTraced] = React.useState<TracedEdge[]>([]);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  // Largest flow per asset, so widths compare like with like.
  const maxByAsset = React.useMemo(() => {
    const max = new Map<string, bigint>();
    for (const e of graph.edges) {
      const key = `${e.asset.policyId}.${e.asset.assetName}`;
      if (e.amount > (max.get(key) ?? BigInt(0))) max.set(key, e.amount);
    }
    return max;
  }, [graph.edges]);

  const measure = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();
    const next: TracedEdge[] = [];
    for (const edge of graph.edges) {
      const from = nodeRefs.current.get(edge.from)?.getBoundingClientRect();
      const to = nodeRefs.current.get(edge.to)?.getBoundingClientRect();
      if (!from || !to) continue;
      const x1 = from.right - base.left;
      const y1 = from.top - base.top + from.height / 2;
      const x2 = to.left - base.left;
      const y2 = to.top - base.top + to.height / 2;
      // Pull the control points horizontally so the curve leaves and enters
      // each node flat, which keeps parallel edges from overlapping at the box.
      const dx = Math.max((x2 - x1) / 2, 8);
      next.push({
        d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
        edge,
        width: edgeWidth(
          edge.amount,
          maxByAsset.get(`${edge.asset.policyId}.${edge.asset.assetName}`) ?? BigInt(0),
        ),
      });
    }
    // Bail out when nothing moved: allocating fresh objects every measure would
    // re-render, which re-measures, which loops.
    setTraced((prev) =>
      prev.length === next.length &&
      prev.every((p, i) => p.d === next[i].d && p.edge === next[i].edge)
        ? prev
        : next,
    );
    setSize((prev) =>
      prev.w === base.width && prev.h === base.height
        ? prev
        : { w: base.width, h: base.height },
    );
  }, [graph.edges, maxByAsset]);

  React.useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    // Coalesce observer bursts into one measure per frame.
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [measure]);

  // With no edge there is no flow to draw, and a column of disconnected boxes
  // says less than the tables below it.
  if (graph.edges.length === 0) return null;

  return (
    <div className="tcv-sundae-v4-graph">
      <div className="tcv-sundae-v4-graph-scroll">
        <div className="tcv-sundae-v4-graph-canvas" ref={containerRef}>
          <svg
            className="tcv-sundae-v4-graph-edges"
            width={size.w}
            height={size.h}
            aria-hidden
          >
            {traced.map((t, i) => (
              <path
                key={i}
                d={t.d}
                className={BASIS_CLASS[t.edge.basis]}
                strokeWidth={t.width}
                fill="none"
              />
            ))}
          </svg>

          {/* One grid cell per (column, row): a node keeps the height of what
              it connects to instead of being centred in its own column. */}
          {graph.columns.map((column, columnIndex) =>
            column.map((id) => (
              <div
                className="tcv-sundae-v4-graph-cell"
                key={id}
                style={{
                  gridColumn: columnIndex + 1,
                  gridRow: (graph.rows.get(id) ?? 0) + 1,
                }}
              >
                <GraphNode id={id} graph={graph} setNodeRef={setNodeRef} />
              </div>
            )),
          )}
        </div>
      </div>

      <GraphLegend graph={graph} />
    </div>
  );
}

function GraphNode({
  id,
  graph,
  setNodeRef,
}: {
  id: string;
  graph: V4ScoopGraph;
  setNodeRef: (key: string) => (el: HTMLElement | null) => void;
}) {
  const node = graph.nodes.get(id);
  // Does this step's pool contribute more than one step to the drawing?
  const sharesPool =
    node?.kind === "step" &&
    [...graph.nodes.values()].filter(
      (n) => n.kind === "step" && n.poolSortedInputIndex === node.poolSortedInputIndex,
    ).length > 1;
  if (!node) return null;

  if (node.kind === "order") {
    return (
      <div
        className={`tcv-sundae-v4-node tcv-sundae-v4-node-order tcv-sundae-v4-node-${node.side}`}
        ref={setNodeRef(id)}
      >
        <span className="tcv-sundae-v4-node-kind">{node.label}</span>
        <span className="tcv-sundae-v4-node-sub">
          {node.side === "in" ? `input #${node.bodyInputIndex}` : "payout"}
        </span>
      </div>
    );
  }

  if (node.kind === "asset") {
    return (
      <div className="tcv-sundae-v4-node tcv-sundae-v4-node-asset" ref={setNodeRef(id)}>
        <V4AssetValue asset={node.asset} amount={node.amount} />
      </div>
    );
  }

  return (
    <div className="tcv-sundae-v4-node tcv-sundae-v4-node-step" ref={setNodeRef(id)}>
      <span className="tcv-sundae-v4-node-kind" title={node.poolIdentifier}>
        {truncateHash(node.poolIdentifier, 6, 4)}
        {/* A step index counts within one pool's own transcript, so it only
            tells the reader anything when that pool appears more than once.
            Three pools each showing "Step 0" said nothing. */}
        {sharesPool && (
          <span className="tcv-sundae-v4-node-tag">step {node.stepIndex}</span>
        )}
      </span>
      <span className="tcv-sundae-v4-node-sub">
        input #{node.poolBodyInputIndex}
        {node.operationTag !== BigInt(0) && ` · op ${node.operationTag}`}
      </span>
    </div>
  );
}

const BASIS_LABEL: Record<V4EdgeBasis, { text: string; tip: string }> = {
  declared: {
    text: "routed",
    tip: "A route constraint on the order named this pool step.",
  },
  transcript: {
    text: "claimed",
    tip: "The pool step's own operation payload names this order.",
  },
  deduced: {
    text: "inferred",
    tip: "Nothing named the order. One step both takes what it gave and returns what it received, leaving a single possibility.",
  },
  observed: { text: "measured", tip: "A value change measured from the transaction." },
};

function GraphLegend({ graph }: { graph: V4ScoopGraph }) {
  const bases = [...new Set(graph.edges.map((e) => e.basis))];
  const unresolved = graph.unresolvedRouteOrderIndices;
  const unlinked = graph.unlinkedOrderIndices.filter((i) => !unresolved.includes(i));

  return (
    <div className="tcv-sundae-v4-graph-legend">
      {bases.map((basis) => (
        <span
          className="tcv-sundae-v4-legend-item"
          key={basis}
          title={BASIS_LABEL[basis].tip}
        >
          <svg width="22" height="8" aria-hidden>
            <path d="M1,4 L21,4" className={BASIS_CLASS[basis]} strokeWidth="2" />
          </svg>
          {BASIS_LABEL[basis].text}
        </span>
      ))}
      {unlinked.length > 0 && (
        <span
          className="tcv-sundae-v4-legend-item tcv-sundae-v4-legend-muted"
          title="Nothing in a basic or swap order names the pool step that filled it, and the assets did not single one out. The order is in the table below."
        >
          {unlinked.length} order{unlinked.length === 1 ? "" : "s"} unattributed
        </span>
      )}
      {unresolved.length > 0 && (
        <span
          className="tcv-sundae-v4-legend-item tcv-sundae-v4-legend-warn"
          title="The order's route constraint names a pool step this transaction does not contain. Compare it against the pool transcripts below."
        >
          ⚠ route not found for order{unresolved.length === 1 ? "" : "s"}{" "}
          {unresolved.join(", ")}
        </span>
      )}
    </div>
  );
}

/**
 * Per-asset reconciliation of the two sides of the scoop. A non-zero difference
 * is normal — the service fee leaves as ADA and the scooper keeps the surplus —
 * so this reports the figure rather than flagging it.
 */
export function SundaeV4ScoopBalance({ scoop }: { scoop: V4ScoopInfo }) {
  const graph = React.useMemo(() => buildV4ScoopGraph(scoop), [scoop]);
  if (graph.balance.length === 0) return null;

  return (
    <details className="tcv-sundae-v4-details">
      <summary>Value reconciliation · {graph.balance.length} assets</summary>
      <table className="tcv-sundae-scoop-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Pools released</th>
            <th>Orders received</th>
            <th title="What the pools released less what the orders received. The service fee leaves the orders as ADA and a scooper may take the pool's surplus, so a difference is not by itself a defect.">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {graph.balance.map((row) => (
            <tr key={`${row.asset.policyId}.${row.asset.assetName}`}>
              <td>
                <V4AssetName asset={row.asset} />
              </td>
              <td>
                <V4AssetValue asset={row.asset} amount={row.poolsNet} signed />
              </td>
              <td>
                <V4AssetValue asset={row.asset} amount={row.ordersNet} signed />
              </td>
              <td>
                {row.difference === BigInt(0) ? (
                  <span className="tcv-sundae-status ok">balanced</span>
                ) : (
                  <V4AssetValue asset={row.asset} amount={row.difference} signed />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
