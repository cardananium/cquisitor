import type { TransactionOutput, CardanoNetwork } from "@/components/TransactionCardView/types";
import { getPaymentScriptHash } from "@/utils/protocols/dex/address";
import { resolveOutputDatum } from "@/utils/protocols/dex/datum";
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
import { parseV1PoolDatum } from "./v1";
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

export function detectSundaeOutput(
  output: TransactionOutput,
  network: CardanoNetwork | undefined,
  witnessDatums?: Map<string, PD> | null
): SundaeOutputDetection | null {
  const scriptHash = getPaymentScriptHash(output.address);
  if (!scriptHash) return null;

  const entry = lookupSundaeScript(scriptHash, network);
  if (!entry) return null;

  // A reference-script provider at a Sundae script address carries no order/pool
  // datum (common as a reference input); don't flag it as a missed protocol UTxO.
  if (output.script_ref && !output.plutus_data) return null;

  const detection: SundaeOutputDetection = { match: entry };

  if (entry.role === "order" && (entry.protocol === "V3" || entry.protocol === "Stableswap")) {
    // Inline where there is one, otherwise the tx's witness_set plutus_data
    // for an output that references its datum by hash (e.g. place-order txs
    // that don't use inline datums).
    const raw = resolveOutputDatum(output.plutus_data, witnessDatums);
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

  if (entry.role === "pool") {
    // V1 pools (and occasionally V3/Stableswap) reference the datum by hash;
    // resolve it from the tx witness set.
    const raw = resolveOutputDatum(output.plutus_data, witnessDatums);
    if (raw) {
      detection.rawDatum = raw;
      try {
        detection.pool =
          entry.protocol === "Stableswap"
            ? parseStableswapPoolDatum(raw)
            : entry.protocol === "V1"
              ? parseV1PoolDatum(raw)
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
