// VyFinance (VyFi) v2 decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  matchVyFinanceNftPolicy,
  matchVyFinanceScriptHash,
} from "./constants";
import {
  classifyVyFinanceOrderRedeemer,
  parseVyFinanceOrder,
  parseVyFinancePool,
  type VyFinanceOrder,
  type VyFinancePool,
} from "./vyfinance";

function orderKind(order: VyFinanceOrder): string {
  switch (order.direction) {
    case "expectToken":
      return "Swap (expect token out)";
    case "expectAda":
      return "Swap (expect ADA out)";
    default:
      return `Liquidity action (tag ${order.actionTag})`;
  }
}

function orderToView(order: VyFinanceOrder): DexOrderView {
  const receiveUnit = order.direction === "expectAda" ? "lovelace" : "tokens";
  const rows: DexRow[] = [
    {
      label: "Action",
      value: `${order.direction} (ctor ${order.actionTag})`,
    },
    {
      label: "Min receive",
      value: `${order.minReceive.toLocaleString()} ${receiveUnit}`,
    },
    { label: "Owner payment PKH", value: order.paymentPkh, mono: true },
  ];
  if (order.stakeKeyHash) {
    rows.push({ label: "Owner stake key", value: order.stakeKeyHash, mono: true });
  }
  return {
    protocol: "VyFinance V2",
    role: "order",
    kind: orderKind(order),
    rows,
    issues: order.issues,
  };
}

function poolToView(pool: VyFinancePool): DexOrderView {
  const rows: DexRow[] = [
    { label: "Bar fee A", value: pool.barFeeA.toLocaleString() },
    { label: "Bar fee B", value: pool.barFeeB.toLocaleString() },
    { label: "Total LP tokens", value: pool.totalLpTokens.toLocaleString() },
  ];
  return {
    protocol: "VyFinance V2",
    role: "pool",
    kind: "Liquidity Pool (AMM)",
    rows,
    issues: pool.issues,
  };
}

registerDexAdapter({
  id: "vyfinance",
  label: "VyFinance V2",
  matchScriptHash: matchVyFinanceScriptHash,
  matchNftPolicy: matchVyFinanceNftPolicy,
  decode: (datum: PD, role) =>
    role === "pool" ? poolToView(parseVyFinancePool(datum)) : orderToView(parseVyFinanceOrder(datum)),
  classifyRedeemer: (redeemer: PD, role) =>
    role === "pool" ? null : classifyVyFinanceOrderRedeemer(redeemer),
});

export * from "./vyfinance";
export { VYFINANCE } from "./constants";
