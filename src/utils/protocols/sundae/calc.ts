// V3 swap outcome calculation, ported from
// sundae-contracts/lib/calculation/swap.ak.
//
// Formula (algebraic CPMM with fee, integer arithmetic, rounded down):
//   takes = (poolTake * (D - fee) * orderGive)
//         / (poolGive * D + orderGive * (D - fee))
// where D is the fee denominator (typically 10_000).
//
// Direction A→B uses the pool's `bidFee`; B→A uses `askFee`.

import type { SundaePoolInfo } from "./api";
import type { AssetAmount as V3AssetAmount } from "./v3";

export type SwapDirection = "AtoB" | "BtoA";

export interface SwapEstimate {
  direction: SwapDirection;
  feeNumer: number;
  feeDenom: number;
  // Estimated received amount (raw on-chain units, rounded down — matches the
  // contract's integer division).
  takes: bigint;
  // Effective price = takes / orderGive, scaled by both assets' decimals so
  // it reads as "1 give = X take" in human units.
  effectivePrice: number | null;
  // Mid-price from current reserves alone (no fee, no slippage).
  midPrice: number | null;
  // takes < minReceived → the order would fail at current pool state.
  meetsMinReceived: boolean;
  // (takes - minReceived) / takes, useful for "you'll get +N% over your floor".
  cushion: number | null;
}

function detectDirection(
  offer: V3AssetAmount,
  pool: SundaePoolInfo
): SwapDirection | null {
  if (
    offer.policyId === pool.assetA.policyId &&
    offer.assetName === pool.assetA.assetNameHex
  ) {
    return "AtoB";
  }
  if (
    offer.policyId === pool.assetB.policyId &&
    offer.assetName === pool.assetB.assetNameHex
  ) {
    return "BtoA";
  }
  return null;
}

function ratio(numer: bigint, denom: bigint, decimals: number): number | null {
  if (denom === BigInt(0)) return null;
  // 12 fractional digits is plenty for display and avoids float overflow on
  // large reserves.
  const scale = BigInt(10) ** BigInt(12);
  const scaled = (numer * scale) / denom;
  const asNumber = Number(scaled) / 1e12;
  if (!Number.isFinite(asNumber)) return null;
  return asNumber * Math.pow(10, decimals);
}

export function estimateV3Swap(
  offer: V3AssetAmount,
  minReceived: V3AssetAmount,
  pool: SundaePoolInfo
): SwapEstimate | null {
  const direction = detectDirection(offer, pool);
  if (!direction) return null;
  const orderGive = offer.amount;
  if (orderGive <= BigInt(0)) return null;

  const isAtoB = direction === "AtoB";
  const poolGive = isAtoB ? pool.reserveA : pool.reserveB;
  const poolTake = isAtoB ? pool.reserveB : pool.reserveA;
  const [feeNumer, feeDenom] = isAtoB ? pool.bidFee : pool.askFee;

  if (poolGive <= BigInt(0) || poolTake <= BigInt(0)) return null;

  const D = BigInt(feeDenom);
  const f = BigInt(feeNumer);
  const diff = D - f; // = D - feeNumer
  const takesNumer = poolTake * diff * orderGive;
  const takesDenom = poolGive * D + orderGive * diff;
  const takes = takesNumer / takesDenom;

  const giveAsset = isAtoB ? pool.assetA : pool.assetB;
  const takeAsset = isAtoB ? pool.assetB : pool.assetA;
  const giveDecimals = giveAsset.decimals ?? 0;
  const takeDecimals = takeAsset.decimals ?? 0;

  // Effective price expressed in "take per give" human units.
  const effectivePrice =
    orderGive > BigInt(0)
      ? ratio(takes, orderGive, giveDecimals - takeDecimals)
      : null;
  // Mid price = poolTake / poolGive in human units (no fees, no slippage).
  const midPrice = ratio(poolTake, poolGive, giveDecimals - takeDecimals);

  const meetsMinReceived = takes >= minReceived.amount;
  const cushion =
    takes > BigInt(0)
      ? Number(takes - minReceived.amount) / Number(takes)
      : null;

  return {
    direction,
    feeNumer,
    feeDenom,
    takes,
    effectivePrice,
    midPrice,
    meetsMinReceived,
    cushion,
  };
}

// --- Deposit ---------------------------------------------------------------
//
// Ported from sundae-contracts/lib/calculation/deposit.ak. The contract does:
//
//   b_in_units_of_a = givesB * A / B
//   if b_in_units_of_a > givesA:
//     depositedA = givesA
//     depositedB = ceildiv(B * givesA, A)            // ceiling, in protocol's favor
//   else:
//     depositedA = b_in_units_of_a                    // == givesB * A / B (floor)
//     depositedB = givesB
//   issuedLp = depositedA * Lp / A
//
// The "leftover" of the asset whose ratio was below the pool's is returned to
// the user as change.

export interface DepositEstimate {
  depositedA: bigint;
  depositedB: bigint;
  changeA: bigint;
  changeB: bigint;
  issuedLp: bigint;
  // What % of the post-deposit LP supply the user owns afterward.
  shareOfPool: number | null;
}

function ceildiv(num: bigint, den: bigint): bigint {
  // Same shape as the contract: (num - 1) / den + 1, only for num > 0.
  if (num <= BigInt(0)) return BigInt(0);
  return (num - BigInt(1)) / den + BigInt(1);
}

export function estimateV3Deposit(
  givesA: V3AssetAmount,
  givesB: V3AssetAmount,
  pool: SundaePoolInfo
): DepositEstimate | null {
  // Sanity-check policy/name match — order of (a, b) in the datum should
  // already match the pool, but guard against pathological input.
  const aMatches =
    givesA.policyId === pool.assetA.policyId &&
    givesA.assetName === pool.assetA.assetNameHex;
  const bMatches =
    givesB.policyId === pool.assetB.policyId &&
    givesB.assetName === pool.assetB.assetNameHex;
  if (!aMatches || !bMatches) return null;

  const A = pool.reserveA;
  const B = pool.reserveB;
  const Lp = pool.reserveLP;
  if (A <= BigInt(0) || B <= BigInt(0) || Lp <= BigInt(0)) return null;

  const ga = givesA.amount;
  const gb = givesB.amount;
  if (ga <= BigInt(0) || gb <= BigInt(0)) return null;

  const bInUnitsOfA = (gb * A) / B;
  let depositedA: bigint;
  let depositedB: bigint;
  if (bInUnitsOfA > ga) {
    // Excess B → return some B as change
    depositedA = ga;
    depositedB = ceildiv(B * ga, A);
  } else {
    // Excess A → return some A as change
    depositedA = bInUnitsOfA;
    depositedB = gb;
  }
  const issuedLp = (depositedA * Lp) / A;
  if (issuedLp <= BigInt(0)) return null;

  const newLp = Lp + issuedLp;
  const shareOfPool =
    newLp > BigInt(0)
      ? Number((issuedLp * BigInt(10) ** BigInt(12)) / newLp) / 1e12
      : null;

  return {
    depositedA,
    depositedB,
    changeA: ga - depositedA,
    changeB: gb - depositedB,
    issuedLp,
    shareOfPool,
  };
}

// --- Withdrawal ------------------------------------------------------------
//
// Ported from sundae-contracts/lib/calculation/withdrawal.ak:
//
//   withdrawn_a = burned * A / Lp
//   withdrawn_b = burned * B / Lp

export interface WithdrawEstimate {
  withdrawnA: bigint;
  withdrawnB: bigint;
  // What % of the pool's reserves the user is pulling out.
  shareOfPool: number | null;
  // The LP burned policy/name was incorrect for this pool.
  lpMismatch: boolean;
}

// --- Stableswap deposit / withdraw ----------------------------------------
//
// Stableswap deposits absorb imbalanced amounts via the invariant change:
//   newD = D(A, qA + givesA, qB + givesB)
//   newLp = (newD - D) * Lp / D
// All of givesA and givesB are taken (no change), unlike V3 which rebalances
// against the pool's current ratio.
//
// Withdrawal is proportional, identical to V3:
//   takenA = burned * qA / Lp
//   takenB = burned * qB / Lp

export function estimateStableswapDeposit(
  givesA: V3AssetAmount,
  givesB: V3AssetAmount,
  pool: SundaePoolInfo
): DepositEstimate | null {
  if (pool.linearAmplificationFactor == null) return null;
  const aMatches =
    givesA.policyId === pool.assetA.policyId &&
    givesA.assetName === pool.assetA.assetNameHex;
  const bMatches =
    givesB.policyId === pool.assetB.policyId &&
    givesB.assetName === pool.assetB.assetNameHex;
  if (!aMatches || !bMatches) return null;

  const A = pool.reserveA;
  const B = pool.reserveB;
  const Lp = pool.reserveLP;
  if (A <= BigInt(0) || B <= BigInt(0) || Lp <= BigInt(0)) return null;
  const ga = givesA.amount;
  const gb = givesB.amount;
  if (ga <= BigInt(0) && gb <= BigInt(0)) return null;

  const amp = BigInt(pool.linearAmplificationFactor);
  const oldD = getSumInvariant(amp, A, B);
  if (oldD === null || oldD === BigInt(0)) return null;
  const newD = getSumInvariant(amp, A + ga, B + gb);
  if (newD === null) return null;
  const deltaD = newD - oldD;
  if (deltaD <= BigInt(0)) return null;
  const issuedLp = (deltaD * Lp) / oldD;
  if (issuedLp <= BigInt(0)) return null;

  // Stableswap consumes all of givesA and givesB; no change is returned.
  const newLp = Lp + issuedLp;
  const shareOfPool =
    newLp > BigInt(0)
      ? Number((issuedLp * BigInt(10) ** BigInt(12)) / newLp) / 1e12
      : null;

  return {
    depositedA: ga,
    depositedB: gb,
    changeA: BigInt(0),
    changeB: BigInt(0),
    issuedLp,
    shareOfPool,
  };
}

export function estimateStableswapWithdraw(
  lpBurned: V3AssetAmount,
  pool: SundaePoolInfo
): WithdrawEstimate | null {
  // Withdraw math is the same as V3 — the invariant doesn't enter here, just
  // the user's share of the pool.
  return estimateV3Withdraw(lpBurned, pool);
}

// --- Stableswap swap ------------------------------------------------------
//
// Curve-style invariant with amplification A:
//   An^n * sum(x_i) + D = An^n * D + D^(n+1) / (n^n * prod(x_i))
//
// Ported from sundae-outcome/ssp/ssp.go. We compute D from current reserves,
// then solve for the new y given the new x (= old x + give). The output
// difference (in raw token units) is the gross take, before fees.

const A_PRECISION = BigInt(200);
const RESERVE_PRECISION = BigInt(1_000_000_000_000);
const B_PRECISION = BigInt(10_000);

function abs(x: bigint): bigint {
  return x < BigInt(0) ? -x : x;
}

// Solve for D given reserves x, y and amplification A. Iterates until
// successive estimates are within 1 of each other (matches the contract).
function getSumInvariant(aRaw: bigint, x0: bigint, y0: bigint): bigint | null {
  if (aRaw < BigInt(1)) return null;
  const x = x0 * RESERVE_PRECISION;
  const y = y0 * RESERVE_PRECISION;
  const a = aRaw * A_PRECISION;
  const sum = x + y;
  if (sum === BigInt(0)) return BigInt(0);
  const ann = a * BigInt(2);
  let d = sum;
  for (let i = 0; i < 255; i++) {
    const dPrev = d;
    const dp = (d * d * d) / (BigInt(4) * x * y);
    const numer = (ann * sum) / BigInt(100) + dp * BigInt(2);
    const denom =
      ((ann - BigInt(100)) * d) / BigInt(100) + BigInt(3) * dp;
    d = (numer * d) / denom;
    if (abs(d - dPrev) < BigInt(2)) return d;
  }
  return null;
}

// Solve for new y given new x and the existing D.
function getNewY(newX0: bigint, aRaw: bigint, sumInvariant: bigint): bigint | null {
  const newX = newX0 * RESERVE_PRECISION;
  const ann = aRaw * A_PRECISION * BigInt(2);
  // c = D * D / (newX * 2) * D * APREC / 2 / (ann * 2)
  let c = sumInvariant;
  c = (c * sumInvariant) / (newX * BigInt(2));
  c = (c * sumInvariant * A_PRECISION) / BigInt(2);
  c = c / (ann * BigInt(2));
  const b = newX + (sumInvariant * A_PRECISION) / BigInt(2) / ann;
  let y = sumInvariant;
  for (let i = 0; i < 255; i++) {
    const yPrev = y;
    y = (y * y + c) / (y * BigInt(2) + b - sumInvariant);
    if (abs(y - yPrev) < BigInt(2)) return y;
  }
  return null;
}

export interface StableswapEstimate {
  direction: SwapDirection;
  // Gross output in raw take units, before fees.
  feeBasis: bigint;
  // LP fee + protocol fee in raw take units.
  totalFee: bigint;
  totalProtocolFee: bigint;
  totalLpFee: bigint;
  // What the user actually receives, i.e. feeBasis - totalFee.
  takes: bigint;
  // Fees as fractions in pp10K (LP+protocol combined for "totalFeeRate").
  totalFeeNumer: number;
  totalFeeDenom: number;
  effectivePrice: number | null;
  // Mid price computed via Curve's price formula at the current reserves.
  midPrice: number | null;
  meetsMinReceived: boolean;
  cushion: number | null;
}

export function estimateStableswapSwap(
  offer: V3AssetAmount,
  minReceived: V3AssetAmount,
  pool: SundaePoolInfo
): StableswapEstimate | null {
  if (pool.linearAmplificationFactor == null) return null;
  const direction = (() => {
    if (
      offer.policyId === pool.assetA.policyId &&
      offer.assetName === pool.assetA.assetNameHex
    )
      return "AtoB" as const;
    if (
      offer.policyId === pool.assetB.policyId &&
      offer.assetName === pool.assetB.assetNameHex
    )
      return "BtoA" as const;
    return null;
  })();
  if (!direction) return null;
  const orderGive = offer.amount;
  if (orderGive <= BigInt(0)) return null;

  const isAtoB = direction === "AtoB";
  const poolGive = isAtoB ? pool.reserveA : pool.reserveB;
  const poolTake = isAtoB ? pool.reserveB : pool.reserveA;
  if (poolGive <= BigInt(0) || poolTake <= BigInt(0)) return null;

  const A = BigInt(pool.linearAmplificationFactor);
  const D = getSumInvariant(A, poolGive, poolTake);
  if (D === null) return null;
  const newY = getNewY(poolGive + orderGive, A, D);
  if (newY === null) return null;

  // deltaY in precision-scaled form
  const deltaYPrec = poolTake * RESERVE_PRECISION - newY;
  if (deltaYPrec <= BigInt(0)) return null;
  const feeBasis = deltaYPrec / RESERVE_PRECISION;

  const lpFee = isAtoB ? pool.bidFee : pool.askFee;
  const protoFee = isAtoB ? pool.protocolBidFee : pool.protocolAskFee;
  // Stableswap fees are quoted with the same denominator (10_000 in practice).
  // We assume both fee tuples share the same denominator; if a denominator
  // differs we treat protoFee as zero rather than guess.
  const feeDenom = BigInt(lpFee[1]);
  const lpNumer = BigInt(lpFee[0]);
  const protoNumer =
    protoFee && protoFee[1] === lpFee[1] ? BigInt(protoFee[0]) : BigInt(0);
  const totalFeeNumer = lpNumer + protoNumer;

  // Ceiling division: (feeBasis * totalFeeNumer + (denom - 1)) / denom
  const totalFee =
    totalFeeNumer === BigInt(0)
      ? BigInt(0)
      : (feeBasis * totalFeeNumer + (B_PRECISION - BigInt(1))) / B_PRECISION;
  const totalProtocolFee =
    totalFeeNumer === BigInt(0)
      ? BigInt(0)
      : (totalFee * protoNumer) / totalFeeNumer;
  const totalLpFee = totalFee - totalProtocolFee;
  const takes = feeBasis - totalFee;
  if (takes <= BigInt(0)) return null;

  const giveAsset = isAtoB ? pool.assetA : pool.assetB;
  const takeAsset = isAtoB ? pool.assetB : pool.assetA;
  const giveDecimals = giveAsset.decimals ?? 0;
  const takeDecimals = takeAsset.decimals ?? 0;
  const effectivePrice = ratio(takes, orderGive, giveDecimals - takeDecimals);
  const midPrice = stableswapMidPrice(poolGive, poolTake, A, giveDecimals - takeDecimals);

  const meetsMinReceived = takes >= minReceived.amount;
  const cushion =
    takes > BigInt(0)
      ? Number(takes - minReceived.amount) / Number(takes)
      : null;

  return {
    direction,
    feeBasis,
    totalFee,
    totalProtocolFee,
    totalLpFee,
    takes,
    totalFeeNumer: Number(totalFeeNumer),
    totalFeeDenom: Number(feeDenom),
    effectivePrice,
    midPrice,
    meetsMinReceived,
    cushion,
  };
}

// Curve mid-price (dx_a / dx_b) at the current reserves. See ssp.go GetPrice.
function stableswapMidPrice(
  a: bigint,
  b: bigint,
  amp: bigint,
  decimalsAdjust: number
): number | null {
  const D = getSumInvariant(amp, a, b);
  if (D === null) return null;
  const sumInvariant = D / RESERVE_PRECISION;
  if (sumInvariant === BigInt(0)) return null;
  // dR = D / 4 * D / a * D / b
  let dR = sumInvariant / BigInt(4);
  dR = (dR * sumInvariant) / a;
  dR = (dR * sumInvariant) / b;
  const ann = amp * BigInt(2);
  const xpA = ann * a;
  const numer = xpA + (dR * a) / b;
  const denom = xpA + dR;
  return ratio(numer, denom, decimalsAdjust);
}

export function estimateV3Withdraw(
  lpBurned: V3AssetAmount,
  pool: SundaePoolInfo
): WithdrawEstimate | null {
  if (pool.reserveLP <= BigInt(0)) return null;
  const burned = lpBurned.amount;
  if (burned <= BigInt(0)) return null;
  const lpMismatch =
    lpBurned.policyId !== pool.assetLP.policyId ||
    lpBurned.assetName !== pool.assetLP.assetNameHex;
  const withdrawnA = (burned * pool.reserveA) / pool.reserveLP;
  const withdrawnB = (burned * pool.reserveB) / pool.reserveLP;
  const shareOfPool =
    Number((burned * BigInt(10) ** BigInt(12)) / pool.reserveLP) / 1e12;
  return { withdrawnA, withdrawnB, shareOfPool, lpMismatch };
}
