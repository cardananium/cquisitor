// Genius Yield V1 (PartialOrder) decoder: normalized view + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { PD, PlutusAddress, Rational } from "@/utils/protocols/dex/plutusData";
import {
  GENIUS_YIELD_V1_1_ROLE,
  matchGeniusYieldNftPolicy,
  matchGeniusYieldScriptHash,
  matchGeniusYieldV11NftPolicy,
} from "./constants";
import {
  classifyPartialOrderRedeemer,
  parsePartialOrderDatum,
  validatePartialOrderDatum,
  type PartialOrderDatum,
} from "./partialOrder";
import {
  parsePartialOrderV11Datum,
  partialOrderV11Price,
  validatePartialOrderV11Datum,
  type PartialOrderV11Datum,
} from "./partialOrderV11";

function formatRational(r: Rational): string {
  return `${r.numerator.toLocaleString()} / ${r.denominator.toLocaleString()}`;
}

function ownerAddressRow(addr: PlutusAddress): DexRow {
  const c = addr.paymentCredential;
  return {
    label: `Owner address (${c.kind === "Script" ? "script" : "key"})`,
    value: c.hash,
    hash: true,
  };
}

export function partialOrderToView(
  datum: PartialOrderDatum,
  role: DexRole = "order",
): DexOrderView {
  const rows: DexRow[] = [
    { label: "Price (asked / offered)", value: formatRational(datum.price) },
    {
      label: "Offered (remaining / original)",
      value: `${datum.offeredAmount.toLocaleString()} / ${datum.offeredOriginalAmount.toLocaleString()}`,
    },
    { label: "Partial fills so far", value: datum.partialFills.toLocaleString() },
    {
      label: "Maker / taker flat fee (lovelace)",
      value: `${datum.makerLovelaceFlatFee.toLocaleString()} / ${datum.takerLovelaceFlatFee.toLocaleString()}`,
    },
    {
      label: "Contained fee (lovelace / offered / asked)",
      value: `${datum.containedFee.lovelaces.toLocaleString()} / ${datum.containedFee.offeredTokens.toLocaleString()} / ${datum.containedFee.askedTokens.toLocaleString()}`,
    },
    { label: "Contained payment", value: datum.containedPayment.toLocaleString() },
    {
      label: "Start",
      value: datum.start == null ? "—" : `${datum.start.toLocaleString()} (POSIX ms)`,
    },
    {
      label: "End",
      value: datum.end == null ? "—" : `${datum.end.toLocaleString()} (POSIX ms)`,
    },
    { label: "Owner key", value: datum.ownerKey, hash: true },
    ownerAddressRow(datum.ownerAddr),
    { label: "Order NFT", value: datum.nft, hash: true },
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Offered",
      policyId: datum.offeredAsset.policyId,
      assetName: datum.offeredAsset.assetName,
      amount: datum.offeredAmount,
    },
    {
      label: "Asked",
      policyId: datum.askedAsset.policyId,
      assetName: datum.askedAsset.assetName,
    },
  ];
  return {
    protocol: "Genius Yield V1",
    role,
    kind: "Partial order",
    rows,
    assets,
    issues: validatePartialOrderDatum(datum),
  };
}

registerDexAdapter({
  id: "genius-yield-v1",
  label: "Genius Yield V1",
  // Parameterized validator → no stable payment script hash; always null.
  matchScriptHash: matchGeniusYieldScriptHash,
  matchNftPolicy: matchGeniusYieldNftPolicy,
  decode: (datum: PD, role: DexRole) =>
    partialOrderToView(parsePartialOrderDatum(datum), role),
  classifyRedeemer: (redeemer: PD) => classifyPartialOrderRedeemer(redeemer),
});

export function partialOrderV11ToView(
  datum: PartialOrderV11Datum,
  role: DexRole = GENIUS_YIELD_V1_1_ROLE,
): DexOrderView {
  const rows: DexRow[] = [
    { label: "Price (asked / offered)", value: formatRational(partialOrderV11Price(datum)) },
    {
      label: "Offered amount",
      value: datum.offered.amount.toLocaleString(),
    },
    {
      label: "Asked amount",
      value: datum.asked.amount.toLocaleString(),
    },
    {
      label: "Record kind",
      value: datum.record.kind === "record" ? "record (with NFT)" : "plain",
    },
    {
      label: "Start",
      value: datum.start == null ? "—" : `${datum.start.toLocaleString()} (POSIX ms)`,
    },
    {
      label: "End",
      value: datum.end == null ? "—" : `${datum.end.toLocaleString()} (POSIX ms)`,
    },
    datum.signatories.length === 0
      ? { label: "Signatories", value: "—" }
      : { label: "Signatories", value: datum.signatories.join(", "), hash: true },
    ownerAddressRow(datum.ownerAddr),
    { label: "Order NFT", value: datum.nft, hash: true },
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Offered",
      policyId: datum.offered.asset.policyId,
      assetName: datum.offered.asset.assetName,
      amount: datum.offered.amount,
    },
    {
      label: "Asked",
      policyId: datum.asked.asset.policyId,
      assetName: datum.asked.asset.assetName,
      amount: datum.asked.amount,
    },
  ];
  return {
    protocol: "Genius Yield V1.1",
    role,
    kind: "Partial order",
    rows,
    assets,
    issues: validatePartialOrderV11Datum(datum),
  };
}

registerDexAdapter({
  id: "genius-yield-v1_1",
  label: "Genius Yield V1.1",
  // Parameterized validator → no stable payment script hash; matched by NFT.
  matchScriptHash: matchGeniusYieldScriptHash,
  matchNftPolicy: matchGeniusYieldV11NftPolicy,
  decode: (datum: PD, role: DexRole) =>
    partialOrderV11ToView(parsePartialOrderV11Datum(datum), role),
  // V1.1 reuses the V1 PartialOrderAction redeemer (indexed 0/1/2).
  classifyRedeemer: (redeemer: PD) => classifyPartialOrderRedeemer(redeemer),
});

export * from "./partialOrder";
export * from "./partialOrderV11";
export { GENIUS_YIELD_V1, GENIUS_YIELD_V1_1 } from "./constants";
