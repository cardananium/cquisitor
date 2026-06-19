// WingRiders V2 decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
  type PoolPair,
} from "@/utils/protocols/dex/registry";
import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";
import { asConstr, isBytes, isConstr } from "@/utils/protocols/dex/plutusData";
import type { AssetClass, PD, PlutusAddress } from "@/utils/protocols/dex/plutusData";
import {
  matchWingRidersNftPolicy,
  matchWingRidersRapidNftPolicy,
  matchWingRidersRapidScriptHash,
  matchWingRidersScriptHash,
} from "./constants";
import {
  parseWrPoolDatum,
  parseWrRequestDatum,
  parseWrNestedPoolDatum,
  parseWrNestedRequestDatum,
  type WrRequestAction,
  type WrRequestDatum,
  type WrPoolDatum,
  type WrNestedPoolDatum,
  type WrNestedRequestDatum,
} from "./v2";
import {
  parseRapidPoolDatum,
  parseRapidPoolRedeemer,
  type RapidPoolDatum,
  type RapidPoolRedeemer,
} from "./rapidDex";

function credentialKind(addr: PlutusAddress): string {
  return addr.paymentCredential.kind === "Script" ? "script" : "key";
}

// Render a Cardano Address as one row for the payment credential plus, when
// present, a second row for the stake credential. Matches the existing
// owner/beneficiary rows but also surfaces the stake part (an Address can hold a
// stake credential the bare owner pubkey-hash does not).
function addressRows(label: string, addr: PlutusAddress): DexRow[] {
  const rows: DexRow[] = [
    { label: `${label} (${credentialKind(addr)})`, value: addr.paymentCredential.hash, hash: true },
  ];
  const stake = addr.stakeCredential;
  if (stake && stake.kind === "Inline") {
    rows.push({
      label: `${label} stake (${stake.credential.kind === "Script" ? "script" : "key"})`,
      value: stake.credential.hash,
      hash: true,
    });
  } else if (stake && stake.kind === "Pointer") {
    rows.push({
      label: `${label} stake (pointer)`,
      value: `slot ${stake.slotNumber}, tx ${stake.transactionIndex}, cert ${stake.certificateIndex}`,
    });
  }
  return rows;
}

// The compensation datum is an opaque PlutusData. When it is a bare ByteArray
// it is a datum hash (render as a hash); when it is the unit Constr0[] there is
// none; otherwise surface its shape so the field is never silently dropped.
function compensationDatumRow(d: PD): DexRow {
  if (isBytes(d)) return { label: "Compensation datum", value: d.bytes, hash: true };
  if (isConstr(d) && d.constructor === 0 && d.fields.length === 0) {
    return { label: "Compensation datum", value: "none (unit)" };
  }
  return { label: "Compensation datum", value: "inline datum (see raw)" };
}

function actionLabel(action: WrRequestAction): string {
  switch (action.kind) {
    case "Swap":
      return `Swap (${action.direction === "AToB" ? "A → B" : "B → A"})`;
    case "AddLiquidity":
      return "Add liquidity";
    case "WithdrawLiquidity":
      return "Withdraw liquidity";
    case "ExtractTreasury":
      return "Extract treasury";
    case "AddStakingRewards":
      return "Add staking rewards";
    case "ExtractProjectTreasury":
      return "Extract project treasury";
    case "ExtractReserveTreasury":
      return "Extract reserve treasury";
  }
}

function actionRows(action: WrRequestAction): DexRow[] {
  switch (action.kind) {
    case "Swap":
      return [{ label: "Min wanted tokens", value: action.minWantedTokens.toLocaleString() }];
    case "AddLiquidity":
      return [{ label: "Min wanted shares", value: action.minWantedShares.toLocaleString() }];
    case "WithdrawLiquidity":
      return [
        { label: "Min wanted A", value: action.minWantedA.toLocaleString() },
        { label: "Min wanted B", value: action.minWantedB.toLocaleString() },
      ];
    default:
      return [];
  }
}

// The two assets every WingRiders trading context parses (Asset A / Asset B):
// the pool's reserve pair for an AMM pool, the offered/asked pair for a swap or
// liquidity request. Both are genuine 2-asset trading pairs, so surface them as
// the unified `pair` header.
function tradingPair(assetA: AssetClass, assetB: AssetClass): PoolPair {
  return {
    assetA: { policyId: assetA.policyId, assetName: assetA.assetName },
    assetB: { policyId: assetB.policyId, assetName: assetB.assetName },
  };
}

export function wrRequestToView(datum: WrRequestDatum): DexOrderView {
  const issues: DexIssue[] = [];
  if (datum.deadline <= BigInt(0)) {
    issues.push({ severity: "warning", message: "Request has no deadline set" });
  }
  const rows: DexRow[] = [
    ...actionRows(datum.action),
    { label: "Deadline", value: `${datum.deadline.toLocaleString()} (POSIX ms)` },
    // owner_address can reclaim the request; beneficiary receives the
    // compensation output. Per WingRiders parsing-education RequestDatum.
    ...addressRows("Owner", datum.ownerAddress),
    ...addressRows("Beneficiary", datum.beneficiary),
    { label: "Receiver datum", value: datum.datumType },
    // Compensation datum: the datum attached to the beneficiary's compensation
    // output (an enforced output datum hash when the beneficiary is a script).
    compensationDatumRow(datum.compensationDatum),
    { label: "Agent fee reserve (oil)", value: datum.oil.toLocaleString() },
    // Stableswap scaling factors used to normalize A/B amounts (1 for
    // constant-product pools).
    { label: "Scale A / B", value: `${datum.scaleA.toLocaleString()} / ${datum.scaleB.toLocaleString()}` },
  ];
  const assets: DexAssetRow[] = [
    { label: "Asset A", policyId: datum.assetA.policyId, assetName: datum.assetA.assetName },
    { label: "Asset B", policyId: datum.assetB.policyId, assetName: datum.assetB.assetName },
  ];
  return {
    protocol: "WingRiders V2",
    role: "order",
    kind: actionLabel(datum.action),
    rows,
    assets,
    issues,
    // The request trades Asset A / Asset B (offered vs asked) — surface them as
    // the trading pair.
    pair: tradingPair(datum.assetA, datum.assetB),
  };
}

export function wrPoolToView(datum: WrPoolDatum): DexOrderView {
  const poolType = datum.poolSpecifics.kind === "Stableswap" ? "Stableswap" : "Constant-product";
  const rows: DexRow[] = [
    { label: "Pool type", value: poolType },
    { label: "Swap fee", value: `${datum.swapFeeInBasis} / ${datum.feeBasis}` },
    { label: "Protocol fee", value: `${datum.protocolFeeInBasis} / ${datum.feeBasis}` },
    { label: "Project fee", value: `${datum.projectFeeInBasis} / ${datum.feeBasis}` },
    { label: "Reserve fee", value: `${datum.reserveFeeInBasis} / ${datum.feeBasis}` },
    { label: "Agent fee (ADA)", value: datum.agentFeeAda.toLocaleString() },
    { label: "Treasury A / B", value: `${datum.treasuryA.toLocaleString()} / ${datum.treasuryB.toLocaleString()}` },
    { label: "Project treasury A / B", value: `${datum.projectTreasuryA.toLocaleString()} / ${datum.projectTreasuryB.toLocaleString()}` },
    { label: "Reserve treasury A / B", value: `${datum.reserveTreasuryA.toLocaleString()} / ${datum.reserveTreasuryB.toLocaleString()}` },
    { label: "Last interaction", value: `${datum.lastInteraction.toLocaleString()} (POSIX ms)` },
    { label: "Request validator", value: datum.requestValidatorHash, hash: true },
  ];
  if (datum.projectBeneficiary) {
    rows.push(...addressRows("Project beneficiary", datum.projectBeneficiary));
  }
  if (datum.reserveBeneficiary) {
    rows.push(...addressRows("Reserve beneficiary", datum.reserveBeneficiary));
  }
  if (datum.poolSpecifics.kind === "Stableswap") {
    rows.push({
      label: "Stableswap (D, scaleA, scaleB)",
      value: `${datum.poolSpecifics.parameterD.toLocaleString()}, ${datum.poolSpecifics.scaleA}, ${datum.poolSpecifics.scaleB}`,
    });
  }
  const assets: DexAssetRow[] = [
    { label: "Asset A", policyId: datum.assetA.policyId, assetName: datum.assetA.assetName },
    { label: "Asset B", policyId: datum.assetB.policyId, assetName: datum.assetB.assetName },
  ];
  return {
    protocol: "WingRiders V2",
    role: "pool",
    kind: `Liquidity Pool (${poolType})`,
    rows,
    assets,
    issues: [],
    // AMM pool: the two reserve assets (Asset A / Asset B) are the trading pair.
    pair: tradingPair(datum.assetA, datum.assetB),
  };
}

export function rapidPoolToView(datum: RapidPoolDatum): DexOrderView {
  const rows: DexRow[] = [
    { label: "Fee charged from", value: datum.feeFrom },
    {
      label: "Swap fee (A→B / B→A)",
      value: `${datum.swapFeePointsAToB} / ${datum.swapFeePointsBToA} of ${datum.feeBasis}`,
    },
    {
      label: "Treasury fee (A→B / B→A)",
      value: `${datum.treasuryFeePointsAToB} / ${datum.treasuryFeePointsBToA} of ${datum.feeBasis}`,
    },
    {
      label: "Treasury A / B",
      value: `${datum.treasuryA.toLocaleString()} / ${datum.treasuryB.toLocaleString()}`,
    },
    { label: "Shares asset name", value: datum.sharesAssetName, hash: true },
    { label: "Treasury authority NFT (policy)", value: datum.treasuryAuthorityPolicyId, hash: true },
    { label: "Treasury authority NFT (asset name)", value: datum.treasuryAuthorityAssetName, hash: true },
  ];
  const assets: DexAssetRow[] = [
    { label: "Asset A", policyId: datum.assetA.policyId, assetName: datum.assetA.assetName },
    { label: "Asset B", policyId: datum.assetB.policyId, assetName: datum.assetB.assetName },
  ];
  return {
    protocol: "WingRiders rapid-dex",
    role: "rapid-pool",
    kind: "Liquidity Pool (rapid-dex)",
    rows,
    assets,
    issues: [],
    // AMM pool: the two reserve assets (Asset A / Asset B) are the trading pair.
    pair: tradingPair(datum.assetA, datum.assetB),
  };
}

function rapidRedeemerLabel(r: RapidPoolRedeemer): string {
  switch (r.kind) {
    case "Swap":
      return `Swap (${r.swapAToB ? "A → B" : "B → A"})`;
    case "AddLiquidity":
      return r.aAdd === BigInt(0) || r.bAdd === BigInt(0) ? "Add liquidity (zap-in)" : "Add liquidity";
    case "WithdrawLiquidity":
      return `Withdraw liquidity (${r.withdrawType})`;
    case "WithdrawTreasury":
      return "Withdraw treasury";
    case "Donate":
      return "Donate";
  }
}

// --- LIVE nested-layout views (the shape actually on mainnet) --------------

export function wrNestedRequestToView(datum: WrNestedRequestDatum, isStable: boolean): DexOrderView {
  return {
    protocol: isStable ? "WingRiders Stableswap" : "WingRiders",
    role: isStable ? "stableswap-order" : "order",
    kind: actionLabel(datum.action),
    rows: [
      ...actionRows(datum.action),
      { label: "Deadline", value: `${datum.deadline.toLocaleString()} (POSIX ms)` },
      // Beneficiary = recipient of the compensation output (the address funds are
      // paid to once the request is applied). Distinct from `owner`, which only
      // controls reclaiming the request. Per WingRiders parsing-education
      // RequestDatum (beneficiary: Address, owner_address: Address).
      ...addressRows("Beneficiary", datum.beneficiary),
      { label: "Owner", value: datum.owner, hash: true },
    ],
    assets: [
      { label: "Asset A", policyId: datum.assetA.policyId, assetName: datum.assetA.assetName },
      { label: "Asset B", policyId: datum.assetB.policyId, assetName: datum.assetB.assetName },
    ],
    issues: [],
    // The request trades Asset A / Asset B (offered vs asked) — surface them as
    // the trading pair.
    pair: tradingPair(datum.assetA, datum.assetB),
  };
}

export function wrNestedPoolToView(datum: WrNestedPoolDatum, isStable: boolean): DexOrderView {
  return {
    protocol: isStable ? "WingRiders Stableswap" : "WingRiders",
    role: isStable ? "stableswap-pool" : "pool",
    kind: isStable ? "Liquidity Pool (Stableswap)" : "Liquidity Pool (Constant-product)",
    rows: [
      { label: "Treasury A / B", value: `${datum.treasuryA.toLocaleString()} / ${datum.treasuryB.toLocaleString()}` },
      { label: "Last interaction", value: `${datum.lastInteraction.toLocaleString()} (POSIX ms)` },
      { label: "Request validator", value: datum.requestValidatorHash, hash: true },
    ],
    assets: [
      { label: "Asset A", policyId: datum.assetA.policyId, assetName: datum.assetA.assetName },
      { label: "Asset B", policyId: datum.assetB.policyId, assetName: datum.assetB.assetName },
    ],
    issues: [],
    // AMM pool: the two reserve assets (Asset A / Asset B) are the trading pair.
    pair: tradingPair(datum.assetA, datum.assetB),
  };
}

// Deployed datums are the nested LiquidityPoolDatumV1/RequestDatumV1 shape (2 fields);
// the flat 21-/13-field registry shape is a fallback.
function decodePool(datum: PD, isStable: boolean): DexOrderView {
  if (asConstr(datum).fields.length === 2) {
    return wrNestedPoolToView(parseWrNestedPoolDatum(datum), isStable);
  }
  return wrPoolToView(parseWrPoolDatum(datum));
}
function decodeOrder(datum: PD, isStable: boolean): DexOrderView {
  if (asConstr(datum).fields.length === 2) {
    return wrNestedRequestToView(parseWrNestedRequestDatum(datum), isStable);
  }
  return wrRequestToView(parseWrRequestDatum(datum));
}

registerDexAdapter({
  id: "wingriders-v2",
  label: "WingRiders",
  matchScriptHash: (hash: string, network?: CardanoNetwork): DexRole | null =>
    matchWingRidersScriptHash(hash, network) ?? matchWingRidersRapidScriptHash(hash, network),
  matchNftPolicy: (policyId: string, assetNames: string[], network?: CardanoNetwork): DexRole | null =>
    matchWingRidersNftPolicy(policyId, assetNames, network) ??
    matchWingRidersRapidNftPolicy(policyId, assetNames, network),
  decode: (datum: PD, role): DexOrderView => {
    if (role === "rapid-pool") return rapidPoolToView(parseRapidPoolDatum(datum));
    const isStable = role === "stableswap-pool" || role === "stableswap-order";
    if (role === "pool" || role === "stableswap-pool") return decodePool(datum, isStable);
    return decodeOrder(datum, isStable);
  },
  // The V2 action is read from the request datum (no classifier); rapid-dex
  // has a spend redeemer.
  classifyRedeemer: (redeemer: PD, role): string | null =>
    role === "rapid-pool" ? rapidRedeemerLabel(parseRapidPoolRedeemer(redeemer)) : null,
  // WingRiders V2 batches via a withdraw-zero staking validator: the request
  // spends defer swap/batch validation to this 0-amount withdrawal.
  matchWithdrawalHash: (stakeHash: string, network?: CardanoNetwork): string | null => {
    if (network && network !== "mainnet") return null;
    return stakeHash === "96f5c1bee23481335ff4aece32fe1dfa1aa40a944a66d2d6edc9a9a5"
      ? "batch validator"
      : null;
  },
});

export * from "./v2";
export * from "./rapidDex";
export { WINGRIDERS_V2, WINGRIDERS_RAPID_DEX, wingRidersPoolKindForPolicy } from "./constants";
