// Midnight NIGHT / Glacier Drop mainnet match constants.
//
// The PlutusV3 distribution validator (script hash == the NIGHT minting policy)
// is parameterized by a config/governance contract hash; the config UTxO carries
// the distribution datum (authority, treasury, allocations).
//
//   - distribution validator / NIGHT policy 0691b2fe…: locks the full
//     24,000,000,000 NIGHT here with a UNIT datum (Constr0[]); claims spend it
//     (unit redeemer) in batch txs. Match by the 28-byte PAYMENT script hash only.
//   - config contract 5c7bcedf… (plutusV3, a parameter of the validator): holds
//     the 7-field Glacier Drop config datum.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const MIDNIGHT = {
  // NIGHT Cardano native asset (6 decimals, 24B supply).
  nightPolicy: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
  nightAssetName: "4e49474854", // "NIGHT"
  nightDecimals: 6,
  // The NIGHT minting policy is ALSO the distribution validator (policy id ==
  // script hash). Glacier Drop supply is locked at this script address.
  distributionHash: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
  // Glacier Drop config/governance contract (compile-time parameter of the
  // distribution validator). Holds the distribution config datum.
  configHash: "5c7bcedf8dc18f4f3c975f7107700ff3e0bc0aba9f6856e01f6dbefd",
  // Thaw / redemption — two contracts share the redemption flow:
  //   pool (PlutusV3): the merkle batch pool. The master distribution (tx
  //     7a906cde…) sent the community NIGHT here (~4.5B+); UTxOs carry a 4-field
  //     thaw datum (merkle root + start 2025-12-10 + 90-day interval + redeemed
  //     state). This is the config datum's "treasury #2" credential.
  //   position (PlutusV3): the per-user thaw position (the pool validator is
  //     parameterized by it); UTxOs carry a 5-field datum (owner address, NIGHT
  //     amount, next-thaw date, tranche, 90-day interval). Redemptions move NIGHT
  //     out of a position as each tranche unlocks.
  thawHash: "9015199b65dff1a5b9e281192c0157c23ccb579311232b94fe1c037c",
  thawPositionHash: "5986bfcc0cbfc60dec8df87715cc95d03817aac386b0e9d33da03b39",
  // Secondary PlutusV3 control/mint policy that drives the batch distribution
  // (references BOTH the distribution validator and the config contract; 6-variant
  // redeemer enum). Used as a mint witness in claim/batch txs (e.g. 7a906cde…) but
  // mints no PERSISTING assets (policy_asset_list is empty) and holds no UTxOs —
  // so it is not surfaceable via output-datum or asset-policy detection; recorded
  // here for reference only.
  controlPolicy: "4dcdd732b3ef140bdc8c7ee1490be30921b683db720a15cb7786d081",
} as const;

// Other compile-time parameters of the distribution validator. Investigated and
// found to have NO on-chain footprint (no minted assets, no script at the hash,
// no UTxOs, never required signers), so there is nothing to recognize — likely
// inactive/admin parameters. Kept here only to document the investigation.
export const MIDNIGHT_INERT_PARAMS = [
  "6d307382f261f45ee8da5c4fd7ad9f71d31583e21f1f77bbc1e16590",
  "4fbfd2925aa5bd20f5c3d2ae9fed8b619c243da651bfc6b659d2206b",
] as const;

// Scavenger Mine (Glacier Drop phase 2, Oct–Nov 2025; ~1B NIGHT, now closed)
// uses the SAME on-chain distribution mechanism (this validator + config +
// control policy); there is no separate decodable Scavenger contract on Cardano.

// Match a UTxO by its 28-byte PAYMENT script hash. Mainnet only. We deliberately
// do NOT match the NIGHT token policy broadly (it is held by ~34M airdrop
// wallets — a token-policy match would false-positive everywhere); only UTxOs
// AT the Glacier Drop contract addresses are matched.
export function matchMidnightScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === MIDNIGHT.distributionHash) return "distribution";
  if (lower === MIDNIGHT.configHash) return "config";
  if (lower === MIDNIGHT.thawHash || lower === MIDNIGHT.thawPositionHash) return "thaw";
  return null;
}
