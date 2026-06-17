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
  parseBatchStakeRedeemer,
  parseOptimBondDatum,
  parseOptimPositionDatum,
  parseSotokenMintRedeemer,
  validateBatchStake,
  validateStakingAmo,
  type OptimDatum,
} from "./datums";

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

// AssetClass shape = Constr 0 [ Bytes policy, Bytes name ].
function asAssetClassShape(d: PD): AssetClass | null {
  if (!isConstr(d) || d.constructor !== 0 || d.fields.length !== 2) return null;
  if (!isBytes(d.fields[0]) || !isBytes(d.fields[1])) return null;
  return { policyId: d.fields[0].bytes, assetName: d.fields[1].bytes };
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
  const rows: DexRow[] = fields.map((f, i): DexRow => {
    const ac = asAssetClassShape(f);
    if (ac) {
      return {
        label: `Field ${i} — asset`,
        asset: { policyId: ac.policyId, assetName: ac.assetName },
      };
    }
    if (isInt(f)) return { label: `Field ${i} — int`, value: asInt(f).toLocaleString() };
    if (isBytes(f)) {
      const hex = f.bytes;
      return { label: `Field ${i} — bytes${hex.length === 56 ? " (hash)" : ""}`, value: hex, hash: true };
    }
    if (isConstr(f) && f.fields.length === 0) {
      return { label: `Field ${i}`, value: `none / unit (ctor ${f.constructor})` };
    }
    return { label: `Field ${i}`, value: "(nested structure — see raw)" };
  });
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
        { label: "sOADA policy", value: datum.sotoken, hash: true },
        { label: "sOADA amount", value: datum.sotokenAmount.toLocaleString() },
        { label: "sOADA backing", value: datum.sotokenBacking.toLocaleString() },
        {
          label: "Rate (amount / backing)",
          value: `${datum.sotokenAmount.toLocaleString()} / ${datum.sotokenBacking.toLocaleString()}`,
        },
        { label: "sOADA limit", value: datum.sotokenLimit.toLocaleString() },
        { label: "oDAO fee", value: datum.odaoFee.toLocaleString() },
        { label: "oDAO sOADA", value: datum.odaoSotoken.toLocaleString() },
        {
          label: "Fee claimer",
          asset: { policyId: datum.feeClaimer.policyId, assetName: datum.feeClaimer.assetName },
        },
        { label: "Fee claim rule", value: datum.feeClaimRule, hash: true },
      ];
      return {
        protocol: "Optim Finance",
        role: "position",
        kind: "Staking AMO (rate state)",
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
      const rows: DexRow[] = [
        { label: "Base profit", value: datum.baseProfit.toLocaleString() },
        { label: "Strategy data", value: "opaque (raw Data)" },
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
