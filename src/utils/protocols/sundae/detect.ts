import type { TransactionOutput, CardanoNetwork } from "@cardananium/cquisitor-lib";
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
import {
  classifyV4SettingsNode,
  parseV4OrderDatum,
  parseV4PoolDatum,
  parseV4SettingsDatum,
  type V4OrderDatum,
  type V4PoolDatum,
  type V4SettingsDatum,
  type V4SettingsNode,
} from "./v4";
import { decodeV4Constraints, type V4DecodedConstraint } from "./v4Constraints";
import type { PD } from "./plutusData";

export interface SundaeOutputDetection {
  match: SundaeScriptEntry;
  // Populated when the matched entry is an order we know how to parse and the
  // output carries an inline datum.
  v3Order?: { datum: V3OrderDatum; issues: SundaeIssue[] };
  // Populated when the matched entry is a pool and the pool datum parsed.
  pool?: SundaePoolDatum;
  // V4 equivalents. A V4 order is only meaningful alongside its decoded
  // constraints, since the datum itself does not say what kind of order it is.
  v4Order?: { datum: V4OrderDatum; constraints: V4DecodedConstraint[] };
  v4Pool?: V4PoolDatum;
  // The global settings node, when the output is the one holding it.
  v4Settings?: V4SettingsDatum;
  // A token-bound settings node (a pool package, an order type, the fee
  // parameters). Which one it is comes from its shape.
  v4SettingsNode?: V4SettingsNode;
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

  // V4 pools have their own datum shape and are handled below; running the V3
  // parser on one would leave a parse error behind even though it decoded fine.
  if (entry.role === "pool" && entry.protocol !== "V4") {
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

  if (entry.protocol === "V4") {
    const raw = resolveOutputDatum(output.plutus_data, witnessDatums);
    if (raw) {
      detection.rawDatum = raw;
      try {
        if (entry.role === "order") {
          const datum = parseV4OrderDatum(raw);
          detection.v4Order = {
            datum,
            constraints: decodeV4Constraints(datum.constraints, network),
          };
        } else if (entry.role === "pool") {
          detection.v4Pool = parseV4PoolDatum(raw);
        } else if (entry.role === "settings") {
          // The global node and the token-bound nodes all sit at the settings
          // address and share constructor tag 0. Try the global shape first,
          // then classify by shape.
          try {
            detection.v4Settings = parseV4SettingsDatum(raw);
          } catch {
            const node = classifyV4SettingsNode(raw);
            if (node) detection.v4SettingsNode = node;
            else throw new Error("settings node shape is not recognized");
          }
        }
      } catch (e) {
        detection.parseError = e instanceof Error ? e.message : String(e);
      }
    } else if (output.plutus_data && "DataHash" in output.plutus_data) {
      detection.parseError = `V4 ${entry.role} datum is referenced by hash with no matching witness-set datum`;
    } else if (entry.role === "order") {
      detection.parseError = "Output is at the V4 order address but has no datum";
    }
  }

  return detection;
}
