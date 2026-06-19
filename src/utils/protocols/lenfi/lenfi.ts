// Lenfi (Aada Finance V2) datum + redeemer parsers.
//
// All records = a single Constr (alternative 0) with fields in declared
// order; enums = Constr alternative = 0-based variant index. Option =
// Some -> Constr 0 [x], None -> Constr 1 []. AssetClass = Constr 0 [policy,
// name] (2 fields, NOT flattened). Address/Credential follow the stdlib
// shape (parsed via the shared combinators).
//
// cquisitor-lib's DetailedSchema decode normalizes the on-chain Constr tag to a
// 0-based `constructor` index, so `asConstr` reads the alternative directly.

import {
  asBytes,
  asConstr,
  asInt,
  asOptional,
  isInt,
  parseAssetClass,
  parseCredential,
  parsePlutusAddress,
  type AssetClass,
  type Credential,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";

// --- Shared sub-types ------------------------------------------------------

// OutputReference = Constr 0 [ Constr 0 [ ByteArray txid ], Int output_index ].
export interface OutputReference {
  transactionId: string;
  outputIndex: bigint;
}

export function parseOutputReference(d: PD): OutputReference {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`OutputReference: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`OutputReference: expected 2 fields, got ${c.fields.length}`);
  }
  const inner = asConstr(c.fields[0]);
  if (inner.tag !== 0 || inner.fields.length !== 1) {
    throw new Error("OutputReference: malformed TransactionId");
  }
  return {
    transactionId: asBytes(inner.fields[0]),
    outputIndex: asInt(c.fields[1]),
  };
}

// pool.InterestParams = Constr 0 [ optimal_utilization,
// base_interest_rate, rslope1, rslope2 ].
export interface InterestParams {
  optimalUtilization: bigint;
  baseInterestRate: bigint;
  rslope1: bigint;
  rslope2: bigint;
}

export function parseInterestParams(d: PD): InterestParams {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`InterestParams: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 4) {
    throw new Error(`InterestParams: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    optimalUtilization: asInt(c.fields[0]),
    baseInterestRate: asInt(c.fields[1]),
    rslope1: asInt(c.fields[2]),
    rslope2: asInt(c.fields[3]),
  };
}

// pool.PlatformFeeDetails.
export interface PlatformFeeDetails {
  tier1Fee: bigint;
  tier1Threshold: bigint;
  tier2Fee: bigint;
  tier2Threshold: bigint;
  tier3Fee: bigint;
  tier3Threshold: bigint;
  liquidationFee: bigint;
  platformFeeCollectorAddress: PlutusAddress;
}

export function parsePlatformFeeDetails(d: PD): PlatformFeeDetails {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PlatformFeeDetails: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 8) {
    throw new Error(`PlatformFeeDetails: expected 8 fields, got ${c.fields.length}`);
  }
  return {
    tier1Fee: asInt(c.fields[0]),
    tier1Threshold: asInt(c.fields[1]),
    tier2Fee: asInt(c.fields[2]),
    tier2Threshold: asInt(c.fields[3]),
    tier3Fee: asInt(c.fields[4]),
    tier3Threshold: asInt(c.fields[5]),
    liquidationFee: asInt(c.fields[6]),
    platformFeeCollectorAddress: parsePlutusAddress(c.fields[7]),
  };
}

// pool.Config. Held at the pool_config validator (referenced by
// config_ref) and embedded inside the CollateralDatum.
export interface PoolConfig {
  liquidationThreshold: bigint;
  initialCollateralRatio: bigint;
  poolFee: bigint;
  loanFeeDetails: PlatformFeeDetails;
  mergeActionFee: bigint;
  minTransition: bigint;
  minLoan: bigint;
  minFee: bigint;
  minLiquidationFee: bigint;
  interestParams: InterestParams;
}

export function parsePoolConfig(d: PD): PoolConfig {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PoolConfig: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 10) {
    throw new Error(`PoolConfig: expected 10 fields, got ${c.fields.length}`);
  }
  return {
    liquidationThreshold: asInt(c.fields[0]),
    initialCollateralRatio: asInt(c.fields[1]),
    poolFee: asInt(c.fields[2]),
    loanFeeDetails: parsePlatformFeeDetails(c.fields[3]),
    mergeActionFee: asInt(c.fields[4]),
    minTransition: asInt(c.fields[5]),
    minLoan: asInt(c.fields[6]),
    minFee: asInt(c.fields[7]),
    minLiquidationFee: asInt(c.fields[8]),
    interestParams: parseInterestParams(c.fields[9]),
  };
}

// --- ROLE "pool" : pool UTxO datum -----------------------------------------

// pool.Constants.
export interface PoolConstants {
  collateralAddress: PlutusAddress;
  loanCs: AssetClass;
  collateralCs: AssetClass;
  oracleCollateralAsset: AssetClass;
  oracleLoanAsset: AssetClass;
  lpToken: AssetClass;
  poolNftName: string;
  poolConfigAssetName: string;
}

export function parsePoolConstants(d: PD): PoolConstants {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PoolConstants: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 8) {
    throw new Error(`PoolConstants: expected 8 fields, got ${c.fields.length}`);
  }
  return {
    collateralAddress: parsePlutusAddress(c.fields[0]),
    loanCs: parseAssetClass(c.fields[1]),
    collateralCs: parseAssetClass(c.fields[2]),
    oracleCollateralAsset: parseAssetClass(c.fields[3]),
    oracleLoanAsset: parseAssetClass(c.fields[4]),
    lpToken: parseAssetClass(c.fields[5]),
    poolNftName: asBytes(c.fields[6]),
    poolConfigAssetName: asBytes(c.fields[7]),
  };
}

// pool.Datum = Constr 0 [ params, balance, lent_out,
// total_lp_tokens ].
export interface PoolDatum {
  params: PoolConstants;
  balance: bigint;
  lentOut: bigint;
  totalLpTokens: bigint;
}

export function parsePoolDatum(d: PD): PoolDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 4) {
    throw new Error(`PoolDatum: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    params: parsePoolConstants(c.fields[0]),
    balance: asInt(c.fields[1]),
    lentOut: asInt(c.fields[2]),
    totalLpTokens: asInt(c.fields[3]),
  };
}

// --- ROLE "loan" : collateral/loan UTxO datum ------------------------------

// collateral.CollateralDatum.
export interface CollateralDatum {
  poolNftName: string;
  loanCs: AssetClass;
  loanAmount: bigint;
  poolConfig: PoolConfig;
  collateralCs: AssetClass;
  collateralAmount: bigint;
  interestRate: bigint;
  lentOut: bigint;
  balance: bigint;
  depositTime: bigint;
  borrowerTn: string;
  oracleCollateralAsset: AssetClass;
  oracleLoanAsset: AssetClass;
  tag: OutputReference | null;
}

export function parseCollateralDatum(d: PD): CollateralDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`CollateralDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 14) {
    throw new Error(`CollateralDatum: expected 14 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    poolNftName: asBytes(f[0]),
    loanCs: parseAssetClass(f[1]),
    loanAmount: asInt(f[2]),
    poolConfig: parsePoolConfig(f[3]),
    collateralCs: parseAssetClass(f[4]),
    collateralAmount: asInt(f[5]),
    interestRate: asInt(f[6]),
    lentOut: asInt(f[7]),
    balance: asInt(f[8]),
    depositTime: asInt(f[9]),
    borrowerTn: asBytes(f[10]),
    oracleCollateralAsset: parseAssetClass(f[11]),
    oracleLoanAsset: parseAssetClass(f[12]),
    tag: asOptional(f[13], parseOutputReference),
  };
}

// --- ROLE "loan" variant : leftovers UTxO datum ----------------------------

// leftovers.LeftoversDatum = AssetClass (a type alias). On-chain this is the
// bare AssetClass Constr 0 [ policy_id, asset_name ] — the pool NFT asset class
// that ties the liquidation leftovers back to its originating pool. Held at the
// leftover validator (9b99fef5…), which shares the "loan" role with the
// collateral validator but carries this 2-field datum instead of the 14-field
// CollateralDatum.
export interface LeftoversDatum {
  poolNft: AssetClass;
}

export function parseLeftoversDatum(d: PD): LeftoversDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`LeftoversDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 2) {
    throw new Error(`LeftoversDatum: expected 2 fields, got ${c.fields.length}`);
  }
  return { poolNft: parseAssetClass(d) };
}

// --- ROLE "order" : batcher request UTxO datum -----------------------------
//
// order.Datum<order_type> = Constr 0 [ control_credential: Credential,
// pool_nft_cs: AssetClass, batcher_fee_ada: Int, order: order_type ]. The
// inner `order` is one of the *Request variants below; all are Constr 0 and are
// disambiguated by field count + the first field's shape (batchers deploy one
// validator per request kind, but the role we receive is the generic "order").

// The five inner request kinds. We surface the high-signal scalar/address fields
// and leave the embedded full `Output`/`PartialOutput`/`Value` structures (which
// the redeemer re-validates) summarized rather than fully expanded.
export type OrderRequest =
  | {
      kind: "Borrow";
      // expected_output.address — where the loan + borrower NFT are returned.
      destinationAddress: PlutusAddress | null;
      borrowerNftPolicy: string;
      minCollateralAmount: bigint;
      minDepositTime: bigint;
      maxInterestRate: bigint;
      collateralAddress: PlutusAddress;
    }
  | { kind: "Deposit"; destinationAddress: PlutusAddress | null; depositAmount: bigint; lpAsset: AssetClass }
  | {
      kind: "Withdraw";
      destinationAddress: PlutusAddress | null;
      lpTokensBurn: bigint;
      receiveAsset: AssetClass;
      lpAsset: AssetClass;
    }
  | {
      kind: "Repay";
      destinationAddress: PlutusAddress | null;
      order: OutputReference;
      burnAsset: AssetClass;
    }
  | { kind: "Liquidate"; destinationAddress: PlutusAddress | null }
  | { kind: "Unknown"; fieldCount: number };

export interface OrderDatum {
  controlCredential: Credential;
  poolNftCs: AssetClass;
  batcherFeeAda: bigint;
  request: OrderRequest;
}

// Output = Constr 0 [ address: Address, value: Value, datum, reference_script ]
// and PartialOutput = Constr 0 [ address: Address, value: Value, datum ]. Both
// carry the user's destination Address as their first field; the embedded Value
// is the user-provided ADA/asset baseline (the batcher tops it up). We surface
// only the destination address — the full Value is re-derived by the redeemer.
function parseOrderOutputAddress(d: PD): PlutusAddress | null {
  try {
    const c = asConstr(d);
    if (c.tag !== 0 || c.fields.length < 1) return null;
    return parsePlutusAddress(c.fields[0]);
  } catch {
    return null;
  }
}

// BorrowRequest = Constr 0 [ expected_output: Output, partial_output:
// PartialOutput, borrower_nft_policy: PolicyId, min_collateral_amount: Int,
// min_deposit_time: POSIXTime, max_interest_rate: Int, collateral_address:
// Address ].
function parseBorrowRequest(fields: PD[]): OrderRequest {
  return {
    kind: "Borrow",
    destinationAddress: parseOrderOutputAddress(fields[0]),
    borrowerNftPolicy: asBytes(fields[2]),
    minCollateralAmount: asInt(fields[3]),
    minDepositTime: asInt(fields[4]),
    maxInterestRate: asInt(fields[5]),
    collateralAddress: parsePlutusAddress(fields[6]),
  };
}

// Decode the inner request by structure. order.Datum is generic, so the on-chain
// datum gives no explicit tag for which request it carries; we discriminate on
// the (constructor-0) field count, and on the first field's type for the 3-field
// collision between DepositRequest (Int first) and RepayRequest (Output first).
function parseOrderRequest(d: PD): OrderRequest {
  const c = asConstr(d);
  if (c.tag !== 0) {
    throw new Error(`order request: unexpected ctor ${c.tag}`);
  }
  const f = c.fields;
  switch (f.length) {
    case 1:
      // LiquidateRequest = Constr 0 [ expected_output: Output ].
      return { kind: "Liquidate", destinationAddress: parseOrderOutputAddress(f[0]) };
    case 3:
      if (isInt(f[0])) {
        // DepositRequest = Constr 0 [ deposit_amount: Int, partial_output,
        // lp_asset: AssetClass ].
        return {
          kind: "Deposit",
          destinationAddress: parseOrderOutputAddress(f[1]),
          depositAmount: asInt(f[0]),
          lpAsset: parseAssetClass(f[2]),
        };
      }
      // RepayRequest = Constr 0 [ expected_output: Output, order:
      // OutputReference, burn_asset: AssetClass ].
      return {
        kind: "Repay",
        destinationAddress: parseOrderOutputAddress(f[0]),
        order: parseOutputReference(f[1]),
        burnAsset: parseAssetClass(f[2]),
      };
    case 4:
      // WithdrawRequest = Constr 0 [ lp_tokens_burn: Int, partial_output,
      // receive_asset: AssetClass, lp_asset: AssetClass ].
      return {
        kind: "Withdraw",
        destinationAddress: parseOrderOutputAddress(f[1]),
        lpTokensBurn: asInt(f[0]),
        receiveAsset: parseAssetClass(f[2]),
        lpAsset: parseAssetClass(f[3]),
      };
    case 7:
      return parseBorrowRequest(f);
    default:
      return { kind: "Unknown", fieldCount: f.length };
  }
}

export function parseOrderDatum(d: PD): OrderDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`order.Datum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 4) {
    throw new Error(`order.Datum: expected 4 fields, got ${c.fields.length}`);
  }
  return {
    controlCredential: parseCredential(c.fields[0]),
    poolNftCs: parseAssetClass(c.fields[1]),
    batcherFeeAda: asInt(c.fields[2]),
    request: parseOrderRequest(c.fields[3]),
  };
}

// Single decode entry point (one decode per spec). role is a string.
export type LenfiDatum =
  | { kind: "pool"; datum: PoolDatum }
  | { kind: "loan"; datum: CollateralDatum }
  | { kind: "leftovers"; datum: LeftoversDatum }
  | { kind: "order"; datum: OrderDatum };

export function parseLenfiDatum(data: PD, role: string): LenfiDatum {
  if (role === "pool") return { kind: "pool", datum: parsePoolDatum(data) };
  if (role === "loan") {
    // The "loan" role covers two validators: the collateral validator
    // (14-field CollateralDatum) and the leftover validator (2-field
    // LeftoversDatum / AssetClass). Disambiguate by field count.
    const c = asConstr(data);
    if (c.tag === 0 && c.fields.length === 2) {
      return { kind: "leftovers", datum: parseLeftoversDatum(data) };
    }
    return { kind: "loan", datum: parseCollateralDatum(data) };
  }
  if (role === "order") return { kind: "order", datum: parseOrderDatum(data) };
  throw new Error(`Lenfi: no datum parser for role "${role}"`);
}

// --- Pool spend redeemer (wrapped) -----------------------------------------
//
// On-chain = WrappedRedeemer<pool.Redeemer>: Constr 0 =
// BadScriptContext [], Constr 1 = Wrapped [inner]. The real redeemer is
// therefore Constr 1 [ pool.Redeemer ].

export type PoolContinuingAction =
  | { kind: "LpAdjust"; valueDelta: bigint; continuingOutput: bigint }
  | {
      kind: "Borrow";
      loanAmount: bigint;
      collateralAmount: bigint;
      borrowerTn: string;
      interestRate: bigint;
      continuingOutput: bigint;
    }
  | { kind: "CloseLoan"; loanAmount: bigint; repayAmount: bigint; continuingOutput: bigint }
  | { kind: "PayFee"; fee: bigint; continuingOutput: bigint };

export type PoolAction =
  | { kind: "Continuing"; action: PoolContinuingAction }
  | { kind: "Destroy" };

export interface PoolRedeemer {
  action: PoolAction;
  configRef: OutputReference;
  order: OutputReference | null;
}

function parseContinuingAction(d: PD): PoolContinuingAction {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return {
        kind: "LpAdjust",
        valueDelta: asInt(c.fields[0]),
        continuingOutput: asInt(c.fields[1]),
      };
    case 1:
      return {
        kind: "Borrow",
        loanAmount: asInt(c.fields[0]),
        collateralAmount: asInt(c.fields[1]),
        borrowerTn: asBytes(c.fields[2]),
        interestRate: asInt(c.fields[3]),
        continuingOutput: asInt(c.fields[4]),
      };
    case 2:
      return {
        kind: "CloseLoan",
        loanAmount: asInt(c.fields[0]),
        repayAmount: asInt(c.fields[1]),
        continuingOutput: asInt(c.fields[2]),
      };
    case 3:
      return {
        kind: "PayFee",
        fee: asInt(c.fields[0]),
        continuingOutput: asInt(c.fields[1]),
      };
    default:
      throw new Error(`ContinuingAction: unexpected ctor ${c.tag}`);
  }
}

function parsePoolAction(d: PD): PoolAction {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "Continuing", action: parseContinuingAction(c.fields[0]) };
  if (c.tag === 1) return { kind: "Destroy" };
  throw new Error(`PoolAction: unexpected ctor ${c.tag}`);
}

// Inner pool.Redeemer = Constr 0 [ action, config_ref, order ].
export function parseInnerPoolRedeemer(d: PD): PoolRedeemer {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`pool.Redeemer: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 3) {
    throw new Error(`pool.Redeemer: expected 3 fields, got ${c.fields.length}`);
  }
  return {
    action: parsePoolAction(c.fields[0]),
    configRef: parseOutputReference(c.fields[1]),
    order: asOptional(c.fields[2], parseOutputReference),
  };
}

// Unwrap the WrappedRedeemer and parse the inner pool.Redeemer. Returns null for
// the BadScriptContext (Constr 0) shape.
export function parsePoolRedeemer(d: PD): PoolRedeemer | null {
  const c = asConstr(d);
  if (c.tag === 0) return null; // BadScriptContext
  if (c.tag === 1) return parseInnerPoolRedeemer(c.fields[0]);
  throw new Error(`WrappedRedeemer: unexpected ctor ${c.tag}`);
}

// --- Collateral spend redeemer ---------------------------------------------

export type CollateralAction =
  | { kind: "Repay" }
  | { kind: "Liquidate"; liquidationOutputRefIndex: bigint };

export type CollateralMergeType =
  | { kind: "ImmediateWithPool"; outputReference: OutputReference }
  | { kind: "DelayedIntoPool"; outputIndex: bigint; amountRepaying: bigint };

export interface CollateralRedeemer {
  action: CollateralAction;
  interest: bigint;
  mergeType: CollateralMergeType;
}

function parseCollateralAction(d: PD): CollateralAction {
  const c = asConstr(d);
  if (c.tag === 0) return { kind: "Repay" };
  if (c.tag === 1) return { kind: "Liquidate", liquidationOutputRefIndex: asInt(c.fields[0]) };
  throw new Error(`CollateralRedeemerType: unexpected ctor ${c.tag}`);
}

function parseCollateralMergeType(d: PD): CollateralMergeType {
  const c = asConstr(d);
  if (c.tag === 0) {
    return { kind: "ImmediateWithPool", outputReference: parseOutputReference(c.fields[0]) };
  }
  if (c.tag === 1) {
    const inner = asConstr(c.fields[0]); // DelayedMergeValues = Constr0[ idx, amount ]
    if (inner.fields.length !== 2) {
      throw new Error(`DelayedMergeValues: expected 2 fields, got ${inner.fields.length}`);
    }
    return {
      kind: "DelayedIntoPool",
      outputIndex: asInt(inner.fields[0]),
      amountRepaying: asInt(inner.fields[1]),
    };
  }
  throw new Error(`CollateralMergeType: unexpected ctor ${c.tag}`);
}

// CollateralRedeemer = Constr 0 [ action, interest,
// merge_type ].
export function parseCollateralRedeemer(d: PD): CollateralRedeemer {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`CollateralRedeemer: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 3) {
    throw new Error(`CollateralRedeemer: expected 3 fields, got ${c.fields.length}`);
  }
  return {
    action: parseCollateralAction(c.fields[0]),
    interest: asInt(c.fields[1]),
    mergeType: parseCollateralMergeType(c.fields[2]),
  };
}

// --- Light validation ------------------------------------------------------
//
// Returns DexIssue[] (typed loosely to avoid importing the registry barrel into
// the parser; index.ts merges these into the view).

export interface LenfiIssue {
  severity: "error" | "warning" | "info";
  message: string;
}

export function validatePoolDatum(p: PoolDatum): LenfiIssue[] {
  const issues: LenfiIssue[] = [];
  if (p.balance < BigInt(0)) {
    issues.push({ severity: "error", message: "Pool balance is negative" });
  }
  if (p.lentOut < BigInt(0)) {
    issues.push({ severity: "error", message: "Pool lent_out is negative" });
  }
  if (p.totalLpTokens < BigInt(0)) {
    issues.push({ severity: "error", message: "Pool total_lp_tokens is negative" });
  }
  return issues;
}

export function validateCollateralDatum(c: CollateralDatum): LenfiIssue[] {
  const issues: LenfiIssue[] = [];
  if (c.loanAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Loan amount is not positive" });
  }
  if (c.collateralAmount <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Collateral amount is not positive" });
  }
  if (c.interestRate < BigInt(0)) {
    issues.push({ severity: "error", message: "Interest rate is negative" });
  }
  return issues;
}

// Credential is re-exported for callers that want to inspect the collateral
// address payment credential without re-importing the shared module.
export type { Credential };
export { parseCredential };
