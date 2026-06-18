import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import { jpgAskToView, jpgSwapToView } from "./index";
import { parseJpgAskDatum } from "./ask";
import { parseJpgSwapDatum } from "./swap";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...items: PD[]): PD => ({ list: items });
const M = (...entries: { k: PD; v: PD }[]): PD => ({ map: entries });

const OWNER = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const SELLER = "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeeeffffffff000000001";
const STAKE = "11112222333344445555666677778888999900001111222233334444";
const POLICY = "9abcdef09abcdef09abcdef09abcdef09abcdef09abcdef09abcdef0";
const TOKEN = "4d794e4654303031"; // "MyNFT001"

// Address = Constr0[ Credential, Maybe<StakingCredential> ].
const addrWithStake: PD = C(0, C(0, B(SELLER)), C(0, C(0, C(0, B(STAKE)))));
const addrNoStake: PD = C(0, C(0, B(SELLER)), C(1));

describe("jpgAskToView surfaces every datum field", () => {
  const datum = parseJpgAskDatum(
    C(0, L(C(0, addrWithStake, I(98_000_000)), C(0, addrNoStake, I(2_000_000))), B(OWNER)),
  );
  const view = jpgAskToView(datum);
  const find = (sub: string) => view.rows.find((r) => r.value?.includes(sub));

  test("payout address surfaces the stake credential (previously dropped)", () => {
    const row = find(STAKE);
    expect(row).toBeDefined();
    expect(row!.value).toContain(SELLER); // payment cred is still the primary hash
    expect(row!.value).toContain(`stake key ${STAKE}`);
  });

  test("owner key and per-payout payment creds are present", () => {
    expect(view.rows.some((r) => r.label.includes("Owner") && r.value === OWNER)).toBe(true);
    expect(view.rows.filter((r) => /^Payout \d/.test(r.label)).length).toBe(2);
  });
});

describe("jpgSwapToView surfaces every datum field", () => {
  // Bid: pay seller 8.75 ADA, request the NFT (POLICY, TOKEN) x1.
  const adaExpected = M({ k: B(""), v: C(0, I(0), M({ k: B(""), v: I(8_750_000) })) });
  const nftExpected = M({ k: B(POLICY), v: C(0, I(0), M({ k: B(TOKEN), v: I(1) })) });
  const datum = parseJpgSwapDatum(
    C(0, B(OWNER), L(C(0, addrWithStake, adaExpected), C(0, addrNoStake, nftExpected))),
  );
  const view = jpgSwapToView(datum);

  test("payout address surfaces the stake credential (previously dropped)", () => {
    const row = view.rows.find((r) => r.value?.includes(STAKE));
    expect(row).toBeDefined();
    expect(row!.value).toContain(`stake key ${STAKE}`);
  });

  test("ADA payout renders as a lovelace/ADA requirement, not a bare quantity", () => {
    const row = view.rows.find((r) => r.label.includes("must receive"));
    expect(row).toBeDefined();
    expect(row!.value).toContain("8.75 ADA");
    expect(row!.value).toContain("8750000 lovelace");
  });

  test("requested NFT is surfaced as a structured asset row", () => {
    const asset = view.rows.find((r) => r.asset != null)?.asset;
    expect(asset).toEqual({ policyId: POLICY, assetName: TOKEN, amount: BigInt(1) });
  });

  test("non-zero collection-floor natCount is surfaced", () => {
    const floor = parseJpgSwapDatum(
      C(0, B(OWNER), L(C(0, addrNoStake, M({ k: B(POLICY), v: C(0, I(3), M()) })))),
    );
    const v = jpgSwapToView(floor);
    expect(v.rows.some((r) => r.label.includes("min token count") && r.value === "3")).toBe(true);
    expect(v.rows.some((r) => r.label.includes("policy (any token)") && r.value === POLICY)).toBe(
      true,
    );
  });
});
