// Minswap V1 (legacy, PlutusV1) datum / redeemer parsers + Minswap Stableswap
// (PlutusV2) datum / redeemer parsers.
//
//   V1 OrderV1.StepType:  SwapExactIn=0, SwapExactOut=1, Deposit=2,
//                         Withdraw=3, ZapIn=4
//   V1 OrderV1.Redeemer:  ApplyOrder=0, CancelOrder=1
//   V1 PoolV1.Datum:      Constr0[assetA, assetB, totalLiquidity, rootKLast,
//                         Option<PoolFeeSharing>]
//
//   Stableswap StableOrder.StepType: Swap=0, Deposit=1, Withdraw=2,
//                         WithdrawImbalance=3, ZapOut=4
//   Stableswap OrderRedeemer:  ApplyOrder=0, CancelOrder=1
//   Stableswap PoolDatum: Constr0[balances:List<Int>, totalLiquidity,
//                         amp, orderHash:ByteArray]
//   Stableswap PoolRedeemer:  ApplyPool=0, WithdrawAdminFee=1,
//                         UpdateAmpOrStakeCredential=2

import {
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  parseAssetClass,
  parsePlutusAddress,
  type AssetClass,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";

// --- V1 sub-types ----------------------------------------------------------

export type V1OrderStep =
  | { kind: "SwapExactIn"; desiredAsset: AssetClass; minimumReceived: bigint }
  | { kind: "SwapExactOut"; desiredAsset: AssetClass; expectedReceived: bigint }
  | { kind: "Deposit"; minimumLP: bigint }
  | { kind: "Withdraw"; minimumAssetA: bigint; minimumAssetB: bigint }
  | { kind: "ZapIn"; desiredAsset: AssetClass; minimumLP: bigint };

export interface MinswapV1OrderDatum {
  sender: PlutusAddress;
  receiver: PlutusAddress;
  /** Receiver output datum hash, when set (Constr0[hash] / Constr1[] None). */
  receiverDatumHash: string | null;
  step: V1OrderStep;
  batcherFee: bigint;
  depositADA: bigint;
}

export interface PoolFeeSharing {
  feeTo: PlutusAddress;
  feeToDatumHash: string | null;
}

export interface MinswapV1PoolDatum {
  assetA: AssetClass;
  assetB: AssetClass;
  totalLiquidity: bigint;
  rootKLast: bigint;
  feeSharing: PoolFeeSharing | null;
}

export type MinswapV1OrderRedeemer = "ApplyOrder" | "CancelOrder";

// --- V1 parsers ------------------------------------------------------------

function parseV1OrderStep(d: PD): V1OrderStep {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return {
        kind: "SwapExactIn",
        desiredAsset: parseAssetClass(c.fields[0]),
        minimumReceived: asInt(c.fields[1]),
      };
    case 1:
      return {
        kind: "SwapExactOut",
        desiredAsset: parseAssetClass(c.fields[0]),
        expectedReceived: asInt(c.fields[1]),
      };
    case 2:
      return { kind: "Deposit", minimumLP: asInt(c.fields[0]) };
    case 3:
      return {
        kind: "Withdraw",
        minimumAssetA: asInt(c.fields[0]),
        minimumAssetB: asInt(c.fields[1]),
      };
    case 4:
      return {
        kind: "ZapIn",
        desiredAsset: parseAssetClass(c.fields[0]),
        minimumLP: asInt(c.fields[1]),
      };
    default:
      throw new Error(`V1 OrderStep: unexpected ctor ${c.tag}`);
  }
}

export function parseMinswapV1OrderDatum(data: PD): MinswapV1OrderDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`MinswapV1OrderDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 6) {
    throw new Error(`MinswapV1OrderDatum: expected 6 fields, got ${c.fields.length}`);
  }
  return {
    sender: parsePlutusAddress(c.fields[0]),
    receiver: parsePlutusAddress(c.fields[1]),
    receiverDatumHash: asOptional(c.fields[2], asBytes),
    step: parseV1OrderStep(c.fields[3]),
    batcherFee: asInt(c.fields[4]),
    depositADA: asInt(c.fields[5]),
  };
}

function parsePoolFeeSharing(d: PD): PoolFeeSharing {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PoolFeeSharing: unexpected ctor ${c.tag}`);
  return {
    feeTo: parsePlutusAddress(c.fields[0]),
    feeToDatumHash: asOptional(c.fields[1], asBytes),
  };
}

export function parseMinswapV1PoolDatum(data: PD): MinswapV1PoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`MinswapV1PoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 5) {
    throw new Error(`MinswapV1PoolDatum: expected 5 fields, got ${c.fields.length}`);
  }
  return {
    assetA: parseAssetClass(c.fields[0]),
    assetB: parseAssetClass(c.fields[1]),
    totalLiquidity: asInt(c.fields[2]),
    rootKLast: asInt(c.fields[3]),
    feeSharing: asOptional(c.fields[4], parsePoolFeeSharing),
  };
}

export function classifyMinswapV1OrderRedeemer(data: PD): MinswapV1OrderRedeemer | null {
  const c = asConstr(data);
  if (c.tag === 0) return "ApplyOrder";
  if (c.tag === 1) return "CancelOrder";
  return null;
}

// --- Stableswap sub-types --------------------------------------------------

export type StableswapOrderStep =
  | { kind: "Swap"; assetInIndex: bigint; assetOutIndex: bigint; minimumAssetOut: bigint }
  | { kind: "Deposit"; minimumLP: bigint }
  | { kind: "Withdraw"; minimumAmounts: bigint[] }
  | { kind: "WithdrawImbalance"; withdrawAmounts: bigint[] }
  | { kind: "ZapOut"; assetOutIndex: bigint; minimumAssetOut: bigint };

export interface MinswapStableswapOrderDatum {
  sender: PlutusAddress;
  receiver: PlutusAddress;
  receiverDatumHash: string | null;
  step: StableswapOrderStep;
  batcherFee: bigint;
  depositADA: bigint;
}

export interface MinswapStableswapPoolDatum {
  /** Pool token balances, one per pool asset (in the pool's asset order). */
  balances: bigint[];
  totalLiquidity: bigint;
  /** Amplification coefficient (the curve's `amp`). */
  amplificationCoefficient: bigint;
  /** Hash of the order validator the pool batches against. */
  orderHash: string;
}

export type MinswapStableswapOrderRedeemer = "ApplyOrder" | "CancelOrder";

export type MinswapStableswapPoolRedeemer =
  | "ApplyPool"
  | "WithdrawAdminFee"
  | "UpdateAmpOrStakeCredential";

// --- Stableswap parsers ----------------------------------------------------

function parseStableswapOrderStep(d: PD): StableswapOrderStep {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return {
        kind: "Swap",
        assetInIndex: asInt(c.fields[0]),
        assetOutIndex: asInt(c.fields[1]),
        minimumAssetOut: asInt(c.fields[2]),
      };
    case 1:
      return { kind: "Deposit", minimumLP: asInt(c.fields[0]) };
    case 2:
      return { kind: "Withdraw", minimumAmounts: asList(c.fields[0]).map(asInt) };
    case 3:
      return { kind: "WithdrawImbalance", withdrawAmounts: asList(c.fields[0]).map(asInt) };
    case 4:
      return {
        kind: "ZapOut",
        assetOutIndex: asInt(c.fields[0]),
        minimumAssetOut: asInt(c.fields[1]),
      };
    default:
      throw new Error(`Stableswap OrderStep: unexpected ctor ${c.tag}`);
  }
}

export function parseMinswapStableswapOrderDatum(data: PD): MinswapStableswapOrderDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`StableswapOrderDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 6) {
    throw new Error(`StableswapOrderDatum: expected 6 fields, got ${c.fields.length}`);
  }
  return {
    sender: parsePlutusAddress(c.fields[0]),
    receiver: parsePlutusAddress(c.fields[1]),
    receiverDatumHash: asOptional(c.fields[2], asBytes),
    step: parseStableswapOrderStep(c.fields[3]),
    batcherFee: asInt(c.fields[4]),
    depositADA: asInt(c.fields[5]),
  };
}

export function parseMinswapStableswapPoolDatum(data: PD): MinswapStableswapPoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`StableswapPoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 4) {
    throw new Error(`StableswapPoolDatum: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    balances: asList(c.fields[0]).map(asInt),
    totalLiquidity: asInt(c.fields[1]),
    amplificationCoefficient: asInt(c.fields[2]),
    orderHash: asBytes(c.fields[3]),
  };
}

export function classifyMinswapStableswapOrderRedeemer(
  data: PD,
): MinswapStableswapOrderRedeemer | null {
  const c = asConstr(data);
  if (c.tag === 0) return "ApplyOrder";
  if (c.tag === 1) return "CancelOrder";
  return null;
}

export function classifyMinswapStableswapPoolRedeemer(
  data: PD,
): MinswapStableswapPoolRedeemer | null {
  const c = asConstr(data);
  if (c.tag === 0) return "ApplyPool";
  if (c.tag === 1) return "WithdrawAdminFee";
  if (c.tag === 2) return "UpdateAmpOrStakeCredential";
  return null;
}
