// Splash decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD, Rational } from "@/utils/protocols/dex/plutusData";
import { matchSplashScriptHash } from "./constants";
import {
  classifySplashGridOrderRedeemer,
  classifySplashOrderRedeemer,
  classifySplashPoolRedeemer,
  classifySplashProxyOrderRedeemer,
  classifySplashRoyaltyPoolRedeemer,
  classifySplashStablePoolRedeemer,
  parseSplashBalancePool,
  parseSplashGridOrder,
  parseSplashOrder,
  parseSplashPool,
  parseSplashProxyDeposit,
  parseSplashProxyRedeem,
  parseSplashProxySwap,
  parseSplashRoyaltyPool,
  parseSplashStablePool,
  type SplashBalancePool,
  type SplashGridOrder,
  type SplashOrder,
  type SplashPoolConfig,
  type SplashProxyDeposit,
  type SplashProxyRedeem,
  type SplashProxySwap,
  type SplashRoyaltyPool,
  type SplashStablePool,
} from "./datums";

// Returns the structured asset field for a full AssetClass. The panel renders
// the decoded name (with policy id on hover/copy) and shows ADA for ("", "").
function assetRowValue(asset: AssetClass): { asset: { policyId: string; assetName: string } } {
  return { asset: { policyId: asset.policyId, assetName: asset.assetName } };
}

function formatRational(r: Rational): string {
  return `${r.numerator.toLocaleString()} / ${r.denominator.toLocaleString()}`;
}

function orderToView(order: SplashOrder): DexOrderView {
  const assets: DexAssetRow[] = [
    { label: "Input", policyId: order.input.policyId, assetName: order.input.assetName },
    { label: "Output", policyId: order.output.policyId, assetName: order.output.assetName },
  ];
  if (order.kind === "Limit") {
    const rows: DexRow[] = [
      { label: "Base price", value: formatRational(order.basePrice) },
      { label: "Tradable input", value: order.tradableInput.toLocaleString() },
      { label: "Min marginal output", value: order.minMarginalOutput.toLocaleString() },
      { label: "Cost per exec step", value: order.costPerExStep.toLocaleString() },
      { label: "Fee", value: order.fee.toLocaleString() },
      { label: "Beacon", value: order.beacon, hash: true },
      {
        label: "Executors",
        value: order.permittedExecutors.length === 0
          ? "permissionless"
          : `${order.permittedExecutors.length} permitted`,
      },
    ];
    return { protocol: "Splash", role: "order", kind: "Limit order", rows, assets, issues: [] };
  }
  const rows: DexRow[] = [
    { label: "Base price", value: formatRational(order.basePrice) },
    { label: "Fee", value: order.fee.toLocaleString() },
    { label: "Min lovelace", value: order.minLovelace.toLocaleString() },
    { label: "Cancellation after", value: `${order.cancellationAfter.toLocaleString()} (POSIX ms)` },
    order.permittedExecutor
      ? { label: "Executor", value: order.permittedExecutor, hash: true }
      : { label: "Executor", value: "permissionless" },
  ];
  return { protocol: "Splash", role: "order", kind: "Instant order", rows, assets, issues: [] };
}

function poolToView(pool: SplashPoolConfig): DexOrderView {
  const feeDenom = pool.feeSwitch ? 100_000 : 1_000;
  const rows: DexRow[] = [
    { label: "Pool family", value: pool.feeSwitch ? "Const-product (fee-switch)" : "Const-product (classic)" },
    { label: "LP fee", value: `${pool.feeNum} / ${feeDenom}` },
    { label: "Pool NFT", ...assetRowValue(pool.poolNft) },
    { label: "LP token", ...assetRowValue(pool.assetLq) },
  ];
  if (pool.treasuryFee !== null) {
    rows.push({ label: "Treasury fee", value: `${pool.treasuryFee} / ${feeDenom}` });
  }
  if (pool.treasuryX !== null && pool.treasuryY !== null) {
    rows.push({ label: "Treasury X / Y", value: `${pool.treasuryX.toLocaleString()} / ${pool.treasuryY.toLocaleString()}` });
  }
  if (pool.lqBound !== null) {
    rows.push({ label: "LQ lower bound", value: pool.lqBound.toLocaleString() });
  }
  const assets: DexAssetRow[] = [
    { label: "Asset X", policyId: pool.assetX.policyId, assetName: pool.assetX.assetName },
    { label: "Asset Y", policyId: pool.assetY.policyId, assetName: pool.assetY.assetName },
  ];
  return { protocol: "Splash", role: "pool", kind: "Liquidity Pool (CFMM)", rows, assets, issues: [] };
}

function stablePoolToView(pool: SplashStablePool): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool family", value: "Stableswap" },
    { label: "Amplification coeff", value: pool.amplCoeff.toLocaleString() },
    { label: "LP fee", value: `${pool.lpFeeNum} / 100,000` },
    { label: "Protocol fee", value: `${pool.protocolFeeNum} / 100,000` },
    { label: "LP fee editable", value: pool.lpFeeIsEditable ? "yes" : "no" },
    { label: "Token multipliers", value: pool.tradableTokensMultipliers.map((m) => m.toString()).join(", ") },
    { label: "Collected protocol fees", value: pool.protocolFees.map((m) => m.toLocaleString()).join(", ") },
    { label: "Pool NFT", ...assetRowValue(pool.poolNft) },
    { label: "LP token", ...assetRowValue(pool.lpToken) },
    { label: "Treasury address", value: pool.treasuryAddress, hash: true },
  ];
  const assets: DexAssetRow[] = pool.tradableAssets.map((a, i) => ({
    label: `Asset ${i + 1}`,
    policyId: a.policyId,
    assetName: a.assetName,
  }));
  return { protocol: "Splash", role: "stable-pool", kind: "Liquidity Pool (Stableswap)", rows, assets, issues: [] };
}

function balancePoolToView(pool: SplashBalancePool): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool family", value: "Balance-function (weighted)" },
    { label: "LP fee", value: `${pool.feeNum} / 100,000` },
    { label: "Treasury fee", value: `${pool.treasuryFee} / 100,000` },
    { label: "Treasury X / Y", value: `${pool.treasuryX.toLocaleString()} / ${pool.treasuryY.toLocaleString()}` },
    { label: "Pool NFT", ...assetRowValue(pool.poolNft) },
    { label: "LP token", ...assetRowValue(pool.assetLq) },
  ];
  if (pool.treasuryAddress) {
    rows.push({ label: "Treasury address", value: pool.treasuryAddress, hash: true });
  }
  const assets: DexAssetRow[] = [
    { label: "Asset X", policyId: pool.assetX.policyId, assetName: pool.assetX.assetName },
    { label: "Asset Y", policyId: pool.assetY.policyId, assetName: pool.assetY.assetName },
  ];
  return { protocol: "Splash", role: "balance-pool", kind: "Liquidity Pool (Weighted)", rows, assets, issues: [] };
}

function proxyOrderToView(
  order: SplashProxySwap | SplashProxyDeposit | SplashProxyRedeem,
  role: string,
): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool NFT", ...assetRowValue(order.poolNft) },
    { label: "Reward PKH", value: order.rewardPkh, hash: true },
    order.stakePkh
      ? { label: "Stake PKH", value: order.stakePkh, hash: true }
      : { label: "Stake PKH", value: "none" },
  ];
  let assets: DexAssetRow[] = [];
  let kind = "AMM proxy order";
  if (order.kind === "Swap") {
    kind = "AMM proxy swap";
    rows.unshift(
      { label: "Pool fee num", value: order.feeNum.toString() },
      { label: "Base amount", value: order.baseAmount.toLocaleString() },
      { label: "Min quote amount", value: order.minQuoteAmount.toLocaleString() },
      { label: "Exec fee / token", value: `${order.exFeePerTokenNum} / ${order.exFeePerTokenDen}` },
    );
    assets = [
      { label: "Base (in)", policyId: order.base.policyId, assetName: order.base.assetName },
      { label: "Quote (out)", policyId: order.quote.policyId, assetName: order.quote.assetName },
    ];
  } else if (order.kind === "Deposit") {
    kind = "AMM proxy deposit";
    rows.unshift(
      { label: "Exec fee", value: order.exFee.toLocaleString() },
      { label: "Collateral ADA", value: order.collateralAda.toLocaleString() },
    );
    assets = [
      { label: "Token A", policyId: order.tokenA.policyId, assetName: order.tokenA.assetName },
      { label: "Token B", policyId: order.tokenB.policyId, assetName: order.tokenB.assetName },
      { label: "LP token", policyId: order.tokenLp.policyId, assetName: order.tokenLp.assetName },
    ];
  } else {
    kind = "AMM proxy redeem";
    rows.unshift({ label: "Exec fee", value: order.exFee.toLocaleString() });
    assets = [
      { label: "Pool X", policyId: order.poolX.policyId, assetName: order.poolX.assetName },
      { label: "Pool Y", policyId: order.poolY.policyId, assetName: order.poolY.assetName },
      { label: "LP token", policyId: order.poolLp.policyId, assetName: order.poolLp.assetName },
    ];
  }
  return { protocol: "Splash", role, kind, rows, assets, issues: [] };
}

function gridOrderToView(order: SplashGridOrder): DexOrderView {
  const rows: DexRow[] = [
    { label: "Side", value: order.side ? "Bid" : "Ask" },
    { label: "Price", value: formatRational(order.price) },
    { label: "Buy shift factor", value: formatRational(order.buyShiftFactor) },
    { label: "Sell shift factor", value: formatRational(order.sellShiftFactor) },
    { label: "Lovelace offer", value: order.lovelaceOffer.toLocaleString() },
    { label: "Max lovelace offer", value: order.maxLovelaceOffer.toLocaleString() },
    { label: "Budget per transaction", value: order.budgetPerTransaction.toLocaleString() },
    { label: "Min marginal out (lovelace)", value: order.minMarginalOutputLovelace.toLocaleString() },
    { label: "Min marginal out (token)", value: order.minMarginalOutputToken.toLocaleString() },
    { label: "Beacon", value: order.beacon, hash: true },
    { label: "Cancellation PKH", value: order.cancellationPkh, hash: true },
  ];
  const assets: DexAssetRow[] = [
    { label: "Token", policyId: order.token.policyId, assetName: order.token.assetName },
  ];
  return { protocol: "Splash (grid)", role: "grid-order", kind: "Grid order", rows, assets, issues: [] };
}

function royaltyPoolToView(pool: SplashRoyaltyPool): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool family", value: "Royalty pool" },
    { label: "LP fee", value: `${pool.feeNum} / 100,000` },
    { label: "Treasury fee", value: `${pool.treasuryFee} / 100,000` },
    { label: "Royalty fee", value: `${pool.royaltyFee} / 100,000` },
    { label: "Treasury X / Y", value: `${pool.treasuryX.toLocaleString()} / ${pool.treasuryY.toLocaleString()}` },
    { label: "Royalty X / Y", value: `${pool.royaltyX.toLocaleString()} / ${pool.royaltyY.toLocaleString()}` },
    { label: "Nonce", value: pool.nonce.toLocaleString() },
    { label: "Pool NFT", ...assetRowValue(pool.poolNft) },
    { label: "LP token", ...assetRowValue(pool.poolLq) },
    { label: "Treasury address", value: pool.treasuryAddress, hash: true },
    { label: "Royalty pub key", value: pool.royaltyPubKey, hash: true },
  ];
  const assets: DexAssetRow[] = [
    { label: "Asset X", policyId: pool.poolX.policyId, assetName: pool.poolX.assetName },
    { label: "Asset Y", policyId: pool.poolY.policyId, assetName: pool.poolY.assetName },
  ];
  return { protocol: "Splash (royalty)", role: "royalty-pool", kind: "Liquidity Pool (Royalty)", rows, assets, issues: [] };
}

function decodeSplash(datum: PD, role: DexRole): DexOrderView {
  switch (role) {
    case "pool":
      return poolToView(parseSplashPool(datum));
    case "stable-pool":
      return stablePoolToView(parseSplashStablePool(datum));
    case "balance-pool":
      return balancePoolToView(parseSplashBalancePool(datum));
    case "proxy-swap-order":
      return proxyOrderToView(parseSplashProxySwap(datum), role);
    case "proxy-deposit-order":
      return proxyOrderToView(parseSplashProxyDeposit(datum), role);
    case "proxy-redeem-order":
      return proxyOrderToView(parseSplashProxyRedeem(datum), role);
    case "grid-order":
      return gridOrderToView(parseSplashGridOrder(datum));
    case "royalty-pool":
      return royaltyPoolToView(parseSplashRoyaltyPool(datum));
    default:
      return orderToView(parseSplashOrder(datum));
  }
}

function classifySplashRedeemer(redeemer: PD, role: DexRole): string | null {
  switch (role) {
    case "stable-pool":
      return classifySplashStablePoolRedeemer(redeemer);
    case "proxy-swap-order":
    case "proxy-deposit-order":
    case "proxy-redeem-order":
      return classifySplashProxyOrderRedeemer(redeemer);
    case "grid-order":
      return classifySplashGridOrderRedeemer(redeemer);
    case "royalty-pool":
      return classifySplashRoyaltyPoolRedeemer(redeemer);
    case "pool":
    case "balance-pool":
      // Const-product / balance pool spend = Constr0[in_ix, out_ix], NOT the
      // bare-Bool order redeemer.
      return classifySplashPoolRedeemer(redeemer);
    case "order":
    default:
      // limit/instant orders use the bare-Bool execute/cancel redeemer.
      return classifySplashOrderRedeemer(redeemer);
  }
}

registerDexAdapter({
  id: "splash",
  label: "Splash",
  matchScriptHash: matchSplashScriptHash,
  decode: decodeSplash,
  classifyRedeemer: classifySplashRedeemer,
});

export * from "./datums";
export { SPLASH } from "./constants";
