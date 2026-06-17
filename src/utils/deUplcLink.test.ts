import { describe, expect, test } from "bun:test";
import type { EvalRedeemerResult, UtxoInputContext } from "@cardananium/cquisitor-lib";
import type { Redeemer } from "@/components/TransactionCardView/types";
import {
  resolveRedeemerLink,
  buildAllDeUplcLinks,
  fieldsToPlainUrl,
  fieldsToCompressedUrl,
  programFields,
  type DeUplcResolveCtx,
  type DeUplcFields,
} from "./deUplcLink";
import { fromBase64Url } from "./shareLink/base64url";
import { bech32 } from "bech32";

function hexBytes(h: string): Uint8Array {
  const o: number[] = [];
  for (let i = 0; i < h.length; i += 2) o.push(parseInt(h.slice(i, i + 2), 16));
  return Uint8Array.from(o);
}
/** A mainnet enterprise-script address (type 7) for a 28-byte script hash. */
function scriptAddr(hash28: string): string {
  const bytes = Uint8Array.from([0x71, ...hexBytes(hash28)]);
  return bech32.encode("addr", bech32.toWords(bytes), 1023);
}

// ── helpers to build minimal typed mocks ───────────────────────────────────────────────────────

function redeemer(tag: string, index: number, data = "d8799f00ff"): Redeemer {
  return { tag, index: String(index), data, ex_units: { mem: "0", steps: "0" } };
}

function evalResult(tag: string, index: number, ctx: string | null): EvalRedeemerResult {
  return {
    tag: tag as EvalRedeemerResult["tag"],
    index: BigInt(index),
    script_context_bytes: ctx,
    script_context: null,
    success: ctx !== null,
    error: null,
    logs: [],
    calculated_ex_units: { mem: BigInt(0), steps: BigInt(0) },
    provided_ex_units: { mem: BigInt(0), steps: BigInt(0) },
  } as unknown as EvalRedeemerResult;
}

function utxo(
  txHash: string,
  outputIndex: number,
  output: Partial<UtxoInputContext["utxo"]["output"]>,
): UtxoInputContext {
  return {
    isSpent: true,
    utxo: {
      input: { txHash, outputIndex },
      output: { address: "addr", amount: [], ...output },
    },
  } as unknown as UtxoInputContext;
}

function parseHashParams(url: string): URLSearchParams {
  const hash = url.slice(url.indexOf("#") + 1);
  return new URLSearchParams(hash);
}

async function gunzipBase64Url(d: string): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  void w.write(fromBase64Url(d) as BufferSource);
  void w.close();
  return new Response(ds.readable).text();
}

// ── tests ──────────────────────────────────────────────────────────────────────────────────────

describe("resolveRedeemerLink — param mapping per version", () => {
  test("V3 spend → context ONLY (no redeemer/datum)", () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [{ transaction_id: "aa", index: 0 }] } as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["5350563348"],
        redeemers: [redeemer("Spend", 0)],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash: "H3", version: "V3" }],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Spend", 0, "d87980ctx3")],
      utxoSet: [utxo("aa", 0, { scriptHash: "H3" })],
    };
    const link = resolveRedeemerLink(redeemer("Spend", 0), 0, ctx);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fidelity).toBe("full");
    expect(link.fields).toEqual({ script: "5350563348", v: "v3", context: "d87980ctx3" });
    expect(link.fields.redeemer).toBeUndefined();
    expect(link.fields.datum).toBeUndefined();
  });

  test("V2 spend (inline datum) → datum + redeemer + context", () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [{ transaction_id: "bb", index: 1 }] } as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["5350563248"],
        redeemers: [redeemer("Spend", 0, "d8799f01ff")],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash: "H2", version: "V2" }],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Spend", 0, "ctxv2")],
      utxoSet: [utxo("bb", 1, { scriptHash: "H2", plutusData: "d8799fdatumff" })],
    };
    const link = resolveRedeemerLink(redeemer("Spend", 0, "d8799f01ff"), 0, ctx);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fields).toEqual({
      script: "5350563248",
      v: "v2",
      context: "ctxv2",
      redeemer: "d8799f01ff",
      datum: "d8799fdatumff",
    });
  });

  test("V2 spend (datum by witness hash) → resolves datum from plutus_data.elems", () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [{ transaction_id: "cc", index: 0 }] } as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["abcd"],
        plutus_data: { elems: ["d10000", "d20000"] },
        redeemers: [redeemer("Spend", 0)],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash: "H2", version: "V2" }],
        witness_datum_hashes: ["hashA", "hashB"],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Spend", 0, "ctx")],
      utxoSet: [utxo("cc", 0, { scriptHash: "H2", dataHash: "hashB" })],
    };
    const link = resolveRedeemerLink(redeemer("Spend", 0), 0, ctx);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fields.datum).toBe("d20000"); // elem at the matching hash index
  });

  test("V2 redeemer given as DetailedSchema JSON → passed through by the plutusJsonToCborHex stub (real json→cbor is deferred to cquisitor-lib)", () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [], mint: [["POLICY2", {}]] } as unknown as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["minthex"],
        redeemers: [redeemer("Mint", 0)],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash: "POLICY2", version: "V2" }],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Mint", 0, "mintctx")],
      utxoSet: [],
    };
    // redeemer.data as a DetailedSchema JSON string (what the real decoder produces)
    const r = redeemer("Mint", 0, '{"constructor":0,"fields":[]}');
    const link = resolveRedeemerLink(r, 0, ctx);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    // Stub passes the input through unchanged; once cquisitor-lib ships
    // `plutus_data_json_to_cbor` this becomes the canonical "d87980".
    expect(link.fields.redeemer).toBe('{"constructor":0,"fields":[]}');
  });

  test("V2 Spend resolves the script from the input's ADDRESS payment credential (no output.scriptHash)", () => {
    const hash = "ab".repeat(28); // 28-byte script hash
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [{ transaction_id: "aa", index: 0 }] } as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["scripthexV2"],
        redeemers: [redeemer("Spend", 0)],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash, version: "V2" }],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Spend", 0, "ctx")],
      // address is a script address for `hash`; NO output.scriptHash (that's only for ref scripts)
      utxoSet: [utxo("aa", 0, { address: scriptAddr(hash) })],
    };
    const link = resolveRedeemerLink(redeemer("Spend", 0), 0, ctx);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fields.script).toBe("scripthexV2");
    expect(link.fields.v).toBe("v2");
  });

  test("V2 mint → redeemer + context, NO datum", () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [], mint: [["POLICY2", {}]] } as unknown as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["minthex"],
        redeemers: [redeemer("Mint", 0)],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash: "POLICY2", version: "V2" }],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Mint", 0, "mintctx")],
      utxoSet: [],
    };
    const link = resolveRedeemerLink(redeemer("Mint", 0), 0, ctx);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fields).toEqual({ script: "minthex", v: "v2", context: "mintctx", redeemer: "d8799f00ff" });
    expect(link.fields.datum).toBeUndefined();
  });
});

describe("resolveRedeemerLink — degraded & failure paths", () => {
  test("null context (eval couldn't build one) → program-only, no context", () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [{ transaction_id: "aa", index: 0 }] } as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["scripthex"],
        redeemers: [redeemer("Spend", 0)],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash: "H3", version: "V3" }],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Spend", 0, null)],
      utxoSet: [utxo("aa", 0, { scriptHash: "H3" })],
    };
    const link = resolveRedeemerLink(redeemer("Spend", 0), 0, ctx);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fidelity).toBe("program-only");
    expect(link.fields.context).toBeUndefined();
    expect(link.fields).toEqual({ script: "scripthex", v: "v3" });
  });

  test("no resolvable script → ok:false", () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [{ transaction_id: "aa", index: 0 }] } as DeUplcResolveCtx["body"],
      witnessSet: { plutus_scripts: ["a", "b"], redeemers: [redeemer("Spend", 0)] } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [
          { hash: "X", version: "V2" },
          { hash: "Y", version: "V2" },
        ],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Spend", 0, "ctx")],
      utxoSet: [utxo("aa", 0, {})], // no scriptHash → can't resolve; 2 scripts → no shortcut
    };
    const link = resolveRedeemerLink(redeemer("Spend", 0), 0, ctx);
    expect(link.ok).toBe(false);
  });

  test("reference script (not in witness) → resolved from scriptRef [tag, bytes]", () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [], mint: [["REFHASH", {}]] } as unknown as DeUplcResolveCtx["body"],
      witnessSet: { plutus_scripts: [], redeemers: [redeemer("Mint", 0)] } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Mint", 0, "ctx")],
      // scriptRef = CBOR [2, h'4d010000'] = 82 02 44 4d010000
      utxoSet: [utxo("zz", 7, { scriptHash: "REFHASH", scriptRef: "8202444d010000" })],
    };
    const link = resolveRedeemerLink(redeemer("Mint", 0), 0, ctx);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fields.v).toBe("v2");
    expect(link.fields.script).toBe("4d010000");
  });
});

describe("URL encoders", () => {
  const fields: DeUplcFields = { script: "abcd", v: "v3", context: "ef01" };

  test("fieldsToPlainUrl uses the hash form with the right params", () => {
    const url = fieldsToPlainUrl(fields, "https://x.test");
    expect(url.startsWith("https://x.test/#")).toBe(true);
    const p = parseHashParams(url);
    expect(p.get("script")).toBe("abcd");
    expect(p.get("v")).toBe("v3");
    expect(p.get("context")).toBe("ef01");
    expect(p.get("redeemer")).toBeNull();
  });

  test("programFields → script + v only", () => {
    expect(programFields("aa", "V1")).toEqual({ script: "aa", v: "v1" });
  });

  test("fieldsToCompressedUrl round-trips to the same fields (gzip)", async () => {
    const big: DeUplcFields = {
      script: "ab".repeat(4000),
      v: "v2",
      context: "cd".repeat(1000),
      redeemer: "d8799f00ff",
    };
    const url = await fieldsToCompressedUrl(big, "https://x.test");
    expect(url.startsWith("https://x.test/#d=")).toBe(true);
    const d = parseHashParams(url).get("d")!;
    const json = await gunzipBase64Url(d);
    expect(JSON.parse(json)).toEqual(big);
    // and it's much smaller than the equivalent plain URL
    expect(url.length).toBeLessThan(fieldsToPlainUrl(big, "https://x.test").length);
  });
});

describe("buildAllDeUplcLinks — grouping & ambiguity", () => {
  test("a script used by two spend redeemers → byScript is 'ambiguous'; each redeemer distinct", async () => {
    const ctx: DeUplcResolveCtx = {
      body: {
        inputs: [
          { transaction_id: "aa", index: 0 },
          { transaction_id: "bb", index: 0 },
        ],
      } as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["shared"],
        redeemers: [redeemer("Spend", 0), redeemer("Spend", 1)],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash: "H", version: "V3" }],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Spend", 0, "c0"), evalResult("Spend", 1, "c1")],
      utxoSet: [utxo("aa", 0, { scriptHash: "H" }), utxo("bb", 0, { scriptHash: "H" })],
    };
    const maps = await buildAllDeUplcLinks(ctx, "https://x.test");
    expect(maps.byScript[0]).toBe("ambiguous");
    const r0 = maps.byRedeemer.get(0);
    const r1 = maps.byRedeemer.get(1);
    expect(r0?.ok && r1?.ok).toBe(true);
    expect(r0?.ok && r0.url).not.toBe(r1?.ok && r1.url); // different contexts → different links
  });

  test("a script used by exactly one redeemer → byScript carries that link", async () => {
    const ctx: DeUplcResolveCtx = {
      body: { inputs: [{ transaction_id: "aa", index: 0 }] } as DeUplcResolveCtx["body"],
      witnessSet: {
        plutus_scripts: ["only"],
        redeemers: [redeemer("Spend", 0)],
      } as DeUplcResolveCtx["witnessSet"],
      extractedHashes: {
        witness_plutus_scripts: [{ hash: "H", version: "V3" }],
        witness_datum_hashes: [],
      } as unknown as DeUplcResolveCtx["extractedHashes"],
      evalResults: [evalResult("Spend", 0, "c0")],
      utxoSet: [utxo("aa", 0, { scriptHash: "H" })],
    };
    const maps = await buildAllDeUplcLinks(ctx, "https://x.test");
    const s0 = maps.byScript[0];
    expect(s0 && s0 !== "ambiguous" && s0.ok).toBe(true);
  });
});
