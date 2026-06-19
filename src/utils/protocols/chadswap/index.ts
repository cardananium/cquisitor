// ChadSwap decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD, PlutusAddress } from "@/utils/protocols/dex/plutusData";
import { matchChadswapScriptHash } from "./constants";
import {
  askedAmount,
  askedAsset,
  classifyChadswapRedeemer,
  offeredAmount,
  offeredAsset,
  parseChadswapOrder,
  validateChadswapOrder,
  type ChadswapOrder,
} from "./chadswap";

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

// Surface the maker Address's optional stake credential as its own row so it is
// never dropped. Inline = a bare credential (key/script) hash; Pointer =
// (slot,txIdx,certIdx). Matches the addressRows convention used by peer adapters.
function makerStakeRows(addr: PlutusAddress): DexRow[] {
  const stake = addr.stakeCredential;
  if (!stake) return [{ label: "Maker stake", value: "none" }];
  if (stake.kind === "Inline") {
    const sk = stake.credential.kind === "Script" ? "script" : "key";
    return [{ label: `Maker stake (${sk})`, value: stake.credential.hash, hash: true }];
  }
  return [
    {
      label: "Maker stake (pointer)",
      value: `slot ${stake.slotNumber}, txIdx ${stake.transactionIndex}, certIdx ${stake.certificateIndex}`,
    },
  ];
}

function orderToView(order: ChadswapOrder): DexOrderView {
  const makerKind = order.maker.paymentCredential.kind === "Script" ? "script" : "key";
  const offered = offeredAsset(order);
  const asked = askedAsset(order);
  const offAmt = offeredAmount(order);
  const askAmt = askedAmount(order);

  const rows: DexRow[] = [
    { label: `Maker (${makerKind})`, value: order.maker.paymentCredential.hash, hash: true },
    ...makerStakeRows(order.maker),
    { label: "Direction", value: order.sellToken ? "SELL token → ADA" : "BUY token with ADA" },
    { label: "Offered amount", value: offAmt.toLocaleString() },
    { label: "Asked amount", value: askAmt.toLocaleString() },
    { label: "Price (lovelace / token unit)", value: order.price.toLocaleString() },
    { label: "Order total (token)", value: order.total.toLocaleString() },
    { label: "Filled (token)", value: order.filled.toLocaleString() },
    {
      label: "Expiry",
      value: order.deadline === null ? "none" : `${order.deadline.toLocaleString()} (POSIX ms)`,
    },
  ];

  const assets: DexAssetRow[] = [
    { label: "Offered", policyId: offered.policyId, assetName: offered.assetName, amount: offAmt },
    { label: "Asked", policyId: asked.policyId, assetName: asked.assetName, amount: askAmt },
  ];

  const kind = `Order: ${order.sellToken ? "sell" : "buy"} ${legLabel(offered)} → ${legLabel(asked)}`;

  return {
    protocol: "ChadSwap",
    role: "order",
    kind,
    rows,
    assets,
    issues: validateChadswapOrder(order),
    // A ChadSwap OTC order trades the named token against ADA. Surface those two
    // legs in offered → asked order so the panel shows the "Pair: X / Y" header.
    pair: {
      assetA: { policyId: offered.policyId, assetName: offered.assetName },
      assetB: { policyId: asked.policyId, assetName: asked.assetName },
    },
  };
}

registerDexAdapter({
  id: "chadswap",
  label: "ChadSwap",
  matchScriptHash: matchChadswapScriptHash,
  decode: (datum: PD) => orderToView(parseChadswapOrder(datum)),
  classifyRedeemer: (redeemer: PD) => classifyChadswapRedeemer(redeemer),
});

export * from "./chadswap";
export { CHADSWAP } from "./constants";
