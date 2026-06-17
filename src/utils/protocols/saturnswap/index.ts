// SaturnSwap decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD } from "@/utils/protocols/dex/plutusData";
import { matchSaturnSwapScriptHash } from "./constants";
import {
  classifySaturnRedeemer,
  parseSaturnOrder,
  validateSaturnOrder,
  type SaturnOrder,
} from "./saturnswap";

// Compact leg label for the headline only (NOT a row/label hash field): "ADA"
// for the ada leg, otherwise the decoded ASCII asset name when it is printable,
// falling back to "token". Full policy/name hashes are shown in assets[].
function legLabel(asset: AssetClass): string {
  if (asset.policyId === "" && asset.assetName === "") return "ADA";
  if (asset.assetName && /^[0-9a-fA-F]*$/.test(asset.assetName) && asset.assetName.length % 2 === 0) {
    const bytes = asset.assetName.match(/.{2}/g) ?? [];
    const ascii = bytes.map((b) => String.fromCharCode(parseInt(b, 16))).join("");
    if (/^[\x20-\x7e]+$/.test(ascii)) return ascii;
  }
  return "token";
}

function orderToView(order: SaturnOrder): DexOrderView {
  const ownerKind = order.owner.paymentCredential.kind === "Script" ? "script" : "key";
  const rows: DexRow[] = [
    { label: `Owner (${ownerKind})`, value: order.owner.paymentCredential.hash, hash: true },
    { label: "Offered amount", value: order.offeredAmount.toLocaleString() },
    { label: "Asked amount", value: order.askedAmount.toLocaleString() },
    {
      label: "Expiry",
      value: order.expiry === null ? "none" : `${order.expiry.toLocaleString()} (POSIX ms)`,
    },
    { label: "Nonce txId", value: order.nonce.txId, hash: true },
    { label: "Nonce output index", value: order.nonce.outputIndex.toLocaleString() },
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Offered",
      policyId: order.offered.policyId,
      assetName: order.offered.assetName,
      amount: order.offeredAmount,
    },
    {
      label: "Asked",
      policyId: order.asked.policyId,
      assetName: order.asked.assetName,
      amount: order.askedAmount,
    },
  ];
  // Surface the offered → asked direction as the human action label.
  const kind = `Order: sell ${legLabel(order.offered)} → ${legLabel(order.asked)}`;
  return {
    protocol: "SaturnSwap",
    role: "order",
    kind,
    rows,
    assets,
    issues: validateSaturnOrder(order),
  };
}

registerDexAdapter({
  id: "saturnswap",
  label: "SaturnSwap",
  matchScriptHash: matchSaturnSwapScriptHash,
  decode: (datum: PD) => orderToView(parseSaturnOrder(datum)),
  classifyRedeemer: (redeemer: PD) => classifySaturnRedeemer(redeemer),
});

export * from "./saturnswap";
export { SATURNSWAP } from "./constants";
