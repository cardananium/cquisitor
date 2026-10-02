// Which ledger types a Cardano CBOR input decodes as, and the sentences the
// tab shows when some or all types were not tried.

import {
  base64ToHex,
  isValidBase64,
  isValidHex,
  possibleTypesReport,
  stripWhitespace,
  NATIVE_SCRIPT_DEPTH_LIMIT,
  TYPED_DECODING_DEPTH_LIMIT,
  type PossibleTypesReport,
} from "@cardananium/cquisitor-lib";
import { IMPLEMENTATION_LIMIT_NOTE, NOT_EXAMINED_PREFIX } from "@/utils/implementationLimit";

// Result of trying to detect types
export interface DetectionResult {
  types: string[];
  processedInput: string;
  notification: string | null;
  /** Set when no type was tried because the input nests past the typed decoders' bound. */
  unexamined: string | null;
  /**
   * Set when some types decoded but others were not tried on the nesting bound: a
   * secondary note naming the skipped types. The found types stand.
   */
  skipped: string | null;
}

type Unexamined = NonNullable<PossibleTypesReport["unexamined"]>;

/** "nests N levels deep, deeper than the …-level limit …": the depth and the bound it passed. */
function nestingClause(unexamined: Unexamined | undefined): string {
  const limit = unexamined?.limit ?? TYPED_DECODING_DEPTH_LIMIT;
  const depth = unexamined?.depth;
  const nests = depth !== undefined
    ? `nests ${depth.toLocaleString("en-US")} levels deep`
    : "nests deeper than the scan measures";
  if (limit >= NATIVE_SCRIPT_DEPTH_LIMIT) {
    return `${nests}, deeper than the ${limit.toLocaleString("en-US")}-level limit the tool reads to, native scripts included`;
  }
  return `${nests}, deeper than the ${limit}-level limit of the typed decoders `
    + `(native scripts do not count toward it and may nest up to ${NATIVE_SCRIPT_DEPTH_LIMIT.toLocaleString("en-US")} levels)`;
}

/** Why no type was tried: an implementation limit, not a finding about the data. */
export function typedDecodingNotExaminedMessage(unexamined: PossibleTypesReport["unexamined"]): string {
  return `${NOT_EXAMINED_PREFIX} this input ${nestingClause(unexamined)}. `
    + `${IMPLEMENTATION_LIMIT_NOTE} `
    + "The General CBOR and CDDL Validator tabs read it as plain CBOR.";
}

/** Which types were not tried while others decoded, and why. */
export function skippedTypesNote(unexamined: Unexamined): string {
  const names = unexamined.types ?? [];
  const count = names.length === 1 ? "1 type was" : `${names.length.toLocaleString("en-US")} types were`;
  const list = names.length > 0 ? `: ${names.join(", ")}` : "";
  return `${count} not tried because this input ${nestingClause(unexamined)}${list}. `
    + IMPLEMENTATION_LIMIT_NOTE;
}

/** The detection result for one library report, before any base64 retry. */
function fromReport(report: PossibleTypesReport, processedInput: string, notification: string | null): DetectionResult {
  const types = filterTypes(report.types);
  if (report.unexamined && types.length === 0) {
    return { types: [], processedInput, notification, unexamined: typedDecodingNotExaminedMessage(report.unexamined), skipped: null };
  }
  const skipped = report.unexamined ? skippedTypesNote(report.unexamined) : null;
  return { types, processedInput, notification, unexamined: null, skipped };
}

// Address subtypes that should be filtered out when "Address" is present
const ADDRESS_SUBTYPES = [
  "ByronAddress",
  "RewardAddress", 
  "PointerAddress",
  "BaseAddress",
  "EnterpriseAddress",
];

// Filter types to remove redundant subtypes
export function filterTypes(types: string[]): string[] {
  // If "Address" is in the list, remove specific address subtypes
  if (types.includes("Address")) {
    return types.filter((t) => !ADDRESS_SUBTYPES.includes(t));
  }
  return types;
}

/**
 * Detect the types `rawInput` decodes as. Hex, bech32 and base58 go to the
 * library as typed; only input that is not hex is retried as base64 (every hex
 * string is also a base64 alphabet string, and reading valid hex as base64 is
 * never what was meant). A throw from the library (a refusal, a dead worker, a
 * trap) propagates: it is not an answer that the input is no Cardano type.
 */
export async function detectTypesWithFallback(
  rawInput: string,
  signal?: AbortSignal,
): Promise<DetectionResult> {
  const normalized = stripWhitespace(rawInput);

  const first = fromReport(await possibleTypesReport(normalized, { signal }), normalized, null);
  if (first.types.length > 0 || first.unexamined || isValidHex(normalized) || !isValidBase64(normalized)) {
    return first;
  }

  let hexFromBase64: string;
  try {
    hexFromBase64 = base64ToHex(normalized);
  } catch {
    return first;
  }
  const second = fromReport(await possibleTypesReport(hexFromBase64, { signal }), hexFromBase64, "Base64 → hex");
  if (second.types.length > 0 || second.unexamined) return second;
  return first;
}
