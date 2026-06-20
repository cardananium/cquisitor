// Build "Open in de-uplc-web" deep-links for a validated transaction's redeemers.
//
// Every field de-uplc needs — script bytecode, plutus version, the applied redeemer/datum, and the
// script context — is returned VERBATIM by cquisitor-lib's phase-2 eval (EvalRedeemerResult). The
// lib resolves the script (witness OR reference), encodes the exact PlutusData args its machine ran,
// and emits them as CBOR hex. So the stepped execution in de-uplc matches our eval bit-for-bit and
// nothing is reconstructed on the frontend.
//
// de-uplc-web accepts a URL deep-link in "parts" mode (script + v + context + redeemer/datum) and a
// compressed form `#d=<base64url(gzip(json))>` for large scripts. See de-uplc-web/apps/web/src/url-launch.ts.
//
// Apply-order rule (de-uplc applies datum -> redeemer -> context, only what's present):
//   V3 (any purpose): context ONLY — the V3 ScriptContext embeds the redeemer and the (optional) datum.
//   V1/V2 spend:      datum (if present) + redeemer + context.
//   V1/V2 non-spend:  redeemer + context.

import type { EvalRedeemerResult } from "@cardananium/cquisitor-lib";
import type { Redeemer } from "@/components/TransactionCardView/types";
import { toBase64Url } from "./shareLink/base64url";

/** Deployed de-uplc-web origin (GitHub Pages, project subpath). Override with NEXT_PUBLIC_DE_UPLC_BASE_URL. */
export const DE_UPLC_BASE_URL =
  process.env.NEXT_PUBLIC_DE_UPLC_BASE_URL?.replace(/\/+$/, "") ??
  "https://cardananium.github.io/de-uplc-web";

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

const V_PARAM: Record<string, DeUplcFields["v"]> = { V1: "v1", V2: "v2", V3: "v3" };

/** Normalize a redeemer tag: CSL's decoded-tx uses "VotingProposal", eval uses "Propose". */
function canonTag(t: string): string {
  return t === "VotingProposal" ? "Propose" : t;
}

/** Build the de-uplc launch fields for one eval result. Pure — all data is already in the result. */
export function fieldsFromEval(ev: EvalRedeemerResult): DeUplcLink {
  if (!ev.script_bytes || !ev.plutus_version || !V_PARAM[ev.plutus_version]) {
    return { ok: false, reason: "Script bytecode not available for this redeemer" };
  }
  const fields: DeUplcFields = { script: ev.script_bytes, v: V_PARAM[ev.plutus_version] };
  if (!ev.script_context_bytes) {
    // eval couldn't build a context (script-lookup/build failure) — degrade to bytecode-only.
    return { ok: true, fields, fidelity: "program-only" };
  }
  fields.context = ev.script_context_bytes;
  if (ev.plutus_version === "V1" || ev.plutus_version === "V2") {
    if (ev.redeemer_bytes) fields.redeemer = ev.redeemer_bytes;
    // V1/V2 spend may carry a datum; non-spend never does. (V3 embeds it in the context.)
    if (ev.tag === "Spend" && ev.datum_bytes) fields.datum = ev.datum_bytes;
  }
  return { ok: true, fields, fidelity: "full" };
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
  | { ok: true; url: string; fidelity: "full" | "program-only" }
  | { ok: false; reason: string };

export interface DeUplcLinkMaps {
  /** Per redeemer (keyed by its array index in witness_set.redeemers). */
  byRedeemer: Map<number, DeUplcResolved>;
  /** Per eval result, keyed by `${tag}:${index}` (matches EvalRedeemerResult.tag/index). */
  byEval: Map<string, DeUplcResolved>;
}

/**
 * Resolve + encode every eval result's link and map them back to redeemers by (tag, index). Async
 * because large links are gzip-compressed. Call only after Validate (eval results present).
 */
export async function buildAllDeUplcLinks(
  evalResults: EvalRedeemerResult[],
  redeemers: Redeemer[],
  base = DE_UPLC_BASE_URL,
): Promise<DeUplcLinkMaps> {
  const byEval = new Map<string, DeUplcResolved>();
  for (const ev of evalResults) {
    const link = fieldsFromEval(ev);
    const resolved: DeUplcResolved = link.ok
      ? { ok: true, url: await fieldsToUrl(link.fields, base), fidelity: link.fidelity }
      : link;
    byEval.set(`${ev.tag}:${ev.index}`, resolved);
  }

  const byRedeemer = new Map<number, DeUplcResolved>();
  redeemers.forEach((r, i) => {
    const res = byEval.get(`${canonTag(r.tag)}:${r.index}`);
    if (res) byRedeemer.set(i, res);
  });

  return { byRedeemer, byEval };
}
