// Minswap V2 decoder: turns parsed datums into the normalized DexOrderView and
// self-registers the adapter so the transaction card view picks it up.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type {
  AssetClass,
  Credential,
  PD,
  PlutusAddress,
  StakeCredential,
} from "@/utils/protocols/dex/plutusData";
import {
  matchMinswapV2ScriptHash,
  matchMinswapV1ScriptHash,
  matchMinswapStableswapScriptHash,
} from "./constants";
import { MINSWAP_STABLESWAP_PAIRS } from "./stableswapPairs.generated";
import {
  classifyMinswapOrderRedeemer,
  parseMinswapOrderDatum,
  parseMinswapPoolDatum,
  type ExtraOrderDatum,
  type MinswapOrderDatum,
  type MinswapPoolDatum,
  type OrderAuthorizationMethod,
  type OrderStep,
  type SwapAmountOption,
} from "./v2";
import {
  classifyMinswapV1OrderRedeemer,
  classifyMinswapStableswapOrderRedeemer,
  parseMinswapV1OrderDatum,
  parseMinswapV1PoolDatum,
  parseMinswapStableswapOrderDatum,
  parseMinswapStableswapPoolDatum,
  type MinswapV1OrderDatum,
  type MinswapV1PoolDatum,
  type MinswapStableswapOrderDatum,
  type MinswapStableswapPoolDatum,
  type StableswapOrderStep,
  type V1OrderStep,
} from "./v1";
import type { DexRole } from "@/utils/protocols/dex/registry";
import type { CardanoNetwork } from "@/components/TransactionCardView/types";

const FEE_DENOMINATOR = 10_000;

function isAda(asset: AssetClass): boolean {
  return asset.policyId === "" && asset.assetName === "";
}

function assetRow(label: string, asset: AssetClass): DexRow {
  return { label, asset: { policyId: asset.policyId, assetName: asset.assetName } };
}

function maybeRow(row: DexRow | null): DexRow[] {
  return row ? [row] : [];
}

function credKind(c: Credential): string {
  return c.kind === "Script" ? "script" : "key";
}

function stakeCredentialSuffix(stake: StakeCredential | null): string {
  if (!stake) return "";
  if (stake.kind === "Inline") {
    return ` / stake ${credKind(stake.credential)} ${stake.credential.hash}`;
  }
  return ` / stake pointer (${stake.slotNumber}, ${stake.transactionIndex}, ${stake.certificateIndex})`;
}

// One row carrying an address' full payment-credential hash (hash:true for the
// truncate+copy tooltip); script-ness + any stake credential go into the value.
function addressRow(label: string, addr: PlutusAddress): DexRow {
  const c = addr.paymentCredential;
  return {
    label: `${label} (${credKind(c)})`,
    value: `${c.hash}${stakeCredentialSuffix(addr.stakeCredential)}`,
    hash: true,
  };
}

// V2 ExtraOrderDatum: NoDatum carries nothing; DatumHash/InlineDatum carry a
// 32-byte CustomDatumHash that pins the receiver output's datum.
function extraDatumRow(label: string, extra: ExtraOrderDatum): DexRow | null {
  switch (extra.kind) {
    case "NoDatum":
      return null;
    case "DatumHash":
      return { label: `${label} (datum hash)`, value: extra.hash, hash: true };
    case "InlineDatum":
      return { label: `${label} (inline datum hash)`, value: extra.hash, hash: true };
  }
}

function formatLovelace(lovelace: bigint): string {
  const ada = Number(lovelace) / 1_000_000;
  return `${lovelace.toLocaleString()} lovelace (~₳${ada.toLocaleString(undefined, { maximumFractionDigits: 6 })})`;
}

function describeSwapAmount(opt: SwapAmountOption): string {
  return opt.kind === "SpecificAmount"
    ? opt.swapAmount.toLocaleString()
    : `all available (− ${opt.deductedAmount.toLocaleString()})`;
}

function cancellerRow(c: OrderAuthorizationMethod): DexRow {
  switch (c.kind) {
    case "Signature":
      return { label: "Canceller (signature)", value: c.pubKeyHash, hash: true };
    case "SpendScript":
      return { label: "Canceller (spend script)", value: c.scriptHash, hash: true };
    case "WithdrawScript":
      return { label: "Canceller (withdraw script)", value: c.scriptHash, hash: true };
    case "MintScript":
      return { label: "Canceller (mint script)", value: c.scriptHash, hash: true };
  }
}

const STEP_LABELS: Record<OrderStep["kind"], string> = {
  SwapExactIn: "Swap (exact in)",
  StopLoss: "Stop loss",
  OCO: "OCO (one-cancels-other)",
  SwapExactOut: "Swap (exact out)",
  Deposit: "Deposit (add liquidity)",
  Withdraw: "Withdraw (remove liquidity)",
  ZapOut: "Zap out",
  PartialSwap: "Partial swap",
  WithdrawImbalance: "Withdraw (imbalanced)",
  SwapMultiRouting: "Swap (multi-routing)",
  Donation: "Donation",
};

function direction(aToB: boolean): string {
  return aToB ? "A → B" : "B → A";
}

function stepRows(step: OrderStep): DexRow[] {
  switch (step.kind) {
    case "SwapExactIn":
      return [
        { label: "Direction", value: direction(step.aToBDirection) },
        { label: "Swap amount", value: describeSwapAmount(step.swapAmountOption) },
        { label: "Minimum receive", value: step.minimumReceive.toLocaleString() },
        { label: "Killable", value: String(step.killable) },
      ];
    case "StopLoss":
      return [
        { label: "Direction", value: direction(step.aToBDirection) },
        { label: "Swap amount", value: describeSwapAmount(step.swapAmountOption) },
        { label: "Stop-loss receive", value: step.stopLossReceive.toLocaleString() },
      ];
    case "OCO":
      return [
        { label: "Direction", value: direction(step.aToBDirection) },
        { label: "Swap amount", value: describeSwapAmount(step.swapAmountOption) },
        { label: "Minimum receive", value: step.minimumReceive.toLocaleString() },
        { label: "Stop-loss receive", value: step.stopLossReceive.toLocaleString() },
      ];
    case "SwapExactOut":
      return [
        { label: "Direction", value: direction(step.aToBDirection) },
        { label: "Max swap amount", value: describeSwapAmount(step.maximumSwapAmountOption) },
        { label: "Expected receive", value: step.expectedReceive.toLocaleString() },
        { label: "Killable", value: String(step.killable) },
      ];
    case "Deposit":
      return [
        {
          label: "Deposit amounts",
          value:
            step.depositAmountOption.kind === "SpecificAmount"
              ? `A ${step.depositAmountOption.depositAmountA.toLocaleString()}, B ${step.depositAmountOption.depositAmountB.toLocaleString()}`
              : `all available (−A ${step.depositAmountOption.deductedAmountA.toLocaleString()}, −B ${step.depositAmountOption.deductedAmountB.toLocaleString()})`,
        },
        { label: "Minimum LP", value: step.minimumLp.toLocaleString() },
        { label: "Killable", value: String(step.killable) },
      ];
    case "Withdraw":
      return [
        {
          label: "LP to withdraw",
          value:
            step.withdrawalAmountOption.kind === "SpecificAmount"
              ? step.withdrawalAmountOption.withdrawalLpAmount.toLocaleString()
              : `all available (− ${step.withdrawalAmountOption.deductedAmountLp.toLocaleString()})`,
        },
        { label: "Minimum asset A", value: step.minimumAssetA.toLocaleString() },
        { label: "Minimum asset B", value: step.minimumAssetB.toLocaleString() },
        { label: "Killable", value: String(step.killable) },
      ];
    case "ZapOut":
      return [
        { label: "Direction", value: direction(step.aToBDirection) },
        {
          label: "LP to withdraw",
          value:
            step.withdrawalAmountOption.kind === "SpecificAmount"
              ? step.withdrawalAmountOption.withdrawalLpAmount.toLocaleString()
              : `all available (− ${step.withdrawalAmountOption.deductedAmountLp.toLocaleString()})`,
        },
        { label: "Minimum receive", value: step.minimumReceive.toLocaleString() },
        { label: "Killable", value: String(step.killable) },
      ];
    case "PartialSwap":
      return [
        { label: "Direction", value: direction(step.aToBDirection) },
        { label: "Total swap amount", value: step.totalSwapAmount.toLocaleString() },
        { label: "I/O ratio", value: `${step.ioRatioNumerator.toLocaleString()} / ${step.ioRatioDenominator.toLocaleString()}` },
        { label: "Hops", value: step.hops.toLocaleString() },
        { label: "Min swap per hop", value: step.minimumSwapAmountRequired.toLocaleString() },
        { label: "Max batcher fee / hop", value: formatLovelace(step.maxBatcherFeeEachTime) },
      ];
    case "WithdrawImbalance":
      return [
        {
          label: "LP to withdraw",
          value:
            step.withdrawalAmountOption.kind === "SpecificAmount"
              ? step.withdrawalAmountOption.withdrawalLpAmount.toLocaleString()
              : `all available (− ${step.withdrawalAmountOption.deductedAmountLp.toLocaleString()})`,
        },
        { label: "Ratio A : B", value: `${step.ratioAssetA.toLocaleString()} : ${step.ratioAssetB.toLocaleString()}` },
        { label: "Minimum asset A", value: step.minimumAssetA.toLocaleString() },
        { label: "Killable", value: String(step.killable) },
      ];
    case "SwapMultiRouting":
      return [
        { label: "Routings", value: `${step.routings.length} pool(s)` },
        ...step.routings.flatMap((r, i): DexRow[] => [
          assetRow(`Routing ${i + 1} pool LP`, r.lpAsset),
          { label: `Routing ${i + 1} direction`, value: direction(r.aToBDirection) },
        ]),
        { label: "Swap amount", value: describeSwapAmount(step.swapAmountOption) },
        { label: "Minimum receive", value: step.minimumReceive.toLocaleString() },
      ];
    case "Donation":
      return [];
  }
}

function validateOrder(datum: MinswapOrderDatum): DexIssue[] {
  const issues: DexIssue[] = [];
  if (datum.maxBatcherFee <= BigInt(0)) {
    issues.push({
      severity: "warning",
      message: `maxBatcherFee is ${datum.maxBatcherFee}; a positive lovelace value is expected`,
    });
  }
  const step = datum.step;
  if ((step.kind === "SwapExactIn" || step.kind === "OCO" || step.kind === "ZapOut" || step.kind === "SwapMultiRouting") && step.minimumReceive < BigInt(0)) {
    issues.push({ severity: "error", message: "minimumReceive cannot be negative" });
  }
  if (step.kind === "SwapExactOut" && step.expectedReceive <= BigInt(0)) {
    issues.push({ severity: "warning", message: "SwapExactOut expectedReceive should be positive" });
  }
  if (isAda(datum.lpAsset)) {
    issues.push({ severity: "warning", message: "Order has no pool LP asset set" });
  }
  return issues;
}

export function minswapOrderToView(datum: MinswapOrderDatum): DexOrderView {
  const rows: DexRow[] = [
    ...stepRows(datum.step),
    addressRow("Success receiver", datum.successReceiver),
    ...maybeRow(extraDatumRow("Success receiver datum", datum.successReceiverDatum)),
    addressRow("Refund receiver", datum.refundReceiver),
    ...maybeRow(extraDatumRow("Refund receiver datum", datum.refundReceiverDatum)),
    { label: "Max batcher fee", value: formatLovelace(datum.maxBatcherFee) },
    cancellerRow(datum.canceller),
  ];
  if (datum.expirySetting) {
    rows.push({
      label: "Expiry",
      value: `slot ${datum.expirySetting.expiredTime.toLocaleString()} (max tip ${formatLovelace(datum.expirySetting.maxCancellationTip)})`,
    });
  }
  const assets: DexAssetRow[] = [
    { label: "Pool LP token", policyId: datum.lpAsset.policyId, assetName: datum.lpAsset.assetName },
  ];
  return {
    protocol: "Minswap V2",
    role: "order",
    kind: STEP_LABELS[datum.step.kind],
    rows,
    assets,
    issues: validateOrder(datum),
    // The order only stores the pool's LP token; resolve it to show the pair.
    // Skip multi-routing: its lp_asset is just the entry pool, so a single pair
    // would mislead on a multi-hop swap — the per-routing LP rows show the path.
    poolRef:
      datum.step.kind !== "SwapMultiRouting" && datum.lpAsset.policyId
        ? { policyId: datum.lpAsset.policyId, assetName: datum.lpAsset.assetName }
        : undefined,
  };
}

function stakeCredentialRow(label: string, stake: StakeCredential): DexRow {
  if (stake.kind === "Inline") {
    return {
      label: `${label} (${credKind(stake.credential)})`,
      value: stake.credential.hash,
      hash: true,
    };
  }
  return {
    label: `${label} (pointer)`,
    value: `(${stake.slotNumber}, ${stake.transactionIndex}, ${stake.certificateIndex})`,
  };
}

export function minswapPoolToView(datum: MinswapPoolDatum): DexOrderView {
  const rows: DexRow[] = [
    stakeCredentialRow("Pool batching stake credential", datum.poolBatchingStakeCredential),
    { label: "Total LP minted", value: datum.totalLiquidity.toLocaleString() },
    { label: "Base fee A", value: `${datum.baseFeeANumerator} / ${FEE_DENOMINATOR}` },
    { label: "Base fee B", value: `${datum.baseFeeBNumerator} / ${FEE_DENOMINATOR}` },
    { label: "Allow dynamic fee", value: String(datum.allowDynamicFee) },
  ];
  if (datum.feeSharingNumerator !== null) {
    rows.push({ label: "Fee sharing", value: `${datum.feeSharingNumerator} / ${FEE_DENOMINATOR}` });
  }
  const assets: DexAssetRow[] = [
    { label: "Reserve A", policyId: datum.assetA.policyId, assetName: datum.assetA.assetName, amount: datum.reserveA },
    { label: "Reserve B", policyId: datum.assetB.policyId, assetName: datum.assetB.assetName, amount: datum.reserveB },
  ];
  return {
    protocol: "Minswap V2",
    role: "pool",
    kind: "Liquidity Pool",
    rows,
    assets,
    issues: [],
    // The pool datum carries both reserve assets directly — surface them as the
    // trading pair (the two reserves, not the LP token / pool NFT).
    pair: {
      assetA: { policyId: datum.assetA.policyId, assetName: datum.assetA.assetName },
      assetB: { policyId: datum.assetB.policyId, assetName: datum.assetB.assetName },
    },
  };
}

// --- Minswap V1 (legacy) views ---------------------------------------------

function lovelace(n: bigint): string {
  return `${n.toLocaleString()} lovelace`;
}

function v1StepRows(step: V1OrderStep): DexRow[] {
  switch (step.kind) {
    case "SwapExactIn":
      return [
        assetRow("Desired asset", step.desiredAsset),
        { label: "Minimum received", value: step.minimumReceived.toLocaleString() },
      ];
    case "SwapExactOut":
      return [
        assetRow("Desired asset", step.desiredAsset),
        { label: "Expected received", value: step.expectedReceived.toLocaleString() },
      ];
    case "Deposit":
      return [{ label: "Minimum LP", value: step.minimumLP.toLocaleString() }];
    case "Withdraw":
      return [
        { label: "Minimum asset A", value: step.minimumAssetA.toLocaleString() },
        { label: "Minimum asset B", value: step.minimumAssetB.toLocaleString() },
      ];
    case "ZapIn":
      return [
        assetRow("Desired asset", step.desiredAsset),
        { label: "Minimum LP", value: step.minimumLP.toLocaleString() },
      ];
  }
}

const V1_STEP_LABELS: Record<V1OrderStep["kind"], string> = {
  SwapExactIn: "Swap (exact in)",
  SwapExactOut: "Swap (exact out)",
  Deposit: "Deposit",
  Withdraw: "Withdraw",
  ZapIn: "Zap in",
};

export function minswapV1OrderToView(datum: MinswapV1OrderDatum): DexOrderView {
  const rows: DexRow[] = [
    ...v1StepRows(datum.step),
    addressRow("Receiver", datum.receiver),
  ];
  if (datum.receiverDatumHash !== null) {
    rows.push({ label: "Receiver datum hash", value: datum.receiverDatumHash, hash: true });
  }
  rows.push(
    addressRow("Sender", datum.sender),
    { label: "Batcher fee", value: lovelace(datum.batcherFee) },
    { label: "Deposit ADA", value: lovelace(datum.depositADA) },
  );
  return {
    protocol: "Minswap V1",
    role: "v1-order",
    kind: V1_STEP_LABELS[datum.step.kind],
    rows,
    issues: [],
  };
}

export function minswapV1PoolToView(datum: MinswapV1PoolDatum): DexOrderView {
  const rows: DexRow[] = [
    { label: "Total LP minted", value: datum.totalLiquidity.toLocaleString() },
    { label: "Root k (last)", value: datum.rootKLast.toLocaleString() },
    { label: "Fee sharing", value: datum.feeSharing ? "on" : "off" },
  ];
  if (datum.feeSharing) {
    rows.push(addressRow("Fee-sharing fee-to", datum.feeSharing.feeTo));
    if (datum.feeSharing.feeToDatumHash !== null) {
      rows.push({
        label: "Fee-sharing fee-to datum hash",
        value: datum.feeSharing.feeToDatumHash,
        hash: true,
      });
    }
  }
  return {
    protocol: "Minswap V1",
    role: "v1-pool",
    kind: "Liquidity Pool",
    rows,
    assets: [
      { label: "Asset A", policyId: datum.assetA.policyId, assetName: datum.assetA.assetName },
      { label: "Asset B", policyId: datum.assetB.policyId, assetName: datum.assetB.assetName },
    ],
    issues: [],
    // The pool datum carries both pool assets directly — surface them as the
    // trading pair (the two reserve assets, not the LP token).
    pair: {
      assetA: { policyId: datum.assetA.policyId, assetName: datum.assetA.assetName },
      assetB: { policyId: datum.assetB.policyId, assetName: datum.assetB.assetName },
    },
  };
}

// --- Minswap Stableswap views ----------------------------------------------

function stableStepRows(step: StableswapOrderStep): DexRow[] {
  switch (step.kind) {
    case "Swap":
      return [
        { label: "Asset in → out (index)", value: `${step.assetInIndex} → ${step.assetOutIndex}` },
        { label: "Minimum asset out", value: step.minimumAssetOut.toLocaleString() },
      ];
    case "Deposit":
      return [{ label: "Minimum LP", value: step.minimumLP.toLocaleString() }];
    case "Withdraw":
      return [{ label: "Minimum amounts", value: step.minimumAmounts.map((n) => n.toLocaleString()).join(", ") }];
    case "WithdrawImbalance":
      return [{ label: "Withdraw amounts", value: step.withdrawAmounts.map((n) => n.toLocaleString()).join(", ") }];
    case "ZapOut":
      return [
        { label: "Asset out (index)", value: step.assetOutIndex.toLocaleString() },
        { label: "Minimum asset out", value: step.minimumAssetOut.toLocaleString() },
      ];
  }
}

const STABLE_STEP_LABELS: Record<StableswapOrderStep["kind"], string> = {
  Swap: "Swap",
  Deposit: "Deposit",
  Withdraw: "Withdraw",
  WithdrawImbalance: "Withdraw (imbalanced)",
  ZapOut: "Zap out",
};

export function minswapStableswapOrderToView(datum: MinswapStableswapOrderDatum): DexOrderView {
  const rows: DexRow[] = [
    ...stableStepRows(datum.step),
    addressRow("Receiver", datum.receiver),
  ];
  if (datum.receiverDatumHash !== null) {
    rows.push({ label: "Receiver datum hash", value: datum.receiverDatumHash, hash: true });
  }
  rows.push(
    addressRow("Sender", datum.sender),
    { label: "Batcher fee", value: lovelace(datum.batcherFee) },
    { label: "Deposit ADA", value: lovelace(datum.depositADA) },
  );
  // No `poolRef`: pool-pair resolution is not possible for Minswap Stableswap
  // through the parsePoolPair(poolDatum, ref) mechanism. Verified on chain:
  //  - The order datum carries NO pool token / NFT / LP asset — it only stores
  //    the asset in/out *indices* into the pool's asset list (e.g. Swap 0 → 1)
  //    and sits at a per-pool order-script address. There is nothing to look the
  //    pool UTxO up by.
  //  - The pool inline datum is Constr0[balances, totalLiquidity, amp,
  //    orderHash] — it contains NO asset classes. The traded assets are baked
  //    into the pool validator's compile-time script PARAMETERS (an opaque
  //    Plutus Data constant), and getPoolDatum only returns the inline datum, so
  //    parsePoolPair cannot recover them. We don't guess; the indices are shown
  //    raw in the rows above.
  return {
    protocol: "Minswap Stableswap",
    role: "stableswap-order",
    kind: STABLE_STEP_LABELS[datum.step.kind],
    rows,
    issues: [],
  };
}

export function minswapStableswapPoolToView(datum: MinswapStableswapPoolDatum): DexOrderView {
  return {
    protocol: "Minswap Stableswap",
    role: "stableswap-pool",
    kind: "Stable Pool",
    rows: [
      { label: "Balances", value: datum.balances.map((n) => n.toLocaleString()).join(", ") },
      { label: "Total LP minted", value: datum.totalLiquidity.toLocaleString() },
      { label: "Amplification (A)", value: datum.amplificationCoefficient.toLocaleString() },
      { label: "Order validator", value: datum.orderHash, hash: true },
    ],
    issues: [],
  };
}

// --- Adapter: V2 + V1 + Stableswap, dispatched by the matched role ---------

// Attach the trading pair (resolved once from on-chain reserves) to a
// stableswap view, keyed off the matched per-pool script hash.
function withStableswapPair(view: DexOrderView, scriptHash?: string): DexOrderView {
  const pair = scriptHash ? MINSWAP_STABLESWAP_PAIRS[scriptHash] : undefined;
  if (pair) view.pair = pair;
  return view;
}

function matchMinswap(hash: string, network: Parameters<typeof matchMinswapV2ScriptHash>[1]): DexRole | null {
  return (
    matchMinswapV2ScriptHash(hash, network) ??
    matchMinswapV1ScriptHash(hash, network) ??
    matchMinswapStableswapScriptHash(hash, network)
  );
}

registerDexAdapter({
  id: "minswap",
  label: "Minswap",
  matchScriptHash: matchMinswap,
  decode: (datum: PD, role, scriptHash) => {
    switch (role) {
      case "pool":
        return minswapPoolToView(parseMinswapPoolDatum(datum));
      case "v1-order":
        return minswapV1OrderToView(parseMinswapV1OrderDatum(datum));
      case "v1-pool":
        return minswapV1PoolToView(parseMinswapV1PoolDatum(datum));
      case "stableswap-order":
        // Stableswap orders carry only asset indices; the pair lives in the
        // per-pool script params, so attach it from the resolved-reserves registry.
        return withStableswapPair(
          minswapStableswapOrderToView(parseMinswapStableswapOrderDatum(datum)),
          scriptHash,
        );
      case "stableswap-pool":
        return withStableswapPair(
          minswapStableswapPoolToView(parseMinswapStableswapPoolDatum(datum)),
          scriptHash,
        );
      default: // "order" (V2)
        return minswapOrderToView(parseMinswapOrderDatum(datum));
    }
  },
  classifyRedeemer: (redeemer: PD, role) => {
    if (role === "order") return classifyMinswapOrderRedeemer(redeemer);
    if (role === "v1-order") return classifyMinswapV1OrderRedeemer(redeemer);
    if (role === "stableswap-order") return classifyMinswapStableswapOrderRedeemer(redeemer);
    return null;
  },
  // A V2 order references its pool by the LP token; resolve that pool UTxO's
  // datum back into the two traded assets so the panel can show the pair.
  parsePoolPair: (poolDatum: PD) => {
    // V2 pool datum carries asset_a / asset_b directly (the ref's indices are
    // only needed by multi-asset stableswap pools, handled separately).
    const p = parseMinswapPoolDatum(poolDatum);
    return {
      assetA: { policyId: p.assetA.policyId, assetName: p.assetA.assetName },
      assetB: { policyId: p.assetB.policyId, assetName: p.assetB.assetName },
    };
  },
  // Minswap V2 batches via a withdraw-zero: the order/pool spend defers to this
  // staking validator (the pool datum's pool_batching_stake_credential), which
  // validates the entire batch in one 0-amount withdrawal.
  matchWithdrawalHash: (stakeHash: string, network?: CardanoNetwork): string | null => {
    if (network && network !== "mainnet") return null;
    return stakeHash === "1eae96baf29e27682ea3f815aba361a0c6059d45e4bfbe95bbd2f44a"
      ? "batch validator"
      : null;
  },
});

export * from "./v2";
export { MINSWAP_V2 } from "./constants";
