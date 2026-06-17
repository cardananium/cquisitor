import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyBareTradeAction,
  classifyBondIssueAction,
  classifyProtocolParamsAction,
  parseDanogoOrder,
  parseDanogoPosition,
  parseMultiTradeAction,
  parseWithdrawAction,
  type DanogoBidLimitMulti,
  type DanogoBidMaking,
  type DanogoBondDatum,
  type DanogoRequestDatum,
} from "./danogo";
import { matchDanogoNftPolicy, matchDanogoScriptHash } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });
const M = (...entries: { k: PD; v: PD }[]): PD => ({ map: entries });
const Some = (x: PD): PD => C(0, x);
const None: PD = C(1);

const VK = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const SK = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const SC = "11112222333344445555666677778888999900001111222233334444";
const POLICY = "cde0ddc1e46f26d886eb972319bcb76418cb42c1cd8aded18a042537";
const NAME = "646e";

describe("parseDanogoOrder — AskLimit (3 fields)", () => {
  test("parses owner_vk, Some(owner_sk), requested_yield", () => {
    const o = parseDanogoOrder(C(0, B(VK), Some(B(SK)), I(750)));
    expect(o.kind).toBe("AskLimit");
    if (o.kind !== "AskLimit") throw new Error("expected AskLimit");
    expect(o.ownerVk).toBe(VK);
    expect(o.ownerSk).toBe(SK);
    expect(o.requestedYield).toBe(BigInt(750));
  });

  test("None owner_sk decodes to null", () => {
    const o = parseDanogoOrder(C(0, B(VK), None, I(500)));
    if (o.kind !== "AskLimit") throw new Error("expected AskLimit");
    expect(o.ownerSk).toBeNull();
  });
});

describe("parseDanogoOrder — AskMaking (5 fields)", () => {
  test("parses bid_sc + margin", () => {
    const o = parseDanogoOrder(C(0, B(VK), None, I(600), B(SC), I(25)));
    expect(o.kind).toBe("AskMaking");
    if (o.kind !== "AskMaking") throw new Error("expected AskMaking");
    expect(o.bidSc).toBe(SC);
    expect(o.margin).toBe(BigInt(25));
  });
});

describe("parseDanogoOrder — BidLimitMulti (7 fields)", () => {
  test("parses epoch range, quantity, bond_types enum list", () => {
    const datum = C(
      0,
      B(VK),
      Some(B(SK)),
      I(500), // from_epoch
      I(520), // to_epoch
      I(1_000_000), // quantity
      I(700), // requested_yield
      L(C(0), C(1)), // [DanogoBond, OptimBond]
    );
    const o = parseDanogoOrder(datum) as DanogoBidLimitMulti;
    expect(o.kind).toBe("BidLimitMulti");
    expect(o.fromEpoch).toBe(BigInt(500));
    expect(o.toEpoch).toBe(BigInt(520));
    expect(o.quantity).toBe(BigInt(1_000_000));
    expect(o.bondTypes).toEqual(["DanogoBond", "OptimBond"]);
  });
});

describe("parseDanogoOrder — BidMaking (8 fields)", () => {
  test("parses ask_sc + margin", () => {
    const datum = C(
      0,
      B(VK),
      None,
      I(500),
      I(520),
      I(2_000_000),
      I(650),
      B(SC),
      I(30),
    );
    const o = parseDanogoOrder(datum) as DanogoBidMaking;
    expect(o.kind).toBe("BidMaking");
    expect(o.askSc).toBe(SC);
    expect(o.margin).toBe(BigInt(30));
  });

  test("rejects unknown ctor and arity", () => {
    expect(() => parseDanogoOrder(C(1, B(VK)))).toThrow();
    expect(() => parseDanogoOrder(C(0, B(VK), None))).toThrow();
  });
});

describe("classifyBareTradeAction", () => {
  test("nullary variants by ctor index", () => {
    expect(classifyBareTradeAction(C(0))).toBe("Update");
    expect(classifyBareTradeAction(C(1))).toBe("Buy");
    expect(classifyBareTradeAction(C(2))).toBe("Sell");
    expect(classifyBareTradeAction(C(3))).toBe("Upgrade");
    expect(classifyBareTradeAction(C(4))).toBe("GarbageCollector");
    expect(classifyBareTradeAction(C(5))).toBeNull();
    expect(classifyBareTradeAction(C(2, I(1)))).toBeNull(); // has field → not bare
  });
});

describe("parseMultiTradeAction", () => {
  test("Sell carries fees, offers, cont_idx", () => {
    const r = parseMultiTradeAction(
      C(
        2,
        I(2_000_000), // exchange_fee
        I(98_000_000), // seller_receive
        L(L(B(POLICY), B(NAME), I(5))), // offers
        Some(I(3)), // cont_idx
      ),
    );
    expect(r.kind).toBe("Sell");
    if (r.kind !== "Sell") throw new Error("expected Sell");
    expect(r.exchangeFee).toBe(BigInt(2_000_000));
    expect(r.sellerReceive).toBe(BigInt(98_000_000));
    expect(r.offers).toEqual([{ policyId: POLICY, assetName: NAME, quantity: BigInt(5) }]);
    expect(r.contIdx).toBe(BigInt(3));
  });

  test("nullary Update/Buy/Upgrade/GarbageCollector", () => {
    expect(parseMultiTradeAction(C(0)).kind).toBe("Update");
    expect(parseMultiTradeAction(C(1)).kind).toBe("Buy");
    expect(parseMultiTradeAction(C(3)).kind).toBe("Upgrade");
    expect(parseMultiTradeAction(C(4)).kind).toBe("GarbageCollector");
  });
});

describe("parseWithdrawAction", () => {
  test("SellMulti carries bid_skh", () => {
    const r = parseWithdrawAction(C(0, B(SC)));
    expect(r.kind).toBe("SellMulti");
    expect(r.bidSkh).toBe(SC);
  });
});

describe("parseDanogoPosition — RequestDatum (10 fields)", () => {
  test("parses all borrow-request fields in order", () => {
    const datum = C(
      0,
      I(1500), // apr
      I(86_400), // duration
      B(POLICY), // symbol
      B(NAME), // borrower
      I(100_000_000), // requested
      I(0), // issued
      I(50_000), // epo_rewards
      I(1_000_000), // prepaid
      I(2_000_000), // buffer
      I(500_000), // fee
    );
    const p = parseDanogoPosition(datum) as DanogoRequestDatum;
    expect(p.kind).toBe("RequestDatum");
    expect(p.apr).toBe(BigInt(1500));
    expect(p.symbol).toBe(POLICY);
    expect(p.borrower).toBe(NAME);
    expect(p.requested).toBe(BigInt(100_000_000));
    expect(p.fee).toBe(BigInt(500_000));
  });
});

describe("parseDanogoPosition — BondDatum (9 fields, PValue at idx 0)", () => {
  test("parses PValue epo_rewards (List-of-tuples fallback) + bond fields", () => {
    const pvalue = L(L(B(POLICY), L(L(B(NAME), I(7)))));
    const datum = C(
      0,
      pvalue, // epo_rewards
      I(86_400), // duration
      B(POLICY), // bond_symbol
      B(NAME), // token_name
      I(1_000), // bond_amount
      I(2_000_000), // buffer
      I(500_000), // fee
      B(NAME), // borrower
      I(123_456), // start
    );
    const p = parseDanogoPosition(datum) as DanogoBondDatum;
    expect(p.kind).toBe("BondDatum");
    expect(p.epoRewards).toEqual([
      { policyId: POLICY, assets: [{ assetName: NAME, quantity: BigInt(7) }] },
    ]);
    expect(p.bondSymbol).toBe(POLICY);
    expect(p.bondAmount).toBe(BigInt(1_000));
    expect(p.start).toBe(BigInt(123_456));
  });

  // Real on-chain shape: PValue is a PlutusData Map, with ada keyed
  // under empty-bytes policy/name.
  test("parses real on-chain BondDatum with Map-encoded epo_rewards", () => {
    const BOND = "53fb41609e208f1cd3cae467c0b9abfc69f1a552bf9a90d51665a4d6";
    const TOKEN = "97b2efcc14587d6bd648252b17108ba3cb628273fa45080572d920df1f53e934";
    const BORROWER = "e7e620338c24165d8496444f91b949f45372d9f60dc8a79bbbdd063c";
    const datum = C(
      0,
      M({ k: B(""), v: M({ k: B(""), v: I(753_424_657) }) }), // epo_rewards (ada)
      I(72), // duration
      B(BOND), // bond_symbol
      B(TOKEN), // token_name
      I(10_000), // bond_amount
      I(6), // buffer
      I(300), // fee
      B(BORROWER), // borrower
      I(63), // start
    );
    const p = parseDanogoPosition(datum) as DanogoBondDatum;
    expect(p.kind).toBe("BondDatum");
    expect(p.epoRewards).toEqual([
      { policyId: "", assets: [{ assetName: "", quantity: BigInt(753_424_657) }] },
    ]);
    expect(p.bondSymbol).toBe(BOND);
    expect(p.tokenName).toBe(TOKEN);
    expect(p.bondAmount).toBe(BigInt(10_000));
    expect(p.buffer).toBe(BigInt(6));
    expect(p.fee).toBe(BigInt(300));
    expect(p.borrower).toBe(BORROWER);
    expect(p.start).toBe(BigInt(63));
  });

  // Second real on-chain datum from the position validator
  // 1d2390bab44f6267c0145456dc2f5f8ea2586fcb0aadac5525d9a406 (one of its
  // BondDatum UTxOs), datum hash 5ee9e2d3….
  test("decodes the live BondDatum at the 1d2390ba… position validator", () => {
    const datum = C(
      0,
      M({ k: B(""), v: M({ k: B(""), v: I(753_424_657) }) }), // epo_rewards (ada)
      I(72), // duration
      B("53fb41609e208f1cd3cae467c0b9abfc69f1a552bf9a90d51665a4d6"), // bond_symbol
      B("97b2efcc14587d6bd648252b17108ba3cb628273fa45080572d920df1f53e934"), // token_name
      I(3), // bond_amount
      I(6), // buffer
      I(300), // fee
      B("e7e620338c24165d8496444f91b949f45372d9f60dc8a79bbbdd063c"), // borrower
      I(63), // start
    );
    const p = parseDanogoPosition(datum) as DanogoBondDatum;
    expect(p.kind).toBe("BondDatum");
    expect(p.epoRewards).toEqual([
      { policyId: "", assets: [{ assetName: "", quantity: BigInt(753_424_657) }] },
    ]);
    expect(p.bondSymbol).toBe("53fb41609e208f1cd3cae467c0b9abfc69f1a552bf9a90d51665a4d6");
    expect(p.bondAmount).toBe(BigInt(3));
    expect(p.start).toBe(BigInt(63));
  });
});

describe("bond-issue redeemers", () => {
  test("BondIssueAction by ctor index", () => {
    expect(classifyBondIssueAction(C(0))).toBe("RequestCreate");
    expect(classifyBondIssueAction(C(2))).toBe("BondCreate");
    expect(classifyBondIssueAction(C(7))).toBe("RedeemForce");
    expect(classifyBondIssueAction(C(8))).toBeNull();
  });

  test("ProtocolParamsAction Mint/Burn", () => {
    expect(classifyProtocolParamsAction(C(0))).toBe("MintProtocol");
    expect(classifyProtocolParamsAction(C(1))).toBe("BurnProtocol");
    expect(classifyProtocolParamsAction(C(2))).toBeNull();
  });
});

describe("Danogo matching (on-chain verified position + order)", () => {
  // THE position validator holding BondDatum UTxOs on mainnet.
  const POSITION_HASH = "1d2390bab44f6267c0145456dc2f5f8ea2586fcb0aadac5525d9a406";
  // Governing/parent validator (embeds the position validator as a param).
  const GOVERNING_HASH = "52c3116ed9dac7f6eb898f83657b8af954d7d6e81a834f243ef9abc8";
  const BOND_POLICY = "53fb41609e208f1cd3cae467c0b9abfc69f1a552bf9a90d51665a4d6";
  const BOND_ID = "97b2efcc14587d6bd648252b17108ba3cb628273fa45080572d920df1f53e934";

  test("bond-issue position validator hash matches role 'position' on mainnet", () => {
    expect(matchDanogoScriptHash(POSITION_HASH, "mainnet")).toBe("position");
    expect(matchDanogoScriptHash(POSITION_HASH.toUpperCase(), "mainnet")).toBe("position");
  });

  test("bond-issue governing validator hash matches role 'position' on mainnet", () => {
    expect(matchDanogoScriptHash(GOVERNING_HASH, "mainnet")).toBe("position");
    expect(matchDanogoScriptHash(GOVERNING_HASH.toUpperCase(), "mainnet")).toBe("position");
  });

  test("DanogoBond token policy matches role 'position' on mainnet", () => {
    // asset name is a per-bond id; we match on policy alone (no fixed name).
    expect(matchDanogoNftPolicy(BOND_POLICY, [BOND_ID], "mainnet")).toBe("position");
    expect(matchDanogoNftPolicy(BOND_POLICY, [], "mainnet")).toBe("position");
  });

  test("verified hashes/policies are mainnet-only", () => {
    expect(matchDanogoScriptHash(POSITION_HASH, "preprod")).toBeNull();
    expect(matchDanogoNftPolicy(BOND_POLICY, [BOND_ID], "preview")).toBeNull();
  });

  // bond-dex order validators: making_ask 1adf21d5… (AskMaking 5-field) ↔
  // making_bid c9f72aa6… (BidMaking 8-field) cross-reference each other;
  // d156b23f… is a limit_ask (AskLimit 3-field) instance.
  const MAKING_ASK_HASH = "1adf21d53a99c21d63c69758fcbb882795a90ff99c9254a33bf04a1a";
  const MAKING_BID_HASH = "c9f72aa64eab2ad96f4becbf739233212a4acabba7643212cd6182e2";
  const LIMIT_ASK_HASH = "d156b23f34ad66a506a40003ef4008be65dcdd424f41834c5677c2ba";

  test("bond-dex order validator hashes match role 'order' on mainnet", () => {
    expect(matchDanogoScriptHash(MAKING_ASK_HASH, "mainnet")).toBe("order");
    expect(matchDanogoScriptHash(MAKING_BID_HASH, "mainnet")).toBe("order");
    expect(matchDanogoScriptHash(LIMIT_ASK_HASH, "mainnet")).toBe("order");
    expect(matchDanogoScriptHash(LIMIT_ASK_HASH.toUpperCase(), "mainnet")).toBe("order");
  });

  test("order validator hashes are mainnet-only", () => {
    expect(matchDanogoScriptHash(MAKING_ASK_HASH, "preprod")).toBeNull();
    expect(matchDanogoScriptHash(LIMIT_ASK_HASH, "preview")).toBeNull();
  });

  test("unrelated hashes stay null; non-mainnet null", () => {
    expect(matchDanogoScriptHash(VK, "mainnet")).toBeNull(); // not an order hash
    expect(matchDanogoScriptHash(VK, "preprod")).toBeNull();
    expect(matchDanogoNftPolicy(POLICY, [NAME], "mainnet")).toBeNull();
    expect(matchDanogoNftPolicy(POLICY, [NAME], "preview")).toBeNull();
  });
});
