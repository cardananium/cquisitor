// SnekFun decoder: normalized views + adapter registration.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import type { AssetClass, PD } from "@/utils/protocols/dex/plutusData";
import { matchSnekFunNftPolicy, matchSnekFunScriptHash } from "./constants";
import {
  classifySnekFunRedeemer,
  parseSnekFunCurve,
  validateSnekFunCurve,
  type SnekFunCurve,
} from "./snekfun";

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

function curveToView(curve: SnekFunCurve): DexOrderView {
  const rows: DexRow[] = [
    { label: "Owner (key)", value: curve.owner, hash: true },
    { label: "Curve NFT policy", value: curve.curveNft.policyId, hash: true },
    { label: "Curve NFT name", value: curve.curveNft.assetName, hash: true },
    { label: "Target (lovelace)", value: curve.targetLovelace.toLocaleString() },
    // Bonding-curve coefficients — raw datum ints, surfaced as neutral values.
    { label: "Curve coeff A", value: curve.coeffA.toLocaleString() },
    { label: "Curve coeff B", value: curve.coeffB.toLocaleString() },
    { label: "Trade withdrawal", value: curve.tradeWithdrawal, hash: true },
    { label: "Admin withdrawal", value: curve.adminWithdrawal, hash: true },
  ];
  const assets: DexAssetRow[] = [
    {
      label: "Launched token",
      policyId: curve.token.policyId,
      assetName: curve.token.assetName,
    },
    {
      label: "Base",
      policyId: curve.base.policyId,
      assetName: curve.base.assetName,
    },
    {
      label: "Curve NFT",
      policyId: curve.curveNft.policyId,
      assetName: curve.curveNft.assetName,
      amount: BigInt(1),
    },
  ];
  // The headline action surfaces the launched token traded against the base.
  const kind = `Curve: ${legLabel(curve.token)} / ${legLabel(curve.base)}`;
  return {
    protocol: "SnekFun",
    role: "curve",
    kind,
    rows,
    assets,
    issues: validateSnekFunCurve(curve),
    // A SnekFun curve trades the launched token against its base (ADA). Surface
    // those exact two legs (datum order, never reordered) as the trading pair so
    // the panel can show "Pair: token / ADA". ada = ("", "").
    pair: {
      assetA: { policyId: curve.token.policyId, assetName: curve.token.assetName },
      assetB: { policyId: curve.base.policyId, assetName: curve.base.assetName },
    },
  };
}

registerDexAdapter({
  id: "snekfun",
  label: "SnekFun",
  matchScriptHash: matchSnekFunScriptHash,
  matchNftPolicy: matchSnekFunNftPolicy,
  decode: (datum: PD) => curveToView(parseSnekFunCurve(datum)),
  classifyRedeemer: (redeemer: PD) => classifySnekFunRedeemer(redeemer),
});

export * from "./snekfun";
export { SNEKFUN } from "./constants";
