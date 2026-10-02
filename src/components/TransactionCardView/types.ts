// Props of the transaction card view. The decoded-transaction model itself
// (TransactionData, ValidationDiagnostic, ...) is @cardananium/cquisitor-lib's.
import type {
  CardanoNetwork,
  DataProvider,
  DeUplcLinkMaps,
  ExtractedHashes,
  InputUtxoInfoMap,
  TransactionData,
  ValidationDiagnostic,
} from "@cardananium/cquisitor-lib";

export interface TransactionCardViewProps {
  data: {
    transaction_hash?: string;
    transaction?: TransactionData;
  };
  network?: CardanoNetwork;
  diagnostics?: ValidationDiagnostic[];
  focusedPath?: string[] | null;
  extractedHashes?: ExtractedHashes | null;
  /** Fetched UTxO info for transaction inputs from Koios */
  inputUtxoInfoMap?: InputUtxoInfoMap | null;
  /** Raw transaction CBOR hex, used to display tx size in the summary */
  txCborHex?: string | null;
  /** Protocol limits used to render per-tx budget percentages in the summary. Integers as the library hands them: `number`, or `bigint` past 2^53. */
  protocolMaxes?: {
    maxTxSize?: number;
    maxTxExUnits?: { mem: bigint | number; steps: bigint | number };
  } | null;
  /**
   * Sum of script-eval `calculated_ex_units` (the *actual* cost computed by
   * running scripts), populated only after Validate has run. The redeemer's
   * declared budget can over-estimate this; surfacing both lets the user spot
   * over-declared budgets that waste fee.
   */
  actualExUnits?: { mem: bigint; steps: bigint } | null;
  /**
   * "Open in de-uplc-web" deep-links — per redeemer and per witness script —
   * built after Validate (they need the resolved context + utxos). Null until then.
   */
  deUplcLinks?: DeUplcLinkMaps | null;
  /** Active data provider — used to fetch asset metadata for enrichment. */
  provider?: DataProvider;
  /** API key/project_id for the active provider (asset-metadata fetch). */
  apiKey?: string;
}

// Section card props
export interface SectionCardProps {
  title: string;
  icon: string;
  colorScheme: "blue" | "green" | "orange" | "purple" | "red" | "teal" | "pink" | "indigo";
  children: React.ReactNode;
  badge?: string | number;
  path?: string;
  diagnosticsMap?: Map<string, ValidationDiagnostic[]>;
  focusedPath?: string[] | null;
  defaultExpanded?: boolean;
}
