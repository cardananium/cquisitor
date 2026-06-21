import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyBatchOrderRedeemer,
  classifyOrderBookRedeemer,
  classifyOrderBookV2Redeemer,
  classifyPoolRedeemer,
  parseBatchOrderDatum,
  parseMuesliOrderBookV2Datum,
  parseOrderBookDatum,
  parseOrderStep,
  parsePoolDatum,
  parsePoolRedeemer,
} from "./muesliswap";
import {
  MUESLISWAP,
  matchMuesliSwapNftPolicy,
  matchMuesliSwapScriptHash,
} from "./constants";
import { batchOrderToView, orderBookToView, orderBookV2ToView, poolToView } from "./index";
import type { DexRow } from "@/utils/protocols/dex/registry";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const SCRIPT = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const STAKE = "11112222333344445555666677778888999900001111222233334444";
const POLICY = "22223333444455556666777788889999000011112222333344445555";
const TOKEN = "4d7565736c69";
const NFT_NAME = "706f6f6c4e6674";

// Asset = Constr 0 [policy, name]; ADA = ("", "").
const ada: PD = C(0, B(""), B(""));
const token: PD = C(0, B(POLICY), B(TOKEN));
// Address = Constr 0 [ Credential, Maybe Staking ].
// Credential VKey = Constr 0 [pkh]; Just staking = Constr 0 [ StakingHash(Cred) ].
const addr: PD = C(0, C(0, B(PKH)), C(0, C(0, C(0, B(STAKE)))));
const addrNoStake: PD = C(0, C(1, B(SCRIPT)), C(1)); // Script cred, Nothing

// --- SURFACE A: order-book -------------------------------------------------

describe("parseOrderBookDatum", () => {
  test("unwraps OrderDatum -> Order [creator, buyCurrency, buyToken, buyAmount]", () => {
    const datum: PD = C(0, C(0, B(PKH), B(POLICY), B(TOKEN), I(1_500_000)));
    const o = parseOrderBookDatum(datum);
    expect(o.surface).toBe("order-book");
    expect(o.creator).toBe(PKH);
    expect(o.buyCurrency).toBe(POLICY);
    expect(o.buyToken).toBe(TOKEN);
    expect(o.buyAmount).toBe(BigInt(1_500_000));
    expect(o.extraFields).toEqual([]);
  });

  test("ADA buy side has empty currency/token", () => {
    const datum: PD = C(0, C(0, B(PKH), B(""), B(""), I(42)));
    const o = parseOrderBookDatum(datum);
    expect(o.buyCurrency).toBe("");
    expect(o.buyToken).toBe("");
  });

  test("preserves extra production fields as raw passthrough", () => {
    const datum: PD = C(0, C(0, B(PKH), B(""), B(""), I(7), I(99), B("ab")));
    const o = parseOrderBookDatum(datum);
    expect(o.buyAmount).toBe(BigInt(7));
    expect(o.extraFields.length).toBe(2);
  });

  test("rejects wrong outer ctor", () => {
    expect(() => parseOrderBookDatum(C(1, C(0, B(PKH), B(""), B(""), I(1))))).toThrow();
  });
});

describe("classifyOrderBookRedeemer", () => {
  test("Constr0 = CancelOrder, Constr1 = FullMatch", () => {
    expect(classifyOrderBookRedeemer(C(0))).toBe("CancelOrder");
    expect(classifyOrderBookRedeemer(C(1))).toBe("FullMatch");
    expect(classifyOrderBookRedeemer(C(0, I(1)))).toBeNull(); // has field
    expect(classifyOrderBookRedeemer(C(2))).toBeNull();
  });
});

// --- SURFACE A2: order-book V2 production -----------------------------------

// Inner 8-field Order record, wrapped twice (Constr 0 [ Constr 0 [ … ] ]).
describe("parseMuesliOrderBookV2Datum", () => {
  // Real datum de5a55…: buy ADA, sell OPT (1ddcb9c9…), allowPartial=true.
  const liveDe5a55: PD = C(
    0,
    C(
      0,
      addr, // [0] creator Address
      B(""), // [1] buyCurrency = ADA
      B(""), // [2] buyToken
      B("1ddcb9c9de95361565392c5bdff64767492d61a96166cb16094e54be"), // [3] sellCurrency
      B("4f5054"), // [4] sellToken = "OPT"
      I(499_050_000), // [5] buyAmount
      C(1), // [6] allowPartial = true
      I(2_650_000), // [7] lovelaceAttached
    ),
  );

  test("decodes the 8-field inner order (buy ADA, sell token, partial=true)", () => {
    const o = parseMuesliOrderBookV2Datum(liveDe5a55);
    expect(o.surface).toBe("order-book-v2");
    expect(o.creator.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(o.buyCurrency).toBe("");
    expect(o.buyToken).toBe("");
    expect(o.sellCurrency).toBe("1ddcb9c9de95361565392c5bdff64767492d61a96166cb16094e54be");
    expect(o.sellToken).toBe("4f5054");
    expect(o.buyAmount).toBe(BigInt(499_050_000));
    expect(o.allowPartial).toBe(true);
    expect(o.lovelaceAttached).toBe(BigInt(2_650_000));
  });

  test("allowPartial=false uses Constr 0 in field [6]", () => {
    const datum: PD = C(
      0,
      C(0, addr, B(""), B(""), B(POLICY), B(TOKEN), I(47_179_707), C(0), I(2_650_000)),
    );
    const o = parseMuesliOrderBookV2Datum(datum);
    expect(o.allowPartial).toBe(false);
    expect(o.buyAmount).toBe(BigInt(47_179_707));
  });

  test("buy-token side: buyCurrency/buyToken non-empty, sell ADA", () => {
    const datum: PD = C(
      0,
      C(0, addrNoStake, B(POLICY), B(TOKEN), B(""), B(""), I(1_021_057_929), C(1), I(2_650_000)),
    );
    const o = parseMuesliOrderBookV2Datum(datum);
    expect(o.buyCurrency).toBe(POLICY);
    expect(o.buyToken).toBe(TOKEN);
    expect(o.sellCurrency).toBe("");
    expect(o.creator.stakeCredential).toBeNull();
  });

  test("rejects wrong inner field count (V1 4-field shape)", () => {
    expect(() =>
      parseMuesliOrderBookV2Datum(C(0, C(0, B(PKH), B(""), B(""), I(1)))),
    ).toThrow();
  });

  test("rejects wrong outer ctor", () => {
    expect(() =>
      parseMuesliOrderBookV2Datum(
        C(1, C(0, addr, B(""), B(""), B(""), B(""), I(1), C(0), I(1))),
      ),
    ).toThrow();
  });
});

describe("classifyOrderBookV2Redeemer", () => {
  // Matchmaker fills spend with Constr 0 [] (Match); the V2 index mapping is
  // the OPPOSITE of the V1 order-book.
  test("Constr0 = Match (live matchmaker), Constr1 = CancelOrder", () => {
    expect(classifyOrderBookV2Redeemer(C(0))).toBe("Match");
    expect(classifyOrderBookV2Redeemer(C(1))).toBe("CancelOrder");
    expect(classifyOrderBookV2Redeemer(C(0, I(1)))).toBeNull();
    expect(classifyOrderBookV2Redeemer(C(2))).toBeNull();
  });
});

// --- SURFACE B1: pool ------------------------------------------------------

describe("parsePoolDatum", () => {
  test("[coinA, coinB, totalLiquidity, swapFee]", () => {
    const datum: PD = C(0, ada, token, I(5_000_000), I(30));
    const p = parsePoolDatum(datum);
    expect(p.surface).toBe("pool");
    expect(p.coinA).toEqual({ policyId: "", assetName: "" });
    expect(p.coinB).toEqual({ policyId: POLICY, assetName: TOKEN });
    expect(p.totalLiquidity).toBe(BigInt(5_000_000));
    expect(p.swapFee).toBe(BigInt(30));
    expect(p.clp).toBeUndefined();
  });

  test("CLP (8 fields) captures the appended curve params + renders as a CLP", () => {
    const datum: PD = C(0, ada, token, I(7_923_872), I(30), C(0, I(4), I(9)), C(0, I(2), I(3)), C(0, I(1), I(3)), I(30));
    const p = parsePoolDatum(datum);
    expect(p.coinA).toEqual({ policyId: "", assetName: "" });
    expect(p.swapFee).toBe(BigInt(30));
    expect(p.clp?.params).toEqual([
      { num: BigInt(4), den: BigInt(9) },
      { num: BigInt(2), den: BigInt(3) },
      { num: BigInt(1), den: BigInt(3) },
    ]);
    expect(p.clp?.tail).toBe(BigInt(30));
    const view = poolToView(p);
    expect(view.kind).toBe("Constant liquidity pool");
    expect(view.pair).toMatchObject({ assetA: { policyId: "" }, assetB: { policyId: POLICY } });
    expect(view.rows.find((r) => r.label === "CLP param 1")?.value).toBe("4 / 9");
  });
});

describe("parsePoolRedeemer", () => {
  test("ApplyPool = Constr0 [Address, licenseIndex]", () => {
    const r = parsePoolRedeemer(C(0, addr, I(3)));
    expect(r.kind).toBe("ApplyPool");
    if (r.kind !== "ApplyPool") throw new Error("expected ApplyPool");
    expect(r.licenseIndex).toBe(BigInt(3));
    expect(r.batcherAddress.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
  });

  test("DirectSwap = Constr1 [licenseIndex]", () => {
    const r = parsePoolRedeemer(C(1, I(9)));
    expect(r.kind).toBe("DirectSwap");
    if (r.kind !== "DirectSwap") throw new Error("expected DirectSwap");
    expect(r.licenseIndex).toBe(BigInt(9));
  });

  test("classifyPoolRedeemer", () => {
    expect(classifyPoolRedeemer(C(0, addr, I(0)))).toBe("ApplyPool");
    expect(classifyPoolRedeemer(C(1, I(0)))).toBe("DirectSwap");
    expect(classifyPoolRedeemer(C(7))).toBeNull();
  });
});

// --- SURFACE B5: OrderStep -------------------------------------------------

describe("parseOrderStep", () => {
  test("Deposit = Constr0 [minLP]", () => {
    const s = parseOrderStep(C(0, I(100)));
    expect(s).toEqual({ kind: "Deposit", minimumLP: BigInt(100) });
  });

  test("Withdraw = Constr1 [minA, minB]", () => {
    const s = parseOrderStep(C(1, I(10), I(20)));
    expect(s).toEqual({ kind: "Withdraw", minimumCoinA: BigInt(10), minimumCoinB: BigInt(20) });
  });

  test("OneSideDeposit = Constr2 [AssetClass, minLP]", () => {
    const s = parseOrderStep(C(2, token, I(5)));
    expect(s.kind).toBe("OneSideDeposit");
    if (s.kind !== "OneSideDeposit") throw new Error("expected OneSideDeposit");
    expect(s.desiredCoin).toEqual({ policyId: POLICY, assetName: TOKEN });
    expect(s.minimumLP).toBe(BigInt(5));
  });

  test("rejects unknown ctor", () => {
    expect(() => parseOrderStep(C(3, I(1)))).toThrow();
  });
});

// --- SURFACE B3: batch order -----------------------------------------------

// Two on-chain layouts coexist at batchOrderHash 73ede893…: the 8-field current
// form WITH odPoolNftTokenName, and a legacy 7-field form WITHOUT it. Both end
// with the bytes script version.
describe("parseBatchOrderDatum", () => {
  // 8-field current layout.
  const build8 = (step: PD, datumHash: PD): PD =>
    C(
      0,
      addr, // odSender
      addrNoStake, // odReceiver
      datumHash, // odReceiverDatumHash (Maybe)
      step, // odStep
      I(2_000_000), // odBatcherFee
      I(2_500_000), // odOutputADA
      B(NFT_NAME), // odPoolNftTokenName
      B(MUESLISWAP.scriptVersionHex), // odScriptVersion
    );

  // 7-field legacy layout (no odPoolNftTokenName); script version is last.
  const build7 = (step: PD, datumHash: PD): PD =>
    C(
      0,
      addr, // odSender
      addrNoStake, // odReceiver
      datumHash, // odReceiverDatumHash (Maybe)
      step, // odStep
      I(2_000_000), // odBatcherFee
      I(2_500_000), // odOutputADA
      B(MUESLISWAP.scriptVersionHex), // odScriptVersion (no pool NFT before it)
    );

  test("full deposit batch order with Just receiver datum hash (8-field)", () => {
    const datumHash = C(0, B(PKH)); // Just
    const d = parseBatchOrderDatum(build8(C(0, I(777)), datumHash));
    expect(d.surface).toBe("batch-order");
    expect(d.sender.paymentCredential).toEqual({ kind: "VKey", hash: PKH });
    expect(d.receiver.paymentCredential).toEqual({ kind: "Script", hash: SCRIPT });
    expect(d.receiver.stakeCredential).toBeNull();
    expect(d.receiverDatumHash).toBe(PKH);
    expect(d.step).toEqual({ kind: "Deposit", minimumLP: BigInt(777) });
    expect(d.batcherFee).toBe(BigInt(2_000_000));
    expect(d.outputADA).toBe(BigInt(2_500_000));
    expect(d.poolNftTokenName).toBe(NFT_NAME);
    expect(d.scriptVersion).toBe(MUESLISWAP.scriptVersionHex);
  });

  test("Nothing receiver datum hash decodes to null (8-field)", () => {
    const nothing = C(1); // Nothing
    const d = parseBatchOrderDatum(build8(C(1, I(1), I(2)), nothing));
    expect(d.receiverDatumHash).toBeNull();
    expect(d.step.kind).toBe("Withdraw");
  });

  test("legacy 7-field layout: no pool NFT, script version is the last field", () => {
    const nothing = C(1); // Nothing
    const d = parseBatchOrderDatum(build7(C(0, I(431619)), nothing));
    expect(d.surface).toBe("batch-order");
    expect(d.receiverDatumHash).toBeNull();
    expect(d.step).toEqual({ kind: "Deposit", minimumLP: BigInt(431619) });
    expect(d.batcherFee).toBe(BigInt(2_000_000));
    expect(d.outputADA).toBe(BigInt(2_500_000));
    expect(d.poolNftTokenName).toBeNull();
    expect(d.scriptVersion).toBe(MUESLISWAP.scriptVersionHex);
  });

  test("rejects field counts other than 7 or 8", () => {
    const datumHash = C(1);
    // 6 fields (drop both pool NFT and script version).
    expect(() =>
      parseBatchOrderDatum(
        C(0, addr, addrNoStake, datumHash, C(0, I(1)), I(2_000_000), I(2_500_000)),
      ),
    ).toThrow();
  });
});

describe("classifyBatchOrderRedeemer", () => {
  test("Constr0 = ApplyOrder, Constr1 = CancelOrder", () => {
    expect(classifyBatchOrderRedeemer(C(0))).toBe("ApplyOrder");
    expect(classifyBatchOrderRedeemer(C(1))).toBe("CancelOrder");
    expect(classifyBatchOrderRedeemer(C(0, I(1)))).toBeNull();
  });
});

// --- view completeness: stake credentials + script version surfaced ---------

const rowValue = (rows: DexRow[], label: string): string | undefined =>
  rows.find((r) => r.label === label)?.value;

describe("orderBookV2ToView surfaces the creator stake credential", () => {
  // creator Address WITH an inline stake credential (the `addr` fixture above).
  const datum = parseMuesliOrderBookV2Datum(
    C(0, C(0, addr, B(""), B(""), B(POLICY), B(TOKEN), I(36_771_409), C(0), I(2_650_000))),
  );

  test("emits both the payment AND stake credential rows", () => {
    const { rows } = orderBookV2ToView(datum);
    expect(rowValue(rows, "Creator (key)")).toBe(PKH);
    // Previously dropped: the stake credential of the creator Address.
    expect(rowValue(rows, "Creator stake (key)")).toBe(STAKE);
  });

  test("no stake row when the creator Address has none", () => {
    const noStake = parseMuesliOrderBookV2Datum(
      C(0, C(0, addrNoStake, B(POLICY), B(TOKEN), B(""), B(""), I(1), C(1), I(2_650_000))),
    );
    const { rows } = orderBookV2ToView(noStake);
    expect(rowValue(rows, "Creator (script)")).toBe(SCRIPT);
    expect(rows.some((r) => r.label.startsWith("Creator stake"))).toBe(false);
  });
});

describe("batchOrderToView surfaces stake credentials + script version", () => {
  // odSender = `addr` (inline STAKE), odReceiver = addrNoStake (Script, none).
  const datum = parseBatchOrderDatum(
    C(
      0,
      addr,
      addrNoStake,
      C(1), // Nothing receiver datum hash
      C(1, I(9_707_460), I(39_813_592)), // Withdraw
      I(2_000_000),
      I(2_000_000),
      B(NFT_NAME),
      B(MUESLISWAP.scriptVersionHex),
    ),
  );

  test("sender stake row present, receiver stake row absent", () => {
    const { rows } = batchOrderToView(datum);
    expect(rowValue(rows, "Sender (key)")).toBe(PKH);
    // Previously dropped: the sender Address's stake credential.
    expect(rowValue(rows, "Sender stake (key)")).toBe(STAKE);
    expect(rowValue(rows, "Receiver (script)")).toBe(SCRIPT);
    expect(rows.some((r) => r.label.startsWith("Receiver stake"))).toBe(false);
  });

  test("script version field is surfaced (previously only an issue check)", () => {
    const { rows } = batchOrderToView(datum);
    expect(rowValue(rows, "Script version")).toBe("MuesliSwap_AMM");
  });
});

// --- trading pair surfaced on the genuine 2-asset trading views -------------

describe("view.pair surfaces the traded pair", () => {
  test("order-book V2 limit order: pair = (buy, sell)", () => {
    // buy ADA, sell POLICY/TOKEN.
    const datum = parseMuesliOrderBookV2Datum(
      C(0, C(0, addr, B(""), B(""), B(POLICY), B(TOKEN), I(499_050_000), C(1), I(2_650_000))),
    );
    const view = orderBookV2ToView(datum);
    expect(view.pair).toEqual({
      assetA: { policyId: "", assetName: "" }, // buy side (ADA)
      assetB: { policyId: POLICY, assetName: TOKEN }, // sell side
    });
  });

  test("AMM pool: pair = (coinA, coinB) reserves, not LP / pool NFT", () => {
    const view = poolToView(parsePoolDatum(C(0, ada, token, I(5_000_000), I(30))));
    expect(view.pair).toEqual({
      assetA: { policyId: "", assetName: "" }, // coinA (ADA)
      assetB: { policyId: POLICY, assetName: TOKEN }, // coinB
    });
  });

  test("order-book V1 (buy side only) has no pair", () => {
    // V1 datum carries only the buy asset — not a genuine 2-asset trading pair.
    const view = orderBookToView(parseOrderBookDatum(C(0, C(0, B(PKH), B(POLICY), B(TOKEN), I(7)))));
    expect(view.pair).toBeUndefined();
  });

  test("AMM batch (liquidity) order has no pair", () => {
    // Liquidity deposit/withdraw: not a swap, and the datum doesn't carry the
    // pool's two reserve assets.
    const datum = parseBatchOrderDatum(
      C(
        0,
        addr,
        addrNoStake,
        C(1),
        C(0, I(777)), // Deposit
        I(2_000_000),
        I(2_500_000),
        B(NFT_NAME),
        B(MUESLISWAP.scriptVersionHex),
      ),
    );
    expect(batchOrderToView(datum).pair).toBeUndefined();
  });
});

// --- matching --------------------------------------------------------------

describe("MuesliSwap matching", () => {
  test("script hashes map to roles, mainnet only", () => {
    expect(matchMuesliSwapScriptHash(MUESLISWAP.orderBookV11Hash, "mainnet")).toBe("order");
    expect(matchMuesliSwapScriptHash(MUESLISWAP.orderBookV1Hash, undefined)).toBe("order");
    expect(matchMuesliSwapScriptHash(MUESLISWAP.poolHash, "mainnet")).toBe("pool");
    expect(matchMuesliSwapScriptHash(MUESLISWAP.batchOrderHash, "mainnet")).toBe("pool");
    expect(matchMuesliSwapScriptHash(MUESLISWAP.orderBookV2Hash, "mainnet")).toBe(
      "orderbook-v2-order",
    );
    expect(matchMuesliSwapScriptHash(MUESLISWAP.orderBookV2Hash, "preprod")).toBeNull();
    expect(matchMuesliSwapScriptHash(MUESLISWAP.orderBookV11Hash, "preprod")).toBeNull();
    expect(matchMuesliSwapScriptHash(PKH, "mainnet")).toBeNull();
  });

  test("pool NFT policy matches pool when an asset is present", () => {
    expect(matchMuesliSwapNftPolicy(MUESLISWAP.poolNftPolicy, [NFT_NAME], "mainnet")).toBe("pool");
    expect(matchMuesliSwapNftPolicy(MUESLISWAP.poolNftPolicy, [], "mainnet")).toBeNull();
    expect(matchMuesliSwapNftPolicy(POLICY, [NFT_NAME], "mainnet")).toBeNull();
    expect(matchMuesliSwapNftPolicy(MUESLISWAP.poolNftPolicy, [NFT_NAME], "preprod")).toBeNull();
  });
});
