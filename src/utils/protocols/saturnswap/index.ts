// SaturnSwap decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD, PlutusAddress } from "@/utils/protocols/dex/plutusData";
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

// Surface the owner Address's optional stake credential as its own row so it is
// never dropped. Inline = a bare credential (key/script) hash; Pointer =
// (slot,txIdx,certIdx). Matches the addressRows convention used by peer adapters.
function ownerStakeRows(addr: PlutusAddress): DexRow[] {
  const stake = addr.stakeCredential;
  if (!stake) return [{ label: "Owner stake", value: "none" }];
  if (stake.kind === "Inline") {
    const sk = stake.credential.kind === "Script" ? "script" : "key";
    return [{ label: `Owner stake (${sk})`, value: stake.credential.hash, hash: true }];
  }
  return [
    {
      label: "Owner stake (pointer)",
      value: `slot ${stake.slotNumber}, txIdx ${stake.transactionIndex}, certIdx ${stake.certificateIndex}`,
    },
  ];
}

function orderToView(order: SaturnOrder): DexOrderView {
  const ownerKind = order.owner.paymentCredential.kind === "Script" ? "script" : "key";
  const rows: DexRow[] = [
    { label: `Owner (${ownerKind})`, value: order.owner.paymentCredential.hash, hash: true },
    // The owner Address (field[0]) carries a CIP-19 stake part that the fill
    // output must reproduce. It is set on every observed order (the project
    // stake cred for pool orders, the maker's own stake key for user orders),
    // so surface it as its own row instead of silently dropping it.
    ...ownerStakeRows(order.owner),
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
    // A SaturnSwap order is a genuine 2-asset limit/swap: it sells `offered`
    // for `asked`. Surface those exact two legs (datum order, never reordered)
    // as the trading pair so the panel can show the "Pair: X / Y" header.
    pair: {
      assetA: { policyId: order.offered.policyId, assetName: order.offered.assetName },
      assetB: { policyId: order.asked.policyId, assetName: order.asked.assetName },
    },
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
