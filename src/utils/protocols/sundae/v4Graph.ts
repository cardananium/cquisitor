// A flow graph for a V4 scoop: which orders fed which pool steps, and what
// moved between them.
//
// The layered-DAG shape is borrowed from the Sundae DEX's route picker
// (dex-v2 src/components/RoutePicker/planLayout.ts): nodes fall into columns,
// pools that emit the same asset merge into one junction, and the junction
// re-splits across the pools that consume it, so a many-to-many hop reads as a
// funnel instead of a crossing mesh.
//
// What is DIFFERENT here is the certainty of the input. The DEX lays out a plan
// it built itself, so it knows every edge. An inspector is handed a finished
// transaction and must not invent edges the transaction does not state:
//
//   * A route constraint states an order's path outright — pool input index and
//     transcript step index per hop. Those edges are facts.
//   * Without one, a basic or swap order's constraint only checks the order's
//     OWN value change. Nothing ties it to a particular pool step. The link can
//     sometimes be deduced (one step moved that asset, in that amount, and only
//     one order asked for it) and otherwise cannot.
//
// So every edge carries a `basis` saying where it came from, and the renderer
// draws a deduced edge differently from a declared one. An edge we cannot
// justify is not drawn at all; the order and the step still appear, unlinked.

import { asInt, isBytes, isConstr, isInt, isList, type AssetClass, type PD } from "./plutusData";
import type { V4AssetEntry } from "./v4";
import { isAda } from "./v4";
import type { V4PoolStep, V4ScoopInfo, V4ScoopOrder } from "./v4Scoop";

export type V4NodeId = string;

/** An order, drawn once on the left as a source and once on the right as a sink. */
export interface V4OrderNode {
  kind: "order";
  id: V4NodeId;
  /** Index into `scoop.orders`. */
  orderIndex: number;
  /** Body input index, which is what the UI numbers inputs by. */
  bodyInputIndex: number;
  /** "Swap", "Deposit", … */
  label: string;
  /** Left column (what the order contributes) or right (what it receives). */
  side: "in" | "out";
}

/** One transcript step of one pool. */
export interface V4StepNode {
  kind: "step";
  id: V4NodeId;
  /** Body input index of the pool this step belongs to. */
  poolBodyInputIndex: number;
  /** Sorted input index, which is what redeemers and routes reference. */
  poolSortedInputIndex: number;
  /** Position in that pool's transcript. */
  stepIndex: number;
  /** Pool identifier, truncated by the renderer. */
  poolIdentifier: string;
  /** Module operation tag the step recorded. */
  operationTag: bigint;
}

/** An asset moving between an order and a step, or between two steps. */
export interface V4AssetNode {
  kind: "asset";
  id: V4NodeId;
  asset: AssetClass;
  /** Total flowing through this junction. */
  amount: bigint;
}

export type V4GraphNode = V4OrderNode | V4StepNode | V4AssetNode;

/**
 * Why we believe an edge exists, strongest first.
 *   declared   — a route constraint named this pool step for this order.
 *   transcript — the pool step's own operation payload names this order.
 *   deduced    — no one said, but one step both takes what the order gave and
 *                returns what it received, leaving one possibility.
 *   observed   — the order's measured payout, with no step attributable.
 */
export type V4EdgeBasis = "declared" | "transcript" | "deduced" | "observed";

export interface V4GraphEdge {
  from: V4NodeId;
  to: V4NodeId;
  asset: AssetClass;
  /** Always positive — direction lives in `from`/`to`. */
  amount: bigint;
  basis: V4EdgeBasis;
}

export interface V4ScoopGraph {
  nodes: Map<V4NodeId, V4GraphNode>;
  edges: V4GraphEdge[];
  /** Node ids per column, left to right. */
  columns: V4NodeId[][];
  /**
   * The row each node occupies, shared across columns so a node sits level with
   * what it connects to. Without it a sparse column centres against the tallest
   * one, and a multi-hop chain drifts toward the middle of the drawing with
   * every hop instead of running straight across from its source.
   */
  rows: Map<V4NodeId, number>;
  /** True when at least one order declared a route. */
  hasDeclaredRoutes: boolean;
  /**
   * Orders whose link to a pool step could not be established. Listed so the
   * UI can say so rather than implying the graph is complete.
   */
  unlinkedOrderIndices: number[];
  /**
   * Orders that declared a route naming a pool step this transaction does not
   * contain. A transaction like that would not have validated on chain, so this
   * being non-empty points at either a decode problem or a malformed route —
   * either way something to show, not to smooth over.
   */
  unresolvedRouteOrderIndices: number[];
  /**
   * Per-asset reconciliation across the whole scoop: what the orders received
   * net, what the pools released net, and the difference. A non-zero difference
   * is not necessarily a defect — the service fee leaves as ADA and the scooper
   * takes a surplus — but it is the number worth showing.
   */
  balance: V4AssetBalance[];
}

export interface V4AssetBalance {
  asset: AssetClass;
  /** Net change across all order payouts (positive = orders gained). */
  ordersNet: bigint;
  /** Net released by pool steps (positive = left the pools). */
  poolsNet: bigint;
  /** `poolsNet − ordersNet`. Zero means the two sides account for each other. */
  difference: bigint;
}

function assetKey(a: AssetClass): string {
  return `${a.policyId}.${a.assetName}`;
}

/**
 * An order's value change with the service fee removed from the ADA leg, so an
 * edge shows the trade and not the fee.
 *
 * The fee leaves the order as ADA, which makes the raw ADA delta the trade leg
 * MINUS the fee. The on-chain checks correct for this the same way — swap's
 * `check_fill_ratio` and `order_lib.check_min_received_gross` both add
 * `fee_deducted` back to the ADA entry before comparing. An ADA entry that
 * nets to zero afterwards was pure fee and is dropped.
 */
function tradeDeltas(order: V4ScoopOrder): V4AssetEntry[] {
  const deltas = order.payoutDelta ?? [];
  if (order.feeDeducted === null || order.feeDeducted === BigInt(0)) return deltas;
  const out: V4AssetEntry[] = [];
  for (const d of deltas) {
    if (!isAda(d.asset)) {
      out.push(d);
      continue;
    }
    const adjusted = d.amount + order.feeDeducted;
    if (adjusted !== BigInt(0)) out.push({ asset: d.asset, amount: adjusted });
  }
  return out;
}

const orderNodeId = (i: number, side: "in" | "out") => `o${i}:${side}`;
const stepNodeId = (poolSorted: number, step: number) => `s${poolSorted}.${step}`;
const assetNodeId = (boundary: number, a: AssetClass) =>
  `a${boundary}:${assetKey(a)}`;

/** Flatten every pool's steps into one list, tagged with its pool. */
interface FlatStep {
  step: V4PoolStep;
  poolBodyInputIndex: number;
  poolSortedInputIndex: number;
  poolIdentifier: string;
}

function flatSteps(scoop: V4ScoopInfo): FlatStep[] {
  const out: FlatStep[] = [];
  for (const pool of scoop.pools) {
    for (const step of pool.steps) {
      out.push({
        step,
        poolBodyInputIndex: pool.bodyInputIndex,
        poolSortedInputIndex: pool.sortedInputIndex,
        poolIdentifier: pool.datum.identifier,
      });
    }
  }
  return out;
}

/**
 * Build the flow graph for a scoop. Pure — it reads the reconstruction and adds
 * no chain lookups of its own.
 */
export function buildV4ScoopGraph(scoop: V4ScoopInfo): V4ScoopGraph {
  const nodes = new Map<V4NodeId, V4GraphNode>();
  const edges: V4GraphEdge[] = [];
  const steps = flatSteps(scoop);

  // Index steps by (sorted pool input, step) so a route can resolve its hops.
  const stepByRef = new Map<string, FlatStep>();
  for (const f of steps) {
    stepByRef.set(`${f.poolSortedInputIndex}.${f.step.stepIndex}`, f);
  }

  // --- Nodes: steps, and each order twice (source and sink) ---
  for (const f of steps) {
    const id = stepNodeId(f.poolSortedInputIndex, f.step.stepIndex);
    nodes.set(id, {
      kind: "step",
      id,
      poolBodyInputIndex: f.poolBodyInputIndex,
      poolSortedInputIndex: f.poolSortedInputIndex,
      stepIndex: f.step.stepIndex,
      poolIdentifier: f.poolIdentifier,
      operationTag: f.step.operationTag,
    });
  }

  const scooped = scoop.orders.filter((o) => o.redeemer?.kind !== "Cancel");
  for (const o of scooped) {
    for (const side of ["in", "out"] as const) {
      const id = orderNodeId(o.orderIndex, side);
      nodes.set(id, {
        kind: "order",
        id,
        orderIndex: o.orderIndex,
        bodyInputIndex: o.bodyInputIndex,
        label: o.kind,
        side,
      });
    }
  }

  // --- Edges ---
  const linked = new Set<number>();
  // Orders whose declared route names a step this transaction does not contain.
  const unresolvedRoutes: number[] = [];
  let hasDeclaredRoutes = false;

  for (const o of scooped) {
    if (!o.route || o.route.length === 0) continue;
    hasDeclaredRoutes = true;
    const chain: FlatStep[] = [];
    let missing = false;
    for (const hop of o.route) {
      const f = stepByRef.get(`${hop.poolInputIndex}.${hop.transcriptStepIndex}`);
      if (f) chain.push(f);
      else missing = true;
    }
    if (missing) {
      // The order stated a path, and part of it does not exist among the pool
      // transcripts present. Deduction must not paper over that: an order with
      // a route is exactly the case where guessing would hide a real
      // discrepancy, so it stays unlinked and is reported.
      unresolvedRoutes.push(o.orderIndex);
      continue;
    }
    if (chain.length === 0) continue;
    linked.add(o.orderIndex);
    addDeclaredChain(nodes, edges, o, chain, "declared");
  }

  // Steps the transcripts themselves attribute to an order, which is the usual
  // case: every module deployed so far records the order's output reference in
  // its operation payload.
  const claimed = stepsByOrder(scooped, steps);
  for (const o of scooped) {
    if (linked.has(o.orderIndex)) continue;
    if (unresolvedRoutes.includes(o.orderIndex)) continue;
    const mine = claimed.get(o.orderIndex);
    if (!mine || mine.length === 0) continue;
    linked.add(o.orderIndex);
    addDeclaredChain(nodes, edges, o, orderChain(o, mine), "transcript");
  }

  // Nothing named the order, so fall back to the assets. Only a step that both
  // absorbs what the order gave and releases what it received can be the whole
  // story; a step matching only one side would mean the order routed through
  // somewhere else too, and drawing it as the single hop would be wrong.
  for (const o of scooped) {
    if (linked.has(o.orderIndex)) continue;
    if (unresolvedRoutes.includes(o.orderIndex)) continue;
    const deduced = deduceStepFor(o, steps);
    if (!deduced) continue;
    linked.add(o.orderIndex);
    addPairEdges(nodes, edges, o, deduced, "deduced");
  }

  const unlinkedOrderIndices = scooped
    .filter((o) => !linked.has(o.orderIndex))
    .map((o) => o.orderIndex);

  // An unlinked order gets no edge. Drawing its payout as a line from its own
  // input to its own output put a stroke straight through the step column,
  // which reads as a path through those steps — the opposite of what an
  // unattributed order means. The order still appears as a node, and the Orders
  // table carries what it gave and received.
  for (const orderIndex of unlinkedOrderIndices) {
    for (const side of ["in", "out"] as const) {
      nodes.delete(orderNodeId(orderIndex, side));
    }
  }
  // A node with no edge on either side would float in a column of its own, so
  // an order that could not be attributed is left out of the drawing entirely.

  const columns = layoutColumns(nodes, edges);
  return {
    nodes,
    edges,
    columns,
    rows: assignRows(columns, edges),
    hasDeclaredRoutes,
    unlinkedOrderIndices,
    unresolvedRouteOrderIndices: unresolvedRoutes,
    balance: reconcile(scooped, steps),
  };
}

/**
 * Wire an order through a declared route: the order feeds the first hop, each
 * hop feeds the next through an asset junction, and the last hop pays the
 * order out. Intermediate assets become junction nodes so two orders crossing
 * the same hop share one.
 */
function addDeclaredChain(
  nodes: Map<V4NodeId, V4GraphNode>,
  edges: V4GraphEdge[],
  order: V4ScoopOrder,
  chain: FlatStep[],
  basis: V4EdgeBasis,
): void {
  const deltas = tradeDeltas(order);
  const given = deltas.filter((d) => d.amount < BigInt(0));
  const received = deltas.filter((d) => d.amount > BigInt(0));
  const idOf = (f: FlatStep) => stepNodeId(f.poolSortedInputIndex, f.step.stepIndex);
  const absorbs = (f: FlatStep, asset: AssetClass) =>
    f.step.deltas.find(
      (d) => assetKey(d.asset) === assetKey(asset) && d.amount < BigInt(0),
    );

  // Wire step → step wherever one step's output is another's input, and record
  // which steps took part. The order's steps are not necessarily a line: a
  // scoop can route an order through pools in series, or split it across pools
  // of the same pair in parallel, or both at once. So the shape is derived from
  // what the steps actually move rather than assumed.
  const fed = new Set<V4NodeId>();
  const drained = new Set<V4NodeId>();

  // Pair what each step released with what another took. An order split across
  // pools can have two steps releasing the same asset and two taking it, and
  // matching on the asset alone would draw every combination — four edges where
  // two exist. The amounts settle it: a hop moves exactly what the previous hop
  // produced, so an exact magnitude match is paired off first and removed from
  // consideration. Only what is left over falls back to matching on asset.
  interface Half { index: number; f: FlatStep; asset: AssetClass; amount: bigint }
  const released: Half[] = [];
  const absorbed: Half[] = [];
  chain.forEach((f, index) => {
    for (const d of f.step.deltas) {
      if (d.amount > BigInt(0)) released.push({ index, f, asset: d.asset, amount: d.amount });
      else if (d.amount < BigInt(0)) absorbed.push({ index, f, asset: d.asset, amount: -d.amount });
    }
  });

  const used = new Set<Half>();
  const link = (from: Half, to: Half) => {
    const junction = ensureAssetNode(nodes, from.index + 1, from.asset, from.amount);
    pushEdge(edges, { from: idOf(from.f), to: junction, asset: from.asset, amount: from.amount, basis });
    pushEdge(edges, { from: junction, to: idOf(to.f), asset: to.asset, amount: to.amount, basis });
    fed.add(idOf(to.f));
    drained.add(idOf(from.f));
    used.add(from);
    used.add(to);
  };

  for (const exact of [true, false]) {
    for (const out of released) {
      if (used.has(out)) continue;
      const match = absorbed.find(
        (inn) =>
          !used.has(inn) &&
          inn.f !== out.f &&
          assetKey(inn.asset) === assetKey(out.asset) &&
          (!exact || inn.amount === out.amount),
      );
      if (match) link(out, match);
    }
  }

  // A step nothing upstream feeds takes its input from the order.
  for (const f of chain) {
    if (fed.has(idOf(f))) continue;
    for (const g of given) {
      if (!absorbs(f, g.asset)) continue;
      pushEdge(edges, {
        from: orderNodeId(order.orderIndex, "in"),
        to: idOf(f),
        asset: g.asset,
        amount: -g.amount,
        basis,
      });
    }
  }

  // A step nothing downstream drains pays the order out.
  for (const f of chain) {
    if (drained.has(idOf(f))) continue;
    for (const r of received) {
      const releases = f.step.deltas.some(
        (d) => assetKey(d.asset) === assetKey(r.asset) && d.amount > BigInt(0),
      );
      if (!releases) continue;
      pushEdge(edges, {
        from: idOf(f),
        to: orderNodeId(order.orderIndex, "out"),
        asset: r.asset,
        amount: r.amount,
        basis,
      });
    }
  }

  // The two sides are checked separately. An order can have its input wired and
  // its payout not — a withdraw whose final step only takes assets in, paying
  // the owner in LP the step's deltas do not carry — and a payout node with no
  // edge floats beside the drawing looking like an omission. Each side falls
  // back to the end of the chain nearest it.
  const inId = orderNodeId(order.orderIndex, "in");
  const outId = orderNodeId(order.orderIndex, "out");
  const hasInbound = edges.some((e) => e.from === inId);
  const hasOutbound = edges.some((e) => e.to === outId);
  if (chain.length === 0) return;

  if (!hasInbound) {
    const asset = given[0]?.asset ?? received[0]?.asset;
    if (asset) {
      // The first step is the one nothing upstream feeds, else the chain head.
      const entry = chain.find((f) => !fed.has(idOf(f))) ?? chain[0];
      pushEdge(edges, {
        from: inId,
        to: idOf(entry),
        asset,
        amount: given[0] ? -given[0].amount : received[0]!.amount,
        basis,
      });
    }
  }
  if (!hasOutbound) {
    const asset = received[0]?.asset ?? given[0]?.asset;
    if (asset) {
      const exit =
        [...chain].reverse().find((f) => !drained.has(idOf(f))) ??
        chain[chain.length - 1];
      pushEdge(edges, {
        from: idOf(exit),
        to: outId,
        asset,
        amount: received[0] ? received[0].amount : -given[0]!.amount,
        basis,
      });
    }
  }
}

/** Order ↔ one step, both directions, at a stated confidence. */
function addPairEdges(
  nodes: Map<V4NodeId, V4GraphNode>,
  edges: V4GraphEdge[],
  order: V4ScoopOrder,
  f: FlatStep,
  basis: V4EdgeBasis,
): void {
  const stepId = stepNodeId(f.poolSortedInputIndex, f.step.stepIndex);
  for (const d of tradeDeltas(order)) {
    if (d.amount < BigInt(0)) {
      pushEdge(edges, {
        from: orderNodeId(order.orderIndex, "in"),
        to: stepId,
        asset: d.asset,
        amount: -d.amount,
        basis,
      });
    } else if (d.amount > BigInt(0)) {
      pushEdge(edges, {
        from: stepId,
        to: orderNodeId(order.orderIndex, "out"),
        asset: d.asset,
        amount: d.amount,
        basis,
      });
    }
  }
}

/**
 * Find an output reference inside a module's operation payload that matches one
 * of this scoop's orders.
 *
 * The payload's shape belongs to the module and differs between them — a bare
 * `OutputReference`, or one nested behind the module's own fields. What they
 * share is that the reference is in there, so this walks the tree looking for a
 * `Constr 0 [32-byte bytes, Int]` whose value equals an order input's own
 * reference. Requiring the match against a real order input is what makes the
 * shape test safe: an unrelated pair of the same shape would have to coincide
 * with an actual order's transaction id and index.
 */
function findOrderRef(data: PD, byRef: Map<string, number>): number | null {
  const stack: PD[] = [data];
  // A payload is small, but cap the walk so a malformed one cannot spin.
  for (let visited = 0; stack.length > 0 && visited < 512; visited++) {
    const node = stack.pop()!;
    if (isConstr(node)) {
      if (node.constructor === 0 && node.fields.length === 2) {
        const [first, second] = node.fields;
        if (isBytes(first) && first.bytes.length === 64 && isInt(second)) {
          const key = `${first.bytes.toLowerCase()}#${asInt(second)}`;
          const orderIndex = byRef.get(key);
          if (orderIndex !== undefined) return orderIndex;
        }
      }
      stack.push(...node.fields);
    } else if (isList(node)) {
      stack.push(...node.list);
    }
  }
  return null;
}

/** Group the steps each order's transcripts claim, keyed by order index. */
function stepsByOrder(
  orders: V4ScoopOrder[],
  steps: FlatStep[],
): Map<number, FlatStep[]> {
  const byRef = new Map<string, number>();
  for (const o of orders) {
    byRef.set(`${o.txHash.toLowerCase()}#${o.outputIndex}`, o.orderIndex);
  }
  const out = new Map<number, FlatStep[]>();
  for (const f of steps) {
    const orderIndex = findOrderRef(f.step.operationData, byRef);
    if (orderIndex === null) continue;
    const list = out.get(orderIndex);
    if (list) list.push(f);
    else out.set(orderIndex, [f]);
  }
  return out;
}

/**
 * Put an order's steps in execution order: the step that takes an asset the
 * order gave runs first, and each later step takes what the previous one
 * released.
 *
 * A scoop can also fan one order across several pools of the same pair, where
 * no step feeds another. Those have no chain to find, so they stay in
 * transcript order and render as parallel branches — which is what they are.
 */
function orderChain(order: V4ScoopOrder, steps: FlatStep[]): FlatStep[] {
  if (steps.length <= 1) return steps;
  const given = tradeDeltas(order).filter((d) => d.amount < BigInt(0));
  const absorbs = (f: FlatStep, asset: AssetClass) =>
    f.step.deltas.some((d) => assetKey(d.asset) === assetKey(asset) && d.amount < BigInt(0));
  const releases = (f: FlatStep) =>
    f.step.deltas.filter((d) => d.amount > BigInt(0)).map((d) => d.asset);

  const start = steps.find((f) => given.some((g) => absorbs(f, g.asset)));
  if (!start) return steps;

  const chain: FlatStep[] = [start];
  const remaining = steps.filter((f) => f !== start);
  while (remaining.length > 0) {
    const outputs = releases(chain[chain.length - 1]);
    const nextIndex = remaining.findIndex((f) => outputs.some((a) => absorbs(f, a)));
    if (nextIndex === -1) break;
    chain.push(...remaining.splice(nextIndex, 1));
  }
  // Anything that did not chain is a parallel branch, not a missing hop.
  return [...chain, ...remaining];
}

/**
 * Deduce the single pool step that filled an order, or null when the evidence
 * does not single one out.
 *
 * The rule is deliberately narrow. For each non-ADA asset the order received,
 * find the steps that released that asset. ADA is excluded as the matching
 * asset because the service fee also moves in ADA, so an ADA amount does not
 * identify a step. A step qualifies only if it released at least the amount the
 * order received. When exactly one step qualifies across every received asset,
 * that is the answer; otherwise there is none.
 */
function deduceStepFor(order: V4ScoopOrder, steps: FlatStep[]): FlatStep | null {
  if (steps.length === 0) return null;
  // A single pool step and a single scooped order leave one possibility.
  if (steps.length === 1) return steps[0];

  const deltas = tradeDeltas(order);
  const received = deltas.filter((d) => d.amount > BigInt(0) && !isAda(d.asset));
  const given = deltas.filter((d) => d.amount < BigInt(0) && !isAda(d.asset));
  // ADA is excluded on both sides: the service fee also moves in ADA, so an ADA
  // amount does not identify a step.
  if (received.length === 0 || given.length === 0) return null;

  // A step must account for BOTH sides of the order to be the whole story.
  // Matching only the received side is what produced a wrong single-hop link on
  // a two-pool route: the pool that released the taken asset never saw the
  // asset the order gave, because an earlier pool did.
  const candidates = steps.filter((f) => {
    const releases = received.every((r) =>
      f.step.deltas.some(
        (d) => assetKey(d.asset) === assetKey(r.asset) && d.amount >= r.amount,
      ),
    );
    if (!releases) return false;
    return given.every((g) =>
      f.step.deltas.some(
        (d) => assetKey(d.asset) === assetKey(g.asset) && d.amount <= g.amount,
      ),
    );
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function ensureAssetNode(
  nodes: Map<V4NodeId, V4GraphNode>,
  boundary: number,
  asset: AssetClass,
  amount: bigint,
): V4NodeId {
  const id = assetNodeId(boundary, asset);
  const existing = nodes.get(id);
  if (existing && existing.kind === "asset") {
    existing.amount += amount;
    return id;
  }
  nodes.set(id, { kind: "asset", id, asset, amount });
  return id;
}

/** Merge edges that share endpoints and asset, so parallel edges do not stack. */
function pushEdge(edges: V4GraphEdge[], edge: V4GraphEdge): void {
  if (edge.amount <= BigInt(0)) return;
  const existing = edges.find(
    (e) =>
      e.from === edge.from &&
      e.to === edge.to &&
      assetKey(e.asset) === assetKey(edge.asset),
  );
  if (existing) {
    existing.amount += edge.amount;
    // Keep the strongest basis if an edge is produced twice.
    const rank: Record<V4EdgeBasis, number> = {
      declared: 0,
      transcript: 1,
      deduced: 2,
      observed: 3,
    };
    if (rank[edge.basis] < rank[existing.basis]) existing.basis = edge.basis;
    return;
  }
  edges.push(edge);
}

/**
 * Assign nodes to columns by longest path from a source, so an edge always
 * points rightwards. Orders on the `in` side are sources and `out` side sinks,
 * which pins the two ends regardless of what lies between.
 */
function layoutColumns(
  nodes: Map<V4NodeId, V4GraphNode>,
  edges: V4GraphEdge[],
): V4NodeId[][] {
  const depth = new Map<V4NodeId, number>();
  for (const [id, node] of nodes) {
    depth.set(id, node.kind === "order" && node.side === "in" ? 0 : -1);
  }

  // Relax edges until depths settle. The graph is small (orders × steps), and
  // capping the passes keeps a cycle from looping forever — a cycle should not
  // arise, but a malformed route could declare one.
  const outgoing = new Map<V4NodeId, V4GraphEdge[]>();
  for (const e of edges) {
    const list = outgoing.get(e.from);
    if (list) list.push(e);
    else outgoing.set(e.from, [e]);
  }
  for (let pass = 0; pass < nodes.size + 1; pass++) {
    let changed = false;
    for (const [id, d] of depth) {
      if (d < 0) continue;
      for (const e of outgoing.get(id) ?? []) {
        const target = nodes.get(e.to);
        // Pin order sinks to the last column rather than one past their feeder.
        if (target?.kind === "order" && target.side === "out") continue;
        if ((depth.get(e.to) ?? -1) < d + 1) {
          depth.set(e.to, d + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Anything still unreached (a step no order could be linked to) sits in the
  // middle so it is visible rather than dropped.
  const reached = [...depth.values()].filter((d) => d >= 0);
  const maxDepth = reached.length > 0 ? Math.max(...reached) : 0;
  const middle = Math.max(1, Math.round(maxDepth / 2));
  for (const [id, d] of depth) {
    if (d < 0) depth.set(id, nodes.get(id)!.kind === "step" ? middle : maxDepth);
  }

  // Order sinks always occupy the final column.
  const lastColumn = Math.max(maxDepth, 1) + 1;
  for (const [id, node] of nodes) {
    if (node.kind === "order" && node.side === "out") depth.set(id, lastColumn);
  }

  const columns: V4NodeId[][] = [];
  for (const [id, d] of depth) {
    (columns[d] ??= []).push(id);
  }
  // Drop empty columns, then order within each one to keep edges from crossing.
  const laid = columns
    .filter((c) => c && c.length > 0)
    .map((c) => c.sort((a, b) => a.localeCompare(b)));
  return reduceCrossings(laid, edges);
}

/**
 * Order the nodes within each column so connected nodes sit at similar heights.
 *
 * Sorting a column by node id puts an order next to a step it has nothing to do
 * with, and every edge then has to cross the ones around it. This is the
 * barycenter heuristic: place each node at the average height of the nodes it
 * connects to in the neighbouring column, sweep left-to-right then
 * right-to-left, and repeat. It is the standard layered-graph pass and it
 * settles in a few rounds on graphs this size.
 *
 * A node with no neighbour in the direction being swept keeps its current
 * height, so an unattached node does not drift to one end.
 */
function reduceCrossings(columns: V4NodeId[][], edges: V4GraphEdge[]): V4NodeId[][] {
  if (columns.length < 2) return columns;

  const predecessors = new Map<V4NodeId, V4NodeId[]>();
  const successors = new Map<V4NodeId, V4NodeId[]>();
  for (const e of edges) {
    (successors.get(e.from) ?? successors.set(e.from, []).get(e.from)!).push(e.to);
    (predecessors.get(e.to) ?? predecessors.set(e.to, []).get(e.to)!).push(e.from);
  }

  const height = new Map<V4NodeId, number>();
  const reindex = () => {
    for (const column of columns) {
      column.forEach((id, i) => height.set(id, i));
    }
  };
  reindex();

  const sweep = (column: V4NodeId[], neighbours: Map<V4NodeId, V4NodeId[]>) => {
    const key = new Map<V4NodeId, number>();
    column.forEach((id, i) => {
      const ns = (neighbours.get(id) ?? []).filter((n) => height.has(n));
      key.set(
        id,
        ns.length === 0
          ? i
          : ns.reduce((sum, n) => sum + height.get(n)!, 0) / ns.length,
      );
    });
    // A stable sort keeps equal barycenters in their current relative order,
    // so a sweep that changes nothing really changes nothing.
    column.sort((a, b) => key.get(a)! - key.get(b)!);
  };

  for (let pass = 0; pass < 4; pass++) {
    for (let c = 1; c < columns.length; c++) {
      sweep(columns[c], predecessors);
      reindex();
    }
    for (let c = columns.length - 2; c >= 0; c--) {
      sweep(columns[c], successors);
      reindex();
    }
  }
  return columns;
}

/**
 * Per-asset reconciliation. `ordersNet` is what the order payouts gained;
 * `poolsNet` is what the pool steps released. The difference is what the
 * transaction moved elsewhere — the service fee, the scooper's surplus, or LP
 * minted straight to a destination.
 */
function reconcile(orders: V4ScoopOrder[], steps: FlatStep[]): V4AssetBalance[] {
  const acc = new Map<string, V4AssetBalance>();
  const slot = (asset: AssetClass): V4AssetBalance => {
    const key = assetKey(asset);
    let entry = acc.get(key);
    if (!entry) {
      entry = { asset, ordersNet: BigInt(0), poolsNet: BigInt(0), difference: BigInt(0) };
      acc.set(key, entry);
    }
    return entry;
  };

  for (const o of orders) {
    for (const d of o.payoutDelta ?? []) slot(d.asset).ordersNet += d.amount;
  }
  for (const f of steps) {
    for (const d of f.step.deltas) slot(d.asset).poolsNet += d.amount;
  }
  for (const entry of acc.values()) {
    entry.difference = entry.poolsNet - entry.ordersNet;
  }
  return [...acc.values()]
    .filter((e) => e.ordersNet !== BigInt(0) || e.poolsNet !== BigInt(0))
    .sort((a, b) => assetKey(a.asset).localeCompare(assetKey(b.asset)));
}

/**
 * Give every node a row, keeping a node level with the nodes it connects to.
 *
 * Ordering a column fixes which node comes before which, but not where it sits:
 * laid out with a shared centre line, a column holding one node centres it
 * against the tallest column. A three-hop chain then steps toward the middle at
 * every hop, which is the diagonal drift that makes it look tangled.
 *
 * Each node instead takes the average row of its neighbours, rounded, and
 * collisions inside a column are resolved by pushing later nodes down — so the
 * column's order is preserved while a chain keeps the height it started at.
 */
function assignRows(
  columns: V4NodeId[][],
  edges: V4GraphEdge[],
): Map<V4NodeId, number> {
  const rows = new Map<V4NodeId, number>();
  // The widest column defines the row space; everything else aligns into it.
  let widest = 0;
  for (let c = 1; c < columns.length; c++) {
    if (columns[c].length > columns[widest].length) widest = c;
  }
  columns.forEach((column, c) => {
    column.forEach((id, i) => rows.set(id, c === widest ? i : i));
  });

  const predecessors = new Map<V4NodeId, V4NodeId[]>();
  const successors = new Map<V4NodeId, V4NodeId[]>();
  for (const e of edges) {
    (successors.get(e.from) ?? successors.set(e.from, []).get(e.from)!).push(e.to);
    (predecessors.get(e.to) ?? predecessors.set(e.to, []).get(e.to)!).push(e.from);
  }

  const place = (column: V4NodeId[], neighbours: Map<V4NodeId, V4NodeId[]>) => {
    let previous = -1;
    for (const id of column) {
      const ns = (neighbours.get(id) ?? []).filter((n) => rows.has(n));
      const wanted =
        ns.length === 0
          ? rows.get(id)!
          : Math.round(ns.reduce((sum, n) => sum + rows.get(n)!, 0) / ns.length);
      const row = Math.max(wanted, previous + 1);
      rows.set(id, row);
      previous = row;
    }
  };

  for (let pass = 0; pass < 3; pass++) {
    for (let c = widest + 1; c < columns.length; c++) place(columns[c], predecessors);
    for (let c = widest - 1; c >= 0; c--) place(columns[c], successors);
  }
  return rows;
}

/** Total absolute flow an edge set carries for one asset, for edge widths. */
export function maxEdgeAmount(edges: V4GraphEdge[], asset?: AssetClass): bigint {
  let max = BigInt(0);
  for (const e of edges) {
    if (asset && assetKey(e.asset) !== assetKey(asset)) continue;
    if (e.amount > max) max = e.amount;
  }
  return max;
}

/** Group edges by the asset they carry, for a per-asset legend. */
export function edgeAssets(edges: V4GraphEdge[]): AssetClass[] {
  const seen = new Map<string, AssetClass>();
  for (const e of edges) seen.set(assetKey(e.asset), e.asset);
  return [...seen.values()].sort((a, b) => assetKey(a).localeCompare(assetKey(b)));
}

/** The pool steps that no order could be linked to. */
export function orphanSteps(graph: V4ScoopGraph): V4StepNode[] {
  const touched = new Set<V4NodeId>();
  for (const e of graph.edges) {
    touched.add(e.from);
    touched.add(e.to);
  }
  const out: V4StepNode[] = [];
  for (const node of graph.nodes.values()) {
    if (node.kind === "step" && !touched.has(node.id)) out.push(node);
  }
  return out;
}

/** Sum of a delta list restricted to one asset, for compact summaries. */
export function amountOf(deltas: V4AssetEntry[], asset: AssetClass): bigint {
  let sum = BigInt(0);
  for (const d of deltas) {
    if (assetKey(d.asset) === assetKey(asset)) sum += d.amount;
  }
  return sum;
}
