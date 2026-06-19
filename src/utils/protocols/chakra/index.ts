// Chakra decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type {
  AssetClass,
  PD,
  PlutusAddress,
  Rational,
} from "@/utils/protocols/dex/plutusData";
import { matchChakraNftPolicy, matchChakraScriptHash } from "./constants";
import {
  classifyChakraRedeemer,
  isChakraSwapOrder,
  parseChakraPool,
  parseChakraSwapOrder,
  validateChakraPool,
  type ChakraPool,
  type ChakraSwapOrder,
} from "./chakra";

// Compact leg label for the headline only: "ADA" for the ada leg, otherwise the
// decoded ASCII asset name (CIP-68 (0014df10) label prefix stripped) when
// printable, falling back to "token". Full policy/name stay in assets[].
function legLabel(asset: AssetClass): string {
  if (asset.policyId === "" && asset.assetName === "") return "ADA";
  let name = asset.assetName;
  // Strip a CIP-68 user-token label prefix (000643b0 / 0014df10) if present.
  if (name.length >= 8 && /^00[0-9a-f]{6}/.test(name)) name = name.slice(8);
  if (name && /^[0-9a-fA-F]*$/.test(name) && name.length % 2 === 0) {
    const bytes = name.match(/.{2}/g) ?? [];
    const ascii = bytes.map((b) => String.fromCharCode(parseInt(b, 16))).join("");
    if (/^[\x20-\x7e]+$/.test(ascii)) return ascii;
  }
  return "token";
}

function rat(r: Rational): string {
  return `${r.numerator.toLocaleString()}/${r.denominator.toLocaleString()}`;
}

function poolToView(pool: ChakraPool): DexOrderView {
  const rows: DexRow[] = [
    { label: "Pool NFT policy", value: pool.poolNft.policyId, hash: true },
    { label: "Pool NFT name", value: pool.poolNft.assetName, hash: true },
    { label: "Tokens sold", value: pool.tokensSold.toLocaleString() },
    { label: "Target supply (curve cap)", value: pool.targetSupply.toLocaleString() },
    { label: "Curve coeff A", value: rat(pool.curveA) },
    { label: "Curve coeff B", value: rat(pool.curveB) },
    { label: "Base fee", value: `${pool.baseFee.toLocaleString()} (lovelace)` },
    { label: "Fee fraction", value: rat(pool.feeFraction) },
    { label: "Accrued fee", value: pool.accFee.toLocaleString() },
    { label: "Accrued currency", value: pool.accCurrency.toLocaleString() },
    { label: "Operator (batcher key)", value: pool.operatorKey, hash: true },
  ];
  const assets: DexAssetRow[] = [
    { label: "Currency", policyId: pool.currency.policyId, assetName: pool.currency.assetName },
    { label: "Token", policyId: pool.token.policyId, assetName: pool.token.assetName },
    { label: "Pool NFT", policyId: pool.poolNft.policyId, assetName: pool.poolNft.assetName },
  ];
  return {
    protocol: "Chakra",
    role: "pool",
    kind: `Pool: ${legLabel(pool.token)} / ${legLabel(pool.currency)} (bonding curve)`,
    rows,
    assets,
    issues: validateChakraPool(pool),
    // The two traded legs: the launched token vs the pool's currency (quote)
    // asset. Datum order is preserved (token = field[2], currency = field[1]).
    pair: {
      assetA: { policyId: pool.token.policyId, assetName: pool.token.assetName },
      assetB: { policyId: pool.currency.policyId, assetName: pool.currency.assetName },
    },
  };
}

function returnAddressRows(addr: PlutusAddress): DexRow[] {
  const payKind = addr.paymentCredential.kind === "Script" ? "script" : "key";
  const rows: DexRow[] = [
    { label: `Return addr (${payKind})`, value: addr.paymentCredential.hash, hash: true },
  ];
  const stake = addr.stakeCredential;
  if (!stake) {
    rows.push({ label: "Return addr stake", value: "none" });
  } else if (stake.kind === "Inline") {
    const sk = stake.credential.kind === "Script" ? "script" : "key";
    rows.push({ label: `Return addr stake (${sk})`, value: stake.credential.hash, hash: true });
  } else {
    rows.push({
      label: "Return addr stake (pointer)",
      value: `slot ${stake.slotNumber}, txIdx ${stake.transactionIndex}, certIdx ${stake.certificateIndex}`,
    });
  }
  return rows;
}

function swapOrderToView(order: ChakraSwapOrder): DexOrderView {
  const rows: DexRow[] = [
    { label: "Owner", value: order.owner, hash: true },
    { label: "Pool NFT policy", value: order.poolNft.policyId, hash: true },
    { label: "Pool NFT name", value: order.poolNft.assetName, hash: true },
    { label: "Amount", value: order.amount.toLocaleString() },
    ...returnAddressRows(order.returnAddress),
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Currency",
      policyId: order.currency.policyId,
      assetName: order.currency.assetName,
      amount: order.amount,
    },
    { label: "Pool NFT", policyId: order.poolNft.policyId, assetName: order.poolNft.assetName },
  ];
  return {
    protocol: "Chakra",
    role: "order",
    kind: `Swap order (${legLabel(order.currency)})`,
    rows,
    assets,
    issues: [],
  };
}

function decodeChakra(datum: PD): DexOrderView {
  if (isChakraSwapOrder(datum)) {
    return swapOrderToView(parseChakraSwapOrder(datum));
  }
  return poolToView(parseChakraPool(datum));
}

registerDexAdapter({
  id: "chakra",
  label: "Chakra",
  matchScriptHash: matchChakraScriptHash,
  matchNftPolicy: matchChakraNftPolicy,
  decode: (datum: PD) => decodeChakra(datum),
  classifyRedeemer: (redeemer: PD) => classifyChakraRedeemer(redeemer),
});

export * from "./chakra";
export { CHAKRA } from "./constants";
