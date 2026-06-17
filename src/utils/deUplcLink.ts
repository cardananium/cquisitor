// Build "Open in de-uplc-web" deep-links for a validated transaction's scripts/redeemers.
//
// de-uplc-web (the UPLC step-debugger) accepts a URL deep-link in "parts" mode:
//   script  — compiled bytecode hex (the witness/reference plutus script)
//   v       — plutus version v1|v2|v3
//   context — the script context as PlutusData CBOR hex (de-uplc applies it as the last arg)
//   redeemer/datum — PlutusData CBOR hex (V1/V2 only; V3 embeds them in the context)
// and ALSO a compressed form `#d=<base64url(gzip(json))>` carrying the same fields (smaller URLs,
// large scripts). See de-uplc-web/apps/web/src/url-launch.ts.
//
// The script CONTEXT is sourced verbatim from cquisitor-lib's
// `EvalRedeemerResult.script_context_bytes` — the exact `ScriptContext.to_plutus_data()` CBOR the
// validator ran against — so the stepped execution matches our phase-2 eval. Nothing is hand-built.
//
// Apply-order rule (de-uplc applies datum -> redeemer -> context, only what's present):
//   V3 (any purpose): context ONLY (the V3 ScriptContext embeds redeemer + script_info).
//   V1/V2 spend:      datum + redeemer + context.
//   V1/V2 non-spend:  redeemer + context.

import { decode as cborDecode } from "cbor-x";
import { bech32 } from "bech32";
import type {
  EvalRedeemerResult,
  ExtractedHashes,
  PlutusVersion,
  UtxoInputContext,
} from "@cardananium/cquisitor-lib";
import type {
  Redeemer,
  TransactionBody,
  TransactionInput,
  WitnessSet,
} from "@/components/TransactionCardView/types";
import { toBase64Url } from "./shareLink/base64url";
import { plutusJsonToCborHex } from "./deUplcPlutusData";

/** Deployed de-uplc-web origin (Cloudflare Pages, root). Override with NEXT_PUBLIC_DE_UPLC_BASE_URL. */
export const DE_UPLC_BASE_URL =
  process.env.NEXT_PUBLIC_DE_UPLC_BASE_URL?.replace(/\/+$/, "") ??
  "https://de-uplc-web.pages.dev";

/** The de-uplc-web launch fields (mirror of its URL params). */
export interface DeUplcFields {
  script: string; // compiled bytecode hex
  v: "v1" | "v2" | "v3";
  context?: string; // PlutusData CBOR hex
  redeemer?: string; // PlutusData CBOR hex (V1/V2)
  datum?: string; // PlutusData CBOR hex (V1/V2 spend)
}

export type DeUplcLink =
  | { ok: true; fields: DeUplcFields; fidelity: "full" | "program-only" }
  | { ok: false; reason: string };

/** Everything the resolver needs from the validated transaction (all already in scope post-Validate). */
export interface DeUplcResolveCtx {
  body: TransactionBody;
  witnessSet: WitnessSet;
  extractedHashes?: ExtractedHashes | null;
  evalResults?: EvalRedeemerResult[] | null;
  /** Resolved inputs/reference-inputs, from buildValidationContext(fetchedContext, network).utxoSet. */
  utxoSet: UtxoInputContext[];
}

const V_PARAM: Record<PlutusVersion, DeUplcFields["v"]> = { V1: "v1", V2: "v2", V3: "v3" };

function lexLess(a: string, b: string): boolean {
  return a < b;
}

/** Normalize a redeemer tag: CSL's decoded-tx uses "VotingProposal", eval uses "Propose". */
function canonTag(t: string): string {
  return t === "VotingProposal" ? "Propose" : t;
}

/** Tx inputs in ledger-canonical order (ascending by transaction_id BYTES then index). */
function canonicalInputs(body: TransactionBody): TransactionInput[] {
  return [...(body.inputs ?? [])].sort((x, y) => {
    const xt = x.transaction_id.toLowerCase();
    const yt = y.transaction_id.toLowerCase();
    return xt === yt ? x.index - y.index : lexLess(xt, yt) ? -1 : 1;
  });
}

function findUtxo(
  utxoSet: UtxoInputContext[],
  txHash: string,
  outputIndex: number,
): UtxoInputContext | undefined {
  const t = txHash.toLowerCase();
  return utxoSet.find(
    (u) => u.utxo.input.txHash.toLowerCase() === t && u.utxo.input.outputIndex === outputIndex,
  );
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/**
 * The script hash in a Shelley address's PAYMENT credential, or null if the payment credential is a
 * key (or the address isn't a script-payment Shelley address). Address types 1/3/5/7 (odd type
 * nibble) have a script payment credential; the 28-byte hash follows the 1-byte header.
 */
function paymentScriptHash(address: string): string | null {
  try {
    const a = address.trim();
    let bytes: Uint8Array;
    if (/^[0-9a-fA-F]+$/.test(a)) bytes = hexToBytes(a);
    else bytes = Uint8Array.from(bech32.fromWords(bech32.decode(a, 1023).words));
    if (bytes.length < 29) return null;
    const type = bytes[0] >> 4;
    if (type > 7 || (type & 1) !== 1) return null; // Byron/other, or key-payment
    return bytesToHex(bytes.slice(1, 29));
  } catch {
    return null;
  }
}

/** The script hash a redeemer targets, by purpose. null = can't determine from tag/index alone. */
function resolveScriptHash(
  redeemer: Redeemer,
  index: number,
  ctx: DeUplcResolveCtx,
): string | null {
  switch (redeemer.tag) {
    case "Spend": {
      // The ledger resolves a Spend script from the consumed input's address payment credential
      // (NOT a reference script on the output). Fall back to output.scriptHash defensively.
      const inp = canonicalInputs(ctx.body)[index];
      if (!inp) return null;
      const out = findUtxo(ctx.utxoSet, inp.transaction_id, inp.index)?.utxo.output;
      if (!out) return null;
      return paymentScriptHash(out.address) ?? out.scriptHash ?? null;
    }
    case "Mint": {
      // Mint redeemer index = position in the policy-id-sorted mint; policy id == script hash.
      const policies = (ctx.body.mint ?? []).map(([pid]) => pid.toLowerCase()).sort();
      return policies[index] ?? null;
    }
    // Cert/Reward/Vote/Propose: fall back to the single-script shortcut in resolveScript().
    default:
      return null;
  }
}

interface ScriptResolution {
  scriptHex: string;
  version: PlutusVersion;
}

/** Unwrap a reference-input `scriptRef` ([tag, scriptBytes] CBOR) to bytecode hex + version. */
function refScriptResolution(scriptRefHex: string): ScriptResolution | null {
  try {
    const buf = Uint8Array.from(
      scriptRefHex.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)),
    );
    const decoded = cborDecode(buf) as [number, Uint8Array];
    if (!Array.isArray(decoded) || decoded.length < 2) return null;
    const [tag, bytes] = decoded;
    const version: PlutusVersion | null =
      tag === 1 ? "V1" : tag === 2 ? "V2" : tag === 3 ? "V3" : null;
    if (!version || !(bytes instanceof Uint8Array)) return null; // native (0) is not UPLC
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return { scriptHex: hex, version };
  } catch {
    return null;
  }
}

/** Resolve bytecode hex + version for a redeemer: witness script (by hash), then reference script. */
function resolveScript(
  redeemer: Redeemer,
  index: number,
  ctx: DeUplcResolveCtx,
): ScriptResolution | null {
  const infos = ctx.extractedHashes?.witness_plutus_scripts ?? [];
  const scripts = ctx.witnessSet.plutus_scripts ?? [];
  const hash = resolveScriptHash(redeemer, index, ctx);

  // 1) witness script by hash
  if (hash) {
    const h = hash.toLowerCase();
    const i = infos.findIndex((s) => s?.hash.toLowerCase() === h);
    if (i >= 0 && scripts[i] && infos[i]) {
      return { scriptHex: scripts[i], version: infos[i]!.version };
    }
    // 2) reference script by hash
    const ref = ctx.utxoSet.find(
      (u) => u.utxo.output.scriptHash?.toLowerCase() === h && u.utxo.output.scriptRef,
    );
    if (ref?.utxo.output.scriptRef) {
      const r = refScriptResolution(ref.utxo.output.scriptRef);
      if (r) return r;
    }
  }

  // 3) single-witness-script shortcut (covers Cert/Reward/Vote/Propose, single-validator txs)
  const present = infos
    .map((info, i) => (info && scripts[i] ? { scriptHex: scripts[i], version: info.version } : null))
    .filter((x): x is ScriptResolution => x !== null);
  if (present.length === 1) return present[0];

  return null;
}

/** Datum for a V1/V2 Spend redeemer: inline on the resolved UTxO, else witness datum by hash. */
function resolveSpendDatum(
  index: number,
  ctx: DeUplcResolveCtx,
): string | undefined {
  const inp = canonicalInputs(ctx.body)[index];
  if (!inp) return undefined;
  const utxo = findUtxo(ctx.utxoSet, inp.transaction_id, inp.index);
  if (!utxo) return undefined;
  // Inline datum (output.plutusData) is already CBOR hex; a witness datum (plutus_data.elems) is a
  // DetailedSchema JSON string. plutusJsonToCborHex passes hex through and converts JSON to CBOR hex.
  const inline = utxo.utxo.output.plutusData;
  if (inline) return plutusJsonToCborHex(inline);
  const dataHash = utxo.utxo.output.dataHash?.toLowerCase();
  if (dataHash) {
    const hashes = ctx.extractedHashes?.witness_datum_hashes ?? [];
    const elems = ctx.witnessSet.plutus_data?.elems ?? [];
    const j = hashes.findIndex((h) => h?.toLowerCase() === dataHash);
    if (j >= 0 && elems[j]) return plutusJsonToCborHex(elems[j]);
  }
  return undefined;
}

/** Build the de-uplc launch fields for ONE redeemer (post-Validate). Pure. */
export function resolveRedeemerLink(
  redeemer: Redeemer,
  redeemerArrayIndex: number,
  ctx: DeUplcResolveCtx,
): DeUplcLink {
  const script = resolveScript(redeemer, Number(redeemer.index), ctx);
  if (!script) return { ok: false, reason: "Script bytecode not found for this redeemer" };

  // Match the eval result by (tag, index) — robust to ordering. The decoded-tx tag uses CSL's
  // spelling ("VotingProposal") while eval uses "Propose"; normalize before comparing.
  const ev =
    ctx.evalResults?.find(
      (e) => canonTag(e.tag) === canonTag(redeemer.tag) && String(e.index) === String(redeemer.index),
    ) ?? ctx.evalResults?.[redeemerArrayIndex];
  const context = ev?.script_context_bytes ?? undefined;

  const fields: DeUplcFields = { script: script.scriptHex, v: V_PARAM[script.version] };
  if (!context) {
    // eval couldn't build a context (script-lookup/build failure) — degrade to bytecode-only.
    return { ok: true, fields, fidelity: "program-only" };
  }
  fields.context = context;
  if (script.version === "V1" || script.version === "V2") {
    fields.redeemer = plutusJsonToCborHex(redeemer.data); // DetailedSchema JSON → CBOR hex
    if (redeemer.tag === "Spend") {
      const datum = resolveSpendDatum(Number(redeemer.index), ctx);
      if (datum) fields.datum = datum;
    }
  }
  // V3: context only (it embeds redeemer + script_info).
  return { ok: true, fields, fidelity: "full" };
}

/** Bytecode-only program link for a witness script card (no context; always available). */
export function programFields(scriptHex: string, version: PlutusVersion): DeUplcFields {
  return { script: scriptHex, v: V_PARAM[version] };
}

// ── URL encoders ──────────────────────────────────────────────────────────────────────────────

/** Plain hash URL: BASE/#script=…&v=…&context=… (hex params are URL-safe; hash dodges server caps). */
export function fieldsToPlainUrl(fields: DeUplcFields, base = DE_UPLC_BASE_URL): string {
  const p = new URLSearchParams();
  p.set("script", fields.script);
  p.set("v", fields.v);
  if (fields.context) p.set("context", fields.context);
  if (fields.redeemer) p.set("redeemer", fields.redeemer);
  if (fields.datum) p.set("datum", fields.datum);
  return `${base}/#${p.toString()}`;
}

async function gzipToBase64Url(text: string): Promise<string> {
  const input = new TextEncoder().encode(text);
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return toBase64Url(buf);
}

/** Compressed hash URL: BASE/#d=<base64url(gzip(json fields))>. de-uplc-web decodes it natively. */
export async function fieldsToCompressedUrl(
  fields: DeUplcFields,
  base = DE_UPLC_BASE_URL,
): Promise<string> {
  const d = await gzipToBase64Url(JSON.stringify(fields));
  return `${base}/#d=${d}`;
}

/** Plain URL if it's comfortably small, otherwise the compressed form (handles large validators). */
export async function fieldsToUrl(fields: DeUplcFields, base = DE_UPLC_BASE_URL): Promise<string> {
  const plain = fieldsToPlainUrl(fields, base);
  if (plain.length <= 6000) return plain;
  return fieldsToCompressedUrl(fields, base);
}

// ── High-level: resolve + encode all of a validated tx's links ──────────────────────────────────

/** A card-ready link result (URL string + status), or a reason it couldn't be built. */
export type DeUplcResolved =
  | { ok: true; url: string; fidelity: "full" | "program-only"; scriptHex: string }
  | { ok: false; reason: string };

export interface DeUplcLinkMaps {
  /** Per redeemer (keyed by its array index in witness_set.redeemers). */
  byRedeemer: Map<number, DeUplcResolved>;
  /** Per witness plutus_scripts index: the single redeemer using it, 'ambiguous', or null (none). */
  byScript: (DeUplcResolved | "ambiguous" | null)[];
}

/**
 * Resolve + encode every redeemer's link and group them per witness script. Async because large
 * links are gzip-compressed. Call only after Validate (eval results + resolved utxoSet present).
 */
export async function buildAllDeUplcLinks(
  ctx: DeUplcResolveCtx,
  base = DE_UPLC_BASE_URL,
): Promise<DeUplcLinkMaps> {
  const redeemers = ctx.witnessSet.redeemers ?? [];
  const scripts = ctx.witnessSet.plutus_scripts ?? [];

  const byRedeemer = new Map<number, DeUplcResolved>();
  for (let i = 0; i < redeemers.length; i++) {
    const link = resolveRedeemerLink(redeemers[i], i, ctx);
    if (link.ok) {
      const url = await fieldsToUrl(link.fields, base);
      byRedeemer.set(i, { ok: true, url, fidelity: link.fidelity, scriptHex: link.fields.script });
    } else {
      byRedeemer.set(i, link);
    }
  }

  const resolved = [...byRedeemer.values()];
  const byScript = scripts.map((s) => {
    const using = resolved.filter((l): l is Extract<DeUplcResolved, { ok: true }> => l.ok && l.scriptHex === s);
    if (using.length === 1) return using[0];
    if (using.length > 1) return "ambiguous" as const;
    return null;
  });

  return { byRedeemer, byScript };
}
