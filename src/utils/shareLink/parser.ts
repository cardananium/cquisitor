import type { NetworkType, PlutusDataSchema } from "@cardananium/cquisitor-lib";
import type { FetchedValidationData } from "@/utils/transactionValidation";
import { URL_FORMAT_VERSION, CTX_SCHEMA_VERSION } from "./version";
import { fromBase64Url, bytesToText, bytesToHex } from "./base64url";
import { parseWithBigInt } from "./bigintJson";
import { brotliDecompress } from "./compression";
import type {
  TabId,
  ParsedValidatorShare,
  ParsedCardanoCborShare,
  ParsedGeneralCborShare,
  ValidatorRichPayloadV1,
} from "./types";

const VALID_TABS: readonly TabId[] = [
  "transaction-validator",
  "cardano-cbor",
  "general-cbor",
] as const;
const VALID_NETS: readonly NetworkType[] = ["mainnet", "preview", "preprod"] as const;

export interface ParsedHash {
  tab: TabId | null;
  params: URLSearchParams;
  invalidHash: string | null;
}

export function parseHash(hash: string): ParsedHash {
  const value = hash.replace(/^#/, "");
  if (!value) {
    return { tab: "transaction-validator", params: new URLSearchParams(), invalidHash: null };
  }
  const qIdx = value.indexOf("?");
  const tabPart = qIdx >= 0 ? value.slice(0, qIdx) : value;
  const queryPart = qIdx >= 0 ? value.slice(qIdx + 1) : "";
  if (!VALID_TABS.includes(tabPart as TabId)) {
    return { tab: null, params: new URLSearchParams(), invalidHash: tabPart };
  }
  return {
    tab: tabPart as TabId,
    params: new URLSearchParams(queryPart),
    invalidHash: null,
  };
}

function parseNet(value: string | null): NetworkType | undefined {
  if (!value) return undefined;
  return VALID_NETS.includes(value as NetworkType) ? (value as NetworkType) : undefined;
}

function parsePds(value: string | null): PlutusDataSchema | undefined {
  if (value === "d") return "DetailedSchema";
  if (value === "b") return "BasicConversions";
  if (value === "DetailedSchema" || value === "BasicConversions") return value;
  return undefined;
}

function parsePsv(value: string | null): number | undefined {
  if (value === "1" || value === "2" || value === "3") return Number(value);
  return undefined;
}

interface RichPayload {
  cbor: string;
  rest: Record<string, unknown>;
}

function unpackContainer(container: Uint8Array): RichPayload {
  if (container.length < 4) throw new Error("Rich payload too short");
  const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
  const cborLen = view.getUint32(0, false);
  if (4 + cborLen > container.length) throw new Error("Rich payload cbor length overflow");
  const cborBytes = container.subarray(4, 4 + cborLen);
  const jsonBytes = container.subarray(4 + cborLen);
  const rest = jsonBytes.length > 0
    ? (parseWithBigInt(bytesToText(jsonBytes)) as Record<string, unknown>)
    : {};
  return { cbor: bytesToHex(cborBytes), rest };
}

async function decodeRichPayload(encoding: string, data: string): Promise<RichPayload> {
  const raw = fromBase64Url(data);
  if (encoding === "b") {
    const decompressed = await brotliDecompress(raw);
    return unpackContainer(decompressed);
  }
  if (encoding === "j") {
    return unpackContainer(raw);
  }
  throw new Error(`Unsupported encoding: ${encoding}`);
}

function getRichVersionState(params: URLSearchParams):
  | { kind: "none" }
  | { kind: "future" }
  | { kind: "current"; encoding: string; data: string } {
  const v = params.get("v");
  if (v === null) return { kind: "none" };
  const vNum = Number(v);
  if (!Number.isFinite(vNum)) return { kind: "none" };
  if (vNum > URL_FORMAT_VERSION) return { kind: "future" };
  const encoding = params.get("e");
  const data = params.get("d");
  if (!encoding || !data) return { kind: "none" };
  return { kind: "current", encoding, data };
}

export async function parseValidatorShare(params: URLSearchParams): Promise<ParsedValidatorShare> {
  const out: ParsedValidatorShare = {};
  const rawCbor = params.get("cbor");
  const rawNet = parseNet(params.get("net"));
  if (rawCbor) out.cbor = rawCbor;
  if (rawNet) out.net = rawNet;

  const vState = getRichVersionState(params);
  if (vState.kind === "none") return out;
  if (vState.kind === "future") {
    out.futureVersion = true;
    return out;
  }

  try {
    const payload = await decodeRichPayload(vState.encoding, vState.data);
    const rest = payload.rest as Partial<ValidatorRichPayloadV1>;
    if (!out.cbor && payload.cbor) out.cbor = payload.cbor;
    if (!out.net && rest.net && VALID_NETS.includes(rest.net)) {
      out.net = rest.net;
    }
    if (typeof rest.capturedAt === "number") out.capturedAt = rest.capturedAt;

    if (rest.ctx && typeof rest.ctx_v === "number") {
      if (rest.ctx_v === CTX_SCHEMA_VERSION) {
        out.ctx = rest.ctx as FetchedValidationData;
      } else {
        out.ctxIncompatible = true;
      }
    }
  } catch (e) {
    out.parseError = e instanceof Error ? e.message : "Failed to parse rich payload";
  }
  return out;
}

export async function parseCardanoCborShare(
  params: URLSearchParams
): Promise<ParsedCardanoCborShare> {
  const out: ParsedCardanoCborShare = {};
  const rawCbor = params.get("cbor");
  if (rawCbor) out.cbor = rawCbor;
  const net = parseNet(params.get("net"));
  if (net) out.net = net;
  const type = params.get("type");
  if (type) out.type = type;
  const psv = parsePsv(params.get("psv"));
  if (psv) out.psv = psv;
  const pds = parsePds(params.get("pds"));
  if (pds) out.pds = pds;

  const vState = getRichVersionState(params);
  if (vState.kind === "none") return out;
  if (vState.kind === "future") {
    out.futureVersion = true;
    return out;
  }

  try {
    const payload = await decodeRichPayload(vState.encoding, vState.data);
    const rest = payload.rest as Partial<{
      net: NetworkType;
      type: string;
      psv: number;
      pds: PlutusDataSchema;
    }>;
    if (!out.cbor && payload.cbor) out.cbor = payload.cbor;
    if (!out.net && rest.net && VALID_NETS.includes(rest.net)) out.net = rest.net;
    if (!out.type && typeof rest.type === "string") out.type = rest.type;
    if (!out.psv && (rest.psv === 1 || rest.psv === 2 || rest.psv === 3)) {
      out.psv = rest.psv;
    }
    if (
      !out.pds &&
      (rest.pds === "BasicConversions" || rest.pds === "DetailedSchema")
    ) {
      out.pds = rest.pds;
    }
  } catch (e) {
    out.parseError = e instanceof Error ? e.message : "Failed to parse rich payload";
  }
  return out;
}

export async function parseGeneralCborShare(
  params: URLSearchParams
): Promise<ParsedGeneralCborShare> {
  const out: ParsedGeneralCborShare = {};
  const rawCbor = params.get("cbor");
  if (rawCbor) out.cbor = rawCbor;

  const vState = getRichVersionState(params);
  if (vState.kind === "none") return out;
  if (vState.kind === "future") {
    out.futureVersion = true;
    return out;
  }

  try {
    const payload = await decodeRichPayload(vState.encoding, vState.data);
    if (!out.cbor && payload.cbor) out.cbor = payload.cbor;
  } catch (e) {
    out.parseError = e instanceof Error ? e.message : "Failed to parse rich payload";
  }
  return out;
}
