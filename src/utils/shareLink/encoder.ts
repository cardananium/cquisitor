import type { PlutusDataSchema } from "@cardananium/cquisitor-lib";
import { URL_FORMAT_VERSION, CTX_SCHEMA_VERSION } from "./version";
import { toBase64Url, textToBytes, hexToBytes } from "./base64url";
import { stringifyWithBigInt } from "./bigintJson";
import { brotliCompress } from "./compression";
import type {
  ShareLinkMode,
  ValidatorShareInput,
  CardanoCborShareInput,
  GeneralCborShareInput,
} from "./types";

export interface BuildLinkOpts {
  origin: string;
  basePath: string;
}

function appendParam(
  parts: string[],
  key: string,
  value: string | number | null | undefined
) {
  if (value === null || value === undefined || value === "") return;
  parts.push(`${key}=${encodeURIComponent(String(value))}`);
}

function packContainer(cborHex: string, rest: unknown): Uint8Array {
  const cborBytes = cborHex ? hexToBytes(cborHex) : new Uint8Array(0);
  const jsonBytes = textToBytes(stringifyWithBigInt(rest));
  const out = new Uint8Array(4 + cborBytes.length + jsonBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, cborBytes.length, false);
  out.set(cborBytes, 4);
  out.set(jsonBytes, 4 + cborBytes.length);
  return out;
}

async function encodeRichData(
  cborHex: string,
  rest: unknown,
  encoding: "j" | "b"
): Promise<string> {
  const container = packContainer(cborHex, rest);
  if (encoding === "j") return toBase64Url(container);
  const compressed = await brotliCompress(container);
  return toBase64Url(compressed);
}

function pdsShort(pds: PlutusDataSchema | null | undefined): string | undefined {
  if (pds === "BasicConversions") return "b";
  if (pds === "DetailedSchema") return "d";
  return undefined;
}

function buildUrl(opts: BuildLinkOpts, tab: string, params: string[]): string {
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  return `${opts.origin}${opts.basePath}/#${tab}${query}`;
}

export async function encodeValidatorLink(
  opts: BuildLinkOpts,
  input: ValidatorShareInput,
  mode: ShareLinkMode,
  includeCtx: boolean
): Promise<string> {
  const parts: string[] = [];
  const hasCtx = includeCtx && !!input.ctx;
  const effectiveMode: ShareLinkMode =
    hasCtx && mode.kind !== "minimal" ? mode : { kind: "minimal" };

  if (effectiveMode.kind !== "minimal") {
    const rest = {
      ctx_v: CTX_SCHEMA_VERSION,
      net: input.net,
      capturedAt: input.capturedAt,
      ctx: input.ctx,
    };
    const encoding: "j" | "b" = effectiveMode.kind === "compressed" ? "b" : "j";
    const data = await encodeRichData(input.cbor, rest, encoding);
    parts.push(`v=${URL_FORMAT_VERSION}`);
    parts.push(`e=${encoding}`);
    parts.push(`d=${data}`);
  }
  appendParam(parts, "cbor", input.cbor);
  appendParam(parts, "net", input.net);

  return buildUrl(opts, "transaction-validator", parts);
}

export async function encodeCardanoCborLink(
  opts: BuildLinkOpts,
  input: CardanoCborShareInput,
  mode: ShareLinkMode
): Promise<string> {
  const parts: string[] = [];

  if (mode.kind !== "minimal") {
    const rest = {
      net: input.net,
      type: input.type ?? undefined,
      psv: input.psv ?? undefined,
      pds: input.pds ?? undefined,
    };
    const encoding: "j" | "b" = mode.kind === "compressed" ? "b" : "j";
    const data = await encodeRichData(input.cbor, rest, encoding);
    parts.push(`v=${URL_FORMAT_VERSION}`);
    parts.push(`e=${encoding}`);
    parts.push(`d=${data}`);
  } else {
    appendParam(parts, "cbor", input.cbor);
    appendParam(parts, "net", input.net);
    appendParam(parts, "type", input.type ?? undefined);
    appendParam(parts, "psv", input.psv ?? undefined);
    appendParam(parts, "pds", pdsShort(input.pds));
  }

  return buildUrl(opts, "cardano-cbor", parts);
}

export async function encodeGeneralCborLink(
  opts: BuildLinkOpts,
  input: GeneralCborShareInput,
  mode: ShareLinkMode
): Promise<string> {
  const parts: string[] = [];

  if (mode.kind !== "minimal") {
    const encoding: "j" | "b" = mode.kind === "compressed" ? "b" : "j";
    const data = await encodeRichData(input.cbor, {}, encoding);
    parts.push(`v=${URL_FORMAT_VERSION}`);
    parts.push(`e=${encoding}`);
    parts.push(`d=${data}`);
  } else {
    appendParam(parts, "cbor", input.cbor);
  }

  return buildUrl(opts, "general-cbor", parts);
}

export function getBuildLinkOpts(): BuildLinkOpts {
  if (typeof window === "undefined") return { origin: "", basePath: "" };
  const path = window.location.pathname.replace(/\/+$/, "");
  return {
    origin: window.location.origin,
    basePath: path,
  };
}
