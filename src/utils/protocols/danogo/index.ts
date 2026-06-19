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
    // apr/fee are basis points (base 10_000); duration/prepaid/buffer are epoch
    // counts; epo_rewards is the per-epoch interest in lovelace; symbol+borrower
    // form the borrower NFT AssetClass (symbol == borrower_pid per
    // borrow_request/request_nft.ak). See danogo2023/daken RequestDatum.
    const rows: DexRow[] = [
      { label: "APR (basis points)", value: pos.apr.toLocaleString() },
      { label: "Duration (epochs)", value: pos.duration.toLocaleString() },
      { label: "Requested", value: pos.requested.toLocaleString() },
      { label: "Issued", value: pos.issued.toLocaleString() },
      { label: "Epoch reward (lovelace)", value: pos.epoRewards.toLocaleString() },
      { label: "Prepaid (epochs)", value: pos.prepaid.toLocaleString() },
      { label: "Buffer (epochs)", value: pos.buffer.toLocaleString() },
      { label: "Fee (basis points)", value: pos.fee.toLocaleString() },
      { label: "Borrower", value: pos.borrower, hash: true },
    ];
    const assets: DexAssetRow[] = [
      { label: "Borrower NFT", policyId: pos.symbol, assetName: pos.borrower },
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
  // epo_rewards is a PValue (Dict<PolicyId, Dict<AssetName, Int>>) holding the
  // actual per-epoch interest value escrowed in the bond UTxO — verified equal
  // to bond_amount * bond_face_value * apr / basis / year_to_epoch in
  // borrow_request/bond_create.ak. Surface each entry as its own asset row (ada
  // = ("",""), amount = lovelace) instead of collapsing to a policy count.
  const epoRewardAssets: DexAssetRow[] = pos.epoRewards.flatMap((entry) =>
    entry.assets.map((a) => ({
      label: "Epoch reward",
      policyId: entry.policyId,
      assetName: a.assetName,
      amount: a.quantity,
    })),
  );
  const rows: DexRow[] = [
    { label: "Duration (epochs)", value: pos.duration.toLocaleString() },
    { label: "Bond amount", value: pos.bondAmount.toLocaleString() },
    { label: "Buffer (epochs)", value: pos.buffer.toLocaleString() },
    { label: "Fee (basis points)", value: pos.fee.toLocaleString() },
    { label: "Start epoch", value: pos.start.toLocaleString() },
    { label: "Borrower", value: pos.borrower, hash: true },
  ];
  if (epoRewardAssets.length === 0) {
    rows.push({ label: "Epoch rewards", value: "none" });
  }
  const assets: DexAssetRow[] = [
    { label: "Bond token", policyId: pos.bondSymbol, assetName: pos.tokenName },
    ...epoRewardAssets,
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
