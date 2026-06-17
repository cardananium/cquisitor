// Danogo decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { matchDanogoNftPolicy, matchDanogoScriptHash } from "./constants";
import {
  classifyBareTradeAction,
  classifyBondIssueAction,
  parseDanogoOrder,
  parseDanogoPosition,
  validateDanogoOrder,
  validateDanogoPosition,
  type DanogoOrder,
  type DanogoPosition,
} from "./danogo";

function ownerSkRow(ownerSk: string | null): DexRow {
  return ownerSk
    ? { label: "Owner stake", value: ownerSk, hash: true }
    : { label: "Owner stake", value: "none" };
}

const ORDER_KIND_LABEL: Record<DanogoOrder["kind"], string> = {
  AskLimit: "Ask (limit sell)",
  BidLimitMulti: "Bid (limit buy, multi)",
  AskMaking: "Ask (market-maker sell)",
  BidMaking: "Bid (market-maker buy)",
};

export function danogoOrderToView(order: DanogoOrder): DexOrderView {
  const rows: DexRow[] = [
    { label: "Owner key", value: order.ownerVk, hash: true },
    ownerSkRow(order.ownerSk),
  ];
  switch (order.kind) {
    case "AskLimit":
      rows.push({ label: "Requested yield", value: order.requestedYield.toLocaleString() });
      break;
    case "AskMaking":
      rows.push(
        { label: "Requested yield", value: order.requestedYield.toLocaleString() },
        { label: "Bid script", value: order.bidSc, hash: true },
        { label: "Margin", value: order.margin.toLocaleString() },
      );
      break;
    case "BidLimitMulti":
      rows.push(
        { label: "Epoch range", value: `${order.fromEpoch} → ${order.toEpoch}` },
        { label: "Quantity", value: order.quantity.toLocaleString() },
        { label: "Requested yield", value: order.requestedYield.toLocaleString() },
        {
          label: "Bond types",
          value: order.bondTypes.length === 0 ? "any" : order.bondTypes.join(", "),
        },
      );
      break;
    case "BidMaking":
      rows.push(
        { label: "Epoch range", value: `${order.fromEpoch} → ${order.toEpoch}` },
        { label: "Quantity", value: order.quantity.toLocaleString() },
        { label: "Requested yield", value: order.requestedYield.toLocaleString() },
        { label: "Ask script", value: order.askSc, hash: true },
        { label: "Margin", value: order.margin.toLocaleString() },
      );
      break;
  }
  return {
    protocol: "Danogo",
    role: "order",
    kind: ORDER_KIND_LABEL[order.kind],
    rows,
    issues: validateDanogoOrder(order),
  };
}

export function danogoPositionToView(pos: DanogoPosition): DexOrderView {
  if (pos.kind === "RequestDatum") {
    const rows: DexRow[] = [
      { label: "APR", value: pos.apr.toLocaleString() },
      { label: "Duration", value: pos.duration.toLocaleString() },
      { label: "Requested", value: pos.requested.toLocaleString() },
      { label: "Issued", value: pos.issued.toLocaleString() },
      { label: "Epoch rewards", value: pos.epoRewards.toLocaleString() },
      { label: "Prepaid", value: pos.prepaid.toLocaleString() },
      { label: "Buffer", value: pos.buffer.toLocaleString() },
      { label: "Fee", value: pos.fee.toLocaleString() },
      { label: "Borrower", value: pos.borrower, hash: true },
    ];
    const assets: DexAssetRow[] = [
      { label: "Bond policy", policyId: pos.symbol, assetName: pos.borrower },
    ];
    return {
      protocol: "Danogo",
      role: "position",
      kind: "Borrow request",
      rows,
      assets,
      issues: validateDanogoPosition(pos),
    };
  }
  const rows: DexRow[] = [
    { label: "Duration", value: pos.duration.toLocaleString() },
    { label: "Bond amount", value: pos.bondAmount.toLocaleString() },
    { label: "Buffer", value: pos.buffer.toLocaleString() },
    { label: "Fee", value: pos.fee.toLocaleString() },
    { label: "Start", value: pos.start.toLocaleString() },
    { label: "Borrower", value: pos.borrower, hash: true },
    {
      label: "Epoch rewards",
      value: pos.epoRewards.length === 0 ? "none" : `${pos.epoRewards.length} policies`,
    },
  ];
  const assets: DexAssetRow[] = [
    { label: "Bond token", policyId: pos.bondSymbol, assetName: pos.tokenName },
  ];
  return {
    protocol: "Danogo",
    role: "position",
    kind: "Active bond",
    rows,
    assets,
    issues: validateDanogoPosition(pos),
  };
}

function danogoDecode(datum: PD, role: DexRole): DexOrderView {
  if (role === "position") return danogoPositionToView(parseDanogoPosition(datum));
  return danogoOrderToView(parseDanogoOrder(datum));
}

// Classify a spend redeemer. For the order role this is the bare TradeAction
// (used by limit_ask/making_ask/making_bid). The field-carrying TradeAction
// (limit_bid bid_multi) and WithdrawAction need per-validator disambiguation
// and are exposed as parsers in ./danogo; the bond-issue position redeemer is
// the shared BondIssueAction.
function danogoClassifyRedeemer(redeemer: PD, role: DexRole): string | null {
  if (role === "position") return classifyBondIssueAction(redeemer);
  return classifyBareTradeAction(redeemer);
}

registerDexAdapter({
  id: "danogo",
  label: "Danogo",
  matchScriptHash: matchDanogoScriptHash,
  matchNftPolicy: matchDanogoNftPolicy,
  decode: danogoDecode,
  classifyRedeemer: danogoClassifyRedeemer,
});

export * from "./danogo";
export { DANOGO } from "./constants";
