// Splash (ex-Spectrum) datum parsers — LimitOrder, InstantOrder, and the
// const-product CFMM PoolConfig.
//
// Field order follows the deployed datum layout (which differs from the source
// struct field order). Constr tags decode to a 0-based `constructor` index via
// cquisitor-lib's DetailedSchema. Asset = Constr0[policy, name]; Rational =
// Constr0[num, denom]; Address = the standard Cardano shape.

import {
  asBool,
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  isInt,
  parseAssetClass,
  parseCredential,
  parsePlutusAddress,
  parseRational,
  type AssetClass,
  type Credential,
  type PD,
  type PlutusAddress,
  type Rational,
} from "@/utils/protocols/dex/plutusData";

export interface SplashLimitOrder {
  kind: "Limit";
  tag: string;
  beacon: string;
  input: AssetClass;
  tradableInput: bigint;
  costPerExStep: bigint;
  minMarginalOutput: bigint;
  output: AssetClass;
  basePrice: Rational;
  fee: bigint;
  redeemerAddress: PlutusAddress;
  cancellationPkh: string;
  permittedExecutors: string[];
}

export interface SplashInstantOrder {
  kind: "Instant";
  tag: string;
  redeemerAddress: PlutusAddress;
  input: AssetClass;
  output: AssetClass;
  basePrice: Rational;
  fee: bigint;
  minLovelace: bigint;
  permittedExecutor: string;
  cancellationAfter: bigint;
  cancellationPkh: string;
}

export type SplashOrder = SplashLimitOrder | SplashInstantOrder;

function parseLimitOrder(fields: PD[]): SplashLimitOrder {
  if (fields.length !== 12) {
    throw new Error(`Splash LimitOrder: expected 12 fields, got ${fields.length}`);
  }
  return {
    kind: "Limit",
    tag: asBytes(fields[0]),
    beacon: asBytes(fields[1]),
    input: parseAssetClass(fields[2]),
    tradableInput: asInt(fields[3]),
    costPerExStep: asInt(fields[4]),
    minMarginalOutput: asInt(fields[5]),
    output: parseAssetClass(fields[6]),
    basePrice: parseRational(fields[7]),
    fee: asInt(fields[8]),
    redeemerAddress: parsePlutusAddress(fields[9]),
    cancellationPkh: asBytes(fields[10]),
    permittedExecutors: asList(fields[11]).map(asBytes),
  };
}

function parseInstantOrder(fields: PD[]): SplashInstantOrder {
  if (fields.length !== 10) {
    throw new Error(`Splash InstantOrder: expected 10 fields, got ${fields.length}`);
  }
  return {
    kind: "Instant",
    tag: asBytes(fields[0]),
    redeemerAddress: parsePlutusAddress(fields[1]),
    input: parseAssetClass(fields[2]),
    output: parseAssetClass(fields[3]),
    basePrice: parseRational(fields[4]),
    fee: asInt(fields[5]),
    minLovelace: asInt(fields[6]),
    permittedExecutor: asBytes(fields[7]),
    cancellationAfter: asInt(fields[8]),
    cancellationPkh: asBytes(fields[9]),
  };
}

// Discriminate by the leading tag byte (#"00" = limit, #"01" = instant), with a
// field-count fallback.
export function parseSplashOrder(data: PD): SplashOrder {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash order: unexpected ctor ${c.tag}`);
  const tagByte = c.fields.length > 0 ? safeBytes(c.fields[0]) : null;
  if (tagByte === "01" || c.fields.length === 10) return parseInstantOrder(c.fields);
  return parseLimitOrder(c.fields);
}

function safeBytes(d: PD): string | null {
  try {
    return asBytes(d);
  } catch {
    return null;
  }
}

// --- Const-product CFMM pool ----------------------------------------------

export interface SplashPoolConfig {
  poolNft: AssetClass;
  assetX: AssetClass;
  assetY: AssetClass;
  assetLq: AssetClass;
  feeNum: bigint;
  /** True when the pool carries treasury fields (fee-switch family). */
  feeSwitch: boolean;
  treasuryFee: bigint | null;
  treasuryX: bigint | null;
  treasuryY: bigint | null;
  /** DAOPolicy: governance credential(s) authorized for DAO/admin actions. */
  daoPolicy: Credential[];
  lqBound: bigint | null;
}

export function parseSplashPool(data: PD): SplashPoolConfig {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash PoolConfig: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length < 5) throw new Error(`Splash PoolConfig: expected ≥5 fields, got ${f.length}`);
  const common = {
    poolNft: parseAssetClass(f[0]),
    assetX: parseAssetClass(f[1]),
    assetY: parseAssetClass(f[2]),
    assetLq: parseAssetClass(f[3]),
    feeNum: asInt(f[4]),
  };
  // Fee-switch pools put treasuryFee (Int) at index 5; classic pools put the
  // DAOPolicy (a List) there, followed by lqBound.
  if (f.length > 5 && isInt(f[5])) {
    return {
      ...common,
      feeSwitch: true,
      treasuryFee: asInt(f[5]),
      treasuryX: f.length > 6 ? asInt(f[6]) : null,
      treasuryY: f.length > 7 ? asInt(f[7]) : null,
      // DAOPolicy (List<StakingCredential>) at 8, lqBound at 9.
      daoPolicy: f.length > 8 ? parseDaoPolicy(f[8]) : [],
      lqBound: f.length > 9 && isInt(f[9]) ? asInt(f[9]) : null,
    };
  }
  return {
    ...common,
    feeSwitch: false,
    treasuryFee: null,
    treasuryX: null,
    treasuryY: null,
    // classic: DAOPolicy (List<StakingCredential>) at 5, lqBound at 6 (optional).
    daoPolicy: parseDaoPolicy(f[5]),
    lqBound: f.length > 6 && isInt(f[6]) ? asInt(f[6]) : null,
  };
}

// DAOPolicy = List<StakingCredential>, each StakingCredential = Constr0[Credential].
// Returns the inner Credentials. Tolerant: returns [] for a non-list / odd shape.
function parseDaoPolicy(d: PD): Credential[] {
  try {
    return asList(d).map(parseStakingCredential);
  } catch {
    return [];
  }
}

// Const-product / balance pool spend redeemer = Constr0[ pool_in_ix, pool_out_ix ]
// (two Ints). Distinct from the bare-Bool order redeemer below.
export function classifySplashPoolRedeemer(data: PD): string | null {
  const c = asConstr(data);
  if (c.tag === 0 && c.fields.length >= 2) return "Pool batch";
  return null;
}

// Order spend redeemer is a bare Bool: True (execute) = Constr1[], False
// (cancel) = Constr0[].
export function classifySplashOrderRedeemer(data: PD): "Execute" | "Cancel" | null {
  const c = asConstr(data);
  if (c.fields.length !== 0) return null;
  if (c.tag === 1) return "Execute";
  if (c.tag === 0) return "Cancel";
  return null;
}

// --- Stableswap pool ------------------------------------------------------
//
// The deployed stableFnPoolT2t uses the FLATTENED fixed-2-asset "t2t" layout,
// NOT a List-based PoolData. A single Constr0 with 15 FLAT fields — the two
// tradable assets and their multipliers are individual fields, not Lists.

export interface SplashStablePool {
  poolNft: AssetClass;
  /** Amplification coefficient (A) for the Curve-style invariant. */
  amplCoeff: bigint;
  tradableAssets: AssetClass[];
  tradableTokensMultipliers: bigint[];
  lpToken: AssetClass;
  lpFeeIsEditable: boolean;
  /** A second Bool flag at idx 8; the deployed off-chain does not name it. */
  flag2: boolean;
  lpFeeNum: bigint;
  protocolFeeNum: bigint;
  daoStableProxyWitness: string;
  treasuryAddress: string;
  /** Accumulated protocol fees, one per tradable asset. */
  protocolFees: bigint[];
}

export function parseSplashStablePool(data: PD): SplashStablePool {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash StablePool: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 15) throw new Error(`Splash StablePool: expected 15 fields, got ${f.length}`);
  return {
    poolNft: parseAssetClass(f[0]),
    amplCoeff: asInt(f[1]),
    tradableAssets: [parseAssetClass(f[2]), parseAssetClass(f[3])],
    tradableTokensMultipliers: [asInt(f[4]), asInt(f[5])],
    lpToken: parseAssetClass(f[6]),
    lpFeeIsEditable: asBool(f[7]),
    // f[8] is an additional Bool flag the deployed off-chain does not name.
    flag2: asBool(f[8]),
    lpFeeNum: asInt(f[9]),
    protocolFeeNum: asInt(f[10]),
    daoStableProxyWitness: asBytes(f[11]),
    treasuryAddress: asBytes(f[12]),
    protocolFees: [asInt(f[13]), asInt(f[14])],
  };
}

// Stable PoolRedeemer = Constr0[pool_in_ix, pool_out_ix, action] where action
// PoolAction = AMMAction{option_int0, option_int1}(Constr0) | PDAOAction(Constr1).
export function classifySplashStablePoolRedeemer(
  data: PD,
): "AMM" | "DAOAction" | null {
  const c = asConstr(data);
  if (c.tag !== 0 || c.fields.length !== 3) return null;
  const action = asConstr(c.fields[2]);
  if (action.tag === 0) return "AMM";
  if (action.tag === 1) return "DAOAction";
  return null;
}

// --- Balance-function (weighted) pool -------------------------------------
//
// BalancePoolConfig, Constr0 with 10 fields. The deployed balanceFnPoolV1/V2 use
// the single-fee BalancePool layout (idx 0-7 with one lp_fee_num), NOT the
// separate-fee layout. Mirrors the const-product PoolConfig plus treasury fields;
// the per-asset weights live in the pool Value/parameters, not the datum.

export interface SplashBalancePool {
  poolNft: AssetClass;
  assetX: AssetClass;
  assetY: AssetClass;
  assetLq: AssetClass;
  feeNum: bigint;
  treasuryFee: bigint;
  treasuryX: bigint;
  treasuryY: bigint;
  /** DAOPolicy: governance credential(s) authorized for DAO/admin actions (idx 8). */
  daoPolicy: Credential[];
  /** treasuryAddress (ValidatorHash) at idx 9, after the DAOPolicy List at 8. */
  treasuryAddress: string | null;
}

export function parseSplashBalancePool(data: PD): SplashBalancePool {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash BalancePool: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length < 8) throw new Error(`Splash BalancePool: expected ≥8 fields, got ${f.length}`);
  return {
    poolNft: parseAssetClass(f[0]),
    assetX: parseAssetClass(f[1]),
    assetY: parseAssetClass(f[2]),
    assetLq: parseAssetClass(f[3]),
    feeNum: asInt(f[4]),
    treasuryFee: asInt(f[5]),
    treasuryX: asInt(f[6]),
    treasuryY: asInt(f[7]),
    // DAOPolicy (List<StakingCredential>) at idx 8, treasuryAddress at idx 9.
    daoPolicy: f.length > 8 ? parseDaoPolicy(f[8]) : [],
    treasuryAddress: f.length > 9 && !isInt(f[9]) ? safeBytes(f[9]) : null,
  };
}

// --- Legacy AMM proxy orders (Swap / Deposit / Redeem) --------------------
//
// Swap / Deposit / Redeem, each a Constr0. Asset = Constr0[policy, name];
// stakePkh = Maybe (Some=Constr0[bytes]/None=Constr1[]).

export interface SplashProxySwap {
  kind: "Swap";
  base: AssetClass;
  quote: AssetClass;
  poolNft: AssetClass;
  feeNum: bigint;
  exFeePerTokenNum: bigint;
  exFeePerTokenDen: bigint;
  rewardPkh: string;
  stakePkh: string | null;
  baseAmount: bigint;
  minQuoteAmount: bigint;
}

export interface SplashProxyDeposit {
  kind: "Deposit";
  poolNft: AssetClass;
  tokenA: AssetClass;
  tokenB: AssetClass;
  tokenLp: AssetClass;
  exFee: bigint;
  rewardPkh: string;
  stakePkh: string | null;
  collateralAda: bigint;
}

export interface SplashProxyRedeem {
  kind: "Redeem";
  poolNft: AssetClass;
  poolX: AssetClass;
  poolY: AssetClass;
  poolLp: AssetClass;
  exFee: bigint;
  rewardPkh: string;
  stakePkh: string | null;
}

export function parseSplashProxySwap(data: PD): SplashProxySwap {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash Proxy Swap: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 10) throw new Error(`Splash Proxy Swap: expected 10 fields, got ${f.length}`);
  return {
    kind: "Swap",
    base: parseAssetClass(f[0]),
    quote: parseAssetClass(f[1]),
    poolNft: parseAssetClass(f[2]),
    feeNum: asInt(f[3]),
    exFeePerTokenNum: asInt(f[4]),
    exFeePerTokenDen: asInt(f[5]),
    rewardPkh: asBytes(f[6]),
    stakePkh: asOptional(f[7], asBytes),
    baseAmount: asInt(f[8]),
    minQuoteAmount: asInt(f[9]),
  };
}

export function parseSplashProxyDeposit(data: PD): SplashProxyDeposit {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash Proxy Deposit: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 8) throw new Error(`Splash Proxy Deposit: expected 8 fields, got ${f.length}`);
  return {
    kind: "Deposit",
    poolNft: parseAssetClass(f[0]),
    tokenA: parseAssetClass(f[1]),
    tokenB: parseAssetClass(f[2]),
    tokenLp: parseAssetClass(f[3]),
    exFee: asInt(f[4]),
    rewardPkh: asBytes(f[5]),
    stakePkh: asOptional(f[6], asBytes),
    collateralAda: asInt(f[7]),
  };
}

export function parseSplashProxyRedeem(data: PD): SplashProxyRedeem {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash Proxy Redeem: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 7) throw new Error(`Splash Proxy Redeem: expected 7 fields, got ${f.length}`);
  return {
    kind: "Redeem",
    poolNft: parseAssetClass(f[0]),
    poolX: parseAssetClass(f[1]),
    poolY: parseAssetClass(f[2]),
    poolLp: parseAssetClass(f[3]),
    exFee: asInt(f[4]),
    rewardPkh: asBytes(f[5]),
    stakePkh: asOptional(f[6], asBytes),
  };
}

// Legacy AMM proxy order redeemer OrderRedeemer = Constr0[poolInIx, orderInIx,
// rewardOutIx, action] where action OrderAction is a BARE Int: Apply=0, Refund=1.
// The action sits in the `int` field, not a Constr.
export function classifySplashProxyOrderRedeemer(data: PD): "Apply" | "Refund" | null {
  const c = asConstr(data);
  if (c.tag !== 0 || c.fields.length !== 4) return null;
  const action = c.fields[3];
  if (!isInt(action)) return null;
  const a = asInt(action);
  if (a === BigInt(0)) return "Apply";
  if (a === BigInt(1)) return "Refund";
  return null;
}

// --- Grid order (native) --------------------------------------------------
//
// GridStateNative. NOT parameterized — the un-applied hash equals the deployed
// gridOrderNative hash. A single Constr0 with 13 ordered fields. `side` is a Bool
// (False=Constr0=Ask / True=Constr1=Bid); `redeemer_address` is the standard
// Cardano Address shape. Deployed gridOrderNative address:
// addr1w9h0lzvu5czuqhq3tuxhkrgrjl3dmzrv6dndw77tftr9jgsa5r7zh.

export interface SplashGridOrder {
  beacon: string;
  token: AssetClass;
  buyShiftFactor: Rational;
  sellShiftFactor: Rational;
  maxLovelaceOffer: bigint;
  lovelaceOffer: bigint;
  price: Rational;
  /** False = Ask, True = Bid. */
  side: boolean;
  budgetPerTransaction: bigint;
  minMarginalOutputLovelace: bigint;
  minMarginalOutputToken: bigint;
  redeemerAddress: PlutusAddress;
  cancellationPkh: string;
}

export function parseSplashGridOrder(data: PD): SplashGridOrder {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash GridOrder: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 13) throw new Error(`Splash GridOrder: expected 13 fields, got ${f.length}`);
  return {
    beacon: asBytes(f[0]),
    token: parseAssetClass(f[1]),
    buyShiftFactor: parseRational(f[2]),
    sellShiftFactor: parseRational(f[3]),
    maxLovelaceOffer: asInt(f[4]),
    lovelaceOffer: asInt(f[5]),
    price: parseRational(f[6]),
    side: asBool(f[7]),
    budgetPerTransaction: asInt(f[8]),
    minMarginalOutputLovelace: asInt(f[9]),
    minMarginalOutputToken: asInt(f[10]),
    redeemerAddress: parsePlutusAddress(f[11]),
    cancellationPkh: asBytes(f[12]),
  };
}

// Grid order Action is a real Constr (NOT the bare-Bool order redeemer):
// Execute = Constr0[successor_out_index: Int]; Close (cancel) = Constr1[].
export function classifySplashGridOrderRedeemer(data: PD): "Execute" | "Close" | null {
  const c = asConstr(data);
  if (c.tag === 0 && c.fields.length === 1 && isInt(c.fields[0])) return "Execute";
  if (c.tag === 1 && c.fields.length === 0) return "Close";
  return null;
}

// --- Royalty pool ---------------------------------------------------------
//
// RoyaltyPoolConfig, Constr0 with 15 ordered fields. DAOPolicy is a
// List<StakingCredential> where each StakingCredential = Constr0[Credential].
// `treasuryAddress` is a bare ValidatorHash ByteArray. Deployed royalty pool
// address:
// addr1x89ksjnfu7ys02tedvslc9g2wk90tu5qte0dt4dge60hdudj764lvrxdayh2ux30fl0ktuh27csgmpevdu89jlxppvrsg0g63z.

export interface SplashRoyaltyPool {
  poolNft: AssetClass;
  poolX: AssetClass;
  poolY: AssetClass;
  poolLq: AssetClass;
  feeNum: bigint;
  treasuryFee: bigint;
  royaltyFee: bigint;
  treasuryX: bigint;
  treasuryY: bigint;
  royaltyX: bigint;
  royaltyY: bigint;
  daoPolicy: Credential[];
  treasuryAddress: string;
  royaltyPubKey: string;
  nonce: bigint;
}

// StakingCredential = Constr0[Credential]; unwrap one layer to the inner
// Credential (ScriptCredential=Constr1[hash] / PubKeyCredential=Constr0[hash]).
function parseStakingCredential(d: PD): Credential {
  const c = asConstr(d);
  if (c.tag !== 0 || c.fields.length !== 1) {
    throw new Error(`Splash StakingCredential: unexpected shape ctor ${c.tag}`);
  }
  return parseCredential(c.fields[0]);
}

export function parseSplashRoyaltyPool(data: PD): SplashRoyaltyPool {
  const c = asConstr(data);
  if (c.tag !== 0) throw new Error(`Splash RoyaltyPool: unexpected ctor ${c.tag}`);
  const f = c.fields;
  if (f.length !== 15) throw new Error(`Splash RoyaltyPool: expected 15 fields, got ${f.length}`);
  return {
    poolNft: parseAssetClass(f[0]),
    poolX: parseAssetClass(f[1]),
    poolY: parseAssetClass(f[2]),
    poolLq: parseAssetClass(f[3]),
    feeNum: asInt(f[4]),
    treasuryFee: asInt(f[5]),
    royaltyFee: asInt(f[6]),
    treasuryX: asInt(f[7]),
    treasuryY: asInt(f[8]),
    royaltyX: asInt(f[9]),
    royaltyY: asInt(f[10]),
    daoPolicy: asList(f[11]).map(parseStakingCredential),
    treasuryAddress: asBytes(f[12]),
    royaltyPubKey: asBytes(f[13]),
    nonce: asInt(f[14]),
  };
}

// PoolRedeemer = Constr0[action, selfIx] where action: PoolAction is a BARE Int
// (PInner=PInteger): Deposit=0, Redeem=1, Swap=2, DAOAction=3, WithdrawRoyalty=4.
export function classifySplashRoyaltyPoolRedeemer(
  data: PD,
): "Deposit" | "Redeem" | "Swap" | "DAOAction" | "WithdrawRoyalty" | null {
  const c = asConstr(data);
  if (c.tag !== 0 || c.fields.length !== 2) return null;
  const action = c.fields[0];
  if (!isInt(action)) return null;
  const a = asInt(action);
  if (a === BigInt(0)) return "Deposit";
  if (a === BigInt(1)) return "Redeem";
  if (a === BigInt(2)) return "Swap";
  if (a === BigInt(3)) return "DAOAction";
  if (a === BigInt(4)) return "WithdrawRoyalty";
  return null;
}
