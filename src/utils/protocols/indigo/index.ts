// Indigo Protocol (CDP / iAsset synthetics) decoder: normalized views + adapter
// registration. Re-exports the parser module.

import {
  registerDexAdapter,
  type DexOrderView,
  type DexRole,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { matchIndigoNftPolicy, matchIndigoScriptHash } from "./constants";
import {
  parseCDPDatum,
  parseCDPRedeemer,
  validateCDPDatum,
  type CDPDatum,
  type CDPPosition,
  type IAssetConfig,
  type IndigoRole,
} from "./cdp";
import type { Rational } from "@/utils/protocols/dex/plutusData";

const PROTOCOL = "Indigo Protocol";

// iAsset token names are short ASCII (e.g. "iUSD"); render them readable.
function decodeAsciiName(hex: string): string {
  if (hex === "") return "";
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return hex;
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code < 0x20 || code > 0x7e) return hex; // not printable ASCII → keep hex
    out += String.fromCharCode(code);
  }
  return `${out} (${hex})`;
}

function cdpPositionToView(datum: CDPPosition): DexOrderView {
  const rows: DexRow[] = [
    { label: "iAsset (debt)", value: decodeAsciiName(datum.iasset), mono: true },
    { label: "Minted debt amount", value: datum.mintedAmt.toLocaleString() },
    datum.cdpOwner === null
      ? { label: "Owner", value: "Nothing (FROZEN)" }
      : { label: "Owner", value: datum.cdpOwner, hash: true },
  ];
  if (datum.cdpFees.kind === "ActiveInterestTracking") {
    rows.push(
      { label: "Last settled", value: `${datum.cdpFees.lastSettled.toLocaleString()} (POSIX ms)` },
      { label: "Unitary interest snapshot", value: datum.cdpFees.unitaryInterestSnapshot.toLocaleString() },
    );
  } else {
    rows.push(
      { label: "Accrued fees → treasury (lovelace)", value: datum.cdpFees.lovelacesTreasury.toLocaleString() },
      { label: "Accrued fees → INDY stakers (lovelace)", value: datum.cdpFees.lovelacesIndyStakers.toLocaleString() },
    );
  }
  rows.push({
    label: "Collateral asset",
    asset: {
      policyId: datum.collateral.policyId,
      assetName: datum.collateral.assetName,
    },
  });
  return {
    protocol: PROTOCOL,
    role: "cdp",
    kind: datum.frozen ? "CDP position (frozen)" : "CDP position",
    rows,
    assets: [],
    issues: validateCDPDatum(datum),
  };
}

function formatRatio(r: Rational): string {
  if (r.denominator === BigInt(0)) return `${r.numerator.toString()}/0`;
  return `${r.numerator.toString()}/${r.denominator.toString()}`;
}

function iAssetConfigToView(datum: IAssetConfig): DexOrderView {
  const rows: DexRow[] = [
    { label: "iAsset name", value: decodeAsciiName(datum.assetName), mono: true },
    { label: "Price source", value: datum.priceSource.toString() },
    ...datum.ratios.map((r, i) => ({ label: `Ratio #${i + 1}`, value: formatRatio(r) })),
    { label: "Flag", value: datum.flag ? "yes" : "no" },
    {
      label: "Next iAsset",
      value: datum.nextIAsset === null ? "Nothing (list tail)" : decodeAsciiName(datum.nextIAsset),
      mono: datum.nextIAsset !== null,
    },
  ];
  return {
    protocol: PROTOCOL,
    role: "iasset",
    kind: "iAsset config",
    rows,
    assets: [],
    issues: validateCDPDatum(datum),
  };
}

export function cdpDatumToView(datum: CDPDatum): DexOrderView {
  return datum.role === "cdp" ? cdpPositionToView(datum) : iAssetConfigToView(datum);
}

// Classify a CDP spending redeemer (see cdp.ts for the constructor table).
export function classifyIndigoRedeemer(redeemer: PD): string | null {
  const r = parseCDPRedeemer(redeemer);
  switch (r.kind) {
    case "AdjustCDP":
      return "Adjust CDP";
    case "MergeCDPs":
      return "Merge CDPs";
    case "MergeAuxiliary":
      return "Merge auxiliary";
    case "Liquidate":
      return "Liquidate CDP";
    case "UpgradeAsset":
      return "Upgrade (iAsset param)";
    case "UpgradeVersion":
      return "Upgrade (version migration)";
    case "Unknown":
      return r.label
        ? `Unknown redeemer (Constr ${r.tag}; ${r.label})`
        : `Unknown redeemer (Constr ${r.tag})`;
  }
}

registerDexAdapter({
  id: "indigo",
  label: PROTOCOL,
  matchScriptHash: matchIndigoScriptHash,
  matchNftPolicy: matchIndigoNftPolicy,
  // The CDP validator hosts both roles; the actual role is determined by the
  // CDPDatum constructor, so we ignore the matched `role` hint and decode from
  // the datum itself (Constr 0 = cdp position, Constr 1 = iasset config).
  decode: (datum: PD, role: DexRole) => {
    // On chain both roles are wrapped in a top-level Constr0, so the role hint
    // from the matched script hash / auth-token NFT decides which to parse.
    const indigoRole: IndigoRole = role === "iasset" ? "iasset" : "cdp";
    return cdpDatumToView(parseCDPDatum(datum, indigoRole));
  },
  classifyRedeemer: (redeemer: PD) => classifyIndigoRedeemer(redeemer),
});

export * from "./cdp";
export { INDIGO, matchIndigoNftPolicy, matchIndigoScriptHash } from "./constants";
