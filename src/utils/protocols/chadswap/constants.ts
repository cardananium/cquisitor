// Known ChadSwap (chadswap.com) mainnet script hash.
//
// ChadSwap is a TRUSTLESS P2P OTC MARKETPLACE for ADA + Cardano native assets
// (mainnet launch 2025-04-23, built with the Anvil API + a custom Aiken
// validator — NOT an aggregator/router). A maker locks the offered asset at a
// single PlutusV3 escrow validator with a datum naming the OTHER side of the
// pair (the non-ADA token), the direction (sell-token-for-ADA / buy-token-with-
// ADA), a per-unit price and the order's total/filled quantity. A taker tx
// directly spends the order (TAKE), or the maker cancels/updates it — every
// lifecycle tx carries a `674` metadata msg ("[NEW ORDER]" / "[TAKE ORDER]" /
// "[UPDATE ORDER]" / "[CANCEL ORDER]").
//
// Verified escrow hash: 2f201c28150a7a177645ddd8b519e280f2c64d393078e2ff7a26e847
//   - Source: ChadSwap's OWN widget bundle (widget.chadswap.com /assets/
//     index-CESGVwOG.js) hard-codes `scriptHash:"2f201c28…"`.
//   - Live on mainnet: plutusV3, size 4762 (real validator, NOT timelock/null),
//     a `spend`-only validator
//     whose datum is `Constr0[ Constr0[ Address, Bool, policy, name, price,
//     Constr0[int], Maybe, Maybe(expiry) ], Constr0[total, filled], Maybe,
//     Maybe ]` — matching the field positions the validator reads
//     (fields[0].fields[4]=price, fields[1].fields[0..1]=total/filled,
//     fields[0].fields[7]=deadline vs tx valid range).
//   - Real OTC orders observed at addr1wyhjq8pgz59859mkghwa3dgeu2q093jd8yc83chl0gnws3c66l8sz
//     (enterprise address = this script, no stake part) with `674`
//     "[NEW ORDER]" / "[TAKE ORDER]" / "[CANCEL ORDER]" / "[UPDATE ORDER]"
//     metadata.
//   - Collision-free: `grep -rl 2f201c28… src/utils/protocols/` returns no
//     OTHER protocol's files (the previous pass wrongly used Minswap's
//     ea07b733/f5808c2c and Minswap's e1317b15/a65ca58a for ChadSwap — those are
//     Minswap; rejected here).
//
// Orders use a datum HASH (not an inline datum); the witness set carries the
// datum, so a UTxO at this script is matched by its 28-byte PAYMENT credential.

import type { CardanoNetwork } from "@/components/TransactionCardView/types";
import type { DexRole } from "@/utils/protocols/dex/registry";

export const CHADSWAP = {
  // OTC escrow / order validator (plutusV3, size 4762). Maker locks the offered
  // asset here; taker spends it (TAKE) or maker cancels/updates.
  orderHash: "2f201c28150a7a177645ddd8b519e280f2c64d393078e2ff7a26e847",
} as const;

export function matchChadswapScriptHash(
  hash: string,
  network: CardanoNetwork | undefined,
): DexRole | null {
  if (network && network !== "mainnet") return null;
  if (hash.toLowerCase() === CHADSWAP.orderHash) return "order";
  return null;
}
