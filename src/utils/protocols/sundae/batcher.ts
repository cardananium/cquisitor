// SundaeSwap V3 settles orders through a withdraw-zero "scooper" staking
// validator: the order spends are trivial and defer the batch validation to a
// single 0-amount withdrawal. Sundae OUTPUTS are decoded by detectSundaeOutput
// (not the DEX registry), so this adapter intentionally matches ONLY the batcher
// withdrawal — it has no matchScriptHash/matchNftPolicy and never claims an
// output, it just lets the WithdrawalCard label the scooper.

import { registerDexAdapter } from "@/utils/protocols/dex/registry";
import type { CardanoNetwork } from "@/components/TransactionCardView/types";

registerDexAdapter({
  id: "sundae-v3-batcher",
  label: "SundaeSwap",
  matchWithdrawalHash: (stakeHash: string, network?: CardanoNetwork): string | null => {
    if (network && network !== "mainnet") return null;
    return stakeHash === "99e5aacf401fed0eb0e2993d72d423947f42342e8f848353d03efe61"
      ? "scooper (batch validator)"
      : null;
  },
});
