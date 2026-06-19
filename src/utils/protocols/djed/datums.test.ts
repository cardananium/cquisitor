import { describe, expect, test } from "bun:test";
import type { PD } from "@/utils/protocols/dex/plutusData";
import {
  classifyDjedReserveRedeemer,
  parseDjedReserveAction,
  parseDjedReserveState,
} from "./datums";
import { DJED, matchDjedNftPolicy, matchDjedScriptHash } from "./constants";

const C = (tag: number, ...fields: PD[]): PD => ({ constructor: tag, fields });
const I = (n: number | bigint): PD => ({ int: BigInt(n) });
const B = (hex: string): PD => ({ bytes: hex });

// TxOutRef = Constr0[ Constr0[ ByteArray ], Int ].
const ref = (hash: string, idx: number): PD => C(0, C(0, B(hash)), I(idx));

const ORACLE_INPUT = "5562f7b7ec8e563fef15b9006febdff02aba0b73a0b962a170088d28e4fffb82";
const ORACLE_REF = "362e24ab3b1aacf8108c52aec7ddc6c2e007fef3c3a125eebe849a0be4203902";
const PRIOR_REF = "37116bb7647aeccd235c4e3dbd8e186bb209ca2eef7fc801298d96727e8d3879";

// Reserve/Pool datum fixture (Constr0, 10 fields). Field names + the field [6]
// Nullable semantics follow artifi-labs/open-djed packages/data/src/pool-datum.ts
// (PoolDatumSchema + its committed CBOR test vector).
const liveDatum: PD = C(
  0,
  I(BigInt("31794195172111")), // [0] adaInReserve (lovelace)
  I(BigInt("2989240361350")), // [1] djedInCirculation (micro-DJED)
  I(BigInt("28911296606227")), // [2] shenInCirculation (micro-SHEN)
  // [3] lastOrder = Constr0[ Constr0[ { order: TxOutRef, time: Int } ] ]
  C(0, C(0, C(0, ref(ORACLE_INPUT, 0), I(BigInt("1781621805000"))))),
  I(1823130), // [4] minADA
  I(1530050), // [5] _1 (unnamed)
  C(1), // [6] _2 Nullable = Constr1 [] = Nothing
  B(DJED.mintingPolicyId), // [7] mintingPolicyId
  ref(ORACLE_REF, 0), // [8] mintingPolicyUniqRef
  ref(PRIOR_REF, 0), // [9] _3 (unnamed OutputReference)
);

describe("parseDjedReserveState", () => {
  test("parses all 10 fields of the live datum", () => {
    const s = parseDjedReserveState(liveDatum);
    expect(s.adaInReserve).toBe(BigInt("31794195172111"));
    expect(s.djedInCirculation).toBe(BigInt("2989240361350"));
    expect(s.shenInCirculation).toBe(BigInt("28911296606227"));
    expect(s.minADA).toBe(BigInt(1823130));
    expect(s.field1).toBe(BigInt(1530050));
    // Constr1 [] is Nullable Nothing, not a paused/locked boolean.
    expect(s.optionPresent).toBe(false);
    expect(s.mintingPolicyId).toBe(DJED.mintingPolicyId);
  });

  test("peels the nested lastOrder wrappers to (TxOutRef, posix-ms)", () => {
    const s = parseDjedReserveState(liveDatum);
    expect(s.lastOrder.timestamp).toBe(BigInt("1781621805000"));
    expect(s.lastOrder.order).toEqual({ txHash: ORACLE_INPUT, index: BigInt(0) });
  });

  test("parses the minting-policy unique ref + field[9] ref", () => {
    const s = parseDjedReserveState(liveDatum);
    expect(s.mintingPolicyUniqRef).toEqual({ txHash: ORACLE_REF, index: BigInt(0) });
    expect(s.field3).toEqual({ txHash: PRIOR_REF, index: BigInt(0) });
  });

  test("rejects wrong field count", () => {
    expect(() => parseDjedReserveState(C(0, I(1)))).toThrow();
  });

  test("reads a present (Some) field[6] option (Constr0[x])", () => {
    const d: PD = C(
      0,
      I(0),
      I(0),
      I(0),
      C(0, C(0, C(0, ref(ORACLE_INPUT, 0), I(0)))),
      I(0),
      I(0),
      C(0, I(7)), // field[6] = Some(7)
      B(DJED.mintingPolicyId),
      ref(ORACLE_REF, 1),
      ref(PRIOR_REF, 2),
    );
    const s = parseDjedReserveState(d);
    expect(s.optionPresent).toBe(true);
    expect(s.mintingPolicyUniqRef.index).toBe(BigInt(1));
    expect(s.field3.index).toBe(BigInt(2));
  });
});

describe("parseDjedReserveAction", () => {
  test("tag-2 main action decodes owner key + ref", () => {
    const owner = "abababababababababababababababababababababababababababab";
    const r: PD = C(2, C(0, B(owner), ref(PRIOR_REF, 0)));
    const a = parseDjedReserveAction(r);
    expect(a.kind).toBe("MainAction");
    if (a.kind !== "MainAction") throw new Error("expected MainAction");
    expect(a.ownerOrKey).toBe(owner);
    expect(a.ref).toEqual({ txHash: PRIOR_REF, index: BigInt(0) });
  });

  test("no-field tags surface their ctor index", () => {
    for (const tag of [0, 1, 3, 4]) {
      const a = parseDjedReserveAction(C(tag));
      expect(a.kind).toBe("Action");
      if (a.kind !== "Action") throw new Error("expected Action");
      expect(a.tag).toBe(tag);
    }
  });
});

describe("classifyDjedReserveRedeemer", () => {
  test("labels the main action and passes the rest by ctor index", () => {
    expect(classifyDjedReserveRedeemer(C(2, C(0)))).toBe("Mint/Burn/Settle (main)");
    expect(classifyDjedReserveRedeemer(C(0))).toBe("Reserve action #0");
    expect(classifyDjedReserveRedeemer(C(4))).toBe("Reserve action #4");
    expect(classifyDjedReserveRedeemer(C(7))).toBeNull();
  });
});

describe("Djed matching", () => {
  test("reserve script hash on mainnet only", () => {
    expect(matchDjedScriptHash(DJED.reserveScriptHash, "mainnet")).toBe("reserve");
    expect(matchDjedScriptHash(DJED.reserveScriptHash, undefined)).toBe("reserve");
    expect(matchDjedScriptHash(DJED.reserveScriptHash, "preprod")).toBeNull();
    expect(matchDjedScriptHash("00".repeat(28), "mainnet")).toBeNull();
  });

  test("thread NFT: policy + DjedStableCoinNFT asset name", () => {
    expect(
      matchDjedNftPolicy(DJED.mintingPolicyId, [DJED.threadNftAssetName], "mainnet"),
    ).toBe("reserve");
    // Policy match alone (only the circulating token) must NOT match.
    expect(
      matchDjedNftPolicy(DJED.mintingPolicyId, [DJED.djedAssetName], "mainnet"),
    ).toBeNull();
    expect(
      matchDjedNftPolicy(DJED.mintingPolicyId, [DJED.threadNftAssetName], "preprod"),
    ).toBeNull();
    expect(
      matchDjedNftPolicy("00".repeat(28), [DJED.threadNftAssetName], "mainnet"),
    ).toBeNull();
  });
});
