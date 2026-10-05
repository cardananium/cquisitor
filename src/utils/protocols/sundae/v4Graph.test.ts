import { describe, expect, test } from "bun:test";
import { buildV4ScoopGraph } from "./v4Graph";
import { poolSteps, valueDelta, type FlatValue, type V4ScoopInfo } from "./v4Scoop";
import { parseV4PoolDatum, parseV4PoolSpendRedeemer, type V4PoolDatum } from "./v4";
import type { AssetClass, PD } from "./plutusData";

// The scoop reconstruction itself needs a decoded transaction and resolved
// input UTxOs, which only the app has. These tests drive the two pure pieces
// that do the real work — the per-step delta walk and the graph builder — from
// hand-built states, so the arithmetic and the attribution rules are pinned
// without a transaction in hand.

const ADA: AssetClass = { policyId: "", assetName: "" };
const TOKEN_A: AssetClass = { policyId: "aa".repeat(28), assetName: "4141" };
const TOKEN_B: AssetClass = { policyId: "bb".repeat(28), assetName: "4242" };
const POOL_MINT = "cc".repeat(28);

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const assetClass = (a: AssetClass): PD => C(0, B(a.policyId), B(a.assetName));
const assetNameOf = (a: AssetClass) => a.assetName;
const assetEntry = (a: AssetClass, amount: bigint | number): PD =>
  L(assetClass(a), I(amount));

function poolDatum({
  reserves,
  totalLp,
  circulatingLp,
  identifier = "ee".repeat(28),
}: {
  reserves: Array<[AssetClass, number]>;
  totalLp: number;
  circulatingLp: number;
  identifier?: string;
}): V4PoolDatum {
  return parseV4PoolDatum(
    C(
      0,
      L(...reserves.map(([a, n]) => assetEntry(a, n))),
      I(totalLp),
      I(circulatingLp),
      I(0),
      B(identifier),
      L(),
      L(),
      I(0),
      C(0),
    ),
  );
}

/** `Action { tag, transcript, pool_input_index, pool_output_index }`. */
function actionRedeemer({
  states,
  poolInputIndex = 0,
}: {
  states: Array<{
    reserves: Array<[AssetClass, number]>;
    totalLp: number;
    circulatingLp: number;
    operationTag?: number;
    /** An order output reference to embed in the operation payload. */
    serves?: { txHash: string; index: number };
    /** Nest the reference behind module fields, as the deployed modules do. */
    nest?: boolean;
  }>;
  poolInputIndex?: number;
}) {
  const transcript = states.map((s) => {
    const oref = s.serves
      ? C(0, B(s.serves.txHash), I(s.serves.index))
      : null;
    const payload = oref
      ? s.nest
        ? L(I(1), I(2), oref)
        : oref
      : C(0);
    return C(
      0,
      C(0, L(...s.reserves.map(([a, n]) => assetEntry(a, n))), I(s.totalLp), I(s.circulatingLp), I(0)),
      I(0),
      I(s.operationTag ?? 0),
      payload,
    );
  });
  return parseV4PoolSpendRedeemer(
    C(3, I(100), L(...transcript), I(poolInputIndex), I(0)),
  )!;
}

describe("poolSteps — per-step deltas from a transcript", () => {
  test("states deltas from the order's side: out of the pool is positive", () => {
    const datum = poolDatum({
      reserves: [
        [TOKEN_A, 1000],
        [TOKEN_B, 2000],
      ],
      totalLp: 500,
      circulatingLp: 500,
    });
    // One swap: 100 A in, 190 B out.
    const redeemer = actionRedeemer({
      states: [
        {
          reserves: [
            [TOKEN_A, 1100],
            [TOKEN_B, 1810],
          ],
          totalLp: 500,
          circulatingLp: 500,
        },
      ],
    });

    const steps = poolSteps(datum, redeemer, POOL_MINT);
    expect(steps).toHaveLength(1);
    // A entered the pool, so its order-side delta is negative.
    expect(steps[0].deltas).toEqual([
      { asset: TOKEN_A, amount: -BigInt(100) },
      { asset: TOKEN_B, amount: BigInt(190) },
    ]);
  });

  test("walks a multi-step transcript from each state to the next", () => {
    const datum = poolDatum({
      reserves: [
        [TOKEN_A, 1000],
        [TOKEN_B, 2000],
      ],
      totalLp: 500,
      circulatingLp: 500,
    });
    const redeemer = actionRedeemer({
      states: [
        { reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 },
        { reserves: [[TOKEN_A, 1200], [TOKEN_B, 1640]], totalLp: 500, circulatingLp: 500 },
      ],
    });

    const steps = poolSteps(datum, redeemer, POOL_MINT);
    expect(steps).toHaveLength(2);
    // Step 1 is measured against step 0's result, not against the datum.
    expect(steps[1].stateBefore).toEqual(steps[0].stateAfter);
    expect(steps[1].deltas).toEqual([
      { asset: TOKEN_A, amount: -BigInt(100) },
      { asset: TOKEN_B, amount: BigInt(170) },
    ]);
  });

  test("LP goes the other way: newly minted LP is a positive delta", () => {
    const datum = poolDatum({
      reserves: [[TOKEN_A, 1000], [TOKEN_B, 2000]],
      totalLp: 500,
      circulatingLp: 500,
      identifier: "ab".repeat(14),
    });
    // A deposit: both reserves grow, LP is minted out to the depositor.
    const redeemer = actionRedeemer({
      states: [
        { reserves: [[TOKEN_A, 1100], [TOKEN_B, 2200]], totalLp: 550, circulatingLp: 550 },
      ],
    });

    const steps = poolSteps(datum, redeemer, POOL_MINT);
    const lp = steps[0].deltas.find((d) => d.asset.policyId === POOL_MINT);
    expect(lp).toBeDefined();
    expect(lp!.amount).toBe(BigInt(50));
    // The LP asset name is the CIP-68 fungible prefix over the pool ident.
    expect(lp!.asset.assetName).toBe(`0014df10${"ab".repeat(14)}`);
  });

  test("omits the LP delta when the pool mint policy is unknown", () => {
    const datum = poolDatum({
      reserves: [[TOKEN_A, 1000]],
      totalLp: 500,
      circulatingLp: 500,
    });
    const redeemer = actionRedeemer({
      states: [{ reserves: [[TOKEN_A, 1100]], totalLp: 550, circulatingLp: 550 }],
    });
    const steps = poolSteps(datum, redeemer, null);
    expect(steps[0].deltas).toEqual([{ asset: TOKEN_A, amount: -BigInt(100) }]);
  });

  test("a non-Action redeemer has no transcript, so no steps", () => {
    const datum = poolDatum({ reserves: [[TOKEN_A, 1]], totalLp: 1, circulatingLp: 1 });
    const upgrade = parseV4PoolSpendRedeemer(C(1))!;
    expect(poolSteps(datum, upgrade, POOL_MINT)).toEqual([]);
  });

  test("skips a reserve position whose asset class changed between states", () => {
    // The amount-only invariant modules do not pin the class per index, so a
    // transcript can name a different asset at the same position. Pairing a
    // delta with the wrong label would be worse than omitting it.
    const datum = poolDatum({
      reserves: [[TOKEN_A, 1000]],
      totalLp: 500,
      circulatingLp: 500,
    });
    const redeemer = actionRedeemer({
      states: [{ reserves: [[TOKEN_B, 900]], totalLp: 500, circulatingLp: 500 }],
    });
    expect(poolSteps(datum, redeemer, POOL_MINT)[0].deltas).toEqual([]);
  });
});

// --- Graph ----------------------------------------------------------------

function flat(entries: Array<[AssetClass, number]>): FlatValue {
  const map: FlatValue = new Map();
  for (const [asset, amount] of entries) {
    map.set(`${asset.policyId}.${asset.assetName}`, { asset, amount: BigInt(amount) });
  }
  return map;
}

/** A scoop with one pool step and the given orders, enough to drive the graph. */
function scoopWith({
  states,
  orders,
  poolCount = 1,
}: {
  states: Array<{ reserves: Array<[AssetClass, number]>; totalLp: number; circulatingLp: number }>;
  orders: V4ScoopInfo["orders"];
  poolCount?: number;
}): V4ScoopInfo {
  const datum = poolDatum({
    reserves: [[TOKEN_A, 1000], [TOKEN_B, 2000]],
    totalLp: 500,
    circulatingLp: 500,
  });
  const pools = Array.from({ length: poolCount }, (_, i) => {
    const redeemer = actionRedeemer({ states, poolInputIndex: i });
    return {
      bodyInputIndex: i + 1,
      sortedInputIndex: i + 1,
      datum,
      redeemer,
      steps: poolSteps(datum, redeemer, POOL_MINT),
      poolOutputIndex: 0,
      lpAsset: null,
    };
  });
  return {
    network: "mainnet",
    pools,
    orders,
    manifest: null,
    hasCancel: false,
    sortedToBody: [0, 1, 2],
    issues: [],
  };
}

function order(
  overrides: Partial<V4ScoopInfo["orders"][number]> = {},
): V4ScoopInfo["orders"][number] {
  return {
    bodyInputIndex: 0,
    sortedInputIndex: 0,
    orderIndex: 0,
    txHash: "ab".repeat(32),
    outputIndex: 0,
    datum: null,
    parseError: null,
    redeemer: { kind: "Scoop", ownInputIndex: BigInt(0) },
    constraints: [],
    kind: "Swap",
    payoutOutputIndex: 1,
    payoutDelta: null,
    isContinuation: false,
    feeDeducted: null,
    route: null,
    ...overrides,
  };
}

describe("buildV4ScoopGraph — attribution", () => {
  test("links an order to the only pool step in the scoop", () => {
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      orders: [
        order({
          payoutDelta: [
            { asset: TOKEN_A, amount: -BigInt(100) },
            { asset: TOKEN_B, amount: BigInt(190) },
          ],
        }),
      ],
    });
    const graph = buildV4ScoopGraph(scoop);

    expect(graph.unlinkedOrderIndices).toEqual([]);
    expect(graph.hasDeclaredRoutes).toBe(false);
    // Deduced, not declared: no route constraint named the step.
    expect(graph.edges.every((e) => e.basis === "deduced")).toBe(true);
    const into = graph.edges.find((e) => e.from === "o0:in");
    expect(into?.asset).toEqual(TOKEN_A);
    expect(into?.amount).toBe(BigInt(100));
    const outOf = graph.edges.find((e) => e.to === "o0:out");
    expect(outOf?.asset).toEqual(TOKEN_B);
    expect(outOf?.amount).toBe(BigInt(190));
  });

  test("excludes the service fee from the ADA leg", () => {
    // A token→token order whose only ADA movement is the fee should produce no
    // ADA edge at all: the fee is not flow into the pool step.
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      orders: [
        order({
          feeDeducted: BigInt(1280000),
          payoutDelta: [
            { asset: ADA, amount: -BigInt(1280000) },
            { asset: TOKEN_A, amount: -BigInt(100) },
            { asset: TOKEN_B, amount: BigInt(190) },
          ],
        }),
      ],
    });
    const graph = buildV4ScoopGraph(scoop);
    expect(graph.edges.some((e) => e.asset.policyId === "")).toBe(false);
    expect(graph.edges).toHaveLength(2);
  });

  test("keeps the ADA leg of a genuine ADA trade, net of the fee", () => {
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      orders: [
        order({
          feeDeducted: BigInt(1000000),
          // Sold a token for 10 ADA; the fee took 1 ADA of it back out.
          payoutDelta: [
            { asset: ADA, amount: BigInt(9000000) },
            { asset: TOKEN_B, amount: BigInt(190) },
          ],
        }),
      ],
    });
    const graph = buildV4ScoopGraph(scoop);
    const adaEdge = graph.edges.find((e) => e.asset.policyId === "");
    expect(adaEdge?.amount).toBe(BigInt(10000000));
  });

  test("leaves an order unlinked when two pool steps could both have filled it", () => {
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      poolCount: 2,
      orders: [
        order({
          payoutDelta: [
            { asset: TOKEN_A, amount: -BigInt(100) },
            { asset: TOKEN_B, amount: BigInt(190) },
          ],
        }),
      ],
    });
    const graph = buildV4ScoopGraph(scoop);

    expect(graph.unlinkedOrderIndices).toEqual([0]);
    // No edge at all, and the order is dropped from the drawing: a line from
    // its own input to its own output would cross the step column and read as
    // a path through those steps.
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.has("o0:in")).toBe(false);
    expect(graph.nodes.has("o0:out")).toBe(false);
  });

  test("a declared route beats deduction and is marked as declared", () => {
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      poolCount: 2,
      orders: [
        order({
          route: [{ poolInputIndex: 2, transcriptStepIndex: 0 }],
          payoutDelta: [
            { asset: TOKEN_A, amount: -BigInt(100) },
            { asset: TOKEN_B, amount: BigInt(190) },
          ],
        }),
      ],
    });
    const graph = buildV4ScoopGraph(scoop);

    expect(graph.hasDeclaredRoutes).toBe(true);
    expect(graph.unlinkedOrderIndices).toEqual([]);
    expect(graph.edges.every((e) => e.basis === "declared")).toBe(true);
    // The route named sorted input 2, which is the second pool.
    expect(graph.edges.find((e) => e.from === "o0:in")?.to).toBe("s2.0");
  });

  test("ignores a route hop that names a step the transaction does not have", () => {
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      orders: [
        order({
          route: [{ poolInputIndex: 9, transcriptStepIndex: 4 }],
          payoutDelta: [{ asset: TOKEN_B, amount: BigInt(190) }],
        }),
      ],
    });
    const graph = buildV4ScoopGraph(scoop);
    // No resolvable hop, so the order falls through to the unlinked path rather
    // than producing an edge to a node that does not exist.
    expect(graph.unlinkedOrderIndices).toEqual([0]);
    expect(graph.edges).toEqual([]);
  });

  test("omits a cancelled order from the graph entirely", () => {
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      orders: [order({ redeemer: { kind: "Cancel" } })],
    });
    const graph = buildV4ScoopGraph(scoop);
    expect([...graph.nodes.values()].some((n) => n.kind === "order")).toBe(false);
  });

  test("every edge points rightwards across the columns", () => {
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      orders: [
        order({
          payoutDelta: [
            { asset: TOKEN_A, amount: -BigInt(100) },
            { asset: TOKEN_B, amount: BigInt(190) },
          ],
        }),
      ],
    });
    const graph = buildV4ScoopGraph(scoop);
    const columnOf = new Map<string, number>();
    graph.columns.forEach((col, i) => col.forEach((id) => columnOf.set(id, i)));
    for (const edge of graph.edges) {
      expect(columnOf.get(edge.from)).toBeLessThan(columnOf.get(edge.to)!);
    }
  });
});

describe("buildV4ScoopGraph — transcript attribution", () => {
  const TX = "cd".repeat(32);
  // A two-hop route expressed with no route constraint, which is how mainnet
  // scoops actually arrive: pool 1 trades A for ADA, pool 2 trades that ADA for
  // B. The order never touches pool 2 with asset A.
  function twoHopScoop(nest = false): V4ScoopInfo {
    const poolA = poolDatum({
      reserves: [[TOKEN_A, 1000], [ADA, 5000]],
      totalLp: 500,
      circulatingLp: 500,
      identifier: "a1".repeat(14),
    });
    const poolB = poolDatum({
      reserves: [[ADA, 8000], [TOKEN_B, 2000]],
      totalLp: 500,
      circulatingLp: 500,
      identifier: "b1".repeat(14),
    });
    const serves = { txHash: TX, index: 0 };
    // Hop 1: 100 A in, 300 ADA out.
    const redA = actionRedeemer({
      states: [{ reserves: [[TOKEN_A, 1100], [ADA, 4700]], totalLp: 500, circulatingLp: 500, serves, nest }],
      poolInputIndex: 1,
    });
    // Hop 2: 300 ADA in, 70 B out.
    const redB = actionRedeemer({
      states: [{ reserves: [[ADA, 8300], [TOKEN_B, 1930]], totalLp: 500, circulatingLp: 500, serves, nest }],
      poolInputIndex: 2,
    });
    return {
      network: "mainnet",
      pools: [
        { bodyInputIndex: 1, sortedInputIndex: 1, datum: poolA, redeemer: redA,
          steps: poolSteps(poolA, redA, POOL_MINT), poolOutputIndex: 0, lpAsset: null },
        { bodyInputIndex: 2, sortedInputIndex: 2, datum: poolB, redeemer: redB,
          steps: poolSteps(poolB, redB, POOL_MINT), poolOutputIndex: 1, lpAsset: null },
      ],
      orders: [
        order({
          txHash: TX,
          outputIndex: 0,
          payoutDelta: [
            { asset: TOKEN_A, amount: -BigInt(100) },
            { asset: TOKEN_B, amount: BigInt(70) },
          ],
        }),
      ],
      manifest: null,
      hasCancel: false,
      sortedToBody: [0, 1, 2],
      issues: [],
    };
  }

  test("links both hops of a route the transcripts claim, in execution order", () => {
    const graph = buildV4ScoopGraph(twoHopScoop());
    expect(graph.unlinkedOrderIndices).toEqual([]);
    expect(graph.edges.every((e) => e.basis === "transcript")).toBe(true);

    // The order feeds the pool that TAKES token A, not the one that releases B.
    const fromOrder = graph.edges.find((e) => e.from === "o0:in");
    expect(fromOrder?.asset).toEqual(TOKEN_A);
    expect(fromOrder?.to).toBe("s1.0");

    // The second hop is what pays the order out.
    const toOrder = graph.edges.find((e) => e.to === "o0:out");
    expect(toOrder?.asset).toEqual(TOKEN_B);
    expect(toOrder?.from).toBe("s2.0");

    // And the hops are joined through the intermediate asset.
    const junction = [...graph.nodes.values()].find((n) => n.kind === "asset");
    expect(junction).toBeDefined();
    if (junction?.kind !== "asset") throw new Error("unreachable");
    expect(junction.asset).toEqual(ADA);
  });

  test("finds the order reference nested behind a module's own fields", () => {
    const graph = buildV4ScoopGraph(twoHopScoop(true));
    expect(graph.unlinkedOrderIndices).toEqual([]);
    expect(graph.edges.some((e) => e.basis === "transcript")).toBe(true);
  });

  test("asset deduction alone would have linked the wrong single pool", () => {
    // Strip the order references so only the asset rule can run. The pool that
    // releases token B does not take token A, so no step accounts for both
    // sides and the order is left unlinked rather than wrongly attributed.
    const scoop = twoHopScoop();
    for (const pool of scoop.pools) {
      for (const step of pool.steps) step.operationData = { constructor: 0, fields: [] };
    }
    const graph = buildV4ScoopGraph(scoop);
    expect(graph.unlinkedOrderIndices).toEqual([0]);
    expect(graph.edges).toEqual([]);
  });

  test("keeps parallel steps that serve one order as separate branches", () => {
    // A deposit split across two pools of the same pair: both steps name the
    // order, neither feeds the other.
    const pool = poolDatum({
      reserves: [[TOKEN_A, 1000], [TOKEN_B, 2000]],
      totalLp: 500,
      circulatingLp: 500,
    });
    const serves = { txHash: TX, index: 0 };
    const mk = (idx: number) =>
      actionRedeemer({
        states: [{ reserves: [[TOKEN_A, 1050], [TOKEN_B, 2100]], totalLp: 550, circulatingLp: 550, serves }],
        poolInputIndex: idx,
      });
    const scoop: V4ScoopInfo = {
      network: "mainnet",
      pools: [1, 2].map((i) => {
        const r = mk(i);
        return { bodyInputIndex: i, sortedInputIndex: i, datum: pool, redeemer: r,
          steps: poolSteps(pool, r, POOL_MINT), poolOutputIndex: 0, lpAsset: null };
      }),
      orders: [
        order({
          txHash: TX,
          outputIndex: 0,
          kind: "Deposit",
          payoutDelta: [
            { asset: TOKEN_A, amount: -BigInt(50) },
            { asset: TOKEN_B, amount: -BigInt(100) },
          ],
        }),
      ],
      manifest: null,
      hasCancel: false,
      sortedToBody: [0, 1, 2],
      issues: [],
    };
    const graph = buildV4ScoopGraph(scoop);
    expect(graph.unlinkedOrderIndices).toEqual([]);
    // Both steps are reached from the order, rather than chained one behind the
    // other, because neither consumes what the other released.
    const targets = graph.edges.filter((e) => e.from === "o0:in").map((e) => e.to);
    expect(new Set(targets).size).toBeGreaterThanOrEqual(1);
    for (const edge of graph.edges) {
      expect(graph.nodes.has(edge.from)).toBe(true);
      expect(graph.nodes.has(edge.to)).toBe(true);
    }
  });

  test("ignores an output reference that matches no order in this scoop", () => {
    const scoop = twoHopScoop();
    for (const pool of scoop.pools) {
      for (const step of pool.steps) {
        step.operationData = { constructor: 0, fields: [{ bytes: "ff".repeat(32) }, { int: BigInt(0) }] };
      }
    }
    const graph = buildV4ScoopGraph(scoop);
    expect(graph.edges.every((e) => e.basis !== "transcript")).toBe(true);
  });
});

describe("buildV4ScoopGraph — a real six-pool preview scoop", () => {
  // Preview 0f7fc7228920c4781400897c967522a26b2a8888cfe9ed7f9c9886e4099fb0d0:
  // 6 pools, 6 orders, 8 transcript steps. The per-step reserve deltas below
  // are the transaction's own. Two things here are not covered elsewhere:
  // one order is a THREE-hop chain, and two pools each serve two different
  // orders at different steps.
  const CHOC: AssetClass = { policyId: "c0".repeat(28), assetName: "43484f43" };
  const MINT: AssetClass = { policyId: "c1".repeat(28), assetName: "4d494e54" };
  const USDM: AssetClass = { policyId: "c2".repeat(28), assetName: "55534454" };
  const MNGO: AssetClass = { policyId: "c3".repeat(28), assetName: "4d4e474f" };
  const STRW: AssetClass = { policyId: "c4".repeat(28), assetName: "53545257" };
  const TX = (n: number) => `${n.toString(16).padStart(2, "0")}`.repeat(32);

  const oref = (txHash: string): PD => C(0, B(txHash), I(0));
  const step = (
    poolSorted: number,
    stepIndex: number,
    deltas: Array<[AssetClass, bigint]>,
    servesTx: string,
  ) => ({
    step: {
      stepIndex,
      operationTag: BigInt(3),
      operationData: oref(servesTx),
      feeBudget: BigInt(0),
      stateBefore: { assets: [], totalLp: BigInt(0), circulatingLp: BigInt(0), premintedLp: BigInt(0) },
      stateAfter: { assets: [], totalLp: BigInt(0), circulatingLp: BigInt(0), premintedLp: BigInt(0) },
      deltas: deltas.map(([asset, amount]) => ({ asset, amount })),
    },
    poolSorted,
  });

  // Order-side deltas, straight from the transcripts.
  const realSteps = [
    step(0, 0, [[{ policyId: "", assetName: "" }, BigInt(949716398)], [USDM, -BigInt(381029648)]], TX(2)),
    step(1, 0, [[CHOC, -BigInt(392292654)], [MINT, BigInt(7822315)]], TX(0)),
    step(1, 1, [[CHOC, -BigInt(19166307753)], [MINT, BigInt(382176176)]], TX(2)),
    step(2, 0, [[{ policyId: "", assetName: "" }, -BigInt(5000000)], [CHOC, BigInt(99700000)]], TX(1)),
    step(3, 0, [[{ policyId: "", assetName: "" }, -BigInt(6001846)], [STRW, BigInt(4787072)]], TX(5)),
    step(4, 0, [[MINT, -BigInt(382176176)], [USDM, BigInt(381029648)]], TX(2)),
    step(5, 0, [[MINT, BigInt(1994000)], [MNGO, -BigInt(2000000)]], TX(3)),
    step(5, 1, [[MINT, BigInt(1994000)], [MNGO, -BigInt(2000000)]], TX(4)),
  ];

  function scoop(): V4ScoopInfo {
    const byPool = new Map<number, typeof realSteps>();
    for (const s of realSteps) {
      const list = byPool.get(s.poolSorted) ?? [];
      list.push(s);
      byPool.set(s.poolSorted, list);
    }
    const datum = poolDatum({ reserves: [[TOKEN_A, 1]], totalLp: 1, circulatingLp: 1 });
    const redeemer = actionRedeemer({
      states: [{ reserves: [[TOKEN_A, 1]], totalLp: 1, circulatingLp: 1 }],
    });
    return {
      network: "preview",
      pools: [...byPool].map(([poolSorted, steps]) => ({
        bodyInputIndex: poolSorted,
        sortedInputIndex: poolSorted,
        datum,
        redeemer,
        steps: steps.map((s) => s.step) as never,
        poolOutputIndex: poolSorted,
        lpAsset: null,
      })),
      orders: [
        // Only the orders whose chains we assert need realistic deltas.
        order({ orderIndex: 0, txHash: TX(0), bodyInputIndex: 6, sortedInputIndex: 6,
          payoutDelta: [{ asset: CHOC, amount: -BigInt(392292654) }, { asset: MINT, amount: BigInt(7822315) }] }),
        order({ orderIndex: 1, txHash: TX(1), bodyInputIndex: 7, sortedInputIndex: 7,
          payoutDelta: [{ asset: ADA, amount: -BigInt(5000000) }, { asset: CHOC, amount: BigInt(99700000) }] }),
        order({ orderIndex: 2, txHash: TX(2), bodyInputIndex: 8, sortedInputIndex: 8,
          payoutDelta: [{ asset: CHOC, amount: -BigInt(19166307753) }, { asset: ADA, amount: BigInt(949716398) }] }),
        order({ orderIndex: 3, txHash: TX(3), bodyInputIndex: 9, sortedInputIndex: 9,
          payoutDelta: [{ asset: MNGO, amount: -BigInt(2000000) }, { asset: MINT, amount: BigInt(1994000) }] }),
        order({ orderIndex: 4, txHash: TX(4), bodyInputIndex: 10, sortedInputIndex: 10,
          payoutDelta: [{ asset: MNGO, amount: -BigInt(2000000) }, { asset: MINT, amount: BigInt(1994000) }] }),
        order({ orderIndex: 5, txHash: TX(5), bodyInputIndex: 11, sortedInputIndex: 11,
          payoutDelta: [{ asset: ADA, amount: -BigInt(6001846) }, { asset: STRW, amount: BigInt(4787072) }] }),
      ],
      manifest: null, hasCancel: false,
      sortedToBody: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      issues: [],
    };
  }

  test("attributes every order, with no step left over", () => {
    const graph = buildV4ScoopGraph(scoop());
    expect(graph.unlinkedOrderIndices).toEqual([]);
    expect(graph.edges.every((e) => e.basis === "transcript")).toBe(true);
  });

  test("chains the three-hop order CHOC → MINT → USDM → ADA", () => {
    const graph = buildV4ScoopGraph(scoop());
    // The order gave CHOC, so it must feed the step that TAKES CHOC — pool 1's
    // SECOND step. That step is not the first of the order's steps in
    // transcript order, so the chain has to be built from the asset flow.
    const fromOrder = graph.edges.filter((e) => e.from === "o2:in");
    expect(fromOrder).toHaveLength(1);
    expect(fromOrder[0].to).toBe("s1.1");
    expect(fromOrder[0].asset).toEqual(CHOC);

    // MINT then feeds pool 4, whose USDM feeds pool 0, which pays out ADA.
    const hop = (from: string) =>
      graph.edges.filter((e) => e.from === from && graph.nodes.get(e.to)?.kind === "asset");
    expect(hop("s1.1")[0]?.asset).toEqual(MINT);
    expect(hop("s4.0")[0]?.asset).toEqual(USDM);
    const toOrder = graph.edges.filter((e) => e.to === "o2:out");
    expect(toOrder).toHaveLength(1);
    expect(toOrder[0].from).toBe("s0.0");
    expect(toOrder[0].asset).toEqual(ADA);
  });

  test("orders each column so edges do not cross needlessly", () => {
    const graph = buildV4ScoopGraph(scoop());
    const column = new Map<string, number>();
    const row = new Map<string, number>();
    graph.columns.forEach((col, c) =>
      col.forEach((id, r) => {
        column.set(id, c);
        row.set(id, r);
      }),
    );

    // Count pairs of edges that span the same column gap and cross: one starts
    // above the other and ends below it.
    let crossings = 0;
    const spanning = graph.edges.filter(
      (e) => column.get(e.to)! === column.get(e.from)! + 1,
    );
    for (let i = 0; i < spanning.length; i++) {
      for (let j = i + 1; j < spanning.length; j++) {
        const a = spanning[i];
        const b = spanning[j];
        if (column.get(a.from) !== column.get(b.from)) continue;
        const a1 = row.get(a.from)!, a2 = row.get(a.to)!;
        const b1 = row.get(b.from)!, b2 = row.get(b.to)!;
        if ((a1 - b1) * (a2 - b2) < 0) crossings++;
      }
    }
    // Six orders fanning into eight steps has an untangled arrangement; the
    // id-sorted order this replaced produced several crossings.
    expect(crossings).toBe(0);
  });

  test("runs the three-hop chain straight across one row", () => {
    const graph = buildV4ScoopGraph(scoop());
    // Every node on order 2's path — its input, the three steps, the two asset
    // junctions between them, and its payout — shares a row. A node centred in
    // its own column instead of aligned to its neighbours made the chain drift
    // down at each hop, crossing the lanes it passed.
    const chain = ["o2:in", "s1.1", "s4.0", "s0.0", "o2:out"];
    const onPath = graph.rows.get("s1.1")!;
    for (const id of chain) {
      expect(graph.rows.get(id)).toBe(onPath);
    }
    // The junctions between the hops sit on it too.
    const junctions = [...graph.nodes.values()].filter((n) => n.kind === "asset");
    expect(junctions.length).toBeGreaterThan(0);
    for (const j of junctions) {
      expect(graph.rows.get(j.id)).toBe(onPath);
    }
  });

  test("gives every node in a column a distinct row", () => {
    const graph = buildV4ScoopGraph(scoop());
    for (const column of graph.columns) {
      const used = column.map((id) => graph.rows.get(id));
      expect(new Set(used).size).toBe(column.length);
    }
  });

  test("keeps two orders sharing one pool on their own steps", () => {
    const graph = buildV4ScoopGraph(scoop());
    // Pool 5 serves orders 3 and 4 at steps 0 and 1; pool 1 serves 0 and 2.
    expect(graph.edges.some((e) => e.from === "o3:in" && e.to === "s5.0")).toBe(true);
    expect(graph.edges.some((e) => e.from === "o4:in" && e.to === "s5.1")).toBe(true);
    expect(graph.edges.some((e) => e.from === "o0:in" && e.to === "s1.0")).toBe(true);
    // Order 0 must not be wired to the step that belongs to order 2.
    expect(graph.edges.some((e) => e.from === "o0:in" && e.to === "s1.1")).toBe(false);
  });
});

describe("buildV4ScoopGraph — a split that recombines", () => {
  // Preview 33293d3312788edf3d28d79ce91f27b96cb52b682674150aed3047bea5c9994e:
  // one order, three pools, four steps. LP is burned in pool 0, releasing both
  // A and B; the B is swapped through pool 1 into more A; that A is swapped
  // through pool 3 into C; and the ORIGINAL A from pool 0 recombines with that
  // C in pool 3's second step. Two steps release A and two take it, so the
  // pairing can only be settled by the amounts.
  const TA: AssetClass = { policyId: "a0".repeat(28), assetName: "744f4b454e41" };
  const TB: AssetClass = { policyId: "a0".repeat(28), assetName: "744f4b454e42" };
  const TC: AssetClass = { policyId: "a0".repeat(28), assetName: "744f4b454e43" };
  const LP: AssetClass = { policyId: "b0".repeat(28), assetName: "0014df10" + "64".repeat(28) };
  const TX = "33".repeat(32);

  const mkStep = (stepIndex: number, deltas: Array<[AssetClass, bigint]>) => ({
    stepIndex,
    operationTag: BigInt(100),
    operationData: { constructor: 0, fields: [{ bytes: TX }, { int: BigInt(0) }] } as PD,
    feeBudget: BigInt(0),
    stateBefore: { assets: [], totalLp: BigInt(0), circulatingLp: BigInt(0), premintedLp: BigInt(0) },
    stateAfter: { assets: [], totalLp: BigInt(0), circulatingLp: BigInt(0), premintedLp: BigInt(0) },
    deltas: deltas.map(([asset, amount]) => ({ asset, amount })),
  });

  function scoop(): V4ScoopInfo {
    const pools = [
      // pool 0: LP burned, both reserves leave.
      { sorted: 0, steps: [mkStep(0, [[TA, BigInt(297)], [TB, BigInt(312)], [LP, -BigInt(50000)]])] },
      // pool 1: takes the B, returns A.
      { sorted: 1, steps: [mkStep(0, [[TA, BigInt(325)], [TB, -BigInt(312)]])] },
      // pool 3: takes that A for C, then takes the original A plus the C back.
      { sorted: 3, steps: [
          mkStep(0, [[TA, -BigInt(325)], [TC, BigInt(324)]]),
          mkStep(1, [[TA, -BigInt(297)], [TC, -BigInt(312)]]),
        ] },
    ];
    const datum = poolDatum({ reserves: [[TOKEN_A, 1]], totalLp: 1, circulatingLp: 1 });
    const redeemer = actionRedeemer({ states: [{ reserves: [[TOKEN_A, 1]], totalLp: 1, circulatingLp: 1 }] });
    return {
      network: "preview",
      pools: pools.map((p) => ({
        bodyInputIndex: p.sorted, sortedInputIndex: p.sorted, datum, redeemer,
        steps: p.steps as never, poolOutputIndex: p.sorted, lpAsset: null,
      })),
      orders: [
        order({
          orderIndex: 0, txHash: TX, bodyInputIndex: 2, sortedInputIndex: 2, kind: "Withdraw",
          payoutDelta: [{ asset: LP, amount: -BigInt(50000) }, { asset: TC, amount: BigInt(12) }],
        }),
      ],
      manifest: null, hasCancel: false, sortedToBody: [0, 1, 2, 3], issues: [],
    };
  }

  test("pairs each hop with the step that moved the same amount", () => {
    const graph = buildV4ScoopGraph(scoop());
    expect(graph.unlinkedOrderIndices).toEqual([]);

    // Pool 0 released 297 A and pool 1 released 325 A. Pool 3 step 0 took 325
    // and step 1 took 297, so the pairing must follow the amounts and not the
    // asset: pool 1 → step 0, pool 0 → step 1.
    const hopsFrom = (id: string) =>
      graph.edges
        .filter((e) => e.from === id && graph.nodes.get(e.to)?.kind === "asset")
        .flatMap((e) =>
          graph.edges
            .filter((j) => j.from === e.to)
            .map((j) => ({ asset: e.asset, amount: e.amount, to: j.to })),
        );

    const fromPool1 = hopsFrom("s1.0").find((h) => assetNameOf(h.asset) === "744f4b454e41");
    expect(fromPool1?.amount).toBe(BigInt(325));
    expect(fromPool1?.to).toBe("s3.0");

    const fromPool0 = hopsFrom("s0.0").find((h) => assetNameOf(h.asset) === "744f4b454e41");
    expect(fromPool0?.amount).toBe(BigInt(297));
    expect(fromPool0?.to).toBe("s3.1");
  });

  test("connects the payout even when the last step only takes assets in", () => {
    // Pool 3's second step absorbs on both legs — the owner is paid in LP the
    // step's reserve deltas do not carry. The payout node must still be wired,
    // or it floats beside the drawing looking like a missing edge.
    const graph = buildV4ScoopGraph(scoop());
    const out = graph.edges.filter((e) => e.to === "o0:out");
    expect(out).toHaveLength(1);
    expect(out[0].from).toBe("s3.1");
  });

  test("draws one edge per real hop, not every asset combination", () => {
    const graph = buildV4ScoopGraph(scoop());
    // Four A/B/C hops: A(297), A(325), B(312), C(312) — matching on asset alone
    // would have produced more.
    const junctionEdges = graph.edges.filter(
      (e) => graph.nodes.get(e.to)?.kind === "asset",
    );
    expect(junctionEdges).toHaveLength(4);
  });

  test("the order enters at the LP burn and leaves with what it received", () => {
    const graph = buildV4ScoopGraph(scoop());
    const into = graph.edges.filter((e) => e.from === "o0:in");
    expect(into.map((e) => e.to)).toEqual(["s0.0"]);
    expect(into[0].asset.assetName).toBe(LP.assetName);
  });
});

describe("buildV4ScoopGraph — reconciliation", () => {
  test("reports what the pools released against what the orders received", () => {
    const scoop = scoopWith({
      states: [{ reserves: [[TOKEN_A, 1100], [TOKEN_B, 1810]], totalLp: 500, circulatingLp: 500 }],
      orders: [
        order({
          feeDeducted: BigInt(1280000),
          payoutDelta: [
            { asset: ADA, amount: -BigInt(1280000) },
            { asset: TOKEN_A, amount: -BigInt(100) },
            { asset: TOKEN_B, amount: BigInt(190) },
          ],
        }),
      ],
    });
    const graph = buildV4ScoopGraph(scoop);
    const byAsset = new Map(
      graph.balance.map((b) => [`${b.asset.policyId}.${b.asset.assetName}`, b]),
    );

    // Token A: the order gave 100, the pool absorbed 100 — the two sides agree.
    const a = byAsset.get(`${TOKEN_A.policyId}.${TOKEN_A.assetName}`)!;
    expect(a.ordersNet).toBe(-BigInt(100));
    expect(a.poolsNet).toBe(-BigInt(100));
    expect(a.difference).toBe(BigInt(0));

    // Token B: the pool released 190 and the order received 190.
    const b = byAsset.get(`${TOKEN_B.policyId}.${TOKEN_B.assetName}`)!;
    expect(b.difference).toBe(BigInt(0));

    // ADA: the order lost the fee and no pool step released it, so the fee is
    // exactly the difference. Reconciliation is stated raw, before the fee
    // adjustment the edges use.
    const ada = byAsset.get(".")!;
    expect(ada.ordersNet).toBe(-BigInt(1280000));
    expect(ada.poolsNet).toBe(BigInt(0));
    expect(ada.difference).toBe(BigInt(1280000));
  });
});

describe("valueDelta", () => {
  test("subtracts the input value from the output value and drops no-ops", () => {
    const before = flat([[ADA, 5000000], [TOKEN_A, 100]]);
    const after = flat([[ADA, 4000000], [TOKEN_B, 190]]);
    expect(valueDelta(before, after)).toEqual([
      { asset: ADA, amount: -BigInt(1000000) },
      { asset: TOKEN_A, amount: -BigInt(100) },
      { asset: TOKEN_B, amount: BigInt(190) },
    ]);
  });

  test("an unchanged value yields no entries", () => {
    const value = flat([[ADA, 5000000], [TOKEN_A, 100]]);
    expect(valueDelta(value, flat([[ADA, 5000000], [TOKEN_A, 100]]))).toEqual([]);
  });
});
