// Minswap V2 datum / redeemer parsers.
//
// The order types' constructor tags follow 0-based declaration order:
//
//   OrderStep: SwapExactIn=0, StopLoss=1, OCO=2, SwapExactOut=3, Deposit=4,
//              Withdraw=5, ZapOut=6, PartialSwap=7, WithdrawImbalance=8,
//              SwapMultiRouting=9, Donation=10
//   OrderRedeemer: ApplyOrder=0, CancelOrderByOwner=1, CancelExpiredOrderByAnyone=2
//   PoolRedeemer:  Batching=0, UpdatePoolParameters=1, WithdrawFeeSharing=2

import {
  asBool,
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  parseAssetClass,
  parsePlutusAddress,
  parseStakeCredential,
  type AssetClass,
  type PD,
  type PlutusAddress,
  type StakeCredential,
} from "@/utils/protocols/dex/plutusData";

// --- Sub-types -------------------------------------------------------------

export type OrderAuthorizationMethod =
  | { kind: "Signature"; pubKeyHash: string }
  | { kind: "SpendScript"; scriptHash: string }
  | { kind: "WithdrawScript"; scriptHash: string }
  | { kind: "MintScript"; scriptHash: string };

export type ExtraOrderDatum =
  | { kind: "NoDatum" }
  | { kind: "DatumHash"; hash: string }
  | { kind: "InlineDatum"; hash: string };

export type SwapAmountOption =
  | { kind: "SpecificAmount"; swapAmount: bigint }
  | { kind: "All"; deductedAmount: bigint };

export type DepositAmountOption =
  | { kind: "SpecificAmount"; depositAmountA: bigint; depositAmountB: bigint }
  | { kind: "All"; deductedAmountA: bigint; deductedAmountB: bigint };

export type WithdrawAmountOption =
  | { kind: "SpecificAmount"; withdrawalLpAmount: bigint }
  | { kind: "All"; deductedAmountLp: bigint };

export interface SwapRouting {
  lpAsset: AssetClass;
  aToBDirection: boolean;
}

export type OrderStep =
  | { kind: "SwapExactIn"; aToBDirection: boolean; swapAmountOption: SwapAmountOption; minimumReceive: bigint; killable: boolean }
  | { kind: "StopLoss"; aToBDirection: boolean; swapAmountOption: SwapAmountOption; stopLossReceive: bigint }
  | { kind: "OCO"; aToBDirection: boolean; swapAmountOption: SwapAmountOption; minimumReceive: bigint; stopLossReceive: bigint }
  | { kind: "SwapExactOut"; aToBDirection: boolean; maximumSwapAmountOption: SwapAmountOption; expectedReceive: bigint; killable: boolean }
  | { kind: "Deposit"; depositAmountOption: DepositAmountOption; minimumLp: bigint; killable: boolean }
  | { kind: "Withdraw"; withdrawalAmountOption: WithdrawAmountOption; minimumAssetA: bigint; minimumAssetB: bigint; killable: boolean }
  | { kind: "ZapOut"; aToBDirection: boolean; withdrawalAmountOption: WithdrawAmountOption; minimumReceive: bigint; killable: boolean }
  | { kind: "PartialSwap"; aToBDirection: boolean; totalSwapAmount: bigint; ioRatioNumerator: bigint; ioRatioDenominator: bigint; hops: bigint; minimumSwapAmountRequired: bigint; maxBatcherFeeEachTime: bigint }
  | { kind: "WithdrawImbalance"; withdrawalAmountOption: WithdrawAmountOption; ratioAssetA: bigint; ratioAssetB: bigint; minimumAssetA: bigint; killable: boolean }
  | { kind: "SwapMultiRouting"; routings: SwapRouting[]; swapAmountOption: SwapAmountOption; minimumReceive: bigint }
  | { kind: "Donation" };

export interface MinswapOrderDatum {
  canceller: OrderAuthorizationMethod;
  refundReceiver: PlutusAddress;
  refundReceiverDatum: ExtraOrderDatum;
  successReceiver: PlutusAddress;
  successReceiverDatum: ExtraOrderDatum;
  /** The pool's LP asset — identifies which pool the order targets. */
  lpAsset: AssetClass;
  step: OrderStep;
  maxBatcherFee: bigint;
  /** (expiredTime, maxCancellationTip) when set. */
  expirySetting: { expiredTime: bigint; maxCancellationTip: bigint } | null;
}

export interface MinswapPoolDatum {
  poolBatchingStakeCredential: StakeCredential;
  assetA: AssetClass;
  assetB: AssetClass;
  totalLiquidity: bigint;
  reserveA: bigint;
  reserveB: bigint;
  baseFeeANumerator: bigint;
  baseFeeBNumerator: bigint;
  feeSharingNumerator: bigint | null;
  allowDynamicFee: boolean;
}

export type MinswapOrderRedeemer =
  | "ApplyOrder"
  | "CancelOrderByOwner"
  | "CancelExpiredOrderByAnyone";

// --- Sub-parsers -----------------------------------------------------------

function parseOrderAuthorizationMethod(d: PD): OrderAuthorizationMethod {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "Signature", pubKeyHash: asBytes(c.fields[0]) };
    case 1:
      return { kind: "SpendScript", scriptHash: asBytes(c.fields[0]) };
    case 2:
      return { kind: "WithdrawScript", scriptHash: asBytes(c.fields[0]) };
    case 3:
      return { kind: "MintScript", scriptHash: asBytes(c.fields[0]) };
    default:
      throw new Error(`OrderAuthorizationMethod: unexpected ctor ${c.tag}`);
  }
}

function parseExtraOrderDatum(d: PD): ExtraOrderDatum {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "NoDatum" };
  if (c.tag === 1) return { kind: "DatumHash", hash: asBytes(c.fields[0]) };
  if (c.tag === 2) return { kind: "InlineDatum", hash: asBytes(c.fields[0]) };
  throw new Error(`ExtraOrderDatum: unexpected ctor ${c.tag}`);
}

function parseSwapAmountOption(d: PD): SwapAmountOption {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "SpecificAmount", swapAmount: asInt(c.fields[0]) };
  if (c.tag === 1) return { kind: "All", deductedAmount: asInt(c.fields[0]) };
  throw new Error(`SwapAmountOption: unexpected ctor ${c.tag}`);
}

function parseDepositAmountOption(d: PD): DepositAmountOption {
  const c = asConstr(d);
  if (c.tag === 0) {
    return { kind: "SpecificAmount", depositAmountA: asInt(c.fields[0]), depositAmountB: asInt(c.fields[1]) };
  }
  if (c.tag === 1) {
    return { kind: "All", deductedAmountA: asInt(c.fields[0]), deductedAmountB: asInt(c.fields[1]) };
  }
  throw new Error(`DepositAmountOption: unexpected ctor ${c.tag}`);
}

function parseWithdrawAmountOption(d: PD): WithdrawAmountOption {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "SpecificAmount", withdrawalLpAmount: asInt(c.fields[0]) };
  if (c.tag === 1) return { kind: "All", deductedAmountLp: asInt(c.fields[0]) };
  throw new Error(`WithdrawAmountOption: unexpected ctor ${c.tag}`);
}

function parseSwapRouting(d: PD): SwapRouting {
  const c = asConstr(d);
  return { lpAsset: parseAssetClass(c.fields[0]), aToBDirection: asBool(c.fields[1]) };
}

function parseOrderStep(d: PD): OrderStep {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return {
        kind: "SwapExactIn",
        aToBDirection: asBool(c.fields[0]),
        swapAmountOption: parseSwapAmountOption(c.fields[1]),
        minimumReceive: asInt(c.fields[2]),
        killable: asBool(c.fields[3]),
      };
    case 1:
      return {
        kind: "StopLoss",
        aToBDirection: asBool(c.fields[0]),
        swapAmountOption: parseSwapAmountOption(c.fields[1]),
        stopLossReceive: asInt(c.fields[2]),
      };
    case 2:
      return {
        kind: "OCO",
        aToBDirection: asBool(c.fields[0]),
        swapAmountOption: parseSwapAmountOption(c.fields[1]),
        minimumReceive: asInt(c.fields[2]),
        stopLossReceive: asInt(c.fields[3]),
      };
    case 3:
      return {
        kind: "SwapExactOut",
        aToBDirection: asBool(c.fields[0]),
        maximumSwapAmountOption: parseSwapAmountOption(c.fields[1]),
        expectedReceive: asInt(c.fields[2]),
        killable: asBool(c.fields[3]),
      };
    case 4:
      return {
        kind: "Deposit",
        depositAmountOption: parseDepositAmountOption(c.fields[0]),
        minimumLp: asInt(c.fields[1]),
        killable: asBool(c.fields[2]),
      };
    case 5:
      return {
        kind: "Withdraw",
        withdrawalAmountOption: parseWithdrawAmountOption(c.fields[0]),
        minimumAssetA: asInt(c.fields[1]),
        minimumAssetB: asInt(c.fields[2]),
        killable: asBool(c.fields[3]),
      };
    case 6:
      return {
        kind: "ZapOut",
        aToBDirection: asBool(c.fields[0]),
        withdrawalAmountOption: parseWithdrawAmountOption(c.fields[1]),
        minimumReceive: asInt(c.fields[2]),
        killable: asBool(c.fields[3]),
      };
    case 7:
      return {
        kind: "PartialSwap",
        aToBDirection: asBool(c.fields[0]),
        totalSwapAmount: asInt(c.fields[1]),
        ioRatioNumerator: asInt(c.fields[2]),
        ioRatioDenominator: asInt(c.fields[3]),
        hops: asInt(c.fields[4]),
        minimumSwapAmountRequired: asInt(c.fields[5]),
        maxBatcherFeeEachTime: asInt(c.fields[6]),
      };
    case 8:
      return {
        kind: "WithdrawImbalance",
        withdrawalAmountOption: parseWithdrawAmountOption(c.fields[0]),
        ratioAssetA: asInt(c.fields[1]),
        ratioAssetB: asInt(c.fields[2]),
        minimumAssetA: asInt(c.fields[3]),
        killable: asBool(c.fields[4]),
      };
    case 9:
      return {
        kind: "SwapMultiRouting",
        routings: asList(c.fields[0]).map(parseSwapRouting),
        swapAmountOption: parseSwapAmountOption(c.fields[1]),
        minimumReceive: asInt(c.fields[2]),
      };
    case 10:
      return { kind: "Donation" };
    default:
      throw new Error(`OrderStep: unexpected ctor ${c.tag}`);
  }
}

// --- Top-level parsers -----------------------------------------------------

export function parseMinswapOrderDatum(data: PD): MinswapOrderDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`MinswapOrderDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 9) {
    throw new Error(`MinswapOrderDatum: expected 9 fields, got ${c.fields.length}`);
  }
  return {
    canceller: parseOrderAuthorizationMethod(c.fields[0]),
    refundReceiver: parsePlutusAddress(c.fields[1]),
    refundReceiverDatum: parseExtraOrderDatum(c.fields[2]),
    successReceiver: parsePlutusAddress(c.fields[3]),
    successReceiverDatum: parseExtraOrderDatum(c.fields[4]),
    lpAsset: parseAssetClass(c.fields[5]),
    step: parseOrderStep(c.fields[6]),
    maxBatcherFee: asInt(c.fields[7]),
    expirySetting: asOptional(c.fields[8], (tuple) => {
      const list = asList(tuple);
      if (list.length !== 2) throw new Error("expiry_setting: expected (time, tip)");
      return { expiredTime: asInt(list[0]), maxCancellationTip: asInt(list[1]) };
    }),
  };
}

export function parseMinswapPoolDatum(data: PD): MinswapPoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`MinswapPoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 10) {
    throw new Error(`MinswapPoolDatum: expected 10 fields, got ${c.fields.length}`);
  }
  return {
    poolBatchingStakeCredential: parseStakeCredential(c.fields[0]),
    assetA: parseAssetClass(c.fields[1]),
    assetB: parseAssetClass(c.fields[2]),
    totalLiquidity: asInt(c.fields[3]),
    reserveA: asInt(c.fields[4]),
    reserveB: asInt(c.fields[5]),
    baseFeeANumerator: asInt(c.fields[6]),
    baseFeeBNumerator: asInt(c.fields[7]),
    feeSharingNumerator: asOptional(c.fields[8], asInt),
    allowDynamicFee: asBool(c.fields[9]),
  };
}

export function classifyMinswapOrderRedeemer(data: PD): MinswapOrderRedeemer | null {
  const c = asConstr(data);
  if (c.tag === 0) return "ApplyOrder";
  if (c.tag === 1) return "CancelOrderByOwner";
  if (c.tag === 2) return "CancelExpiredOrderByAnyone";
  return null;
}
