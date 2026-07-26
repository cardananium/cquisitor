import { describe, test, expect } from "bun:test";
import "@/utils/protocols/dex/adapters";
import { buildDexTxContext } from "./txContext";
import type { TransactionBody, Redeemer } from "@/components/TransactionCardView/types";
import type { KoiosUtxoInfo } from "@/utils/koiosTypes";

// Minswap V2 order validator (mainnet), as a hex enterprise address (71 = script payment cred).
const MINSWAP_V2_ORDER_ADDR = "71" + "c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c";
// WingRiders V2 withdraw-zero batcher + a key-credential stake address (never a batcher).
const WINGRIDERS_BATCHER = "stake17xt0tsd7ug6gzv6l7jhvuvh7rhap4fq2j39xd5kkahy6nfg8vjx3m";
const KEY_STAKE = "stake1uyrx65wjqjgeeksd8hptmcgl5jfyrqkfq0xe8xlp367kphsckq250";

const TX_A = "ff".repeat(32); // sorts AFTER TX_B
const TX_B = "00".repeat(32);

function utxo(address: string): KoiosUtxoInfo {
  return {
    tx_hash: "",
    tx_index: 0,
    address,
    value: "2000000",
    stake_address: null,
    payment_cred: null,
    epoch_no: 0,
    block_height: 0,
    block_time: 0,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    asset_list: null,
    is_spent: true,
  };
}

function spend(index: string, data: string): Redeemer {
  return { tag: "Spend", index, data, ex_units: { mem: "0", steps: "0" } };
}
function reward(index: string): Redeemer {
  return { tag: "Reward", index, data: '{"constructor":0,"fields":[]}', ex_units: { mem: "0", steps: "0" } };
}

describe("buildDexTxContext — redeemer notes", () => {
  // Body order: [user input (TX_A), minswap order (TX_B)]. Script-context
  // (sorted) order flips them: sorted 0 → body 1, sorted 1 → body 0.
  const body = {
    inputs: [
      { transaction_id: TX_A, index: 0 },
      { transaction_id: TX_B, index: 1 },
    ],
    withdrawals: { [WINGRIDERS_BATCHER]: "0", [KEY_STAKE]: "1000000" },
  } as unknown as TransactionBody;

  const utxoMap = new Map<string, KoiosUtxoInfo>([
    [`${TX_B}#1`, utxo(MINSWAP_V2_ORDER_ADDR)],
  ]);

  const redeemers = [
    // Targets sorted input 0 = body input 1 (the order); ctor 1 = CancelOrderByOwner.
    spend("0", '{"constructor":1,"fields":[]}'),
    // Sorted withdrawals: key-cred KEY_STAKE (0xe1…) < script WINGRIDERS (0xf1…),
    // so index 1 is the batcher.
    reward("1"),
    reward("0"),
  ];

  const ctx = buildDexTxContext(body, redeemers, "mainnet", utxoMap);

  test("annotates a Spend redeemer with its order's protocol, role and action", () => {
    expect(ctx.redeemerNotes.get(0)).toMatchObject({
      label: "Minswap",
      role: "order",
      action: "CancelOrderByOwner",
      inputIndex: 1,
    });
  });

  test("annotates a Reward redeemer via the byte-sorted withdrawal it targets", () => {
    expect(ctx.redeemerNotes.get(1)).toMatchObject({
      label: "WingRiders",
      purpose: "batch validator",
    });
  });

  test("leaves unrecognized redeemers unannotated", () => {
    // reward("0") targets the key-credential withdrawal — not a batcher.
    expect(ctx.redeemerNotes.get(2)).toBeUndefined();
  });
});

describe("buildDexTxContext — withdraw-redeemer ACTION classification", () => {
  // FluidTokens loan-action dispatcher: stake hash = loanPolicyId (hex reward
  // address, f1 = script stake cred). Redeemer:
  // Constr0[ configRefInputIndex, ActionType ], ctor 2 = ChangeCollateral.
  const FT_LOAN_DISPATCHER = "f1" + "30f1095a8a2acb68bb0ffa193e18e004b6dd3e12b5d9c2375a1d5c41";
  const body = {
    inputs: [{ transaction_id: "00".repeat(32), index: 0 }],
    withdrawals: { [FT_LOAN_DISPATCHER]: "0" },
  } as unknown as TransactionBody;

  const redeemers: Redeemer[] = [
    {
      tag: "Reward",
      index: "0",
      data: '{"constructor":0,"fields":[{"int":6},{"constructor":2,"fields":[]}]}',
      ex_units: { mem: "0", steps: "0" },
    },
  ];

  test("decodes the real action out of a FluidTokens dispatcher withdrawal", () => {
    const ctx = buildDexTxContext(body, redeemers, "mainnet", null);
    expect(ctx.redeemerNotes.get(0)).toMatchObject({
      label: "FluidTokens Loans V3",
      purpose: "loan actions",
      action: "ChangeCollateral",
    });
  });
});
