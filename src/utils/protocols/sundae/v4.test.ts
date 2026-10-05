import { describe, expect, test } from "bun:test";
import type { PD } from "./plutusData";
import { buildV4ScoopGraph } from "./v4Graph";
import { poolSteps, type V4ScoopInfo } from "./v4Scoop";
import {
  initialPoolState,
  parseV4OrderDatum,
  parseV4OrderSpendRedeemer,
  parseV4OrderValidatorRedeemer,
  parseV4PoolDatum,
  parseV4PoolSpendRedeemer,
  parseV4SettingsDatum,
  parseV4OrderConfig,
  parseV4FeeSettings,
  terminalSettlement,
} from "./v4";
import { decodeV4Constraint } from "./v4Constraints";

// --- Fixtures -------------------------------------------------------------
//
// Every datum and redeemer below is lifted verbatim from mainnet, so these
// tests fail if a field is added, reordered, or re-typed on chain.
//
// Scoop:        cd221a62afdf703f892c7f3291557ac59a3674420d54ccd40909a79bbdb26b2d
//               (epoch 659, block 14025949) — one basic "Swap" order filled
//               against a USDCx/USDr constant-sum pool.
// Order placed: 13d5df55c781868e84e9519b23b0ede9476be5878bf289fb967a6050816a710d
//
// The transaction's inputs are, in body order: #0 the order, #1 the pool. They
// sort the same way, so the redeemers' `own_input_index: 0` and
// `pool_input_index: 1` line up with the body indices here.

const POOL_DATUM_HEX =
  "d8799f9f9fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1b0000005c63962b42ff9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae4455534472ff1b0000006eb23e5b76ffff1b000000cae79d776d1b000000cae69acc6a1b00038cb3be2bb396581c062ed639ee7ac7e9d3727ab52c605e88bcab80dd32dd3ab4c9617bc09fd8799f1864d87a809f581c4e1a435f8d55f26068150579c18964e58078082b899e6bb560be7cd5581c1351c687e6359b0030086fc7ddd6cd389f55f97faba3f531c5535688581c31d2328d6ddc3d5dfc48c5b827aa922506a80e7db40f25ef807d0fd5ffffd8799f18c8d87a809f581cbcdca3ffc967ed2a5bf2dc9040f9f17d97f574122f7561fe26ef565bffffd8799f01d87a809f581c518c4a6ef444c2f0631b3a7adb7514d80212dff988e35c1318da88a2ffffff9f9f581c4e1a435f8d55f26068150579c18964e58078082b899e6bb560be7cd5582076b9fc453ffd565b815084092fc2420b3b1542a7ea3c68320a955126abdcda85ff9f581c1351c687e6359b0030086fc7ddd6cd389f55f97faba3f531c553568858208c51550c4c4fd4c2f78ce6102498470215d930c0894855fa103839bcb9ac3d78ff9f581c31d2328d6ddc3d5dfc48c5b827aa922506a80e7db40f25ef807d0fd54180ff9f581cbcdca3ffc967ed2a5bf2dc9040f9f17d97f574122f7561fe26ef565b5820b7afc0e9c25e4fa2933e0ed75b11024f44b271223ddeb5e919c9ed09489e29a1ff9f581c518c4a6ef444c2f0631b3a7adb7514d80212dff988e35c1318da88a258207e1942d1f00485d10faea45744f36786da540e6ad5688c7d8e44eb24581852c9ffff1a00e4e1c0d87980ff";

const ORDER_DATUM_HEX =
  "d8799fd8799f581c88612f9519d6f1388fd1eab60c99031fb85ce40611accbf1a38a1283ffd8799fd8799fd8799f581c77b7440864d32b34e6ec22028360610a6f6149404343b1a6802c1a22ffd8799fd8799fd8799f581c88612f9519d6f1388fd1eab60c99031fb85ce40611accbf1a38a1283ffffffffd87a80ff1a001388001a001388005820012dd204b7a3c6d5d410290631d135f95703fc7247a0954067c9dbf32838d0fb9f9f581c30f1fac08a15ef84ea6a5aa04989b1c2ceeb3b437f2c3103df5aca68d87b9f9f9fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1a1cbe6a61ffff9f9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae4455534472ff1a1cbabc81ffffffff9f581c267eabb980be6699144e85b24283659838b0746e0fd2f08be1423e70d87980ffffd87980ff";

/** `Scoop { own_input_index: 0 }` — the order's spend redeemer. */
const ORDER_SPEND_REDEEMER_HEX = "d87a9f00ff";

/** `Action { tag: 100, transcript: [1 entry], pool_input_index: 1, pool_output_index: 0 }`. */
const POOL_SPEND_REDEEMER_HEX =
  "d87c9f18649fd8799fd8799f9f9fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1b0000005c63962b42ff9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae4455534472ff1b0000006eb23e5b76ffff1b000000cae79d776d1b000000cae69acc6a1b00038cb3be2bb396ff1a0002f0d403d87982582013d5df55c781868e84e9519b23b0ede9476be5878bf289fb967a6050816a710d00ffff0100ff";

/** `OrderValidatorRedeemer { configs: [1], entries: [1] }` — the batch manifest. */
const MANIFEST_REDEEMER_HEX =
  "d8799f9fd8799f065820012dd204b7a3c6d5d410290631d135f95703fc7247a0954067c9dbf32838d0fbffff9fd8799f0100ffffff";

const USDCX_POLICY = "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34";
const USDCX_NAME = "5553444378"; // "USDCx"
const USDR_POLICY = "7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae";
const USDR_NAME = "55534472"; // "USDr"

const BASIC_ORDER_HASH = "30f1fac08a15ef84ea6a5aa04989b1c2ceeb3b437f2c3103df5aca68";
const FEE_CONSTRAINT_HASH = "267eabb980be6699144e85b24283659838b0746e0fd2f08be1423e70";
const CONSTANT_SUM_HASH = "4e1a435f8d55f26068150579c18964e58078082b899e6bb560be7cd5";
const FEE_SPLIT_HASH = "1351c687e6359b0030086fc7ddd6cd389f55f97faba3f531c5535688";
const FAIRNESS_HASH = "31d2328d6ddc3d5dfc48c5b827aa922506a80e7db40f25ef807d0fd5";
const TREASURY_POLICY_HASH = "bcdca3ffc967ed2a5bf2dc9040f9f17d97f574122f7561fe26ef565b";
const GOVERNANCE_HASH = "518c4a6ef444c2f0631b3a7adb7514d80212dff988e35c1318da88a2";

// --- CBOR → PD ------------------------------------------------------------
//
// In the app a datum arrives as cquisitor-lib's DetailedSchema tree. Here we
// start from raw CBOR so the fixtures can be the exact on-chain bytes, and
// convert to the same `PD` shape the parsers consume.

function cborToPD(hex: string): PD {
  const bytes = new Uint8Array(hex.match(/../g)!.map((x) => parseInt(x, 16)));
  let p = 0;
  const u8 = () => bytes[p++];
  const take = (n: number) => {
    const slice = bytes.slice(p, p + n);
    p += n;
    return slice;
  };
  const toHex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("");

  function count(ai: number): number | bigint {
    if (ai < 24) return ai;
    if (ai === 24) return u8();
    if (ai === 25) return (u8() << 8) | u8();
    if (ai === 26) {
      let x = 0;
      for (let i = 0; i < 4; i++) x = x * 256 + u8();
      return x;
    }
    if (ai === 27) {
      let x = BigInt(0);
      for (let i = 0; i < 8; i++) x = x * BigInt(256) + BigInt(u8());
      return x;
    }
    if (ai === 31) return -1; // indefinite length
    throw new Error(`unsupported additional info ${ai}`);
  }

  function read(): PD {
    const ib = u8();
    const major = ib >> 5;
    const ai = ib & 0x1f;
    switch (major) {
      case 0:
        return { int: BigInt(count(ai) as number | bigint) };
      case 1:
        return { int: -BigInt(1) - BigInt(count(ai) as number | bigint) };
      case 2: {
        if (ai === 31) {
          const parts: string[] = [];
          while (bytes[p] !== 0xff) {
            const chunk = u8();
            parts.push(toHex(take(Number(count(chunk & 0x1f)))));
          }
          p++;
          return { bytes: parts.join("") };
        }
        return { bytes: toHex(take(Number(count(ai)))) };
      }
      case 4: {
        const items: PD[] = [];
        if (ai === 31) {
          while (bytes[p] !== 0xff) items.push(read());
          p++;
        } else {
          const n = Number(count(ai));
          for (let i = 0; i < n; i++) items.push(read());
        }
        return { list: items };
      }
      case 5: {
        const entries: { k: PD; v: PD }[] = [];
        if (ai === 31) {
          while (bytes[p] !== 0xff) entries.push({ k: read(), v: read() });
          p++;
        } else {
          const n = Number(count(ai));
          for (let i = 0; i < n; i++) entries.push({ k: read(), v: read() });
        }
        return { map: entries };
      }
      case 6: {
        const tag = Number(count(ai));
        // Constructors 0-6 are tags 121-127; 7 and up use tag 102 with an
        // explicit index. Bignums (tags 2 and 3) carry the integer as bytes.
        if (tag >= 121 && tag <= 127) {
          const inner = read() as { list: PD[] };
          return { constructor: tag - 121, fields: inner.list };
        }
        if (tag === 102) {
          const inner = read() as { list: PD[] };
          const index = Number((inner.list[0] as { int: bigint }).int);
          return { constructor: index, fields: (inner.list[1] as { list: PD[] }).list };
        }
        if (tag === 2 || tag === 3) {
          const magnitude = BigInt(`0x${(read() as { bytes: string }).bytes}`);
          return { int: tag === 2 ? magnitude : -BigInt(1) - magnitude };
        }
        throw new Error(`unsupported CBOR tag ${tag}`);
      }
      default:
        throw new Error(`unsupported CBOR major type ${major}`);
    }
  }

  const value = read();
  if (p !== bytes.length) throw new Error(`trailing bytes: stopped at ${p} of ${bytes.length}`);
  return value;
}

describe("cborToPD (test helper)", () => {
  test("round-trips the shapes the fixtures use", () => {
    expect(cborToPD("d87980")).toEqual({ constructor: 0, fields: [] });
    expect(cborToPD("00")).toEqual({ int: BigInt(0) });
    expect(cborToPD("4101")).toEqual({ bytes: "01" });
    expect(cborToPD("9f0102ff")).toEqual({ list: [{ int: BigInt(1) }, { int: BigInt(2) }] });
    // d87a9f00ff = tag 122 (constructor 1) wrapping [0]
    expect(cborToPD("d87a9f00ff")).toEqual({ constructor: 1, fields: [{ int: BigInt(0) }] });
  });
});

// --- Pool datum -----------------------------------------------------------

describe("parseV4PoolDatum — live USDCx/USDr constant-sum pool", () => {
  const datum = parseV4PoolDatum(cborToPD(POOL_DATUM_HEX));

  test("decodes reserves in declaration order", () => {
    expect(datum.assets).toHaveLength(2);
    expect(datum.assets[0].asset).toEqual({ policyId: USDCX_POLICY, assetName: USDCX_NAME });
    expect(datum.assets[0].amount).toBe(BigInt(396807777090));
    expect(datum.assets[1].asset).toEqual({ policyId: USDR_POLICY, assetName: USDR_NAME });
    expect(datum.assets[1].amount).toBe(BigInt(475436833654));
  });

  test("decodes the three LP counters and the identifier", () => {
    expect(datum.totalLp).toBe(BigInt(871469250413));
    expect(datum.circulatingLp).toBe(BigInt(871452298346));
    expect(datum.premintedLp).toBe(BigInt(999128547701654));
    expect(datum.identifier).toBe("062ed639ee7ac7e9d3727ab52c605e88bcab80dd32dd3ab4c9617bc0");
  });

  test("decodes the action map, including which modules validate each tag", () => {
    expect(datum.actions).toHaveLength(3);
    expect(datum.actions[0].tag).toBe(BigInt(100));
    expect(datum.actions[0].enabled).toBe(true);
    expect(datum.actions[0].modules).toEqual([
      CONSTANT_SUM_HASH,
      FEE_SPLIT_HASH,
      FAIRNESS_HASH,
    ]);
    expect(datum.actions[1].tag).toBe(BigInt(200));
    expect(datum.actions[1].modules).toEqual([TREASURY_POLICY_HASH]);
    expect(datum.actions[2].tag).toBe(BigInt(1));
    expect(datum.actions[2].modules).toEqual([GOVERNANCE_HASH]);
  });

  test("decodes per-module state and the appended min_surplus", () => {
    expect(datum.moduleState).toHaveLength(5);
    expect(datum.moduleState[0].moduleHash).toBe(CONSTANT_SUM_HASH);
    expect(datum.moduleState[2]).toEqual({ moduleHash: FAIRNESS_HASH, state: "80" });
    // min_surplus is the 8th field, appended after the original seven.
    expect(datum.minSurplus).toBe(BigInt(15000000));
  });

  test("initialPoolState mirrors the datum's own reserves and counters", () => {
    expect(initialPoolState(datum)).toEqual({
      assets: datum.assets,
      totalLp: datum.totalLp,
      circulatingLp: datum.circulatingLp,
      premintedLp: datum.premintedLp,
    });
  });

  test("tolerates a future appended field but rejects a truncated datum", () => {
    const pd = cborToPD(POOL_DATUM_HEX) as { constructor: number; fields: PD[] };
    const extended = { constructor: 0, fields: [...pd.fields, { int: BigInt(1) }] };
    expect(parseV4PoolDatum(extended).minSurplus).toBe(BigInt(15000000));
    const truncated = { constructor: 0, fields: pd.fields.slice(0, 6) };
    expect(() => parseV4PoolDatum(truncated)).toThrow(/at least 7 fields/);
  });
});

// --- Order datum ----------------------------------------------------------

describe("parseV4OrderDatum — live basic Swap order", () => {
  const datum = parseV4OrderDatum(cborToPD(ORDER_DATUM_HEX));

  test("decodes the owner as a single-signature multisig", () => {
    expect(datum.owner).toEqual({
      kind: "Signature",
      keyHash: "88612f9519d6f1388fd1eab60c99031fb85ce40611accbf1a38a1283",
    });
  });

  test("decodes a Fixed destination with no datum", () => {
    expect(datum.destination.kind).toBe("Fixed");
    if (datum.destination.kind !== "Fixed") throw new Error("unreachable");
    expect(datum.destination.address.paymentCredential).toEqual({
      kind: "VKey",
      hash: "77b7440864d32b34e6ec22028360610a6f6149404343b1a6802c1a22",
    });
    expect(datum.destination.address.stakeCredential).toEqual({
      kind: "Inline",
      credential: {
        kind: "VKey",
        hash: "88612f9519d6f1388fd1eab60c99031fb85ce40611accbf1a38a1283",
      },
    });
    expect(datum.destination.datum).toBeNull();
  });

  test("decodes the two fee fields and the config token", () => {
    expect(datum.serviceBudget).toBe(BigInt(1280000));
    expect(datum.maxPerExecution).toBe(BigInt(1280000));
    expect(datum.configToken).toBe(
      "012dd204b7a3c6d5d410290631d135f95703fc7247a0954067c9dbf32838d0fb",
    );
  });

  test("decodes the constraint list keyed by validator hash", () => {
    expect(datum.constraints).toHaveLength(2);
    expect(datum.constraints[0].hash).toBe(BASIC_ORDER_HASH);
    expect(datum.constraints[1].hash).toBe(FEE_CONSTRAINT_HASH);
  });

  test("terminalSettlement takes the lesser of the cap and the budget", () => {
    expect(terminalSettlement(datum)).toBe(BigInt(1280000));
    expect(terminalSettlement({ ...datum, maxPerExecution: BigInt(500000) })).toBe(BigInt(500000));
    expect(terminalSettlement({ ...datum, serviceBudget: BigInt(250000) })).toBe(BigInt(250000));
  });

  test("rejects a datum with the wrong field count", () => {
    const pd = cborToPD(ORDER_DATUM_HEX) as { constructor: number; fields: PD[] };
    expect(() => parseV4OrderDatum({ constructor: 0, fields: pd.fields.slice(0, 6) })).toThrow(
      /expected 7 fields/,
    );
  });
});

// --- Constraints ----------------------------------------------------------

describe("decodeV4Constraint — basic order payload", () => {
  const datum = parseV4OrderDatum(cborToPD(ORDER_DATUM_HEX));

  test("reads the subtype from the payload's constructor index", () => {
    // Constructor 2 is `Swap` in the SDK's EV4BasicConstraint. The validator
    // ignores the index, so this is the builder's declared intent.
    const decoded = decodeV4Constraint(datum.constraints[0], "mainnet");
    expect(decoded.title).toBe("basic_order.withdraw");
    expect(decoded.label).toBe("basic order");
    expect(decoded.body.kind).toBe("basic");
    if (decoded.body.kind !== "basic") throw new Error("unreachable");
    expect(decoded.body.subtypeTag).toBe(2);
    expect(decoded.body.subtype).toBe("Swap");
    expect(decoded.body.offered).toEqual([
      { asset: { policyId: USDCX_POLICY, assetName: USDCX_NAME }, amount: BigInt(482241121) },
    ]);
    expect(decoded.body.minReceived).toEqual([
      { asset: { policyId: USDR_POLICY, assetName: USDR_NAME }, amount: BigInt(482000001) },
    ]);
  });

  test("recognizes the fee constraint by its validator hash", () => {
    const decoded = decodeV4Constraint(datum.constraints[1], "mainnet");
    expect(decoded.title).toBe("fee_constraint.withdraw");
    expect(decoded.body.kind).toBe("fee");
  });

  test("reports an unknown validator instead of throwing", () => {
    const decoded = decodeV4Constraint({ hash: "00".repeat(28), data: { int: BigInt(1) } }, "mainnet");
    expect(decoded.title).toBeNull();
    expect(decoded.body.kind).toBe("unknown");
    if (decoded.body.kind !== "unknown") throw new Error("unreachable");
    expect(decoded.body.reason).toMatch(/not part of a known V4 deployment/);
  });

  test("reports a payload that does not match its validator's shape", () => {
    const decoded = decodeV4Constraint({ hash: BASIC_ORDER_HASH, data: { int: BigInt(7) } }, "mainnet");
    expect(decoded.title).toBe("basic_order.withdraw");
    expect(decoded.body.kind).toBe("unknown");
    // The raw payload survives so the completeness view can still show it.
    expect(decoded.raw).toEqual({ int: BigInt(7) });
  });
});

// --- Redeemers ------------------------------------------------------------

describe("parseV4OrderSpendRedeemer", () => {
  test("decodes the live Scoop redeemer and its sorted input index", () => {
    expect(parseV4OrderSpendRedeemer(cborToPD(ORDER_SPEND_REDEEMER_HEX))).toEqual({
      kind: "Scoop",
      ownInputIndex: BigInt(0),
    });
  });

  test("decodes Cancel, and returns null for an unrecognized shape", () => {
    expect(parseV4OrderSpendRedeemer({ constructor: 0, fields: [] })).toEqual({ kind: "Cancel" });
    expect(parseV4OrderSpendRedeemer({ int: BigInt(1) })).toBeNull();
    expect(parseV4OrderSpendRedeemer({ constructor: 1, fields: [] })).toBeNull();
  });
});

describe("parseV4PoolSpendRedeemer — live Action with a transcript", () => {
  const redeemer = parseV4PoolSpendRedeemer(cborToPD(POOL_SPEND_REDEEMER_HEX));

  test("decodes the action tag and the pool's input/output indices", () => {
    expect(redeemer?.kind).toBe("Action");
    if (redeemer?.kind !== "Action") throw new Error("unreachable");
    expect(redeemer.tag).toBe(BigInt(100));
    // Both are sorted-input / output positions, not body input positions.
    expect(redeemer.poolInputIndex).toBe(BigInt(1));
    expect(redeemer.poolOutputIndex).toBe(BigInt(0));
    expect(redeemer.transcriptLength).toBe(1);
  });

  test("decodes the transcript entry's resulting state and fee budget", () => {
    if (redeemer?.kind !== "Action") throw new Error("unreachable");
    expect(redeemer.transcript).toHaveLength(1);
    const entry = redeemer.transcript![0];
    expect(entry.feeBudget).toBe(BigInt(192724));
    expect(entry.operationTag).toBe(BigInt(3));
    expect(entry.stateAfter.totalLp).toBe(BigInt(871469250413));
    expect(entry.stateAfter.circulatingLp).toBe(BigInt(871452298346));
    expect(entry.stateAfter.assets[0].amount).toBe(BigInt(396807777090));
    expect(entry.stateAfter.assets[1].amount).toBe(BigInt(475436833654));
  });

  test("the transcript's final state matches the pool's continuation datum", () => {
    // The scoop's one step must land the pool exactly where output #0 says it
    // is — the single strongest cross-check available in one transaction.
    if (redeemer?.kind !== "Action") throw new Error("unreachable");
    const continuation = parseV4PoolDatum(cborToPD(POOL_DATUM_HEX));
    const final = redeemer.transcript![redeemer.transcript!.length - 1].stateAfter;
    expect(final.assets).toEqual(continuation.assets);
    expect(final.totalLp).toBe(continuation.totalLp);
    expect(final.circulatingLp).toBe(continuation.circulatingLp);
    expect(final.premintedLp).toBe(continuation.premintedLp);
  });

  test("decodes the administrative constructors", () => {
    expect(parseV4PoolSpendRedeemer({ constructor: 0, fields: [{ int: BigInt(5) }] })).toEqual({
      kind: "EscapeHatch",
      redeemedLp: BigInt(5),
    });
    expect(parseV4PoolSpendRedeemer({ constructor: 1, fields: [] })).toEqual({ kind: "Upgrade" });
    expect(
      parseV4PoolSpendRedeemer({
        constructor: 2,
        fields: [{ int: BigInt(100) }, { constructor: 0, fields: [] }],
      }),
    ).toEqual({ kind: "EmergencyDisable", targetTag: BigInt(100), setEnabled: false });
    expect(parseV4PoolSpendRedeemer({ constructor: 4, fields: [] })).toEqual({ kind: "Destroy" });
  });

  test("keeps the step count when a transcript entry has an unknown shape", () => {
    const opaque = {
      constructor: 3,
      fields: [{ int: BigInt(1) }, { list: [{ int: BigInt(9) }] }, { int: BigInt(0) }, { int: BigInt(0) }],
    };
    const parsed = parseV4PoolSpendRedeemer(opaque);
    expect(parsed?.kind).toBe("Action");
    if (parsed?.kind !== "Action") throw new Error("unreachable");
    expect(parsed.transcript).toBeNull();
    expect(parsed.transcriptLength).toBe(1);
  });
});

describe("parseV4OrderValidatorRedeemer — the live batch manifest", () => {
  test("decodes the config reference and the one order entry", () => {
    const manifest = parseV4OrderValidatorRedeemer(cborToPD(MANIFEST_REDEEMER_HEX));
    expect(manifest).not.toBeNull();
    expect(manifest!.configs).toEqual([
      {
        refIndex: BigInt(6),
        token: "012dd204b7a3c6d5d410290631d135f95703fc7247a0954067c9dbf32838d0fb",
      },
    ]);
    expect(manifest!.entries).toEqual([{ outputIndex: BigInt(1), configIndex: BigInt(0) }]);
  });

  test("the manifest's config token is the one the order datum names", () => {
    const manifest = parseV4OrderValidatorRedeemer(cborToPD(MANIFEST_REDEEMER_HEX));
    const order = parseV4OrderDatum(cborToPD(ORDER_DATUM_HEX));
    expect(manifest!.configs[0].token).toBe(order.configToken);
  });

  test("returns null for a redeemer of another shape", () => {
    expect(parseV4OrderValidatorRedeemer({ int: BigInt(1) })).toBeNull();
    expect(parseV4OrderValidatorRedeemer({ constructor: 0, fields: [] })).toBeNull();
  });
});

// --- Settings nodes -------------------------------------------------------
//
// Lifted from the preview deployment's settings as reported by
// api.preview.sundae.fi: the global node, an order config, and the fee node.

describe("settings nodes", () => {
  test("parseV4SettingsDatum decodes admins and the scooper allowlist", () => {
    const hex =
      "d8799fd8799f581ce2afcadc7b111be7b89f283e9facffbbc5292f40fd13d7613e639c35ffd8799f581ce2afcadc7b111be7b89f283e9facffbbc5292f40fd13d7613e639c35ffd8799f9fd8799f581ce2afcadc7b111be7b89f283e9facffbbc5292f40fd13d7613e639c35ffd8799f581c008b47844d92812fc30d1f0ac9b6fbf38778ccba9db8312ad9079079ffffffd8799f581ce2afcadc7b111be7b89f283e9facffbbc5292f40fd13d7613e639c35ffd87980ff";
    const datum = parseV4SettingsDatum(cborToPD(hex));
    expect(datum.settingsAdmin).toEqual({
      kind: "Signature",
      keyHash: "e2afcadc7b111be7b89f283e9facffbbc5292f40fd13d7613e639c35",
    });
    expect(datum.authorizedScoopers).toHaveLength(2);
    expect(datum.authorizedScoopers![1]).toEqual({
      kind: "Signature",
      keyHash: "008b47844d92812fc30d1f0ac9b6fbf38778ccba9db8312ad9079079",
    });
    expect(datum.securityCouncil).toEqual(datum.settingsAdmin);
  });

  test("parseV4OrderConfig lists the constraints an order type must carry", () => {
    const hex =
      "d8799f58200056667008c14652ef9039690587c17fa70546e3ccd62ec63ec750cfd72969ab9f581c4859acf5f46a50f383d16323a3c7eacf502ba732aa8874a7d3b7783e581cd7d1c09deb8bc8e15baae7895e57e86ab6d0cb10e2faaa6d96cd691bffff";
    const config = parseV4OrderConfig(cborToPD(hex));
    expect(config.label).toBe(
      "0056667008c14652ef9039690587c17fa70546e3ccd62ec63ec750cfd72969ab",
    );
    expect(config.requiredConstraints).toEqual([
      "4859acf5f46a50f383d16323a3c7eacf502ba732aa8874a7d3b7783e",
      "d7d1c09deb8bc8e15baae7895e57e86ab6d0cb10e2faaa6d96cd691b",
    ]);
  });

  test("parseV4FeeSettings decodes the base fee", () => {
    expect(parseV4FeeSettings(cborToPD("d8799f1a00138800ff")).baseFee).toBe(BigInt(1280000));
  });
});

// --- Real two-hop scoop ---------------------------------------------------
//
// Mainnet c8c8ac6fb5aa29152101332a79d820e89cc1b704917040c70e6b9d3d70e95c5c.
// One order routed through two pools with NO route constraint: pool A trades
// sUSDr for USDr, pool B trades that USDr for USDCx. Both transcripts name the
// order's output reference, which is the only thing in the transaction that
// states the path.

const HOP_POOL_A_DATUM = "d8799f9f9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae4455534472ff1b000000b88bc70d9fff9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae457355534472ff1b000000ba09a22211ffff1b16148516739566a51b1614834ea32bfd491b00032d33c938fe1a581c10aceb43bb0127e40b4696bb0e06174c830bec3f7ee6063b1d1045469fd8799f1864d87a809f581cf47f6594cab956302f7f1cd81ac4122e9ee128146102497feca1a79f581c1351c687e6359b0030086fc7ddd6cd389f55f97faba3f531c5535688581c31d2328d6ddc3d5dfc48c5b827aa922506a80e7db40f25ef807d0fd5ffffd8799f18c8d87a809f581cbcdca3ffc967ed2a5bf2dc9040f9f17d97f574122f7561fe26ef565bffffd8799f01d87a809f581c518c4a6ef444c2f0631b3a7adb7514d80212dff988e35c1318da88a2ffffff9f9f581cf47f6594cab956302f7f1cd81ac4122e9ee128146102497feca1a79f582091685eafb77bbdf78156fb38a06f8677f1fd47e13664ca2b0f796c1eb84f222dff9f581c1351c687e6359b0030086fc7ddd6cd389f55f97faba3f531c553568858208c51550c4c4fd4c2f78ce6102498470215d930c0894855fa103839bcb9ac3d78ff9f581c31d2328d6ddc3d5dfc48c5b827aa922506a80e7db40f25ef807d0fd54180ff9f581cbcdca3ffc967ed2a5bf2dc9040f9f17d97f574122f7561fe26ef565b5820b7afc0e9c25e4fa2933e0ed75b11024f44b271223ddeb5e919c9ed09489e29a1ff9f581c518c4a6ef444c2f0631b3a7adb7514d80212dff988e35c1318da88a258207e1942d1f00485d10faea45744f36786da540e6ad5688c7d8e44eb24581852c9ffff1a00e4e1c0d87980ff";
const HOP_POOL_B_DATUM = "d8799f9f9fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1b0000005cc9168512ff9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae4455534472ff1b0000006d3f5bcae2ffff1b000000c9dae59d961b000000c9d9fcace41b00038cb4cac9d31c581c062ed639ee7ac7e9d3727ab52c605e88bcab80dd32dd3ab4c9617bc09fd8799f1864d87a809f581c4e1a435f8d55f26068150579c18964e58078082b899e6bb560be7cd5581c1351c687e6359b0030086fc7ddd6cd389f55f97faba3f531c5535688581c31d2328d6ddc3d5dfc48c5b827aa922506a80e7db40f25ef807d0fd5ffffd8799f18c8d87a809f581cbcdca3ffc967ed2a5bf2dc9040f9f17d97f574122f7561fe26ef565bffffd8799f01d87a809f581c518c4a6ef444c2f0631b3a7adb7514d80212dff988e35c1318da88a2ffffff9f9f581c4e1a435f8d55f26068150579c18964e58078082b899e6bb560be7cd5582076b9fc453ffd565b815084092fc2420b3b1542a7ea3c68320a955126abdcda85ff9f581c1351c687e6359b0030086fc7ddd6cd389f55f97faba3f531c553568858208c51550c4c4fd4c2f78ce6102498470215d930c0894855fa103839bcb9ac3d78ff9f581c31d2328d6ddc3d5dfc48c5b827aa922506a80e7db40f25ef807d0fd54180ff9f581cbcdca3ffc967ed2a5bf2dc9040f9f17d97f574122f7561fe26ef565b5820b7afc0e9c25e4fa2933e0ed75b11024f44b271223ddeb5e919c9ed09489e29a1ff9f581c518c4a6ef444c2f0631b3a7adb7514d80212dff988e35c1318da88a258207e1942d1f00485d10faea45744f36786da540e6ad5688c7d8e44eb24581852c9ffff1a00e4e1c0d87980ff";
const HOP_REDEEMER_A = "d87c9f18649fd8799fd8799f9f9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae4455534472ff1b000000b84d0a65cdff9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae457355534472ff1b000000ba485ceab3ffff1b1614855ffe8895961b1614834ea32bfd491b00032d33c938fe1aff1b000001262bccbbc403d8799fc24c0367f533a4b205455219d0fbc24d141b182d0645f94f3c0e1e6e6ed879825820c4928530a6605cbbe75c55c58e7ea7c879c114c8ca39541cdad945b7fa9dce0200ffffff0000ff";
const HOP_REDEEMER_B = "d87c9f18649fd8799fd8799f9f9fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1b0000005c8a61e503ff9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae4455534472ff1b0000006d7e1872b4ffff1b000000c9dae7166a1b000000c9d9fcace41b00038cb4cac9d31cff1a0005e35003d879825820c4928530a6605cbbe75c55c58e7ea7c879c114c8ca39541cdad945b7fa9dce0200ffff0101ff";
const HOP_ORDER_TX = "c4928530a6605cbbe75c55c58e7ea7c879c114c8ca39541cdad945b7fa9dce02";

describe("real two-hop scoop — c8c8ac6f", () => {
  const poolA = parseV4PoolDatum(cborToPD(HOP_POOL_A_DATUM));
  const poolB = parseV4PoolDatum(cborToPD(HOP_POOL_B_DATUM));
  const redA = parseV4PoolSpendRedeemer(cborToPD(HOP_REDEEMER_A))!;
  const redB = parseV4PoolSpendRedeemer(cborToPD(HOP_REDEEMER_B))!;
  const POOL_MINT = "d9d5985e0657933005d6eb953aeadad29aa8c36f17e493e2962584ec";

  test("the two pools trade different pairs, sharing only USDr", () => {
    const names = (d: typeof poolA) => d.assets.map((a) => a.asset.assetName);
    // "USDr" and "sUSDr"
    expect(names(poolA)).toEqual(["55534472", "7355534472"]);
    // "USDCx" and "USDr"
    expect(names(poolB)).toEqual(["5553444378", "55534472"]);
  });

  test("each transcript names the same order output reference", () => {
    for (const redeemer of [redA, redB]) {
      expect(redeemer.kind).toBe("Action");
      if (redeemer.kind !== "Action") throw new Error("unreachable");
      expect(redeemer.transcript).toHaveLength(1);
      // The reference is somewhere inside the module's payload; find it.
      const found = JSON.stringify(
        redeemer.transcript![0].operationData,
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      );
      expect(found).toContain(HOP_ORDER_TX);
    }
  });

  test("the graph links both hops in execution order, not just the last", () => {
    const stepsA = poolSteps(poolA, redA, POOL_MINT);
    const stepsB = poolSteps(poolB, redB, POOL_MINT);
    const scoop: V4ScoopInfo = {
      network: "mainnet",
      pools: [
        { bodyInputIndex: 0, sortedInputIndex: 0, datum: poolA, redeemer: redA,
          steps: stepsA, poolOutputIndex: 0, lpAsset: null },
        { bodyInputIndex: 1, sortedInputIndex: 1, datum: poolB, redeemer: redB,
          steps: stepsB, poolOutputIndex: 1, lpAsset: null },
      ],
      orders: [
        {
          bodyInputIndex: 2, sortedInputIndex: 2, orderIndex: 0,
          txHash: HOP_ORDER_TX, outputIndex: 0,
          datum: null, parseError: null,
          redeemer: { kind: "Scoop", ownInputIndex: BigInt(2) },
          constraints: [], kind: "Swap",
          payoutOutputIndex: 2,
          // Gave sUSDr, received USDCx — neither asset is in both pools.
          payoutDelta: [
            { asset: { policyId: "7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae", assetName: "7355534472" }, amount: -BigInt(1052428450) },
            { asset: { policyId: "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34", assetName: "5553444378" }, amount: BigInt(1052024847) },
          ],
          isContinuation: false, feeDeducted: BigInt(2780000), route: null,
        },
      ],
      manifest: null, hasCancel: false, sortedToBody: [0, 1, 2], issues: [],
    };

    const graph = buildV4ScoopGraph(scoop);
    expect(graph.unlinkedOrderIndices).toEqual([]);
    expect(graph.edges.every((e) => e.basis === "transcript")).toBe(true);

    // The order feeds pool A, which is the one that takes sUSDr. Linking it to
    // pool B — the pool that released the USDCx it received — was the defect:
    // the order's sUSDr never entered pool B.
    const fromOrder = graph.edges.find((e) => e.from === "o0:in");
    expect(fromOrder?.to).toBe("s0.0");
    expect(fromOrder?.asset.assetName).toBe("7355534472");

    // Pool B pays the order out.
    const toOrder = graph.edges.find((e) => e.to === "o0:out");
    expect(toOrder?.from).toBe("s1.0");
    expect(toOrder?.asset.assetName).toBe("5553444378");

    // The hops meet at USDr, the asset the two pools share.
    const junction = [...graph.nodes.values()].find((n) => n.kind === "asset");
    if (junction?.kind !== "asset") throw new Error("expected an asset junction");
    expect(junction.asset.assetName).toBe("55534472");
  });
});
