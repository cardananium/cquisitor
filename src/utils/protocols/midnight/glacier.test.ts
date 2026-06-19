import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { parseGlacierConfig, parseGlacierThaw } from "./glacier";
import { midnightToView, midnightClassifyRedeemer } from "./index";
import { MIDNIGHT, matchMidnightScriptHash } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint | string): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });

const AUTH = "f3b2da0f757f10b1879dd72860b936a6d0a1896bc939b088021958b2";
const POLICY = "a48deffae06711e99a7e2d721ae29ca105fc179f2404a15d9d040f42";
const T1 = "77ef73922374fd16696fc8a5664b87f0db24eed0a29ae9f10893552c";
const T2 = "9015199b65dff1a5b9e281192c0157c23ccb579311232b94fe1c037c";
const A1 = "b628fce4a3c7b00630dc9bda74f88da227f2d53435410cec53a0f2e7";
const STAKE = "ca984943d88f90318a42a47f66e4ee5248b2205bf2581ad73961bcd7";
const A2 = "5587b270ddb13f327853ae911f941f262f68107fca7f48702cdb2600";
const S1 = "870590a23a736f480ed45df14c6b0e78139c251fda4e746e59983d62";
const S2 = "870590a23a736f480ed45df14c6b0e78139c251fda4e746e59983d63";

// Address = Constr0[ paymentCredential, Option<stakeCredential> ].
const vkey = (h: string): PD => C(0, B(h));
const script = (h: string): PD => C(1, B(h));
const none = (): PD => C(1);
const someInlineVKey = (h: string): PD => C(0, C(0, vkey(h)));
const addr = (payment: PD, stake: PD): PD => C(0, payment, stake);

// A representative Glacier Drop config datum.
const configDatum: PD = C(
  0,
  script(AUTH), // [0] authority (Script credential)
  B(POLICY), // [1] authority policy hash
  addr(script(T1), none()), // [2] treasury #1
  addr(vkey(T2), none()), // [3] treasury #2
  L(
    C(0, addr(vkey(A1), someInlineVKey(STAKE)), I("533782364690000")),
    C(0, addr(script(A2), none()), I("463194414070000")),
  ), // [4] allocations
  L(B(S1), B(S2)), // [5] series
  I(8), // [6] count
);

describe("Glacier Drop config datum", () => {
  test("parses authority, treasury, allocations, series, count", () => {
    const cfg = parseGlacierConfig(configDatum);
    expect(cfg.authority).toEqual({ kind: "Script", hash: AUTH });
    expect(cfg.authorityHash).toBe(POLICY);
    expect(cfg.treasuryA.paymentCredential).toEqual({ kind: "Script", hash: T1 });
    expect(cfg.treasuryB.paymentCredential).toEqual({ kind: "VKey", hash: T2 });
    expect(cfg.allocations).toHaveLength(2);
    expect(cfg.allocations[0].amount).toBe(BigInt("533782364690000"));
    expect(cfg.allocations[0].address.paymentCredential).toEqual({ kind: "VKey", hash: A1 });
    expect(cfg.allocations[0].address.stakeCredential).toEqual({
      kind: "Inline",
      credential: { kind: "VKey", hash: STAKE },
    });
    expect(cfg.allocations[1].address.paymentCredential).toEqual({ kind: "Script", hash: A2 });
    expect(cfg.series).toEqual([S1, S2]);
    expect(cfg.count).toBe(BigInt(8));
  });

  test("rejects a datum that is not a 7-field Constr0", () => {
    expect(() => parseGlacierConfig(C(1, B(AUTH)))).toThrow();
    expect(() => parseGlacierConfig(C(0, B(AUTH)))).toThrow();
  });
});

describe("midnightToView", () => {
  test("config view shows allocations with NIGHT totals", () => {
    const v = midnightToView(configDatum, "config");
    expect(v.protocol).toBe("Midnight (NIGHT)");
    expect(v.kind).toBe("Glacier Drop config");
    const alloc = v.rows.find((r) => r.label === "Foundation wallets");
    expect(alloc?.value).toContain("2 entries");
    expect(alloc?.value).toContain("996,976,778.76 NIGHT");
    expect(v.rows.some((r) => r.label.startsWith("Foundation wallet 1"))).toBe(true);
  });

  test("config view surfaces each TGE auth key and allocation stake credentials", () => {
    const v = midnightToView(configDatum, "config");
    // tge_agent_auth_keys are listed, not just counted.
    expect(v.rows.find((r) => r.label === "TGE auth key 1")?.value).toBe(S1);
    expect(v.rows.find((r) => r.label === "TGE auth key 2")?.value).toBe(S2);
    // Foundation wallet #1 has an inline stake credential that must be surfaced.
    const alloc1Pay = v.rows.find((r) => r.label.startsWith("Foundation wallet 1") && r.label.includes("payment"));
    expect(alloc1Pay?.value).toBe(A1);
    const alloc1Stake = v.rows.find((r) => r.label.startsWith("Foundation wallet 1") && r.label.includes("stake"));
    expect(alloc1Stake?.value).toBe(STAKE);
  });

  test("distribution view is a recognizer (unit datum)", () => {
    const v = midnightToView(C(0), "distribution");
    expect(v.kind).toBe("Glacier Drop distribution");
    expect(v.rows.some((r) => r.value?.includes(MIDNIGHT.nightPolicy))).toBe(true);
  });
});

describe("Glacier Drop thaw datum", () => {
  const ROOT = "c6b2c8cf1b4ff69d0f9c9e1ba752d83aceb0b7fba050528fec4dd69edc1c2f95";
  const START = "1765324800000"; // 2025-12-10 UTC
  const INTERVAL = "7776000000"; // 90 days
  const thawBitmap = C(0, B(ROOT), I(START), I(INTERVAL), C(1, B("0380"))); // popcount 0x0380 = 3
  const thawCount = C(0, B(ROOT), I(START), I(INTERVAL), C(0, I(20)));

  // Per-user position (5-field) datum.
  const OWNER = "4d40cacf5f7ba5a92dfb09581a49e8d9e46ad2721537cb1a43c64797";
  const ownerAddr = C(0, C(0, B(OWNER)), C(1)); // payment VKey, no stake
  const thawPosition = C(0, ownerAddr, I(179404114), I("1781395200000"), I(2), I(INTERVAL));

  test("pool: parses schedule + bitmap state", () => {
    const t = parseGlacierThaw(thawBitmap);
    expect(t.variant).toBe("pool");
    if (t.variant !== "pool") return;
    expect(t.merkleRoot).toBe(ROOT);
    expect(t.thawStart).toBe(BigInt(START));
    expect(t.thawInterval).toBe(BigInt(INTERVAL));
    expect(t.state).toEqual({ kind: "bitmap", hex: "0380", setBits: 3 });
  });

  test("pool: parses count state", () => {
    const t = parseGlacierThaw(thawCount);
    if (t.variant !== "pool") throw new Error("expected pool");
    expect(t.state).toEqual({ kind: "count", value: BigInt(20) });
  });

  test("position: parses per-user 5-field datum", () => {
    const t = parseGlacierThaw(thawPosition);
    expect(t.variant).toBe("position");
    if (t.variant !== "position") return;
    expect(t.owner.paymentCredential).toEqual({ kind: "VKey", hash: OWNER });
    expect(t.amount).toBe(BigInt(179404114));
    expect(t.nextThaw).toBe(BigInt("1781395200000"));
    expect(t.tranche).toBe(BigInt(2));
    expect(t.interval).toBe(BigInt(INTERVAL));
  });

  test("rejects wrong arity", () => {
    expect(() => parseGlacierThaw(C(0, B(ROOT), I(START)))).toThrow();
  });

  test("pool view shows the documented thaw schedule", () => {
    const v = midnightToView(thawBitmap, "thaw");
    expect(v.kind).toBe("Glacier Drop thaw pool");
    expect(v.rows.find((r) => r.label === "Thaw start")?.value).toBe("2025-12-10 00:00 UTC");
    expect(v.rows.find((r) => r.label === "Thaw interval")?.value).toBe("90 days");
    expect(v.rows.find((r) => r.label === "Redeemed")?.value).toContain("3 marked");
  });

  test("position view shows owner, amount and next thaw", () => {
    const v = midnightToView(thawPosition, "thaw");
    expect(v.kind).toBe("Glacier Drop thaw position");
    expect(v.rows.find((r) => r.label.startsWith("Owner") && r.label.includes("payment"))?.value).toBe(OWNER);
    expect(v.rows.find((r) => r.label === "Amount")?.value).toBe("179.404114 NIGHT");
    expect(v.rows.find((r) => r.label === "Tranche")?.value).toBe("2");
  });

  // Per-user position with an inline stake credential on the owner address.
  const STAKE_OWNER = "9521be31c548e20ced3ea72f2ba2dc56caae65664e34d2d9cbdba544";
  const ownerAddrWithStake = C(0, C(0, B(OWNER)), C(0, C(0, C(0, B(STAKE_OWNER)))));
  const thawPositionStaked = C(0, ownerAddrWithStake, I(179404114), I("1781395200000"), I(2), I(INTERVAL));

  test("position view surfaces the owner's stake credential when present", () => {
    const v = midnightToView(thawPositionStaked, "thaw");
    expect(v.rows.find((r) => r.label.startsWith("Owner") && r.label.includes("payment"))?.value).toBe(OWNER);
    expect(v.rows.find((r) => r.label.startsWith("Owner") && r.label.includes("stake"))?.value).toBe(STAKE_OWNER);
  });
});

describe("midnightClassifyRedeemer", () => {
  test("labels the distribution spend (unit) and surfaces other ctors by index", () => {
    expect(midnightClassifyRedeemer(C(0), "distribution")).toBe("Claim / release NIGHT (unit redeemer)");
    expect(midnightClassifyRedeemer(C(3), "distribution")).toBe("Distribution action (ctor 3)");
    expect(midnightClassifyRedeemer(C(1), "thaw")).toBe("Redeem / thaw tranche (ctor 1)");
  });
  test("only classifies the distribution role", () => {
    expect(midnightClassifyRedeemer(C(0), "config")).toBeNull();
    expect(midnightClassifyRedeemer(I(1), "distribution")).toBeNull();
  });
});

describe("matchMidnightScriptHash", () => {
  test("matches the distribution + config + thaw contracts on mainnet only", () => {
    expect(matchMidnightScriptHash(MIDNIGHT.distributionHash, "mainnet")).toBe("distribution");
    expect(matchMidnightScriptHash(MIDNIGHT.configHash, "mainnet")).toBe("config");
    expect(matchMidnightScriptHash(MIDNIGHT.thawHash, "mainnet")).toBe("thaw");
    expect(matchMidnightScriptHash(MIDNIGHT.thawPositionHash, "mainnet")).toBe("thaw");
    expect(matchMidnightScriptHash(MIDNIGHT.thawHash, "preprod")).toBeNull();
    expect(matchMidnightScriptHash("deadbeef".repeat(7), "mainnet")).toBeNull();
  });
});
