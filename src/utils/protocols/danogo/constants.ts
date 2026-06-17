// Danogo mainnet matching constants + match functions.
//
// MAINNET MATCHING — POSITION and ORDER both resolved on-chain.
// Every validator is parameterized (BondConfigLimitRaw / BondConfigMakingRaw +
// script_blacklist for the DEX orders; protocol_nft_pid/name + BondIssueConfig
// for bond-issue), so matching uses the applied hashes. Match a UTxO by its
// 28-byte PAYMENT script hash only (never full bech32). Mainnet only (return
// null for other networks).
//
// On-chain identifiers:
//  - DanogoBond / Optim bond TOKEN policy:
//      53fb41609e208f1cd3cae467c0b9abfc69f1a552bf9a90d51665a4d6
//    plutusV1, 20 bond assets minted (asset name = 32-byte bond id).
//    This is the bond-dex `get_bond_policy_id()` value.
//    A bond TOKEN at a position UTxO has policy = this id and asset name =
//    BondDatum.token_name, so it doubles as the position validity NFT policy.
//  - bond-issue POSITION validator (holds the live BondDatum):
//      1d2390bab44f6267c0145456dc2f5f8ea2586fcb0aadac5525d9a406
//    plutusV1. THE validator that holds bond positions on mainnet (addr header
//    0x11 = payment script + stake) each carrying a BondDatum (9-field Constr 0,
//    epo_rewards as a PlutusData Map, ada keyed under empty policy/name). It is
//    the bond-issue BondDatum spend validator (8-arg record over
//    fields[0]=epo_rewards map .. fields[8]=start; bond_symbol checked == #"")
//    referencing the escrow policy 5f1dd319… as a compile-time param.
//  - bond-issue GOVERNING validator (references the position validator):
//      52c3116ed9dac7f6eb898f83657b8af954d7d6e81a834f243ef9abc8
//    plutusV1. Embeds the position validator hash 1d2390ba… as compile-time
//    param_1 and the escrow policy 5f1dd319… (b_4), and also reads a 9-field
//    BondDatum-shaped record. It is the parent/governing script for the bond
//    positions, so a UTxO at it is also a Danogo bond-position UTxO. Kept in
//    positionHashes alongside 1d2390ba….
//  - Danogo escrow (DanogoBond) policy `get_escrow_policy_id()`:
//      5f1dd3192cbdaa2c1a91560a6147466efb18d33a5d6516b266ce6b6f (plutusV1).
//
// bond-DEX ORDER validators (role: "order"), plutusV2. Each validator is
// parameterized (BondConfigLimitRaw / BondConfigMakingRaw), so limit_ask in
// particular has SEVERAL distinct applied hashes (one per bond config) — each
// carries a genuine AskLimit datum Constr0[owner_vk(28), Option(owner_sk),
// requested_yield:Int]. The making pair self-references: a BidMaking datum's
// ask_sc == the making_ask hash 1adf21d5…, and an AskMaking datum's bid_sc ==
// the making_bid hash c9f72aa6…. See orderHashes below.
// NOTE: addr1z8jd97ct… (payment hash
// e4d2fb0b8d275852103fd75801e2c7dcf6ed3e276c74cabadbe5b8b6) is NOT Danogo — its
// datum is Constr0[Credential, "iUSD", Int] (an Indigo/iAsset-style order), so
// it must NOT be added here. The plutusV1 hash
// c652c19ea10ab025a2b0880682f96a2794d7cea9bc4782645c0e114c carries a 3-field
// datum but FAILS strict AskLimit validation (field[2] is not an Int / field[1]
// is not an Option) — excluded.
//
// Also NOT an "order" hash: 219ad85cb7cb300f3d315e5b8469de05ae79e8135c318d1d0d0de690
// (plutusV3). This is Danogo's newer "palm" lending / leverage validator (its
// compile-time param is the BoundedBytes "palm_state…"), whose datum is
// Constr[<state-enum>, Credential, ByteArray, Int(posix-ms), …] — a different
// schema than the bond-dex AskLimit/Bid* parsed by parseDanogoOrder. Do NOT add
// it to orderHashes; the bond-dex order parser would mis-decode it.
//
// Known NON-validator hash (do NOT use for role matching): the $DANO token
// policy id cde0ddc1e46f26d886eb972319bcb76418cb42c1cd8aded18a042537 is a TOKEN
// policy, not an order/bond/validator hash.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const DANOGO = {
  // bond-dex order validator payment script hashes (role: "order").
  // Each is a plutusV2 order validator holding a datum that decodes via
  // parseDanogoOrder.
  //  - making_ask 1adf21d5… (AskMaking, 5-field) and making_bid c9f72aa6…
  //    (BidMaking, 8-field) cross-reference each other in their datums.
  //  - the remaining seven are limit_ask (AskLimit, 3-field) applied hashes;
  //    limit_ask is parameterized per BondConfigLimitRaw so it has multiple
  //    deployed instances, each carrying an AskLimit order.
  orderHashes: [
    "1adf21d53a99c21d63c69758fcbb882795a90ff99c9254a33bf04a1a",
    "c9f72aa64eab2ad96f4becbf739233212a4acabba7643212cd6182e2",
    "d156b23f34ad66a506a40003ef4008be65dcdd424f41834c5677c2ba",
    "8bffef8c538fbe549269e86f56fd5174ad3128828befeabc4e7df9bf",
    "ac9cc4f7781ff5e1d6bb7dfc7caa655aee41bb92ca3c4b05122ac107",
    "93e8809888a2ee78edb41151c1460eccd1c4e89f65b69aab636f4d53",
    "a950bd8041cf8c9ca4522373fccfcf6b0c7fe070461668513fe8aa9a",
    "a59752e18abd49e8c795d553c3a6abf8453d8479d6af631335992fd6",
    "67adaa1f0c90925d42ac1d444f6b18f695370deb0b270a3f08cc40be",
  ] as readonly string[],
  // bond-issue position validator payment script hashes (role: "position").
  // Each holds the 9-field BondDatum (epo_rewards as a Map).
  //  - 1d2390ba… is THE position validator holding BondDatum UTxOs.
  //  - 52c3116e… is the governing/parent validator (embeds 1d2390ba… as a
  //    compile-time param) that also carries the BondDatum record shape.
  positionHashes: [
    "1d2390bab44f6267c0145456dc2f5f8ea2586fcb0aadac5525d9a406",
    "52c3116ed9dac7f6eb898f83657b8af954d7d6e81a834f243ef9abc8",
  ] as readonly string[],
  // Position NFT policies. The DanogoBond / Optim bond TOKEN policy: a bond
  // position UTxO carries a token under this policy whose asset name equals the
  // 32-byte bond id (= BondDatum.token_name). 20 assets minted.
  positionNftPolicies: [
    "53fb41609e208f1cd3cae467c0b9abfc69f1a552bf9a90d51665a4d6",
  ] as readonly string[],
  // Asset name carried by a position validity NFT, when known. Bond ids are
  // per-bond 32-byte hashes (no fixed value), so we leave this empty and match
  // on the policy id alone.
  positionNftAssetNames: [] as readonly string[],
} as const;

export function matchDanogoScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if ((DANOGO.orderHashes as readonly string[]).includes(lower)) return "order";
  if ((DANOGO.positionHashes as readonly string[]).includes(lower)) return "position";
  return null;
}

export function matchDanogoNftPolicy(
  policyId: string,
  assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  if (!(DANOGO.positionNftPolicies as readonly string[]).includes(lower)) return null;
  // When the validity-NFT asset name is known, require a match so that other
  // assets minted under the same parameterized policy do not false-positive.
  const names = DANOGO.positionNftAssetNames as readonly string[];
  if (names.length > 0) {
    const lowerNames = assetNames.map((n) => n.toLowerCase());
    if (!names.some((n) => lowerNames.includes(n))) return null;
  }
  return "position";
}
