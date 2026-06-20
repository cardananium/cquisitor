import { describe, expect, test } from "bun:test";
import type { EvalRedeemerResult } from "@cardananium/cquisitor-lib";
import type { Redeemer } from "@/components/TransactionCardView/types";
import {
  fieldsFromEval,
  buildAllDeUplcLinks,
  fieldsToPlainUrl,
  fieldsToCompressedUrl,
  type DeUplcFields,
} from "./deUplcLink";
import { fromBase64Url } from "./shareLink/base64url";

// ── minimal typed mocks ──────────────────────────────────────────────────────────────────────────

function redeemer(tag: string, index: number): Redeemer {
  return { tag, index: String(index), data: "00", ex_units: { mem: "0", steps: "0" } };
}

function evalResult(opts: {
  tag: string;
  index: number;
  version?: string | null;
  script?: string | null;
  context?: string | null;
  redeemer?: string | null;
  datum?: string | null;
}): EvalRedeemerResult {
  return {
    tag: opts.tag,
    index: BigInt(opts.index),
    script_bytes: opts.script ?? null,
    plutus_version: opts.version ?? null,
    script_context_bytes: opts.context ?? null,
    redeemer_bytes: opts.redeemer ?? null,
    datum_bytes: opts.datum ?? null,
    script_context: null,
    success: true,
    error: null,
    logs: [],
    calculated_ex_units: { mem: BigInt(0), steps: BigInt(0) },
    provided_ex_units: { mem: BigInt(0), steps: BigInt(0) },
  } as unknown as EvalRedeemerResult;
}

function parseHashParams(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf("#") + 1));
}

async function gunzipBase64Url(d: string): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  void w.write(fromBase64Url(d) as BufferSource);
  void w.close();
  return new Response(ds.readable).text();
}

// ── fieldsFromEval — param mapping per version ────────────────────────────────────────────────────

describe("fieldsFromEval — apply-order per version", () => {
  test("V3 spend → context ONLY (redeemer/datum embedded in the V3 context, never sent)", () => {
    const link = fieldsFromEval(
      evalResult({
        tag: "Spend",
        index: 0,
        version: "V3",
        script: "5350563348",
        context: "d87980ctx3",
        redeemer: "d8799f00ff", // present on the result but must be dropped for V3
        datum: "d8799fdatumff",
      }),
    );
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fidelity).toBe("full");
    expect(link.fields).toEqual({ script: "5350563348", v: "v3", context: "d87980ctx3" });
  });

  test("V3 spend WITHOUT datum → still context only (datum optional for V3 spend)", () => {
    const link = fieldsFromEval(
      evalResult({ tag: "Spend", index: 0, version: "V3", script: "aa", context: "ctx", datum: null }),
    );
    expect(link.ok && link.fields).toEqual({ script: "aa", v: "v3", context: "ctx" });
  });

  test("V2 spend → datum + redeemer + context", () => {
    const link = fieldsFromEval(
      evalResult({
        tag: "Spend",
        index: 0,
        version: "V2",
        script: "5350563248",
        context: "ctxv2",
        redeemer: "d8799f01ff",
        datum: "d8799fdatumff",
      }),
    );
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

  test("V2 mint → redeemer + context, NO datum", () => {
    const link = fieldsFromEval(
      evalResult({ tag: "Mint", index: 0, version: "V2", script: "minthex", context: "mintctx", redeemer: "d8799f00ff", datum: "shouldBeIgnored" }),
    );
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fields).toEqual({ script: "minthex", v: "v2", context: "mintctx", redeemer: "d8799f00ff" });
    expect(link.fields.datum).toBeUndefined();
  });

  test("V1 spend without a datum → redeemer + context, no datum", () => {
    const link = fieldsFromEval(
      evalResult({ tag: "Spend", index: 0, version: "V1", script: "v1hex", context: "c", redeemer: "r", datum: null }),
    );
    expect(link.ok && link.fields).toEqual({ script: "v1hex", v: "v1", context: "c", redeemer: "r" });
  });
});

describe("fieldsFromEval — degraded & failure paths", () => {
  test("null context (eval couldn't build one) → program-only, no context", () => {
    const link = fieldsFromEval(evalResult({ tag: "Spend", index: 0, version: "V3", script: "scripthex", context: null }));
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.fidelity).toBe("program-only");
    expect(link.fields).toEqual({ script: "scripthex", v: "v3" });
  });

  test("missing script bytecode → ok:false", () => {
    const link = fieldsFromEval(evalResult({ tag: "Spend", index: 0, version: "V2", script: null, context: "c" }));
    expect(link.ok).toBe(false);
  });

  test("unknown/absent version → ok:false", () => {
    const link = fieldsFromEval(evalResult({ tag: "Spend", index: 0, version: null, script: "aa", context: "c" }));
    expect(link.ok).toBe(false);
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
    expect(JSON.parse(await gunzipBase64Url(d))).toEqual(big);
    expect(url.length).toBeLessThan(fieldsToPlainUrl(big, "https://x.test").length);
  });
});

describe("buildAllDeUplcLinks — byEval / byRedeemer mapping", () => {
  test("byEval keyed by tag:index; byRedeemer maps redeemer array index → its eval link", async () => {
    const evals = [
      evalResult({ tag: "Spend", index: 0, version: "V3", script: "s0", context: "c0" }),
      evalResult({ tag: "Mint", index: 0, version: "V2", script: "s1", context: "c1", redeemer: "r1" }),
    ];
    const redeemers = [redeemer("Spend", 0), redeemer("Mint", 0)];
    const maps = await buildAllDeUplcLinks(evals, redeemers, "https://x.test");

    expect(maps.byEval.get("Spend:0")?.ok).toBe(true);
    expect(maps.byEval.get("Mint:0")?.ok).toBe(true);
    const r0 = maps.byRedeemer.get(0);
    const r1 = maps.byRedeemer.get(1);
    expect(r0?.ok && r1?.ok).toBe(true);
    expect(r0?.ok && r0.url).not.toBe(r1?.ok && r1.url); // distinct scripts/contexts → distinct links
  });

  test("decoded-tx 'VotingProposal' tag matches eval 'Propose' (canonicalized)", async () => {
    const evals = [evalResult({ tag: "Propose", index: 0, version: "V3", script: "p", context: "pc" })];
    const maps = await buildAllDeUplcLinks(evals, [redeemer("VotingProposal", 0)], "https://x.test");
    expect(maps.byRedeemer.get(0)?.ok).toBe(true);
    expect(maps.byRedeemer.get(0)).toBe(maps.byEval.get("Propose:0"));
  });
});
