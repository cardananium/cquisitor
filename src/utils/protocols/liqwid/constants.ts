// Liqwid Finance mainnet match constants + match functions.
//
// On-chain anchors (all plutusV2):
//   - loanScriptHash   71391f18… : the "Loan"/position spend validator. Every
//     datum a List of 5 [bytes,int,int,int,int]. Each carries a loan-NFT (policy
//     ee944b56…, name 00=supply / 01=borrow receipt) + the qToken.
//   - marketSpendHash  0fd1b854… : a sibling thin spend validator (same forwarding
//     body as the loan one, embeds the same central hash 9cae3d41…). Kept as a
//     known Liqwid script for hash-detection only.
//   - actionScriptHash fa3603d2… : the batcher / action-queue validator
//     (address addr1w8arvq7j9…). Its redeemer is the action
//     enum (tags 0–5, see datums.ts). Embeds the state-token policy 34293de1…,
//     the V2 validator 5785b71b…, and the LQ gov-token policy da8c3085…("LQ").
//   - stateTokenPolicy 34293de1… : the market state-thread NFT (asset name "").
//     These sit at addr1wyn2aflq8ff… (script hash 26aea7e0…), each on a UTxO
//     whose inline datum is the 8-field MarketState List. This is the
//     authoritative way to find a market-state UTxO.
//
// Source addresses (computed from the hashes, mainnet enterprise header 0x71):
//   loan      71391f18 -> addr1w9cnj8cclvf3729zxra87wmvvzv7g3mq9v4a9h6aq3k9axgfq4hx9
//   action    fa3603d2 -> addr1w8arvq7j9qlrmt0wpdvpp7h4jr4fmfk8l653p9t907v2nsss7w7r4
//   state hub 26aea7e0 -> addr1wyn2aflq8ff7xaxpmqk9vz53ks28hz256tkyaj739rsvrrq3u5ft3

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const LIQWID = {
  // "Loan"/position spend validator (role: position).
  loanScriptHash: "71391f18fb131f28a230fa7f3b6c6099e447602b2bd2df5d046c5e99",

  // Sibling thin spend validator (role: market). Same forwarding body as loan.
  // Detect-only.
  marketSpendHash: "0fd1b854729d2e29290d47fe2173319aae3c4c885a955dc203f72759",

  // Batcher / action-queue validator (role: action). Holds the action redeemer.
  actionScriptHash: "fa3603d2283e3dadee0b5810faf590ea9da6c7fea91095657f98a9c2",

  // Script hash of the address holding the 8-field MarketState datums (role:
  // market). Each state UTxO is marked by the state-token NFT below.
  stateHubScriptHash: "26aea7e03a53e374c1d82c560a91b4147b8954d2ec4ecbd128e0c18c",

  // Market state-thread NFT minting policy (asset name = empty). One token per
  // market state UTxO; the canonical anchor for the "market" role.
  stateTokenPolicy: "34293de1784ad1dec6f8c975e220c5dab93e636c8d877f99d89c42ce",

  // Loan-NFT minting policy. Each loan/position UTxO carries one (name "00" =
  // supply position receipt, "01" = borrow position receipt).
  loanNftPolicy: "ee944b56bab503197bdfb929509a177c3ef9e5083ca7e65ffa1469c8",

  // qADA interest-bearing receipt token policy (one qToken policy per market).
  qAdaPolicy: "a04ce7a52545e5e33c2867e148898d9e667a69602285f6a1298f9d68",

  // LQ governance token policy (referenced inside the action validator as a
  // fee/reward asset; asset name "LQ").
  lqGovPolicy: "da8c30857834c6ae7203935b89278c532b3995245295456f993e1d24",
} as const;

export function matchLiqwidScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = hash.toLowerCase();
  if (lower === LIQWID.loanScriptHash) return "position";
  if (lower === LIQWID.stateHubScriptHash) return "market";
  if (lower === LIQWID.marketSpendHash) return "market";
  if (lower === LIQWID.actionScriptHash) return "action";
  return null;
}

// Identify Liqwid roles by minting policy. The state-token policy marks a
// market-state UTxO; the loan-NFT policy marks a position UTxO; the qADA policy
// marks a qToken receipt. Asset names are not required to gate (policy is enough),
// so `assetNames` is accepted only for future per-market refinement.
export function matchLiqwidNftPolicy(
  policyId: string,
  _assetNames: string[],
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  const lower = policyId.toLowerCase();
  if (lower === LIQWID.stateTokenPolicy) return "market";
  if (lower === LIQWID.loanNftPolicy) return "position";
  if (lower === LIQWID.qAdaPolicy) return "qtoken";
  return null;
}
