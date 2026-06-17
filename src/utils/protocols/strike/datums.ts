// Strike Finance (Perpetuals) datum + redeemer parsers.
//
// Encoding = standard Plutus Constr with tag 121+index, which
// cquisitor-lib's DetailedSchema normalizes to a 0-based `constructor` index, so
// the generic `asConstr` helper reads them directly.
//
// Conventions baked in below:
//   • Asset = Constr0[policyId, assetName] (parseAssetClass). ADA = Constr0[#"",#""].
//   • Option<T>: Some = Constr0[T], None = Constr1[] (asOptional).
//   • USD prices & fees are integers scaled ×100000; times are POSIX MILLISECONDS.

import {
  asConstr,
  asInt,
  asList,
  asOptional,
  asBytes,
  parseAssetClass,
  type AssetClass,
  type PD,
} from "@/utils/protocols/dex/plutusData";

// --- PositionDatum ----------------------------------------------------------

export type PositionSide = "Long" | "Short";

export interface StrikePositionDatum {
  ownerPkh: string;
  ownerStakeKey: string | null;
  enteredPositionTime: bigint; // POSIX milliseconds
  enteredAtUsdPrice: bigint; // USD ×100000
  positionPolicyId: string;
  managePositionsScriptHash: string;
  collateralAsset: AssetClass;
  maintainMarginAmount: bigint; // percent
  hourlyUsdBorrowFee: bigint; // USD ×100000 / hour
  stopLossUsdPrice: bigint; // USD ×100000; 0 = unset
  takeProfitUsdPrice: bigint; // USD ×100000; 0 = unset
  collateralAssetAmount: bigint;
  positionAssetAmount: bigint;
  side: PositionSide;
}

// PositionSide: Long = Constr0[], Short = Constr1[].
function parsePositionSide(d: PD): PositionSide {
  const c = asConstr(d);
  if (c.tag === 0) return "Long";
  if (c.tag === 1) return "Short";
  throw new Error(`PositionSide: unexpected ctor ${c.tag}`);
}

// PositionDatum is Constr index 0, single-variant, 14 ordered fields.
export function parseStrikePositionFields(fields: PD[]): StrikePositionDatum {
  if (fields.length !== 14) {
    throw new Error(`Strike PositionDatum: expected 14 fields, got ${fields.length}`);
  }
  return {
    ownerPkh: asBytes(fields[0]),
    ownerStakeKey: asOptional(fields[1], asBytes),
    enteredPositionTime: asInt(fields[2]),
    enteredAtUsdPrice: asInt(fields[3]),
    positionPolicyId: asBytes(fields[4]),
    managePositionsScriptHash: asBytes(fields[5]),
    collateralAsset: parseAssetClass(fields[6]),
    maintainMarginAmount: asInt(fields[7]),
    hourlyUsdBorrowFee: asInt(fields[8]),
    stopLossUsdPrice: asInt(fields[9]),
    takeProfitUsdPrice: asInt(fields[10]),
    collateralAssetAmount: asInt(fields[11]),
    positionAssetAmount: asInt(fields[12]),
    side: parsePositionSide(fields[13]),
  };
}

export function parseStrikePositionDatum(data: PD): StrikePositionDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Strike PositionDatum: unexpected ctor ${c.tag}`);
  return parseStrikePositionFields(c.fields);
}

// --- OrderDatum / OrderAction ----------------------------------------------

export type StrikeOpenPositionType = "MarketOrder" | "LimitOrder";

// MarketOrder = Constr0[], LimitOrder = Constr1[].
function parseOpenPositionType(d: PD): StrikeOpenPositionType {
  const c = asConstr(d);
  if (c.tag === 0) return "MarketOrder";
  if (c.tag === 1) return "LimitOrder";
  throw new Error(`OpenPositionType: unexpected ctor ${c.tag}`);
}

export type StrikeOrderAction =
  | {
      kind: "OpenPositionOrder";
      positionDatum: StrikePositionDatum;
      openPositionType: StrikeOpenPositionType;
    }
  | {
      kind: "ClosePositionOrder";
      ownerPkh: string;
      ownerStakeKey: string | null;
      sendAsset: AssetClass;
      sendAssetAmount: bigint;
      poolAssetProfitLoss: bigint; // can be negative
      positionPolicyId: string;
      borrowedAmount: bigint;
    }
  | {
      kind: "LiquidatePositionOrder";
      profit: bigint;
      lendedAmount: bigint;
      positionPolicyId: string;
    }
  | {
      kind: "ProvideLiquidityOrder";
      ownerPkh: string;
      ownerStakeKey: string | null;
      liquidityAsset: AssetClass;
    }
  | {
      kind: "WithdrawLiquidityOrder";
      ownerPkh: string;
      ownerStakeKey: string | null;
    };

// OrderAction has 5 variants.
export function parseStrikeOrderAction(data: PD): StrikeOrderAction {
  const c = asConstr(data);
  switch (c.tag) {
    case 0: {
      // OpenPositionOrder { position_datum, open_position_type }
      if (c.fields.length !== 2) {
        throw new Error(`OpenPositionOrder: expected 2 fields, got ${c.fields.length}`);
      }
      return {
        kind: "OpenPositionOrder",
        positionDatum: parseStrikePositionDatum(c.fields[0]),
        openPositionType: parseOpenPositionType(c.fields[1]),
      };
    }
    case 1: {
      // ClosePositionOrder { owner_pkh, owner_stake_key, send_asset,
      //   send_asset_amount, pool_asset_profit_loss, position_policy_id,
      //   borrowed_amount }
      if (c.fields.length !== 7) {
        throw new Error(`ClosePositionOrder: expected 7 fields, got ${c.fields.length}`);
      }
      return {
        kind: "ClosePositionOrder",
        ownerPkh: asBytes(c.fields[0]),
        ownerStakeKey: asOptional(c.fields[1], asBytes),
        sendAsset: parseAssetClass(c.fields[2]),
        sendAssetAmount: asInt(c.fields[3]),
        poolAssetProfitLoss: asInt(c.fields[4]),
        positionPolicyId: asBytes(c.fields[5]),
        borrowedAmount: asInt(c.fields[6]),
      };
    }
    case 2: {
      // LiquidatePositionOrder { profit, lended_amount, position_policy_id }
      if (c.fields.length !== 3) {
        throw new Error(`LiquidatePositionOrder: expected 3 fields, got ${c.fields.length}`);
      }
      return {
        kind: "LiquidatePositionOrder",
        profit: asInt(c.fields[0]),
        lendedAmount: asInt(c.fields[1]),
        positionPolicyId: asBytes(c.fields[2]),
      };
    }
    case 3: {
      // ProvideLiquidityOrder { owner_pkh, owner_stake_key, liquidity_asset }
      if (c.fields.length !== 3) {
        throw new Error(`ProvideLiquidityOrder: expected 3 fields, got ${c.fields.length}`);
      }
      return {
        kind: "ProvideLiquidityOrder",
        ownerPkh: asBytes(c.fields[0]),
        ownerStakeKey: asOptional(c.fields[1], asBytes),
        liquidityAsset: parseAssetClass(c.fields[2]),
      };
    }
    case 4: {
      // WithdrawLiquidityOrder { owner_pkh, owner_stake_key }
      if (c.fields.length !== 2) {
        throw new Error(`WithdrawLiquidityOrder: expected 2 fields, got ${c.fields.length}`);
      }
      return {
        kind: "WithdrawLiquidityOrder",
        ownerPkh: asBytes(c.fields[0]),
        ownerStakeKey: asOptional(c.fields[1], asBytes),
      };
    }
    default:
      throw new Error(`Strike OrderAction: unexpected ctor ${c.tag}`);
  }
}

export interface StrikeOrderDatum {
  action: StrikeOrderAction;
}

// OrderDatum is Constr index 0, single field wrapping one OrderAction.
export function parseStrikeOrderDatum(data: PD): StrikeOrderDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Strike OrderDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 1) {
    throw new Error(`Strike OrderDatum: expected 1 field, got ${c.fields.length}`);
  }
  return { action: parseStrikeOrderAction(c.fields[0]) };
}

// --- PoolDatum / SettingsDatum ---------------------------------------------

export interface StrikePoolDatum {
  underlyingAsset: AssetClass;
  lpAsset: AssetClass;
  liquidityTotalAssetAmount: bigint;
  liquidityTotalLpMinted: bigint;
  totalLendedAmount: bigint;
  batcherLicense: string; // PolicyId (28-byte)
}

// PoolDatum is Constr0 with 6 ordered fields.
export function parseStrikePoolDatum(data: PD): StrikePoolDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Strike PoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 6) {
    throw new Error(`Strike PoolDatum: expected 6 fields, got ${c.fields.length}`);
  }
  return {
    underlyingAsset: parseAssetClass(c.fields[0]),
    lpAsset: parseAssetClass(c.fields[1]),
    liquidityTotalAssetAmount: asInt(c.fields[2]),
    liquidityTotalLpMinted: asInt(c.fields[3]),
    totalLendedAmount: asInt(c.fields[4]),
    batcherLicense: asBytes(c.fields[5]),
  };
}

export interface StrikeSettingsDatum {
  interestRate: bigint;
  maxLeverageFactor: bigint;
  maxPositionUsdValue: bigint;
  minPositionUsdValue: bigint;
  maintainMarginAmount: bigint;
}

// SettingsDatum is Constr0 with 5 ordered fields.
export function parseStrikeSettingsDatum(data: PD): StrikeSettingsDatum {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Strike SettingsDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 5) {
    throw new Error(`Strike SettingsDatum: expected 5 fields, got ${c.fields.length}`);
  }
  return {
    interestRate: asInt(c.fields[0]),
    maxLeverageFactor: asInt(c.fields[1]),
    maxPositionUsdValue: asInt(c.fields[2]),
    minPositionUsdValue: asInt(c.fields[3]),
    maintainMarginAmount: asInt(c.fields[4]),
  };
}

// --- Redeemers --------------------------------------------------------------

export type StrikeCloseType =
  | "TraderClose"
  | "StopLossClose"
  | "TakeProfitClose"
  | "LiquidateClose";

// CloseType: TraderClose=0, StopLossClose=1, TakeProfitClose=2, LiquidateClose=3.
function parseCloseType(d: PD): StrikeCloseType {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return "TraderClose";
    case 1:
      return "StopLossClose";
    case 2:
      return "TakeProfitClose";
    case 3:
      return "LiquidateClose";
    default:
      throw new Error(`CloseType: unexpected ctor ${c.tag}`);
  }
}

export type StrikeManagePositionRedeemer =
  | {
      kind: "Close";
      closePrice: bigint;
      closeType: StrikeCloseType;
      outputToOrderIndex: bigint;
    }
  | {
      kind: "AddCollateral";
      collateralAssetAmount: bigint;
      outputBackToPositionsIndex: bigint;
    }
  | {
      kind: "PositionUpdate";
      stopLoss: bigint;
      takeProfit: bigint;
      outputBackToPositionsIndex: bigint;
      currentUsdPrice: bigint;
    };

// manage_positions SPEND redeemer — the position close/settle redeemer.
export function parseStrikeManagePositionRedeemer(data: PD): StrikeManagePositionRedeemer {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      if (c.fields.length !== 3) {
        throw new Error(`Close: expected 3 fields, got ${c.fields.length}`);
      }
      return {
        kind: "Close",
        closePrice: asInt(c.fields[0]),
        closeType: parseCloseType(c.fields[1]),
        outputToOrderIndex: asInt(c.fields[2]),
      };
    case 1:
      if (c.fields.length !== 2) {
        throw new Error(`AddCollateral: expected 2 fields, got ${c.fields.length}`);
      }
      return {
        kind: "AddCollateral",
        collateralAssetAmount: asInt(c.fields[0]),
        outputBackToPositionsIndex: asInt(c.fields[1]),
      };
    case 2:
      if (c.fields.length !== 4) {
        throw new Error(`PositionUpdate: expected 4 fields, got ${c.fields.length}`);
      }
      return {
        kind: "PositionUpdate",
        stopLoss: asInt(c.fields[0]),
        takeProfit: asInt(c.fields[1]),
        outputBackToPositionsIndex: asInt(c.fields[2]),
        currentUsdPrice: asInt(c.fields[3]),
      };
    default:
      throw new Error(`Strike ManagePositionRedeemer: unexpected ctor ${c.tag}`);
  }
}

export type StrikeOrdersRedeemer =
  | { kind: "ProcessOrders" }
  | { kind: "CancelOrder" }
  | { kind: "CloseOrderWhilePending"; index: bigint };

// orders SPEND redeemer.
export function parseStrikeOrdersRedeemer(data: PD): StrikeOrdersRedeemer {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      return { kind: "ProcessOrders" };
    case 1:
      return { kind: "CancelOrder" };
    case 2:
      if (c.fields.length !== 1) {
        throw new Error(`CloseOrderWhilePending: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "CloseOrderWhilePending", index: asInt(c.fields[0]) };
    default:
      throw new Error(`Strike OrdersRedeemer: unexpected ctor ${c.tag}`);
  }
}

// A (Int,Int) tuple is a CBOR 2-element LIST [Int, Int].
function parseIntPair(d: PD): [bigint, bigint] {
  const list = asList(d);
  if (list.length !== 2) throw new Error("Strike tuple: expected 2-element list");
  return [asInt(list[0]), asInt(list[1])];
}

export interface StrikeOrdersWithdrawRedeemer {
  currentUsdPrice: bigint;
  indexer: [bigint, bigint][];
  poolUtxoIndex: [bigint, bigint];
  batcherLicenseUtxoIndex: bigint;
}

// orders WITHDRAW redeemer — Constr0 single-variant (withdraw-zero forwarding /
// batch pattern).
export function parseStrikeOrdersWithdrawRedeemer(data: PD): StrikeOrdersWithdrawRedeemer {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Strike OrdersWithdrawRedeemer: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 4) {
    throw new Error(`Strike OrdersWithdrawRedeemer: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    currentUsdPrice: asInt(c.fields[0]),
    indexer: asList(c.fields[1]).map(parseIntPair),
    poolUtxoIndex: parseIntPair(c.fields[2]),
    batcherLicenseUtxoIndex: asInt(c.fields[3]),
  };
}

export type StrikePositionMintRedeemer =
  | {
      kind: "OpenPosition";
      currentUsdPrice: bigint;
      outputToOrderIndex: bigint;
      poolIndex: bigint;
      settingIndex: bigint;
    }
  | { kind: "ClosePosition"; burnAmount: bigint };

// position_mint MINT redeemer.
export function parseStrikePositionMintRedeemer(data: PD): StrikePositionMintRedeemer {
  const c = asConstr(data);
  switch (c.tag) {
    case 0:
      if (c.fields.length !== 4) {
        throw new Error(`OpenPosition: expected 4 fields, got ${c.fields.length}`);
      }
      return {
        kind: "OpenPosition",
        currentUsdPrice: asInt(c.fields[0]),
        outputToOrderIndex: asInt(c.fields[1]),
        poolIndex: asInt(c.fields[2]),
        settingIndex: asInt(c.fields[3]),
      };
    case 1:
      if (c.fields.length !== 1) {
        throw new Error(`ClosePosition: expected 1 field, got ${c.fields.length}`);
      }
      return { kind: "ClosePosition", burnAmount: asInt(c.fields[0]) };
    default:
      throw new Error(`Strike PositionMintRedeemer: unexpected ctor ${c.tag}`);
  }
}
