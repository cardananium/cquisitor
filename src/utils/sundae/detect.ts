import { decode_specific_type } from "@cardananium/cquisitor-lib";
import type { TransactionOutput, DataOption, CardanoNetwork } from "@/components/TransactionCardView/types";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import { lookupSundaeScript, type SundaeScriptEntry } from "./constants";
import {
  parseV3OrderDatum,
  parseStableswapOrderDatum,
  parseV3PoolDatum,
  parseStableswapPoolDatum,
  validateV3OrderDatum,
  type V3OrderDatum,
  type SundaePoolDatum,
  type SundaeIssue,
} from "./v3";
import type { PD } from "./plutusData";

export interface SundaeOutputDetection {
  match: SundaeScriptEntry;
  // Populated when the matched entry is an order we know how to parse and the
  // output carries an inline datum.
  v3Order?: { datum: V3OrderDatum; issues: SundaeIssue[] };
  // Populated when the matched entry is a pool and the pool datum parsed.
  pool?: SundaePoolDatum;
  // If we tried to parse a datum but failed, capture the reason.
  parseError?: string;
  // The raw decoded plutus data tree, when an inline datum was present.
  rawDatum?: PD;
}

interface DecodedAddress {
  address_type: string;
  details: { payment_cred?: { type: string; credential: string } };
}

function getPaymentScriptHash(addressBech32: string): string | null {
  try {
    const decoded = decode_specific_type(addressBech32, "Address", {}) as DecodedAddress;
    if (decoded?.details?.payment_cred?.type === "ScriptHash") {
      return decoded.details.payment_cred.credential.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

// The lib's Transaction decoder pre-decodes inline datums into a JSON string
// of the plutus tree (DetailedSchema-shaped). For the rare case where the
// value is still a CBOR hex string (e.g., when an upstream caller passes the
// raw bytes directly), we fall back to decoding via decode_specific_type.
function decodeInlineDatum(data: DataOption | null | undefined): PD | null {
  if (!data || !("Data" in data)) return null;
  const raw = data.Data;
  // 1) Try JSON parse — the common case from a decoded Transaction.
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return convertSerdeNumbers(parsed) as PD;
    }
  } catch {
    // not JSON; fall through to CBOR-hex path
  }
  // 2) Fall back to treating it as a CBOR hex string.
  try {
    const decoded = decode_specific_type(raw, "PlutusData", {
      plutus_data_schema: "DetailedSchema",
    }) as { plutus_data: PD };
    return convertSerdeNumbers(decoded.plutus_data) as PD;
  } catch {
    return null;
  }
}

export function detectSundaeOutput(
  output: TransactionOutput,
  network: CardanoNetwork | undefined,
  witnessDatums?: Map<string, PD> | null
): SundaeOutputDetection | null {
  const scriptHash = getPaymentScriptHash(output.address);
  if (!scriptHash) return null;

  const entry = lookupSundaeScript(scriptHash, network);
  if (!entry) return null;

  const detection: SundaeOutputDetection = { match: entry };

  if (entry.role === "order" && (entry.protocol === "V3" || entry.protocol === "Stableswap")) {
    let raw = decodeInlineDatum(output.plutus_data);
    // Fall back to the tx's witness_set plutus_data when the output references
    // its datum by hash (e.g. place-order txs that don't use inline datums).
    if (!raw && output.plutus_data && "DataHash" in output.plutus_data && witnessDatums) {
      const matched = witnessDatums.get(output.plutus_data.DataHash.toLowerCase());
      if (matched) raw = matched;
    }
    if (raw) {
      detection.rawDatum = raw;
      try {
        const datum =
          entry.protocol === "Stableswap"
            ? parseStableswapOrderDatum(raw)
            : parseV3OrderDatum(raw);
        detection.v3Order = { datum, issues: validateV3OrderDatum(datum) };
      } catch (e) {
        detection.parseError = e instanceof Error ? e.message : String(e);
      }
    } else if (output.plutus_data && "DataHash" in output.plutus_data) {
      detection.parseError = `${entry.protocol} order datum is referenced by hash, not inline — cannot parse (no matching datum in witness set)`;
    } else {
      detection.parseError = `Output is at the ${entry.protocol} order address but has no datum`;
    }
  }

  if (entry.role === "pool" && (entry.protocol === "V3" || entry.protocol === "Stableswap")) {
    let raw = decodeInlineDatum(output.plutus_data);
    if (!raw && output.plutus_data && "DataHash" in output.plutus_data && witnessDatums) {
      const matched = witnessDatums.get(output.plutus_data.DataHash.toLowerCase());
      if (matched) raw = matched;
    }
    if (raw) {
      detection.rawDatum = raw;
      try {
        detection.pool =
          entry.protocol === "Stableswap"
            ? parseStableswapPoolDatum(raw)
            : parseV3PoolDatum(raw);
      } catch (e) {
        detection.parseError = e instanceof Error ? e.message : String(e);
      }
    } else if (output.plutus_data && "DataHash" in output.plutus_data) {
      detection.parseError = `${entry.protocol} pool datum is referenced by hash with no matching witness-set datum`;
    }
  }

  return detection;
}
