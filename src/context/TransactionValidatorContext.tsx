"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import type { NetworkType, ExtractedHashes } from "@cardananium/cquisitor-lib";
import type { ValidationResult, FetchedValidationData, DataProvider } from "@/utils/transactionValidation";
import type { TransactionData } from "@/components/TransactionCardView/types";
import type { KoiosUtxoInfo } from "@/utils/koiosTypes";
import { parseHash, parseValidatorShare } from "@/utils/shareLink";

// Blockfrost project_ids are strictly tied to a single network, so they are
// stored per-network. Koios tokens are valid across networks per koios.rest's
// pricing page ("API Tokens are valid across networks"), so a single key is
// stored. The legacy un-suffixed Blockfrost key (pre 2026-05) is migrated
// into the mainnet slot on first read so users don't lose their entry.
const KOIOS_API_KEY_STORAGE_KEY = "cquisitor_koios_api_key";
const BLOCKFROST_API_KEY_STORAGE_PREFIX = "cquisitor_blockfrost_api_key";
const PROVIDER_STORAGE_KEY = "cquisitor_data_provider";

const NETWORKS: ReadonlyArray<NetworkType> = ["mainnet", "preview", "preprod"];

type BlockfrostKeyMap = Record<NetworkType, string>;

function blockfrostStorageKey(network: NetworkType): string {
  return `${BLOCKFROST_API_KEY_STORAGE_PREFIX}_${network}`;
}

function loadBlockfrostKeys(): BlockfrostKeyMap {
  const empty: BlockfrostKeyMap = { mainnet: "", preview: "", preprod: "" };
  if (typeof window === "undefined") return empty;
  const map = { ...empty };
  for (const net of NETWORKS) {
    map[net] = localStorage.getItem(blockfrostStorageKey(net)) || "";
  }
  const legacy = localStorage.getItem(BLOCKFROST_API_KEY_STORAGE_PREFIX);
  if (legacy) {
    if (!map.mainnet) {
      map.mainnet = legacy;
      localStorage.setItem(blockfrostStorageKey("mainnet"), legacy);
    }
    localStorage.removeItem(BLOCKFROST_API_KEY_STORAGE_PREFIX);
  }
  return map;
}

export interface DecodedTransaction {
  transaction_hash?: string;
  transaction?: TransactionData;
}

/**
 * Map of UTxO reference (txHash#outputIndex) to KoiosUtxoInfo
 */
export type InputUtxoInfoMap = Map<string, KoiosUtxoInfo>;

export type ContextSource = "url" | "koios" | "blockfrost" | null;

interface TransactionValidatorState {
  txInput: string;
  network: NetworkType;
  provider: DataProvider;
  apiKey: string;
  isLoading: boolean;
  result: ValidationResult | null;
  error: string | null;
  decodedTx: DecodedTransaction | null;
  decodeError: string | null;
  activeTab: string;
  focusedPath: string[] | null;
  extractedHashes: ExtractedHashes | null;
  /** Fetched UTxO info for transaction inputs */
  inputUtxoInfoMap: InputUtxoInfoMap | null;
  /** Full fetched validation context (Koios fetch or URL-provided) — used for sharing */
  fetchedContext: FetchedValidationData | null;
  /** Origin of the current fetchedContext */
  contextSource: ContextSource;
  /** Epoch millis when URL-provided ctx was captured (only for contextSource='url') */
  contextCapturedAt: number | null;
  /** User preference: when URL ctx is present, use it instead of refetching from Koios */
  useUrlContext: boolean;
  /** Warning: URL had embedded ctx but schema version mismatched */
  ctxIncompatibleWarning: boolean;
  /** Warning: URL's format version is greater than this build supports */
  futureVersionWarning: boolean;
}

interface TransactionValidatorContextType extends TransactionValidatorState {
  setTxInput: (value: string) => void;
  setNetwork: (value: NetworkType) => void;
  setProvider: (value: DataProvider) => void;
  setApiKey: (value: string) => void;
  setIsLoading: (value: boolean) => void;
  setResult: (value: ValidationResult | null) => void;
  setError: (value: string | null) => void;
  setDecodedTx: (value: DecodedTransaction | null) => void;
  setDecodeError: (value: string | null) => void;
  setActiveTab: (value: string) => void;
  setFocusedPath: (value: string[] | null) => void;
  setExtractedHashes: (value: ExtractedHashes | null) => void;
  setInputUtxoInfoMap: (value: InputUtxoInfoMap | null) => void;
  setFetchedContext: (value: FetchedValidationData | null) => void;
  setContextSource: (value: ContextSource) => void;
  setContextCapturedAt: (value: number | null) => void;
  setUseUrlContext: (value: boolean) => void;
  setCtxIncompatibleWarning: (value: boolean) => void;
  setFutureVersionWarning: (value: boolean) => void;
  handleApiKeyChange: (value: string) => void;
  clearAll: () => void;
}

const TransactionValidatorContext = createContext<TransactionValidatorContextType | null>(null);

interface InitialValidatorState {
  txInput: string;
  network: NetworkType;
}

function readInitialValidatorState(): InitialValidatorState {
  const defaults: InitialValidatorState = { txInput: "", network: "mainnet" };
  if (typeof window === "undefined") return defaults;
  const { tab, params } = parseHash(window.location.hash);
  if (tab !== "transaction-validator") return defaults;
  const cbor = params.get("cbor");
  const net = params.get("net");
  return {
    txInput: cbor ?? "",
    network:
      net === "mainnet" || net === "preview" || net === "preprod"
        ? (net as NetworkType)
        : "mainnet",
  };
}

export function TransactionValidatorProvider({ children }: { children: ReactNode }) {
  const initial = readInitialValidatorState();
  const [txInput, setTxInput] = useState(initial.txInput);
  const [network, setNetwork] = useState<NetworkType>(initial.network);
  // Provider + per-provider keys, persisted independently in localStorage so
  // switching back and forth doesn't lose either key.
  const [provider, setProviderState] = useState<DataProvider>(() => {
    if (typeof window === "undefined") return "koios";
    const v = localStorage.getItem(PROVIDER_STORAGE_KEY);
    return v === "blockfrost" ? "blockfrost" : "koios";
  });
  const [koiosKey, setKoiosKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(KOIOS_API_KEY_STORAGE_KEY) || "";
  });
  const [blockfrostKeys, setBlockfrostKeys] = useState<BlockfrostKeyMap>(() => loadBlockfrostKeys());
  const apiKey = provider === "blockfrost" ? blockfrostKeys[network] : koiosKey;
  const setApiKey = useCallback(
    (value: string) => {
      if (provider === "blockfrost") {
        setBlockfrostKeys((prev) => ({ ...prev, [network]: value }));
      } else {
        setKoiosKey(value);
      }
    },
    [provider, network]
  );
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodedTx, setDecodedTx] = useState<DecodedTransaction | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("validation");
  const [focusedPath, setFocusedPath] = useState<string[] | null>(null);
  const [extractedHashes, setExtractedHashes] = useState<ExtractedHashes | null>(null);
  const [inputUtxoInfoMap, setInputUtxoInfoMap] = useState<InputUtxoInfoMap | null>(null);
  const [fetchedContext, setFetchedContext] = useState<FetchedValidationData | null>(null);
  const [contextSource, setContextSource] = useState<ContextSource>(null);
  const [contextCapturedAt, setContextCapturedAt] = useState<number | null>(null);
  const [useUrlContext, setUseUrlContext] = useState(true);
  const [ctxIncompatibleWarning, setCtxIncompatibleWarning] = useState(false);
  const [futureVersionWarning, setFutureVersionWarning] = useState(false);

  // Save the API key for the currently active provider. Blockfrost is scoped
  // by network; Koios is a single shared key.
  const handleApiKeyChange = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      const storageKey =
        provider === "blockfrost" ? blockfrostStorageKey(network) : KOIOS_API_KEY_STORAGE_KEY;
      if (provider === "blockfrost") {
        setBlockfrostKeys((prev) => ({ ...prev, [network]: value }));
      } else {
        setKoiosKey(value);
      }
      if (trimmed) {
        localStorage.setItem(storageKey, trimmed);
      } else {
        localStorage.removeItem(storageKey);
      }
    },
    [provider, network]
  );

  const setProvider = useCallback((value: DataProvider) => {
    setProviderState(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(PROVIDER_STORAGE_KEY, value);
    }
  }, []);

  const clearAll = useCallback(() => {
    setTxInput("");
    setResult(null);
    setError(null);
    setDecodedTx(null);
    setDecodeError(null);
    setFocusedPath(null);
    setExtractedHashes(null);
    setInputUtxoInfoMap(null);
    setFetchedContext(null);
    setContextSource(null);
    setContextCapturedAt(null);
    setCtxIncompatibleWarning(false);
    setFutureVersionWarning(false);
  }, []);

  // Rich payload hydration (v=1 with optional ctx) — runs once on mount.
  useEffect(() => {
    const { tab, params } = parseHash(window.location.hash);
    if (tab !== "transaction-validator") return;
    if (!params.get("v")) return;
    let cancelled = false;
    parseValidatorShare(params)
      .then((parsed) => {
        if (cancelled) return;
        if (parsed.cbor && !params.get("cbor")) setTxInput(parsed.cbor);
        if (parsed.net && !params.get("net")) setNetwork(parsed.net);
        if (parsed.ctx) {
          setFetchedContext(parsed.ctx);
          setContextSource("url");
          setContextCapturedAt(parsed.capturedAt ?? null);
          // Build inputUtxoInfoMap from URL ctx for immediate display
          const map: InputUtxoInfoMap = new Map();
          for (const utxo of parsed.ctx.utxoInfos ?? []) {
            map.set(`${utxo.tx_hash}#${utxo.tx_index}`, utxo);
          }
          setInputUtxoInfoMap(map);
        }
        if (parsed.ctxIncompatible) setCtxIncompatibleWarning(true);
        if (parsed.futureVersion) setFutureVersionWarning(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TransactionValidatorContext.Provider
      value={{
        txInput,
        network,
        provider,
        apiKey,
        isLoading,
        result,
        error,
        decodedTx,
        decodeError,
        activeTab,
        focusedPath,
        extractedHashes,
        inputUtxoInfoMap,
        fetchedContext,
        contextSource,
        contextCapturedAt,
        useUrlContext,
        ctxIncompatibleWarning,
        futureVersionWarning,
        setTxInput,
        setNetwork,
        setProvider,
        setApiKey,
        setIsLoading,
        setResult,
        setError,
        setDecodedTx,
        setDecodeError,
        setActiveTab,
        setFocusedPath,
        setExtractedHashes,
        setInputUtxoInfoMap,
        setFetchedContext,
        setContextSource,
        setContextCapturedAt,
        setUseUrlContext,
        setCtxIncompatibleWarning,
        setFutureVersionWarning,
        handleApiKeyChange,
        clearAll,
      }}
    >
      {children}
    </TransactionValidatorContext.Provider>
  );
}

export function useTransactionValidator() {
  const context = useContext(TransactionValidatorContext);
  if (!context) {
    throw new Error("useTransactionValidator must be used within a TransactionValidatorProvider");
  }
  return context;
}

export type { TransactionValidatorState };
