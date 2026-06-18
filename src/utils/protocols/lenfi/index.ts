// Lenfi (Aada Finance V2) decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
  type PoolPair,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD, PlutusAddress } from "@/utils/protocols/dex/plutusData";
import { matchLenfiNftPolicy, matchLenfiScriptHash } from "./constants";
import {
  parseCollateralRedeemer,
  parseOrderDatum,
  parsePoolConfig,
  parsePoolDatum,
  parsePoolRedeemer,
  parseLenfiDatum,
  validateCollateralDatum,
  validatePoolDatum,
  type CollateralAction,
  type CollateralDatum,
  type LeftoversDatum,
  type OrderDatum,
  type PoolConfig,
  type PoolContinuingAction,
  type PoolDatum,
} from "./lenfi";
import type { Credential } from "@/utils/protocols/dex/plutusData";

const PROTOCOL = "Lenfi (Aada V2)";

function assetRow(label: string, asset: AssetClass): DexRow {
  return {
    label,
    asset: { policyId: asset.policyId, assetName: asset.assetName },
  };
}

// Render a PlutusAddress as one (or two) rows: the payment credential hash
// (with its VKey/Script kind), plus the stake credential hash when present.
function addressRows(label: string, addr: PlutusAddress): DexRow[] {
  const rows: DexRow[] = [
    {
      label: `${label} (${credLabel(addr.paymentCredential)})`,
      value: addr.paymentCredential.hash,
      hash: true,
    },
  ];
  const stake = addr.stakeCredential;
  if (stake && stake.kind === "Inline") {
    rows.push({
      label: `${label} stake (${credLabel(stake.credential)})`,
      value: stake.credential.hash,
      hash: true,
    });
  } else if (stake && stake.kind === "Pointer") {
    rows.push({
      label: `${label} stake (pointer)`,
      value: `${stake.slotNumber}/${stake.transactionIndex}/${stake.certificateIndex}`,
    });
  }
  return rows;
}

function poolToView(p: PoolDatum): DexOrderView {
  const issues: DexIssue[] = validatePoolDatum(p);
  const utilization =
    p.balance + p.lentOut > BigInt(0)
      ? `${p.lentOut.toLocaleString()} / ${(p.balance + p.lentOut).toLocaleString()}`
      : "0";
  const rows: DexRow[] = [
    { label: "Balance", value: p.balance.toLocaleString() },
    { label: "Lent out", value: p.lentOut.toLocaleString() },
    { label: "Total LP tokens", value: p.totalLpTokens.toLocaleString() },
    { label: "Utilization (lent / total)", value: utilization },
    assetRow("Loan asset", p.params.loanCs),
    assetRow("Collateral asset", p.params.collateralCs),
    assetRow("LP token", p.params.lpToken),
    assetRow("Oracle loan asset", p.params.oracleLoanAsset),
    assetRow("Oracle collateral asset", p.params.oracleCollateralAsset),
    { label: "Pool NFT name", value: p.params.poolNftName, hash: true },
    { label: "Pool config asset name", value: p.params.poolConfigAssetName, hash: true },
    ...addressRows("Collateral address", p.params.collateralAddress),
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Loan asset",
      policyId: p.params.loanCs.policyId,
      assetName: p.params.loanCs.assetName,
    },
    {
      label: "Collateral asset",
      policyId: p.params.collateralCs.policyId,
      assetName: p.params.collateralCs.assetName,
    },
  ];
  return { protocol: PROTOCOL, role: "pool", kind: "Lending pool", rows, assets, issues };
}

function loanToView(c: CollateralDatum): DexOrderView {
  const issues: DexIssue[] = validateCollateralDatum(c);
  const rows: DexRow[] = [
    { label: "Loan amount (principal)", value: c.loanAmount.toLocaleString() },
    { label: "Collateral amount", value: c.collateralAmount.toLocaleString() },
    { label: "Interest rate", value: c.interestRate.toLocaleString() },
    { label: "Pool lent out (at snapshot)", value: c.lentOut.toLocaleString() },
    { label: "Pool balance (at snapshot)", value: c.balance.toLocaleString() },
    { label: "Deposit time", value: `${c.depositTime.toLocaleString()} (POSIX ms)` },
    { label: "Borrower NFT name", value: c.borrowerTn, hash: true },
    { label: "Pool NFT name", value: c.poolNftName, hash: true },
    assetRow("Oracle loan asset", c.oracleLoanAsset),
    assetRow("Oracle collateral asset", c.oracleCollateralAsset),
    {
      label: "Liquidation threshold",
      value: c.poolConfig.liquidationThreshold.toLocaleString(),
    },
    {
      label: "Initial collateral ratio",
      value: c.poolConfig.initialCollateralRatio.toLocaleString(),
    },
    { label: "Pool fee", value: c.poolConfig.poolFee.toLocaleString() },
    c.tag
      ? {
          label: "Tag (delayed-merge oref)",
          value: `${c.tag.transactionId}#${c.tag.outputIndex}`,
          hash: true,
        }
      : { label: "Tag (delayed-merge oref)", value: "none" },
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Loan asset",
      policyId: c.loanCs.policyId,
      assetName: c.loanCs.assetName,
      amount: c.loanAmount,
    },
    {
      label: "Collateral asset",
      policyId: c.collateralCs.policyId,
      assetName: c.collateralCs.assetName,
      amount: c.collateralAmount,
    },
  ];
  return { protocol: PROTOCOL, role: "loan", kind: "Loan position", rows, assets, issues };
}

function configToView(cfg: PoolConfig): DexOrderView {
  const fee = cfg.loanFeeDetails;
  const ip = cfg.interestParams;
  const rows: DexRow[] = [
    { label: "Liquidation threshold", value: cfg.liquidationThreshold.toLocaleString() },
    { label: "Initial collateral ratio", value: cfg.initialCollateralRatio.toLocaleString() },
    { label: "Pool fee", value: cfg.poolFee.toLocaleString() },
    { label: "Min loan", value: cfg.minLoan.toLocaleString() },
    { label: "Min fee", value: cfg.minFee.toLocaleString() },
    { label: "Min liquidation fee", value: cfg.minLiquidationFee.toLocaleString() },
    { label: "Min transition", value: cfg.minTransition.toLocaleString() },
    { label: "Merge action fee", value: cfg.mergeActionFee.toLocaleString() },
    { label: "Liquidation fee", value: fee.liquidationFee.toLocaleString() },
    { label: "Platform fee tier 1", value: `${fee.tier1Fee.toLocaleString()} (≥ ${fee.tier1Threshold.toLocaleString()})` },
    { label: "Platform fee tier 2", value: `${fee.tier2Fee.toLocaleString()} (≥ ${fee.tier2Threshold.toLocaleString()})` },
    { label: "Platform fee tier 3", value: `${fee.tier3Fee.toLocaleString()} (≥ ${fee.tier3Threshold.toLocaleString()})` },
    ...addressRows("Platform fee collector", fee.platformFeeCollectorAddress),
    { label: "Optimal utilization", value: ip.optimalUtilization.toLocaleString() },
    { label: "Base interest rate", value: ip.baseInterestRate.toLocaleString() },
    { label: "Interest rslope1", value: ip.rslope1.toLocaleString() },
    { label: "Interest rslope2", value: ip.rslope2.toLocaleString() },
  ];
  return { protocol: PROTOCOL, role: "config", kind: "Pool config", rows, issues: [] };
}

function credLabel(c: Credential): string {
  return c.kind === "Script" ? "Script" : "PubKey";
}

function leftoversToView(l: LeftoversDatum): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool NFT policy", value: l.poolNft.policyId, hash: true },
    { label: "Pool NFT name", value: l.poolNft.assetName, hash: true },
  ];
  return {
    protocol: PROTOCOL,
    role: "loan",
    kind: "Liquidation leftovers",
    rows,
    issues: [],
  };
}

function orderRequestRows(d: OrderDatum): { kind: string; rows: DexRow[] } {
  const head: DexRow[] = [
    {
      label: `Control credential (${credLabel(d.controlCredential)})`,
      value: d.controlCredential.hash,
      hash: true,
    },
    { label: "Pool NFT name", value: d.poolNftCs.assetName, hash: true },
    { label: "Batcher fee", value: `${d.batcherFeeAda.toLocaleString()} lovelace` },
  ];
  const destRows = (addr: PlutusAddress | null): DexRow[] =>
    addr ? addressRows("Destination address", addr) : [];
  const r = d.request;
  switch (r.kind) {
    case "Borrow":
      return {
        kind: "Borrow request",
        rows: [
          ...head,
          ...destRows(r.destinationAddress),
          { label: "Borrower NFT policy", value: r.borrowerNftPolicy, hash: true },
          { label: "Min collateral amount", value: r.minCollateralAmount.toLocaleString() },
          { label: "Min deposit time", value: `${r.minDepositTime.toLocaleString()} (POSIX ms)` },
          { label: "Max interest rate", value: r.maxInterestRate.toLocaleString() },
          {
            label: `Collateral address (${credLabel(r.collateralAddress.paymentCredential)})`,
            value: r.collateralAddress.paymentCredential.hash,
            hash: true,
          },
        ],
      };
    case "Deposit":
      return {
        kind: "Deposit request",
        rows: [
          ...head,
          ...destRows(r.destinationAddress),
          { label: "Deposit amount", value: r.depositAmount.toLocaleString() },
          assetRow("LP token", r.lpAsset),
        ],
      };
    case "Withdraw":
      return {
        kind: "Withdraw request",
        rows: [
          ...head,
          ...destRows(r.destinationAddress),
          { label: "LP tokens to burn", value: r.lpTokensBurn.toLocaleString() },
          assetRow("Receive asset", r.receiveAsset),
          assetRow("LP token", r.lpAsset),
        ],
      };
    case "Repay":
      return {
        kind: "Repay request",
        rows: [
          ...head,
          ...destRows(r.destinationAddress),
          {
            label: "Loan oref",
            value: `${r.order.transactionId}#${r.order.outputIndex}`,
            hash: true,
          },
          assetRow("Burn asset (borrower NFT)", r.burnAsset),
        ],
      };
    case "Liquidate":
      return { kind: "Liquidate request", rows: [...head, ...destRows(r.destinationAddress)] };
    case "Unknown":
      return {
        kind: "Order request",
        rows: [
          ...head,
          { label: "Request", value: `unrecognized shape (${r.fieldCount} fields)` },
        ],
      };
  }
}

function orderToView(d: OrderDatum): DexOrderView {
  const { kind, rows } = orderRequestRows(d);
  // The order references its pool only by the pool NFT (poolNftCs: policy +
  // per-pool name). Resolve that NFT's pool UTxO to surface the pool's
  // loan/collateral pair, which the order datum does not itself carry.
  const poolRef = d.poolNftCs.policyId
    ? { policyId: d.poolNftCs.policyId, assetName: d.poolNftCs.assetName }
    : undefined;
  return { protocol: PROTOCOL, role: "order", kind, rows, issues: [], poolRef };
}

// Benign view for matched roles whose datum we intentionally don't field-decode:
// `order` (request datums) and `feed` (oracle UTxOs that carry only an empty
// datum, with the price supplied via the spend redeemer). The raw datum tree is
// still surfaced by the detector, so this replaces a parseError with context.
function noteView(role: string, kind: string, note: string): DexOrderView {
  return { protocol: PROTOCOL, role, kind, rows: [{ label: "Note", value: note }], issues: [] };
}

export function lenfiToView(datum: PD, role: string): DexOrderView {
  if (role === "config") {
    try {
      return configToView(parsePoolConfig(datum));
    } catch {
      return noteView("config", "Pool config", "Lenfi PoolConfig UTxO; datum shown raw below.");
    }
  }
  if (role === "order") {
    try {
      return orderToView(parseOrderDatum(datum));
    } catch {
      return noteView("order", "Order request", "Lenfi order/request UTxO; request datum shown raw below.");
    }
  }
  if (role === "feed") {
    return noteView("feed", "Oracle reference", "Lenfi oracle feed UTxO (price supplied via redeemer); datum shown raw below.");
  }
  try {
    const parsed = parseLenfiDatum(datum, role);
    switch (parsed.kind) {
      case "pool":
        return poolToView(parsed.datum);
      case "loan":
        return loanToView(parsed.datum);
      case "leftovers":
        return leftoversToView(parsed.datum);
      case "order":
        return orderToView(parsed.datum);
    }
  } catch {
    // A UTxO matched the pool/loan hash but carries a different/empty datum
    // (e.g. an oracle or auxiliary reference UTxO sharing the address). Show a
    // benign view with the raw datum rather than a hard parse error.
    return noteView(role, role === "pool" ? "Pool" : "Loan", `Lenfi ${role} UTxO with an unexpected datum shape; datum shown raw below.`);
  }
}

// --- Redeemer classification -----------------------------------------------

function continuingActionLabel(a: PoolContinuingAction): string {
  switch (a.kind) {
    case "LpAdjust":
      return "LP adjust";
    case "Borrow":
      return "Borrow";
    case "CloseLoan":
      return "Close loan";
    case "PayFee":
      return "Pay fee";
  }
}

function collateralActionLabel(a: CollateralAction): string {
  return a.kind === "Repay" ? "Repay" : "Liquidate";
}

export function classifyLenfiRedeemer(redeemer: PD, role: string): string | null {
  try {
    if (role === "pool") {
      const r = parsePoolRedeemer(redeemer);
      if (r === null) return "Bad script context";
      if (r.action.kind === "Destroy") return "Destroy pool";
      return continuingActionLabel(r.action.action);
    }
    if (role === "loan") {
      const r = parseCollateralRedeemer(redeemer);
      return collateralActionLabel(r.action);
    }
  } catch {
    return null;
  }
  return null;
}

registerDexAdapter({
  id: "lenfi-v2",
  label: "Lenfi (Aada V2)",
  matchScriptHash: matchLenfiScriptHash,
  matchNftPolicy: matchLenfiNftPolicy,
  decode: (datum: PD, role) => lenfiToView(datum, role),
  classifyRedeemer: (redeemer: PD, role) => classifyLenfiRedeemer(redeemer, role),
  // An order references its pool by the pool NFT (the view's poolRef). Decode
  // that resolved pool UTxO's datum back into the pool's loan/collateral pair —
  // Lenfi is a lending pool, but its pool datum carries exactly two asset
  // classes (loan_cs / collateral_cs), which form a meaningful pair to show.
  parsePoolPair: (poolDatum: PD): PoolPair => {
    const p = parsePoolDatum(poolDatum);
    return {
      assetA: { policyId: p.params.loanCs.policyId, assetName: p.params.loanCs.assetName },
      assetB: {
        policyId: p.params.collateralCs.policyId,
        assetName: p.params.collateralCs.assetName,
      },
    };
  },
});

export * from "./lenfi";
export { LENFI_V2, matchLenfiScriptHash, matchLenfiNftPolicy } from "./constants";
