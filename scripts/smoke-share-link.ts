/**
 * Round-trip smoke test for share link encoder/parser.
 * Run with: bun run scripts/smoke-share-link.ts
 *
 * Verifies:
 *  - Minimal URLs encode and parse cleanly
 *  - Compressed (brotli) URLs round-trip with BigInts preserved
 *  - Readable (JSON) URLs round-trip
 *  - ctx_v mismatch is detected (ctxIncompatible=true, ctx dropped)
 *  - Future version (v > current) falls back to raw params
 *  - Third-party minimal URL (no v) parses cleanly
 */
import {
  encodeValidatorLink,
  encodeCardanoCborLink,
  encodeGeneralCborLink,
  parseHash,
  parseValidatorShare,
  parseCardanoCborShare,
  parseGeneralCborShare,
} from "../src/utils/shareLink";
import type { FetchedValidationData } from "../src/utils/transactionValidation";

const opts = { origin: "https://example.test", basePath: "" };

function deepEqualBigInt(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "bigint" || typeof b === "bigint") return a === b;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqualBigInt(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!deepEqualBigInt(ao[k], bo[k])) return false;
  return true;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

function sampleCtx(): FetchedValidationData {
  return {
    utxoSet: [
      {
        utxo: {
          input: { txHash: "aabbcc", outputIndex: 0 },
          output: {
            address: "addr_test1",
            amount: [{ unit: "lovelace", quantity: "10000000" }],
          },
        },
        isSpent: false,
      },
    ],
    accountContexts: [
      {
        bech32Address: "stake1u9abc",
        isRegistered: true,
        balance: 1234567,
        delegatedToDrep: "drep1abc",
        delegatedToPool: "pool1abc",
        payedDeposit: 2000000,
      },
    ],
    poolContexts: [
      { poolId: "pool1xyz", isRegistered: true, retirementEpoch: 500 },
    ],
    drepContexts: [
      { bech32Drep: "drep1xyz", isRegistered: true, payedDeposit: 500000000 },
    ],
    govActionContexts: [
      {
        actionId: { index: 7n, txHash: [1, 2, 3, 4, 5] },
        actionType: "ParameterChange" as unknown as import("@cardananium/cquisitor-lib").GovernanceActionType,
        isActive: true,
      },
    ],
    lastEnactedGovAction: [
      {
        actionId: { index: 42n, txHash: [9, 9, 9] },
        actionType: "HardForkInitiation" as unknown as import("@cardananium/cquisitor-lib").GovernanceActionType,
        isActive: false,
      },
    ],
    currentCommitteeMembers: [
      {
        committeeMemberCold: { kind: "Key", hash: "aa" } as unknown as import("@cardananium/cquisitor-lib").LocalCredential,
        committeeMemberHot: { kind: "Key", hash: "bb" } as unknown as import("@cardananium/cquisitor-lib").LocalCredential,
        isResigned: false,
      },
    ],
    potentialCommitteeMembers: [
      {
        committeeMemberCold: { kind: "Script", hash: "cc" } as unknown as import("@cardananium/cquisitor-lib").LocalCredential,
        committeeMemberHot: null,
        isResigned: true,
      },
    ],
    protocolParameters: {
      minFeeCoefficientA: 44n,
      minFeeConstantB: 155381n,
      maxBlockBodySize: 90112,
      maxTransactionSize: 16384,
      maxBlockHeaderSize: 1100,
      stakeKeyDeposit: 2000000n,
      stakePoolDeposit: 500000000n,
      maxEpochForPoolRetirement: 18,
      protocolVersion: [9, 0],
      minPoolCost: 340000000n,
      adaPerUtxoByte: 4310n,
      costModels: {},
      executionPrices: {
        memPrice: { numerator: 577n, denominator: 10000n },
        stepPrice: { numerator: 721n, denominator: 10000000n },
      },
      maxTxExecutionUnits: { mem: 14000000, steps: 10000000000 },
      maxBlockExecutionUnits: { mem: 62000000, steps: 40000000000 },
      maxValueSize: 5000,
      collateralPercentage: 150,
      maxCollateralInputs: 3,
      governanceActionDeposit: 100000000000n,
      drepDeposit: 500000000n,
      referenceScriptCostPerByte: { numerator: 15n, denominator: 1n },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    slot: 135678901n,
    treasuryValue: 1_234_567_890_123n,
    utxoInfos: [
      {
        tx_hash: "aabbcc",
        tx_index: 0,
        address: "addr_test1",
        value: "10000000",
        stake_address: null,
        payment_cred: null,
        epoch_no: 0,
        block_height: 0,
        block_time: 0,
        datum_hash: null,
        inline_datum: null,
        reference_script: null,
        asset_list: [],
        is_spent: false,
      },
    ],
  };
}

async function main() {
  const cbor = "84a4008182582000".padEnd(100, "0");

  // 1. Minimal validator link (third-party compatible)
  const minimalValidator = await encodeValidatorLink(
    opts,
    { cbor, net: "preview" },
    { kind: "minimal" },
    false
  );
  assert(
    minimalValidator.includes("cbor=") && minimalValidator.includes("net=preview"),
    "Minimal validator link has cbor & net"
  );
  assert(!minimalValidator.includes("v=1"), "Minimal validator link has no v=1");
  assert(!minimalValidator.includes("&d="), "Minimal validator link has no d=");

  const minHash = new URL(minimalValidator).hash;
  const minParsed = parseHash(minHash);
  assert(minParsed.tab === "transaction-validator", "Minimal parses tab=transaction-validator");
  const minShare = await parseValidatorShare(minParsed.params);
  assert(minShare.cbor === cbor, "Minimal validator round-trips cbor");
  assert(minShare.net === "preview", "Minimal validator round-trips net");
  assert(!minShare.ctx, "Minimal validator has no ctx");

  // 2. Compressed validator link with ctx (bigints in protocol params + slot + treasury)
  const ctx = sampleCtx();
  const compressedValidator = await encodeValidatorLink(
    opts,
    { cbor, net: "mainnet", ctx, capturedAt: 1_700_000_000_000 },
    { kind: "compressed" },
    true
  );
  assert(compressedValidator.includes("v=1"), "Compressed validator link has v=1");
  assert(compressedValidator.includes("e=b"), "Compressed validator link has e=b");
  assert(compressedValidator.includes("&d="), "Compressed validator link has d=");

  const comHash = new URL(compressedValidator).hash;
  const comParsed = parseHash(comHash);
  const comShare = await parseValidatorShare(comParsed.params);
  assert(comShare.cbor === cbor, "Compressed validator round-trips cbor");
  assert(comShare.net === "mainnet", "Compressed validator round-trips net");
  assert(comShare.capturedAt === 1_700_000_000_000, "Compressed validator round-trips capturedAt");
  assert(comShare.ctx, "Compressed validator has ctx");
  assert(
    deepEqualBigInt(comShare.ctx, ctx),
    "Compressed validator round-trips full ctx deeply (all subcontexts + bigints)"
  );
  assert(comShare.ctx!.slot === 135678901n, "Compressed validator preserves slot as bigint");
  assert(
    comShare.ctx!.treasuryValue === 1_234_567_890_123n,
    "Compressed validator preserves treasuryValue as bigint"
  );
  assert(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (comShare.ctx!.protocolParameters as any).minFeeCoefficientA === 44n,
    "Compressed validator preserves protocolParameters.minFeeCoefficientA as bigint"
  );

  // 3. Readable validator link
  const readableValidator = await encodeValidatorLink(
    opts,
    { cbor, net: "preprod", ctx },
    { kind: "readable" },
    true
  );
  assert(readableValidator.includes("e=j"), "Readable validator link has e=j");

  const readParsed = parseHash(new URL(readableValidator).hash);
  const readShare = await parseValidatorShare(readParsed.params);
  assert(readShare.ctx!.slot === 135678901n, "Readable validator preserves slot as bigint");
  assert(
    deepEqualBigInt(readShare.ctx, ctx),
    "Readable validator round-trips full ctx deeply (all subcontexts + bigints)"
  );

  // 4. Future version: v=9999 → should fall back, ctx not applied
  const futureUrl = compressedValidator.replace("v=1", "v=9999");
  const futureHash = new URL(futureUrl).hash;
  const futureShare = await parseValidatorShare(parseHash(futureHash).params);
  assert(futureShare.futureVersion === true, "Future version flag set");
  assert(!futureShare.ctx, "Future version drops ctx");
  assert(futureShare.cbor === cbor, "Future version keeps raw cbor fallback");
  assert(futureShare.net === "mainnet", "Future version keeps raw net fallback");

  // 5. Third-party minimal URL (hand-crafted, no v at all)
  const thirdParty = "#transaction-validator?cbor=" + cbor + "&net=mainnet";
  const tpParsed = parseHash(thirdParty);
  const tpShare = await parseValidatorShare(tpParsed.params);
  assert(tpShare.cbor === cbor, "Third-party link parses cbor");
  assert(tpShare.net === "mainnet", "Third-party link parses net");

  // 6. Cardano CBOR: minimal
  const minimalCardano = await encodeCardanoCborLink(
    opts,
    { cbor, net: "mainnet", type: "Transaction", psv: null, pds: null },
    { kind: "minimal" }
  );
  assert(minimalCardano.includes("type=Transaction"), "Minimal cardano-cbor has type param");
  const mcParsed = parseHash(new URL(minimalCardano).hash);
  const mcShare = await parseCardanoCborShare(mcParsed.params);
  assert(mcShare.cbor === cbor, "Minimal cardano round-trips cbor");
  assert(mcShare.type === "Transaction", "Minimal cardano round-trips type");

  // 7. Cardano CBOR: compressed with PlutusScript + psv=3
  const compressedCardano = await encodeCardanoCborLink(
    opts,
    { cbor, net: "preview", type: "PlutusScript", psv: 3, pds: null },
    { kind: "compressed" }
  );
  assert(compressedCardano.includes("v=1&e=b"), "Compressed cardano has v=1&e=b");
  const ccParsed = parseHash(new URL(compressedCardano).hash);
  const ccShare = await parseCardanoCborShare(ccParsed.params);
  assert(ccShare.cbor === cbor, "Compressed cardano round-trips cbor");
  assert(ccShare.type === "PlutusScript", "Compressed cardano round-trips type");
  assert(ccShare.psv === 3, "Compressed cardano round-trips psv");

  // 8. Cardano CBOR: PlutusData with pds=DetailedSchema shortened to 'd'
  const dsCardano = await encodeCardanoCborLink(
    opts,
    { cbor, net: "mainnet", type: "PlutusData", psv: null, pds: "DetailedSchema" },
    { kind: "minimal" }
  );
  assert(dsCardano.includes("pds=d"), "Minimal cardano encodes pds=d");
  const dsParsed = parseHash(new URL(dsCardano).hash);
  const dsShare = await parseCardanoCborShare(dsParsed.params);
  assert(dsShare.pds === "DetailedSchema", "Minimal cardano round-trips pds=DetailedSchema");

  // 9. General CBOR: minimal & compressed
  const minimalGeneral = await encodeGeneralCborLink(opts, { cbor }, { kind: "minimal" });
  const gParsed = parseHash(new URL(minimalGeneral).hash);
  const gShare = await parseGeneralCborShare(gParsed.params);
  assert(gShare.cbor === cbor, "Minimal general-cbor round-trips cbor");

  const compressedGeneral = await encodeGeneralCborLink(opts, { cbor }, { kind: "compressed" });
  const cgParsed = parseHash(new URL(compressedGeneral).hash);
  const cgShare = await parseGeneralCborShare(cgParsed.params);
  assert(cgShare.cbor === cbor, "Compressed general-cbor round-trips cbor");

  // 10. Hand-craft ctx_v mismatch by swapping CTX_SCHEMA_VERSION in the compressed payload.
  //     We approximate by modifying the d= portion to point at a different payload with ctx_v=999.
  //     Easiest route: rebuild the payload manually with wrong ctx_v and encode.
  {
    const { stringifyWithBigInt } = await import("../src/utils/shareLink/bigintJson");
    const { brotliCompress } = await import("../src/utils/shareLink/compression");
    const { toBase64Url, textToBytes, hexToBytes } = await import(
      "../src/utils/shareLink/base64url"
    );
    const badRest = { ctx_v: 999, net: "mainnet", ctx };
    const cborBytes = hexToBytes(cbor);
    const jsonBytes = textToBytes(stringifyWithBigInt(badRest));
    const container = new Uint8Array(4 + cborBytes.length + jsonBytes.length);
    new DataView(container.buffer).setUint32(0, cborBytes.length, false);
    container.set(cborBytes, 4);
    container.set(jsonBytes, 4 + cborBytes.length);
    const compressed = await brotliCompress(container);
    const d = toBase64Url(compressed);
    const badUrl = `#transaction-validator?v=1&e=b&d=${d}&cbor=${cbor}&net=mainnet`;
    const badParsed = parseHash(badUrl);
    const badShare = await parseValidatorShare(badParsed.params);
    assert(badShare.ctxIncompatible === true, "ctx_v mismatch sets ctxIncompatible=true");
    assert(!badShare.ctx, "ctx_v mismatch drops ctx");
    assert(badShare.cbor === cbor, "ctx_v mismatch keeps cbor fallback");
    assert(badShare.net === "mainnet", "ctx_v mismatch keeps net fallback");
  }

  console.log("\n🎉 All share-link round-trip assertions passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
