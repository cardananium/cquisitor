import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyLiqwidRedeemer,
  parseLiqwidAction,
  parseLiqwidMarket,
  parseLiqwidPosition,
  parseLiqwidRaw,
} from "./datums";
import { LIQWID, matchLiqwidNftPolicy, matchLiqwidScriptHash } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });
const M = (...entries: [PD, PD][]): PD => ({ map: entries.map(([k, v]) => ({ k, v })) });

const NAME = "71414441"; // "qADA"
const PKH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";

// Real mainnet loan datum (loan validator 71391f18, utxo 0).
const REAL_POSITION: PD = L(
  B("bd628baabcb0223c8b91831a75287cd1aaccc3b60b428db510ccd1f3"),
  I(200000000),
  I(0),
  I(160000),
  I(BigInt("16788430504338670")),
);

// Real mainnet market-state datum (state-token 34293de1, utxo 0).
const REAL_MARKET: PD = L(
  I(3),
  M([I(0), M()], [I(1), M()]),
  I(3),
  L(C(0, B("e99463eb4f8ad9ed9c1c391979c77253e81a5b0cb7fdd6af6775dcb5"))),
  L(I(18250000000), I(30000000), I(3650000000), I(30000000), I(30000000)),
  M([I(0), I(0)], [I(1), I(681461249)]),
  L(I(43200000), I(172800000), I(43200000), I(86400000), I(1800000), I(10800000)),
  I(1682598557500),
);

describe("parseLiqwidPosition — 5-field loan List", () => {
  test("decodes the real ADA loan datum", () => {
    const p = parseLiqwidPosition(REAL_POSITION);
    expect(p.role).toBe("position");
    expect(p.owner).toBe("bd628baabcb0223c8b91831a75287cd1aaccc3b60b428db510ccd1f3");
    expect(p.principal).toBe(BigInt("200000000"));
    expect(p.interest).toBe(BigInt("0"));
    expect(p.minInterest).toBe(BigInt("160000"));
    expect(p.interestIndex).toBe(BigInt("16788430504338670"));
  });
  test("rejects a Constr (real datum is a top-level List)", () => {
    expect(() => parseLiqwidPosition(C(0, B(PKH)))).toThrow();
  });
  test("rejects a wrong field count", () => {
    expect(() => parseLiqwidPosition(L(B(PKH), I(1)))).toThrow();
  });
});

describe("parseLiqwidMarket — 8-field state List", () => {
  test("decodes the real market-state datum", () => {
    const m = parseLiqwidMarket(REAL_MARKET);
    expect(m.role).toBe("market");
    expect(m.epoch).toBe(BigInt("3"));
    expect(m.mode).toBe(BigInt("3"));
    expect(m.actionQueueKeys).toEqual([0, 1]);
    expect(m.admins).toEqual(["e99463eb4f8ad9ed9c1c391979c77253e81a5b0cb7fdd6af6775dcb5"]);
    expect(m.interestRateModel).toEqual([
      BigInt("18250000000"), BigInt("30000000"), BigInt("3650000000"), BigInt("30000000"), BigInt("30000000"),
    ]);
    expect(m.accumulators).toEqual([
      { actionId: BigInt("0"), amount: BigInt("0") },
      { actionId: BigInt("1"), amount: BigInt("681461249") },
    ]);
    expect(m.timingParams[4]).toBe(BigInt("1800000"));
    expect(m.lastUpdate).toBe(BigInt("1682598557500"));
  });
});

describe("parseLiqwidAction — redeemer enum", () => {
  test("tag 0 = Supply/Deposit with amount", () => {
    const a = parseLiqwidAction(C(0, I(5_000_000)));
    expect(a?.action).toBe("Supply/Deposit");
    expect(a?.amount).toBe(BigInt("5000000"));
  });
  test("tag 1 = Demand/Withdraw request", () => {
    expect(parseLiqwidAction(C(1))?.action).toBe("Demand/Withdraw (request)");
  });
  test("tag 4 = owner action with sub-tag + 28-byte hash", () => {
    const a = parseLiqwidAction(C(4, C(1, B(PKH))));
    expect(a?.action).toBe("OwnerAction");
    expect(a?.ownerSubTag).toBe(1);
    expect(a?.owner).toBe(PKH);
  });
  test("tag 5 = Finalize", () => {
    expect(parseLiqwidAction(C(5))?.action).toBe("Finalize");
  });
  test("classify surfaces amount / owner", () => {
    expect(classifyLiqwidRedeemer(C(0, I(7)), "action")).toBe("Supply/Deposit (amount 7)");
    expect(classifyLiqwidRedeemer(C(3), "action")).toBe("ProcessDemandBatch/Liquidate");
  });
});

describe("parseLiqwidRaw — structural fallback", () => {
  test("a List datum reports null constructor + field count", () => {
    const raw = parseLiqwidRaw(L(I(1), I(2), I(3)), "action");
    expect(raw.constructorTag).toBeNull();
    expect(raw.fieldCount).toBe(3);
  });
});

describe("Liqwid matching — mainnet only", () => {
  test("loan validator hash → position", () => {
    expect(matchLiqwidScriptHash(LIQWID.loanScriptHash, "mainnet")).toBe("position");
  });
  test("state-hub + market-spend hashes → market", () => {
    expect(matchLiqwidScriptHash(LIQWID.stateHubScriptHash, "mainnet")).toBe("market");
    expect(matchLiqwidScriptHash(LIQWID.marketSpendHash, "mainnet")).toBe("market");
  });
  test("action validator hash → action", () => {
    expect(matchLiqwidScriptHash(LIQWID.actionScriptHash, "mainnet")).toBe("action");
  });
  test("state-token policy → market, loan-NFT → position, qADA → qtoken", () => {
    expect(matchLiqwidNftPolicy(LIQWID.stateTokenPolicy, [], "mainnet")).toBe("market");
    expect(matchLiqwidNftPolicy(LIQWID.loanNftPolicy, ["00"], "mainnet")).toBe("position");
    expect(matchLiqwidNftPolicy(LIQWID.qAdaPolicy, [NAME], "mainnet")).toBe("qtoken");
  });
  test("non-mainnet networks return null", () => {
    expect(matchLiqwidScriptHash(LIQWID.actionScriptHash, "preprod")).toBeNull();
    expect(matchLiqwidNftPolicy(LIQWID.qAdaPolicy, [], "preview")).toBeNull();
  });
  test("unknown hash → null", () => {
    expect(matchLiqwidScriptHash(PKH, "mainnet")).toBeNull();
  });
});
