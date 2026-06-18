// Optim Finance decoder: normalized views + adapter registration.
//
// Implements the OADA / sOADA liquid-staking "position" role (BatchStake order
// escrow + the AMO singleton state datums). The "bond" (Liquidity Bonds) role is
// declared but unsupported: we surface a raw passthrough instead of fabricating
// field semantics.

import {
  registerDexAdapter,
  type DexAssetRow,
  type DexIssue,
  type DexOrderView,
  type DexRow,
} from "@/utils/protocols/dex/registry";
import {
  asConstr,
  asInt,
  isBytes,
  isConstr,
  isInt,
  type AssetClass,
  type PD,
  type PlutusAddress,
} from "@/utils/protocols/dex/plutusData";
import { matchOptimScriptHash } from "./constants";
import {
  formatBidApy,
  parseBatchStakeRedeemer,
  parseOptimBondDatum,
  parseOptimPositionDatum,
  parseSotokenMintRedeemer,
  validateBatchStake,
  validateStakeAuctionBid,
  validateStakingAmo,
  type OptimDatum,
} from "./datums";
import type { Credential } from "@/utils/protocols/dex/plutusData";

// Full address descriptor (script/key + optional stake), no truncation. The
// shared HashWithTooltip component truncates + copies the full string.
function describeAddress(addr: PlutusAddress): string {
  const c = addr.paymentCredential;
  const base = `${c.kind === "Script" ? "script" : "key"} ${c.hash}`;
  if (!addr.stakeCredential) return base;
  if (addr.stakeCredential.kind === "Inline") {
    return `${base} / stake ${addr.stakeCredential.credential.hash}`;
  }
  return `${base} / stake (pointer)`;
}

// Render a bare Credential (the stake-credential field of a stake-auction bid).
function describeCredential(c: Credential | null): string {
  if (!c) return "(unrecognized)";
  return `${c.kind === "Script" ? "script" : "key"} ${c.hash}`;
}

// AssetClass shape = Constr 0 [ Bytes policy, Bytes name ].
function asAssetClassShape(d: PD): AssetClass | null {
  if (!isConstr(d) || d.constructor !== 0 || d.fields.length !== 2) return null;
  if (!isBytes(d.fields[0]) || !isBytes(d.fields[1])) return null;
  return { policyId: d.fields[0].bytes, assetName: d.fields[1].bytes };
}

// Render a single raw PD field as a DexRow by its on-chain STRUCTURE (asset
// class, integer, hash/bytes, empty-ctor flag/unit) without fabricating a name.
// Used both for unlabelled position datums and for the opaque Strategy data blob.
function structuralFieldRow(label: string, f: PD): DexRow {
  const ac = asAssetClassShape(f);
  if (ac) return { label: `${label} — asset`, asset: { policyId: ac.policyId, assetName: ac.assetName } };
  if (isInt(f)) return { label: `${label} — int`, value: asInt(f).toLocaleString() };
  if (isBytes(f)) {
    const hex = f.bytes;
    return { label: `${label} — bytes${hex.length === 56 ? " (hash)" : ""}`, value: hex, hash: true };
  }
  if (isConstr(f) && f.fields.length === 0) {
    return { label, value: `none / unit (ctor ${f.constructor})` };
  }
  if (isConstr(f)) return { label, value: `ctor ${f.constructor} (${f.fields.length} fields — see raw)` };
  return { label, value: "(nested structure — see raw)" };
}

// Honest structural view for genuine-but-unlabelled Optim position datums (the
// 15-field StakingAMO state and the 5-field stake order). Rather than fabricate
// field semantics we surface each field by its on-chain STRUCTURE: asset classes
// (recognising OADA / sOADA / ADA), script/key hashes, and integer parameters.
// Matched only at the Optim validator hashes, so this is never shown for
// unrelated UTxOs.
function structuralPositionView(raw: PD): DexOrderView {
  let fields: PD[];
  try {
    fields = asConstr(raw).fields;
  } catch {
    return {
      protocol: "Optim Finance",
      role: "position",
      kind: "Unrecognized datum",
      rows: [{ label: "Note", value: "datum is not a constructor; shown raw below." }],
      issues: [],
    };
  }
  const rows: DexRow[] = fields.map((f, i): DexRow => structuralFieldRow(`Field ${i}`, f));
  return {
    protocol: "Optim Finance",
    role: "position",
    kind: `Position datum (${fields.length} fields)`,
    rows,
    issues: [],
  };
}

export function optimDatumToView(datum: OptimDatum): DexOrderView {
  switch (datum.kind) {
    case "BatchStake": {
      const issues: DexIssue[] = validateBatchStake(datum);
      const rows: DexRow[] = [
        { label: "Owner", value: datum.owner, hash: true },
        { label: "Return address", value: describeAddress(datum.returnAddress), hash: true },
      ];
      return {
        protocol: "Optim Finance",
        role: "position",
        kind: "Stake order (BatchStake)",
        rows,
        issues,
      };
    }
    case "StakingAmo": {
      const issues: DexIssue[] = validateStakingAmo(datum);
      const rows: DexRow[] = [
        {
          label: "Soul token (AMO id)",
          asset: { policyId: datum.soulToken.policyId, assetName: datum.soulToken.assetName },
        },
        {
          label: "Base asset",
          asset: { policyId: datum.baseAsset.policyId, assetName: datum.baseAsset.assetName },
        },
        {
          label: "OTOKEN",
          asset: { policyId: datum.otoken.policyId, assetName: datum.otoken.assetName },
        },
        {
          label: "sOTOKEN",
          asset: { policyId: datum.sotoken.policyId, assetName: datum.sotoken.assetName },
        },
        { label: "sOTOKEN amount (snapshot)", value: datum.sotokenAmount.toLocaleString() },
        { label: "sOTOKEN backing (snapshot)", value: datum.sotokenBacking.toLocaleString() },
        { label: "oDAO fee", value: datum.odaoFee.toLocaleString() },
        { label: "Fee component 2", value: datum.feeComponent2.toLocaleString() },
        { label: "Fee claim rule", value: datum.feeClaimRule, hash: true },
        { label: "Script hash (field 12)", value: datum.scriptHash12, hash: true },
        { label: "Field 1 (int)", value: datum.field1.toLocaleString() },
        { label: "Field 4 (int)", value: datum.field4.toLocaleString() },
        { label: "Field 5 (int)", value: datum.field5.toLocaleString() },
        { label: "Flag 7", value: String(datum.flag7) },
        { label: "Flag 8", value: String(datum.flag8) },
      ];
      return {
        protocol: "Optim Finance",
        role: "position",
        kind: "Staking AMO (rate state)",
        rows,
        issues,
      };
    }
    case "StakeAuctionBid": {
      const issues: DexIssue[] = validateStakeAuctionBid(datum);
      const rows: DexRow[] = [
        { label: "Owner", value: datum.owner, hash: true },
        {
          label: "Stake credential",
          value: describeCredential(datum.stakeCredential),
          hash: datum.stakeCredential !== null,
        },
        { label: "Bid APY", value: `${formatBidApy(datum.apy)} (raw ${datum.apy.toLocaleString()})` },
        { label: "Bid type", value: datum.bidType },
        {
          label: "Bid reference",
          value: datum.bidRef
            ? `${datum.bidRef.transactionId}#${datum.bidRef.outputIndex.toString()}`
            : "none",
          hash: datum.bidRef !== null,
        },
      ];
      return {
        protocol: "Optim Finance",
        role: "position",
        kind: "Stake auction bid",
        rows,
        issues,
      };
    }
    case "StakeAuctionBidCont": {
      const issues: DexIssue[] = validateStakeAuctionBid(datum);
      const rows: DexRow[] = [
        { label: "Bid APY", value: `${formatBidApy(datum.apy)} (raw ${datum.apy.toLocaleString()})` },
        {
          label: "Note",
          value: "Continuation / partial-fill bid (carries APY only).",
        },
      ];
      return {
        protocol: "Optim Finance",
        role: "position",
        kind: "Stake auction bid (continuation)",
        rows,
        issues,
      };
    }
    case "CollateralAmo": {
      const rows: DexRow[] = [
        { label: "Base profit (uncommitted)", value: datum.baseProfitUncommitted.toLocaleString() },
        {
          label: "Staking AMO id",
          asset: { policyId: datum.stakingAmo.policyId, assetName: datum.stakingAmo.assetName },
        },
        { label: "Child strategies", value: datum.childStrategies.length.toLocaleString() },
      ];
      const assets: DexAssetRow[] = datum.childStrategies.map((s, i) => ({
        label: `Strategy ${i + 1}`,
        policyId: s.policyId,
        assetName: s.assetName,
      }));
      return {
        protocol: "Optim Finance",
        role: "position",
        kind: "Collateral AMO",
        rows,
        assets,
        issues: [],
      };
    }
    case "Strategy": {
      // strategy_data is opaque Data in the clean-code schema (no field names);
      // surface its on-chain STRUCTURE rather than hiding it behind a label.
      const rows: DexRow[] = [
        { label: "Base profit", value: datum.baseProfit.toLocaleString() },
        structuralFieldRow("Strategy data", datum.strategyData),
      ];
      return {
        protocol: "Optim Finance",
        role: "position",
        kind: "Strategy",
        rows,
        issues: [],
      };
    }
    case "Unknown":
    default:
      // Genuine Optim UTxO (matched at an Optim validator hash) whose datum we
      // don't field-label — render its structure honestly instead of "raw".
      return structuralPositionView(datum.raw);
  }
}

function bondToView(): DexOrderView {
  return {
    protocol: "Optim Finance",
    role: "bond",
    kind: "Liquidity Bond (unsupported)",
    rows: [
      {
        label: "Note",
        value: "Optim Liquidity Bonds on-chain code is private; datum layout is not decoded.",
      },
    ],
    issues: [],
  };
}

registerDexAdapter({
  id: "optim",
  label: "Optim Finance",
  // Matched by the applied mainnet validator payment hashes (staking-AMO state +
  // stake-order escrow). NOT by the OADA / sOADA token policy: those tokens are
  // broadly held (wallets, other DeFi pools), so a token match false-positives.
  matchScriptHash: matchOptimScriptHash,
  decode: (datum: PD, role) => {
    if (role === "bond") {
      parseOptimBondDatum(datum); // validate it is at least PlutusData; result is opaque
      return bondToView();
    }
    return optimDatumToView(parseOptimPositionDatum(datum));
  },
  // The economically meaningful redeemer is the sOADA Mint tuple (Int,Int), not a
  // spend redeemer (OADA spend handlers carry raw Data via the withdraw-0 pattern).
  // We still classify the BatchStake spend redeemer when present.
  classifyRedeemer: (redeemer: PD) => {
    try {
      const r = parseBatchStakeRedeemer(redeemer);
      if (r.kind === "CancelStake") return "Cancel stake";
      return "Digest stake (fill)";
    } catch {
      /* not a BatchStake redeemer */
    }
    try {
      const m = parseSotokenMintRedeemer(redeemer);
      return `sOADA mint rate ${m.sotokenAmount.toLocaleString()} / ${m.sotokenBacking.toLocaleString()}`;
    } catch {
      return null;
    }
  },
});

export * from "./datums";
export { OPTIM, optimTokenForPolicy } from "./constants";
