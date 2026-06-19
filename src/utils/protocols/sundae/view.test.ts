import { describe, expect, test } from "bun:test";
import type { PD } from "./plutusData";
import {
  parseV3OrderDatum,
  parseStableswapOrderDatum,
  parseV3PoolDatum,
  parseStableswapPoolDatum,
} from "./v3";
import { parseV1PoolDatum } from "./v1";
import { buildSundaeOrderView, buildSundaePoolView } from "./view";
import type { DexRow } from "@/utils/protocols/dex/registry";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint | string): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });
const L = (...xs: PD[]): PD => ({ list: xs });
const SOME = (x: PD): PD => C(0, x);
const NONE: PD = C(1);

// Helpers to assert a value/hash appears verbatim in some row.
function rowValues(rows: DexRow[]): string[] {
  return rows.flatMap((r) => [
    r.value ?? "",
    r.asset ? `${r.asset.policyId}.${r.asset.assetName}` : "",
  ]);
}
function hasValueContaining(rows: DexRow[], needle: string): boolean {
  return rowValues(rows).some((v) => v.includes(needle));
}

// ---------------------------------------------------------------------------
// V3 order datum — live shape (Swap, Fixed destination with a DatumHash and a
// non-empty extension). Covers every field index 0..5.
// ---------------------------------------------------------------------------

const POOL_IDENT = "2f36866691fa75a9aab66dec99f7cc2d297ca09e34d9ce68cde04773";
const OWNER_KEY = "aa00c1052e713ee1eff4c96bbb13c79042308236bcc45994e72e3f44";
const DEST_SCRIPT = "fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077";
const DEST_STAKE = "aa00c1052e713ee1eff4c96bbb13c79042308236bcc45994e72e3f44";
const DEST_DATUM_HASH = "6fbec089a2302324afedf8a7457e905a142e67c33eb985719b90df05f61f3796";
const OFFER_POLICY = "9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d77";
const OFFER_NAME = "53554e444145"; // SUNDAE

const v3OrderDatum: PD = C(
  0,
  SOME(B(POOL_IDENT)), // 0 pool_ident
  C(0, B(OWNER_KEY)), // 1 owner = Signature
  I(500000), // 2 max_protocol_fee
  C(
    0, // 3 destination = Fixed
    C(
      0, // Address
      C(1, B(DEST_SCRIPT)), // payment cred = Script
      SOME(C(0, C(0, B(DEST_STAKE)))) // stake = Inline(VKey)
    ),
    C(1, B(DEST_DATUM_HASH)) // datum = DatumHash
  ),
  C(
    1, // 4 details = Swap
    L(B(OFFER_POLICY), B(OFFER_NAME), I(50000000)), // offer
    L(B(""), B(""), I(944376)) // min_received (ada)
  ),
  B("d866821ad543084a80") // 5 extension (NON-empty)
);

describe("buildSundaeOrderView — V3 Swap (every field surfaced)", () => {
  const view = buildSundaeOrderView(parseV3OrderDatum(v3OrderDatum), "V3");

  test("kind + protocol", () => {
    expect(view.protocol).toBe("Sundae V3");
    expect(view.role).toBe("order");
    expect(view.kind).toBe("Swap");
  });

  test("field 0: pool_ident surfaced", () => {
    expect(hasValueContaining(view.rows, POOL_IDENT)).toBe(true);
  });
  test("field 1: owner key hash surfaced", () => {
    expect(hasValueContaining(view.rows, OWNER_KEY)).toBe(true);
  });
  test("field 2: max_protocol_fee surfaced", () => {
    expect(hasValueContaining(view.rows, "500,000")).toBe(true);
  });
  test("field 3a: destination payment (script) hash surfaced", () => {
    expect(hasValueContaining(view.rows, DEST_SCRIPT)).toBe(true);
  });
  test("field 3a: destination stake credential surfaced", () => {
    expect(hasValueContaining(view.rows, DEST_STAKE)).toBe(true);
  });
  test("field 3b: destination DATUM HASH surfaced (was truncated/dropped)", () => {
    expect(hasValueContaining(view.rows, DEST_DATUM_HASH)).toBe(true);
  });
  test("field 4: swap offer + min_received assets surfaced", () => {
    const assets = view.rows.filter((r) => r.asset);
    expect(assets.some((r) => r.asset!.policyId === OFFER_POLICY && r.asset!.assetName === OFFER_NAME)).toBe(true);
    // ada min received
    expect(assets.some((r) => r.asset!.policyId === "" && r.asset!.assetName === "")).toBe(true);
  });
  test("field 5: non-empty extension surfaced (was dropped entirely)", () => {
    expect(hasValueContaining(view.rows, "d866821ad543084a80")).toBe(true);
  });
});

// Canonical empty extension (d87980) must NOT add a noise row.
describe("buildSundaeOrderView — empty extension is omitted", () => {
  const datum: PD = C(
    0,
    NONE, // pool_ident = none
    C(0, B(OWNER_KEY)),
    I(2500000),
    C(0, C(0, C(0, B(OWNER_KEY)), NONE), C(0)), // Fixed{addr(no stake), NoDatum}
    C(1, L(B(""), B(""), I(800000000)), L(B(OFFER_POLICY), B(OFFER_NAME), I(188149612867))),
    B("d87980") // empty extension
  );
  const view = buildSundaeOrderView(parseV3OrderDatum(datum), "V3");
  test("no extension row", () => {
    expect(view.rows.some((r) => r.label.startsWith("Extension"))).toBe(false);
  });
  test("pool_ident 'none' surfaced", () => {
    expect(hasValueContaining(view.rows, "none")).toBe(true);
  });
});

// Multisig owner (AtLeast) — nested signers must each appear, not collapse to a count.
describe("buildSundaeOrderView — multisig owner expands all signers", () => {
  const S1 = "11".repeat(28);
  const S2 = "22".repeat(28);
  const S3 = "33".repeat(28);
  const datum: PD = C(
    0,
    SOME(B(POOL_IDENT)),
    C(3, I(2), L(C(0, B(S1)), C(0, B(S2)), C(6, B(S3)))), // AtLeast 2 of [sig,sig,script]
    I(500000),
    C(0, C(0, C(0, B(OWNER_KEY)), NONE), C(0)),
    C(1, L(B(""), B(""), I(1)), L(B(OFFER_POLICY), B(OFFER_NAME), I(2))),
    B("d87980")
  );
  const view = buildSundaeOrderView(parseV3OrderDatum(datum), "V3");
  test("all three nested signers appear", () => {
    expect(hasValueContaining(view.rows, S1)).toBe(true);
    expect(hasValueContaining(view.rows, S2)).toBe(true);
    expect(hasValueContaining(view.rows, S3)).toBe(true);
  });
  test("AtLeast threshold surfaced", () => {
    expect(hasValueContaining(view.rows, "2 of 3")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stableswap order datum (nested-Constr asset triples; details = Swap).
// ---------------------------------------------------------------------------
describe("buildSundaeOrderView — Stableswap Swap", () => {
  const datum: PD = C(
    0,
    SOME(B(POOL_IDENT)),
    C(0, B(OWNER_KEY)),
    I(1280000),
    C(0, C(0, C(0, B(OWNER_KEY)), NONE), C(0)),
    C(
      1,
      C(0, B("fe7c786ab321f41c654ef6c1af7b3250a613c24e4213e0425a7ae456"), B("55534441"), I(40633000)),
      C(0, B("1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34"), B("5553444378"), I(39829159))
    ),
    B("d87980")
  );
  const view = buildSundaeOrderView(parseStableswapOrderDatum(datum), "Stableswap");
  test("protocol + assets", () => {
    expect(view.protocol).toBe("Sundae Stableswap");
    const assets = view.rows.filter((r) => r.asset);
    expect(assets.some((r) => r.asset!.assetName === "55534441")).toBe(true);
    expect(assets.some((r) => r.asset!.assetName === "5553444378")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V3 pool datum — every field surfaced (live NIGHT/USDA pool shape).
// ---------------------------------------------------------------------------
describe("buildSundaePoolView — V3 pool", () => {
  const datum: PD = C(
    0,
    B("6b3f5bb4fae5dbd157876f649aec5f9d7840fbb479dfa167f05752b1"), // identifier
    L(
      L(B("0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa"), B("4e49474854")),
      L(B("fe7c786ab321f41c654ef6c1af7b3250a613c24e4213e0425a7ae456"), B("55534441"))
    ),
    I(1230414660390), // circulating_lp
    I(30), // bid fees per 10k
    I(30), // ask fees per 10k
    NONE, // fee_manager
    I(0), // market_open
    I(5601988006) // protocol_fees
  );
  const view = buildSundaePoolView(parseV3PoolDatum(datum));
  test("ident, LP, fees, protocol fees, fee manager all surfaced", () => {
    expect(hasValueContaining(view.rows, "6b3f5bb4fae5dbd157876f649aec5f9d7840fbb479dfa167f05752b1")).toBe(true);
    expect(hasValueContaining(view.rows, "1,230,414,660,390")).toBe(true);
    expect(hasValueContaining(view.rows, "0.300%")).toBe(true); // 30/10000
    expect(hasValueContaining(view.rows, "5,601,988,006")).toBe(true);
    expect(hasValueContaining(view.rows, "none")).toBe(true); // fee manager none
    expect(view.rows.filter((r) => r.asset).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Stableswap pool datum — amplification, invariant D, amp manager surfaced.
// ---------------------------------------------------------------------------
describe("buildSundaePoolView — Stableswap pool", () => {
  const datum: PD = C(
    0,
    B("d7c7a7db47ab71ef07f0aa65e6b0bcf9409977c183e85fe6f0a5feb6"),
    L(
      L(B("1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34"), B("5553444378")),
      L(B("c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad"), B("0014df105553444d"))
    ),
    I(3232740344448), // circulating_lp
    L(I(5), I(5)), // lp fee (bid, ask)
    L(I(1), I(1)), // protocol fee (bid, ask)
    NONE, // fee_manager
    I(0), // market_open
    L(I(2895672095), I(200542517), I(200305385)), // protocol fees (flat, A, B)
    I(500), // amplification
    I("3243322329211365000000000"), // invariant D (huge — must stay exact)
    NONE // amplification manager
  );
  const view = buildSundaePoolView(parseStableswapPoolDatum(datum));
  test("amplification + invariant D + accumulated fees surfaced exactly", () => {
    expect(hasValueContaining(view.rows, "500")).toBe(true); // amp
    expect(hasValueContaining(view.rows, "3243322329211365000000000")).toBe(true); // D, exact
    expect(hasValueContaining(view.rows, "2,895,672,095")).toBe(true); // accumulated flat
    // amplification manager row present
    expect(view.rows.some((r) => r.label.startsWith("Amplification manager"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V1 pool datum.
// ---------------------------------------------------------------------------
describe("buildSundaePoolView — V1 pool", () => {
  const datum: PD = C(
    0,
    C(0, C(0, B(""), B("")), C(0, B("63766427b4499dd678cb8b715dec3265dd292279ce7779447e3651e5"), B("4b4f5a"))),
    B("a402"),
    I(0),
    C(0, I(1), I(100))
  );
  const view = buildSundaePoolView(parseV1PoolDatum(datum));
  test("ident, pair, LP, swap fee surfaced", () => {
    expect(hasValueContaining(view.rows, "a402")).toBe(true);
    expect(hasValueContaining(view.rows, "1 / 100")).toBe(true);
    expect(view.rows.filter((r) => r.asset).length).toBe(2);
  });
});
