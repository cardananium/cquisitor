// Splash decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRole,
  type DexRow,
  type PoolPair,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, Credential, PD, PlutusAddress, Rational } from "@/utils/protocols/dex/plutusData";
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

// Build full-value DexRows for a Cardano Address: one row for the payment
// credential and (when present) one for the stake credential. The shared hash
// component truncates + copies the full hash; script-ness goes into the label.
// Dropping the address loses where the order's proceeds settle / who can cancel.
function addressRows(label: string, addr: PlutusAddress): DexRow[] {
  const c = addr.paymentCredential;
  const kind = c.kind === "Script" ? "script" : "key";
  const rows: DexRow[] = [{ label: `${label} (${kind})`, value: c.hash, hash: true }];
  const stake = addr.stakeCredential;
  if (stake) {
    if (stake.kind === "Inline") {
      const sk = stake.credential.kind === "Script" ? "script" : "key";
      rows.push({ label: `${label} stake (${sk})`, value: stake.credential.hash, hash: true });
    } else {
      rows.push({
        label: `${label} stake (pointer)`,
        value: `slot ${stake.slotNumber}, txIdx ${stake.transactionIndex}, certIdx ${stake.certificateIndex}`,
      });
    }
  }
  return rows;
}

// One row carrying a bare Credential's full hash (script-ness in the label).
function credentialRow(label: string, c: Credential): DexRow {
  return { label: `${label} (${c.kind === "Script" ? "script" : "key"})`, value: c.hash, hash: true };
}

// DAOPolicy rows: the governance credential(s) authorized for DAO/admin actions
// on a pool. Dropping it loses who controls the pool's treasury/fee switch.
function daoPolicyRows(policy: Credential[]): DexRow[] {
  if (policy.length === 0) return [{ label: "DAO policy", value: "none" }];
  return policy.map((c, i) =>
    credentialRow(policy.length > 1 ? `DAO policy ${i + 1}` : "DAO policy", c),
  );
}

function orderToView(order: SplashOrder): DexOrderView {
  const assets: DexAssetRow[] = [
    { label: "Input", policyId: order.input.policyId, assetName: order.input.assetName },
    { label: "Output", policyId: order.output.policyId, assetName: order.output.assetName },
  ];
  // Genuine 2-asset trade: the order's input (give) vs output (get) assets.
  const pair: PoolPair = {
    assetA: { policyId: order.input.policyId, assetName: order.input.assetName },
    assetB: { policyId: order.output.policyId, assetName: order.output.assetName },
  };
  if (order.kind === "Limit") {
    const rows: DexRow[] = [
      { label: "Base price", value: formatRational(order.basePrice) },
      { label: "Tradable input", value: order.tradableInput.toLocaleString() },
      { label: "Min marginal output", value: order.minMarginalOutput.toLocaleString() },
      { label: "Cost per exec step", value: order.costPerExStep.toLocaleString() },
      { label: "Fee", value: order.fee.toLocaleString() },
      { label: "Beacon", value: order.beacon, hash: true },
      ...addressRows("Redeemer address", order.redeemerAddress),
      { label: "Cancellation PKH", value: order.cancellationPkh, hash: true },
      {
        label: "Executors",
        value: order.permittedExecutors.length === 0
          ? "permissionless"
          : order.permittedExecutors.join(", "),
      },
    ];
    return { protocol: "Splash", role: "order", kind: "Limit order", rows, assets, issues: [], pair };
  }
  const rows: DexRow[] = [
    { label: "Base price", value: formatRational(order.basePrice) },
    { label: "Fee", value: order.fee.toLocaleString() },
    { label: "Min lovelace", value: order.minLovelace.toLocaleString() },
    { label: "Cancellation after", value: `${order.cancellationAfter.toLocaleString()} (POSIX ms)` },
    ...addressRows("Redeemer address", order.redeemerAddress),
    { label: "Cancellation PKH", value: order.cancellationPkh, hash: true },
    order.permittedExecutor
      ? { label: "Executor", value: order.permittedExecutor, hash: true }
      : { label: "Executor", value: "permissionless" },
  ];
  return { protocol: "Splash", role: "order", kind: "Instant order", rows, assets, issues: [], pair };
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
  rows.push(...daoPolicyRows(pool.daoPolicy));
  const assets: DexAssetRow[] = [
    { label: "Asset X", policyId: pool.assetX.policyId, assetName: pool.assetX.assetName },
    { label: "Asset Y", policyId: pool.assetY.policyId, assetName: pool.assetY.assetName },
  ];
  // The traded pair is the two pool reserves (assetX / assetY), NOT the pool
  // NFT or the LP token.
  const pair: PoolPair = {
    assetA: { policyId: pool.assetX.policyId, assetName: pool.assetX.assetName },
    assetB: { policyId: pool.assetY.policyId, assetName: pool.assetY.assetName },
  };
  return { protocol: "Splash", role: "pool", kind: "Liquidity Pool (CFMM)", rows, assets, issues: [], pair };
}

function stablePoolToView(pool: SplashStablePool): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool family", value: "Stableswap" },
    { label: "Amplification coeff", value: pool.amplCoeff.toLocaleString() },
    { label: "LP fee", value: `${pool.lpFeeNum} / 100,000` },
    { label: "Protocol fee", value: `${pool.protocolFeeNum} / 100,000` },
    { label: "LP fee editable", value: pool.lpFeeIsEditable ? "yes" : "no" },
    { label: "Flag 2", value: pool.flag2 ? "true" : "false" },
    { label: "Token multipliers", value: pool.tradableTokensMultipliers.map((m) => m.toString()).join(", ") },
    { label: "Collected protocol fees", value: pool.protocolFees.map((m) => m.toLocaleString()).join(", ") },
    { label: "Pool NFT", ...assetRowValue(pool.poolNft) },
    { label: "LP token", ...assetRowValue(pool.lpToken) },
    {
      label: "DAO stable proxy witness",
      value: pool.daoStableProxyWitness || "(empty)",
      hash: !!pool.daoStableProxyWitness,
    },
    {
      label: "Treasury address",
      value: pool.treasuryAddress || "(empty)",
      hash: !!pool.treasuryAddress,
    },
  ];
  const assets: DexAssetRow[] = pool.tradableAssets.map((a, i) => ({
    label: `Asset ${i + 1}`,
    policyId: a.policyId,
    assetName: a.assetName,
  }));
  // Fixed-2-asset (t2t) stableswap: the two tradable assets are the traded pair
  // (NOT the pool NFT / LP token).
  const [sx, sy] = pool.tradableAssets;
  const pair: PoolPair | undefined =
    sx && sy
      ? {
          assetA: { policyId: sx.policyId, assetName: sx.assetName },
          assetB: { policyId: sy.policyId, assetName: sy.assetName },
        }
      : undefined;
  return { protocol: "Splash", role: "stable-pool", kind: "Liquidity Pool (Stableswap)", rows, assets, issues: [], pair };
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
  rows.push(...daoPolicyRows(pool.daoPolicy));
  const assets: DexAssetRow[] = [
    { label: "Asset X", policyId: pool.assetX.policyId, assetName: pool.assetX.assetName },
    { label: "Asset Y", policyId: pool.assetY.policyId, assetName: pool.assetY.assetName },
  ];
  // Weighted pool's traded pair is its two reserves (assetX / assetY), NOT the
  // pool NFT or the LP token.
  const pair: PoolPair = {
    assetA: { policyId: pool.assetX.policyId, assetName: pool.assetX.assetName },
    assetB: { policyId: pool.assetY.policyId, assetName: pool.assetY.assetName },
  };
  return { protocol: "Splash", role: "balance-pool", kind: "Liquidity Pool (Weighted)", rows, assets, issues: [], pair };
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
  // The proxy order identifies its CFMM pool by the pool NFT; resolve that pool
  // UTxO's datum back into assetX / assetY so the panel shows the real pair.
  return {
    protocol: "Splash",
    role,
    kind,
    rows,
    assets,
    issues: [],
    poolRef: order.poolNft.policyId
      ? { policyId: order.poolNft.policyId, assetName: order.poolNft.assetName }
      : undefined,
  };
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
    ...addressRows("Redeemer address", order.redeemerAddress),
    { label: "Cancellation PKH", value: order.cancellationPkh, hash: true },
  ];
  const assets: DexAssetRow[] = [
    { label: "Token", policyId: order.token.policyId, assetName: order.token.assetName },
  ];
  // A grid (DCA-style) bid/ask trades the single `token` against ADA: every
  // counter-side field (lovelace offer / budget / min-out lovelace) is
  // lovelace-denominated, so the traded pair is token / ADA (ADA = ("", "")).
  const pair: PoolPair = {
    assetA: { policyId: order.token.policyId, assetName: order.token.assetName },
    assetB: { policyId: "", assetName: "" },
  };
  return { protocol: "Splash (grid)", role: "grid-order", kind: "Grid order", rows, assets, issues: [], pair };
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
  rows.push(...daoPolicyRows(pool.daoPolicy));
  const assets: DexAssetRow[] = [
    { label: "Asset X", policyId: pool.poolX.policyId, assetName: pool.poolX.assetName },
    { label: "Asset Y", policyId: pool.poolY.policyId, assetName: pool.poolY.assetName },
  ];
  // Royalty pool is a const-product CFMM (with an extra royalty fee); its traded
  // pair is the two reserves (poolX / poolY), NOT the pool NFT or LP token.
  const pair: PoolPair = {
    assetA: { policyId: pool.poolX.policyId, assetName: pool.poolX.assetName },
    assetB: { policyId: pool.poolY.policyId, assetName: pool.poolY.assetName },
  };
  return { protocol: "Splash (royalty)", role: "royalty-pool", kind: "Liquidity Pool (Royalty)", rows, assets, issues: [], pair };
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
  // A proxy order references its pool only by the pool NFT (`poolRef`). The
  // resolved pool UTxO is a const-product CFMM PoolConfig whose datum carries
  // assetX / assetY directly — decode them into the traded pair.
  parsePoolPair: (poolDatum: PD) => {
    const p = parseSplashPool(poolDatum);
    return {
      assetA: { policyId: p.assetX.policyId, assetName: p.assetX.assetName },
      assetB: { policyId: p.assetY.policyId, assetName: p.assetY.assetName },
    };
  },
});

export * from "./datums";
export { SPLASH } from "./constants";
