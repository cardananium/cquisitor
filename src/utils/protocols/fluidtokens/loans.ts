// FluidTokens Loans V3 (P2P lending) — typed PlutusData parsers (Plutus V3).
//
// ARCHITECTURE NOTE (matters for how this module is used):
//   `general_spend` is a SINGLE generic spend validator that holds
//   Request / Pool / Loan UTxOs and accepts OPAQUE `Data` for BOTH datum and
//   redeemer. So:
//     • To TYPE a UTxO datum we identify the UTxO by the minted NFT policy
//       (requestPolicyId / poolPolicyId / loanPolicyId from the on-chain
//       ConfigDatum) and parse the inline datum as RequestDatum / PoolDatum /
//       LoanDatum (all Constr 0).
//     • The SPEND redeemer of the consumed UTxO is dummy `Data` — the real action
//       (fund / repay / liquidate / cancel) lives in the transaction's WITHDRAWAL
//       redeemers (withdraw-zero / staking-script pattern). Those are modeled by
//       the *WithdrawRedeemer + per-action *ActionWithdrawRedeemer types below.
//
// Encoding conventions:
//   • single-record type        = Constr index 0
//   • enums                      = Constr by declaration order
//   • Bool                       = False Constr0[] / True Constr1[]  (asBool)
//   • Option<T>                  = Some Constr0[T] / None Constr1[]   (asOptional)
//   • `Data` field               = arbitrary opaque PlutusData (passed through)
//   • Address / Credential       = standard Cardano Plutus shape
//
// NOTE: `Asset` here is NOT the shared `AssetClass` Constr semantically — but it
// has the identical 2-field Constr0[policyId, assetName] wire shape, so we reuse
// `parseAssetClass`. ADA = ("",""); the oracle "dummy" is ascii "NONE"/"NONE".

import {
  asBool,
  asBytes,
  asConstr,
  asInt,
  asList,
  asOptional,
  parseAssetClass,
  parseCredential,
  parsePlutusAddress,
  type AssetClass,
  type Credential,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";

// --- Shared types -----------------------------------------------------------

export type FtAsset = AssetClass; // Constr0[policyId, assetName]

export interface FtCollateralAsset {
  policyId: string;
  maybeAssetName: string | null; // Option<ByteArray>
  oracleTokenAsset: FtAsset;
}

export function parseCollateralAsset(d: PD): FtCollateralAsset {
  const c = asConstr(d);
  if (c.fields.length !== 3) {
    throw new Error(`CollateralAsset: expected 3 fields, got ${c.fields.length}`);
  }
  return {
    policyId: asBytes(c.fields[0]),
    maybeAssetName: asOptional(c.fields[1], asBytes),
    oracleTokenAsset: parseAssetClass(c.fields[2]),
  };
}

// AuthorizationMethod — enum, indices 0/1/2/3.
export type FtAuthorizationMethod =
  | { kind: "CardanoSignature"; hash: string }
  | { kind: "CardanoSpendScript"; hash: string }
  | { kind: "CardanoWithdrawScript"; hash: string }
  | { kind: "CardanoMintScript"; hash: string };

export function parseAuthorizationMethod(d: PD): FtAuthorizationMethod {
  const c = asConstr(d);
  const hash = c.fields.length > 0 ? asBytes(c.fields[0]) : "";
  switch (c.tag) {
    case 0:
      return { kind: "CardanoSignature", hash };
    case 1:
      return { kind: "CardanoSpendScript", hash };
    case 2:
      return { kind: "CardanoWithdrawScript", hash };
    case 3:
      return { kind: "CardanoMintScript", hash };
    default:
      throw new Error(`AuthorizationMethod: unexpected ctor ${c.tag}`);
  }
}

// LiquidationMode — enum, indices 0/1/2.
export type FtLiquidationMode =
  | { kind: "NoLiquidationFullCollateralClaim" }
  | { kind: "NoLiquidationDutchAuctionClaim" }
  | {
      kind: "Liquidation";
      lTV: bigint;
      lTVDivider: bigint;
      partialLiquidationPenaltyPerMille: bigint;
      equityInPrincipalCurrency: boolean;
    };

export function parseLiquidationMode(d: PD): FtLiquidationMode {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "NoLiquidationFullCollateralClaim" };
    case 1:
      return { kind: "NoLiquidationDutchAuctionClaim" };
    case 2:
      // Deployed mainnet Liquidation carries 3 fields (lTV, lTVDivider,
      // penalty); the 4th `equityInPrincipalCurrency` boolean is absent on-chain.
      // Accept 3 or 4 fields and default the optional flag to false when it is
      // missing.
      if (c.fields.length < 3) {
        throw new Error(`Liquidation: expected at least 3 fields, got ${c.fields.length}`);
      }
      return {
        kind: "Liquidation",
        lTV: asInt(c.fields[0]),
        lTVDivider: asInt(c.fields[1]),
        partialLiquidationPenaltyPerMille: asInt(c.fields[2]),
        equityInPrincipalCurrency: c.fields.length >= 4 ? asBool(c.fields[3]) : false,
      };
    default:
      throw new Error(`LiquidationMode: unexpected ctor ${c.tag}`);
  }
}

// RepaymentMode — enum, declaration order 0/1/2.
export type FtRepaymentMode =
  | { kind: "InterestOnRemainingPrincipal"; maxPossibleRecasts: bigint }
  | { kind: "PrincipalAndInterestOnInstallments" }
  | { kind: "PerpetualLoan"; apyIncreaseLinearCoefficient: bigint; maxPossibleRecasts: bigint };

export function parseRepaymentMode(d: PD): FtRepaymentMode {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "InterestOnRemainingPrincipal", maxPossibleRecasts: asInt(c.fields[0]) };
    case 1:
      return { kind: "PrincipalAndInterestOnInstallments" };
    case 2:
      return {
        kind: "PerpetualLoan",
        apyIncreaseLinearCoefficient: asInt(c.fields[0]),
        maxPossibleRecasts: asInt(c.fields[1]),
      };
    default:
      throw new Error(`RepaymentMode: unexpected ctor ${c.tag}`);
  }
}

// CommonData — Constr 0, 11 fields.
export interface FtCommonData {
  principalAsset: FtAsset;
  principalOracleAsset: FtAsset;
  interestRate: bigint;
  installmentPeriod: bigint;
  totalInstallments: bigint;
  initialGracePeriod: bigint;
  liquidationMode: FtLiquidationMode;
  repaymentMode: FtRepaymentMode;
  repaymentTimeWindow: bigint;
  penaltyFeeForLateRepayment: bigint;
  repaymentReceipts: boolean;
}

export function parseCommonData(d: PD): FtCommonData {
  const c = asConstr(d);
  if (c.fields.length !== 11) {
    throw new Error(`CommonData: expected 11 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    principalAsset: parseAssetClass(f[0]),
    principalOracleAsset: parseAssetClass(f[1]),
    interestRate: asInt(f[2]),
    installmentPeriod: asInt(f[3]),
    totalInstallments: asInt(f[4]),
    initialGracePeriod: asInt(f[5]),
    liquidationMode: parseLiquidationMode(f[6]),
    repaymentMode: parseRepaymentMode(f[7]),
    repaymentTimeWindow: asInt(f[8]),
    penaltyFeeForLateRepayment: asInt(f[9]),
    repaymentReceipts: asBool(f[10]),
  };
}

// --- DATUMS (all Constr 0; held at general_spend, typed by minted NFT) ------

export interface FtRequestDatum {
  kind: "request";
  permissionedConditionScriptHash: string;
  extraData: PD; // opaque passthrough
  commonData: FtCommonData;
  borrowerAuth: FtAuthorizationMethod;
  borrowerAddress: PlutusAddress;
  collateral: FtCollateralAsset;
  minPrincipal: bigint;
  minPrincipalDivider: bigint;
  maxPrincipal: bigint;
  dynamicCollateralPrice: boolean;
  requestExpiration: bigint; // POSIX millis
  requestExpirationPenalty: bigint; // lovelace
}

export function parseRequestDatum(d: PD): FtRequestDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`RequestDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 12) {
    throw new Error(`RequestDatum: expected 12 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    kind: "request",
    permissionedConditionScriptHash: asBytes(f[0]),
    extraData: f[1],
    commonData: parseCommonData(f[2]),
    borrowerAuth: parseAuthorizationMethod(f[3]),
    borrowerAddress: parsePlutusAddress(f[4]),
    collateral: parseCollateralAsset(f[5]),
    minPrincipal: asInt(f[6]),
    minPrincipalDivider: asInt(f[7]),
    maxPrincipal: asInt(f[8]),
    dynamicCollateralPrice: asBool(f[9]),
    requestExpiration: asInt(f[10]),
    requestExpirationPenalty: asInt(f[11]),
  };
}

export interface FtPoolDatum {
  kind: "pool";
  permissionedConditionScriptHash: string;
  extraData: PD; // opaque
  commonData: FtCommonData;
  lenderAuth: FtAuthorizationMethod;
  lenderBondAddress: PlutusAddress;
  lenderBondInlineDatumHash: string;
  collateralOptions: FtCollateralAsset[];
  minCollateral: bigint[];
  minCollateralDivider: bigint[];
  dynamicCollateralPrice: boolean;
}

export function parsePoolDatum(d: PD): FtPoolDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`PoolDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 10) {
    throw new Error(`PoolDatum: expected 10 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    kind: "pool",
    permissionedConditionScriptHash: asBytes(f[0]),
    extraData: f[1],
    commonData: parseCommonData(f[2]),
    lenderAuth: parseAuthorizationMethod(f[3]),
    lenderBondAddress: parsePlutusAddress(f[4]),
    lenderBondInlineDatumHash: asBytes(f[5]),
    collateralOptions: asList(f[6]).map(parseCollateralAsset),
    minCollateral: asList(f[7]).map(asInt),
    minCollateralDivider: asList(f[8]).map(asInt),
    dynamicCollateralPrice: asBool(f[9]),
  };
}

export interface FtLoanDatum {
  kind: "loan";
  doneRecasts: bigint;
  principalAmount: bigint;
  lendDate: bigint; // POSIX millis
  repaidInstallments: bigint;
  interestRate: bigint;
  totalInstallments: bigint;
  principalAsset: FtAsset;
  principalOracleAsset: FtAsset;
  installmentPeriod: bigint;
  initialGracePeriod: bigint;
  liquidationMode: FtLiquidationMode;
  repaymentMode: FtRepaymentMode;
  repaymentTimeWindow: bigint;
  penaltyFeeForLateRepayment: bigint;
  repaymentReceipts: boolean;
  originId: string; // AssetName = poolId or requestId
  collateral: FtCollateralAsset;
}

export function parseLoanDatum(d: PD): FtLoanDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`LoanDatum: unexpected ctor ${c.tag}`);
  if (c.fields.length !== 17) {
    throw new Error(`LoanDatum: expected 17 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    kind: "loan",
    doneRecasts: asInt(f[0]),
    principalAmount: asInt(f[1]),
    lendDate: asInt(f[2]),
    repaidInstallments: asInt(f[3]),
    interestRate: asInt(f[4]),
    totalInstallments: asInt(f[5]),
    principalAsset: parseAssetClass(f[6]),
    principalOracleAsset: parseAssetClass(f[7]),
    installmentPeriod: asInt(f[8]),
    initialGracePeriod: asInt(f[9]),
    liquidationMode: parseLiquidationMode(f[10]),
    repaymentMode: parseRepaymentMode(f[11]),
    repaymentTimeWindow: asInt(f[12]),
    penaltyFeeForLateRepayment: asInt(f[13]),
    repaymentReceipts: asBool(f[14]),
    originId: asBytes(f[15]),
    collateral: parseCollateralAsset(f[16]),
  };
}

export type FtDatum = FtRequestDatum | FtPoolDatum | FtLoanDatum;

// Best-effort dispatch by field count when the NFT sub-role is unknown.
// (request = 12 fields, pool = 10, loan = 17 — all distinct.)
export function parseFtDatum(d: PD): FtDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`FluidTokens datum: unexpected ctor ${c.tag}`);
  switch (c.fields.length) {
    case 12:
      return parseRequestDatum(d);
    case 10:
      return parsePoolDatum(d);
    case 17:
      return parseLoanDatum(d);
    default:
      throw new Error(`FluidTokens datum: unrecognized field count ${c.fields.length}`);
  }
}

// --- OutputReference (standard Plutus: Constr0[ Constr0[txIdBytes], idx ]) ---

export interface FtOutputReference {
  transactionId: string;
  outputIndex: bigint;
}

export function parseOutputReference(d: PD): FtOutputReference {
  const c = asConstr(d);
  if (c.fields.length !== 2) {
    throw new Error(`OutputReference: expected 2 fields, got ${c.fields.length}`);
  }
  const txId = asConstr(c.fields[0]);
  return {
    transactionId: asBytes(txId.fields[0]),
    outputIndex: asInt(c.fields[1]),
  };
}

// --- MINT REDEEMERS ---------------------------------------------------------

export interface FtRequestMintRedeemer {
  configRefInputIndex: bigint;
  inputRef: FtOutputReference;
}

export function parseRequestMintRedeemer(d: PD): FtRequestMintRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    inputRef: parseOutputReference(c.fields[1]),
  };
}

export interface FtPoolMintRedeemer {
  configRefInputIndex: bigint;
  inputRef: FtOutputReference;
}

export function parsePoolMintRedeemer(d: PD): FtPoolMintRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    inputRef: parseOutputReference(c.fields[1]),
  };
}

export interface FtLoanMintRedeemer {
  configRefInputIndex: bigint;
  isPoolOrigin: boolean;
  originWithdrawRedeemerIndex: bigint;
}

export function parseLoanMintRedeemer(d: PD): FtLoanMintRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    isPoolOrigin: asBool(c.fields[1]),
    originWithdrawRedeemerIndex: asInt(c.fields[2]),
  };
}

// --- WITHDRAWAL REDEEMERS (the REAL actions) --------------------------------

// Request side ---------------------------------------------------------------

export type FtRequestAction =
  | { kind: "Cancel"; requestId: string }
  | { kind: "CancelAfterExpiration"; requestId: string }
  | {
      kind: "Lend"; // = the FUND action for a borrower request
      principalOracleRefInputIndex: bigint; // -1 if ADA
      collateralOracleRefInputIndex: bigint; // -1
      givenPrincipalAmount: bigint;
      requestId: string;
      permissionedConditionWithdrawIndex: bigint;
    };

export function parseRequestAction(d: PD): FtRequestAction {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return { kind: "Cancel", requestId: asBytes(c.fields[0]) };
    case 1:
      return { kind: "CancelAfterExpiration", requestId: asBytes(c.fields[0]) };
    case 2:
      return {
        kind: "Lend",
        principalOracleRefInputIndex: asInt(c.fields[0]),
        collateralOracleRefInputIndex: asInt(c.fields[1]),
        givenPrincipalAmount: asInt(c.fields[2]),
        requestId: asBytes(c.fields[3]),
        permissionedConditionWithdrawIndex: asInt(c.fields[4]),
      };
    default:
      throw new Error(`RequestAction: unexpected ctor ${c.tag}`);
  }
}

export interface FtRequestWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionsForEachInput: FtRequestAction[];
}

export function parseRequestWithdrawRedeemer(d: PD): FtRequestWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionsForEachInput: asList(c.fields[1]).map(parseRequestAction),
  };
}

// Pool side ------------------------------------------------------------------

export type FtPoolActionType = "Cancel" | "Borrow" | "SellLenderPosition";

export function parsePoolActionType(d: PD): FtPoolActionType {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return "Cancel";
    case 1:
      return "Borrow";
    case 2:
      return "SellLenderPosition";
    default:
      throw new Error(`Pool ActionType: unexpected ctor ${c.tag}`);
  }
}

export interface FtPoolWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionType: FtPoolActionType;
}

export function parsePoolWithdrawRedeemer(d: PD): FtPoolWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionType: parsePoolActionType(c.fields[1]),
  };
}

export interface FtPoolCancelData {
  poolId: string;
}

export interface FtPoolCancelActionWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionsForEachInput: FtPoolCancelData[];
}

export function parsePoolCancelActionWithdrawRedeemer(d: PD): FtPoolCancelActionWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionsForEachInput: asList(c.fields[1]).map((x) => ({ poolId: asBytes(asConstr(x).fields[0]) })),
  };
}

export interface FtBorrowData {
  borrowerAddress: PlutusAddress;
  outputWithLenderTokenIndex: bigint;
  principalOracleRefInputIndex: bigint;
  chosenCollateralIndex: bigint;
  chosenCollateralOracleRefInputIndex: bigint;
  wantedPrincipalAmount: bigint;
  poolId: string;
  permissionedConditionWithdrawIndex: bigint;
}

export function parseBorrowData(d: PD): FtBorrowData {
  const c = asConstr(d);
  if (c.fields.length !== 8) {
    throw new Error(`BorrowData: expected 8 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    borrowerAddress: parsePlutusAddress(f[0]),
    outputWithLenderTokenIndex: asInt(f[1]),
    principalOracleRefInputIndex: asInt(f[2]),
    chosenCollateralIndex: asInt(f[3]),
    chosenCollateralOracleRefInputIndex: asInt(f[4]),
    wantedPrincipalAmount: asInt(f[5]),
    poolId: asBytes(f[6]),
    permissionedConditionWithdrawIndex: asInt(f[7]),
  };
}

export interface FtPoolBorrowActionWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionsForEachInput: FtBorrowData[];
}

export function parsePoolBorrowActionWithdrawRedeemer(d: PD): FtPoolBorrowActionWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionsForEachInput: asList(c.fields[1]).map(parseBorrowData),
  };
}

export interface FtSellingLenderBondInfo {
  lenderBondInputIndex: bigint;
  lenderBondAssetName: string;
  loanRefInputIndex: bigint;
  outputWithLenderTokenIndex: bigint;
  poolCollateralIndex: bigint;
  collateralOracleRefInputIndex: bigint;
  principalOracleRefInputIndex: bigint;
}

export function parseSellingLenderBondInfo(d: PD): FtSellingLenderBondInfo {
  const c = asConstr(d);
  if (c.fields.length !== 7) {
    throw new Error(`SellingLenderBondInfo: expected 7 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    lenderBondInputIndex: asInt(f[0]),
    lenderBondAssetName: asBytes(f[1]),
    loanRefInputIndex: asInt(f[2]),
    outputWithLenderTokenIndex: asInt(f[3]),
    poolCollateralIndex: asInt(f[4]),
    collateralOracleRefInputIndex: asInt(f[5]),
    principalOracleRefInputIndex: asInt(f[6]),
  };
}

export interface FtSellLenderPositionData {
  lenderBondsInfo: FtSellingLenderBondInfo[];
  poolId: string;
}

export interface FtPoolSellLenderPositionActionWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionsForEachInput: FtSellLenderPositionData[];
}

export function parsePoolSellLenderPositionActionWithdrawRedeemer(
  d: PD,
): FtPoolSellLenderPositionActionWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionsForEachInput: asList(c.fields[1]).map((x) => {
      const e = asConstr(x);
      return {
        lenderBondsInfo: asList(e.fields[0]).map(parseSellingLenderBondInfo),
        poolId: asBytes(e.fields[1]),
      };
    }),
  };
}

// Loan side ------------------------------------------------------------------

export type FtLoanActionType = "Claim" | "Repay" | "ChangeCollateral" | "Recast";

export function parseLoanActionType(d: PD): FtLoanActionType {
  const c = asConstr(d);
  switch (c.tag) {
    case 0:
      return "Claim"; // lender; = LIQUIDATE / collect
    case 1:
      return "Repay"; // borrower
    case 2:
      return "ChangeCollateral"; // borrower
    case 3:
      return "Recast"; // borrower
    default:
      throw new Error(`Loan ActionType: unexpected ctor ${c.tag}`);
  }
}

export interface FtLoanWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionType: FtLoanActionType;
}

export function parseLoanWithdrawRedeemer(d: PD): FtLoanWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionType: parseLoanActionType(c.fields[1]),
  };
}

export interface FtClaimData {
  liquidationMode: FtLiquidationMode;
  lenderBondOutputIndex: bigint;
  borrowerBondRefInputIndex: bigint;
  collateralOracleRefInputIndex: bigint;
  principalOracleRefInputIndex: bigint;
  borrowerBondRefInputPolicyIdIndex: bigint;
  borrowerBondRefInputAssetNameIndex: bigint;
  lenderAuth: FtAuthorizationMethod;
  equity: bigint;
  loanId: string;
  remainingDebt: bigint;
}

export function parseClaimData(d: PD): FtClaimData {
  const c = asConstr(d);
  if (c.fields.length !== 11) {
    throw new Error(`ClaimData: expected 11 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    liquidationMode: parseLiquidationMode(f[0]),
    lenderBondOutputIndex: asInt(f[1]),
    borrowerBondRefInputIndex: asInt(f[2]),
    collateralOracleRefInputIndex: asInt(f[3]),
    principalOracleRefInputIndex: asInt(f[4]),
    borrowerBondRefInputPolicyIdIndex: asInt(f[5]),
    borrowerBondRefInputAssetNameIndex: asInt(f[6]),
    lenderAuth: parseAuthorizationMethod(f[7]),
    equity: asInt(f[8]),
    loanId: asBytes(f[9]),
    remainingDebt: asInt(f[10]),
  };
}

export interface FtLoanClaimActionWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionsForEachInput: FtClaimData[];
}

export function parseLoanClaimActionWithdrawRedeemer(d: PD): FtLoanClaimActionWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionsForEachInput: asList(c.fields[1]).map(parseClaimData),
  };
}

export interface FtRepayData {
  borrowerBondOutputIndex: bigint;
  lenderBondRefInputIndex: bigint;
  lenderBondRefInputPolicyIdIndex: bigint;
  lenderBondRefInputAssetNameIndex: bigint;
  loanId: string;
  isFinalRepayment: boolean;
}

export function parseRepayData(d: PD): FtRepayData {
  const c = asConstr(d);
  if (c.fields.length !== 6) {
    throw new Error(`RepayData: expected 6 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    borrowerBondOutputIndex: asInt(f[0]),
    lenderBondRefInputIndex: asInt(f[1]),
    lenderBondRefInputPolicyIdIndex: asInt(f[2]),
    lenderBondRefInputAssetNameIndex: asInt(f[3]),
    loanId: asBytes(f[4]),
    isFinalRepayment: asBool(f[5]),
  };
}

export interface FtLoanRepayActionWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionsForEachInput: FtRepayData[];
}

export function parseLoanRepayActionWithdrawRedeemer(d: PD): FtLoanRepayActionWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionsForEachInput: asList(c.fields[1]).map(parseRepayData),
  };
}

export interface FtChangeCollateralData {
  borrowerBondOutputIndex: bigint;
  newCollateralAmount: bigint;
  loanId: string;
  collateralOracleRefInputIndex: bigint;
  principalOracleRefInputIndex: bigint;
}

export function parseChangeCollateralData(d: PD): FtChangeCollateralData {
  const c = asConstr(d);
  if (c.fields.length !== 5) {
    throw new Error(`ChangeCollateralData: expected 5 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    borrowerBondOutputIndex: asInt(f[0]),
    newCollateralAmount: asInt(f[1]),
    loanId: asBytes(f[2]),
    collateralOracleRefInputIndex: asInt(f[3]),
    principalOracleRefInputIndex: asInt(f[4]),
  };
}

export interface FtLoanChangeCollateralActionWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionsForEachInput: FtChangeCollateralData[];
}

export function parseLoanChangeCollateralActionWithdrawRedeemer(
  d: PD,
): FtLoanChangeCollateralActionWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionsForEachInput: asList(c.fields[1]).map(parseChangeCollateralData),
  };
}

export interface FtRecastData {
  borrowerBondOutputIndex: bigint;
  lenderBondRefInputIndex: bigint;
  lenderBondRefInputPolicyIdIndex: bigint;
  lenderBondRefInputAssetNameIndex: bigint;
  amountPaid: bigint;
  loanId: string;
}

export function parseRecastData(d: PD): FtRecastData {
  const c = asConstr(d);
  if (c.fields.length !== 6) {
    throw new Error(`RecastData: expected 6 fields, got ${c.fields.length}`);
  }
  const f = c.fields;
  return {
    borrowerBondOutputIndex: asInt(f[0]),
    lenderBondRefInputIndex: asInt(f[1]),
    lenderBondRefInputPolicyIdIndex: asInt(f[2]),
    lenderBondRefInputAssetNameIndex: asInt(f[3]),
    amountPaid: asInt(f[4]),
    loanId: asBytes(f[5]),
  };
}

export interface FtLoanRecastActionWithdrawRedeemer {
  configRefInputIndex: bigint;
  actionsForEachInput: FtRecastData[];
}

export function parseLoanRecastActionWithdrawRedeemer(d: PD): FtLoanRecastActionWithdrawRedeemer {
  const c = asConstr(d);
  return {
    configRefInputIndex: asInt(c.fields[0]),
    actionsForEachInput: asList(c.fields[1]).map(parseRecastData),
  };
}

// --- ConfigDatum — protocol reference UTxO ----------------------------------
//
// 25 fields; field 1 = adminCredential:Credential. The full field-by-field
// ordering for all 25 is not documented (only field 1 + the named policy/hash
// fields used for matching are), so we surface only adminCredential typed and
// pass the whole field list through as opaque raw for inspection.
// The on-chain values of poolPolicyId / requestPolicyId / loanPolicyId here are
// the authoritative match keys for `matchNftPolicy`.

export interface FtConfigDatum {
  adminCredential: Credential;
  /** All raw fields, passed through (full ordered list not documented beyond field 1). */
  rawFields: PD[];
}

export function parseConfigDatum(d: PD): FtConfigDatum {
  const c = asConstr(d);
  if (c.tag !== 0) throw new Error(`ConfigDatum: unexpected ctor ${c.tag}`);
  return {
    adminCredential: parseCredential(c.fields[1]),
    rawFields: c.fields,
  };
}
