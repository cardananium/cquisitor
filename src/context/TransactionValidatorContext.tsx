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
import type { ValidationResult, FetchedValidationData } from "@/utils/transactionValidation";
import type { TransactionData } from "@/components/TransactionCardView/types";
import type { KoiosUtxoInfo } from "@/utils/koiosTypes";
import { parseHash, parseValidatorShare } from "@/utils/shareLink";

const KOIOS_API_KEY_STORAGE_KEY = "cquisitor_koios_api_key";

export interface DecodedTransaction {
  transaction_hash?: string;
  transaction?: TransactionData;
}

/**
 * Map of UTxO reference (txHash#outputIndex) to KoiosUtxoInfo
 */
export type InputUtxoInfoMap = Map<string, KoiosUtxoInfo>;

export type ContextSource = "url" | "koios" | null;

interface TransactionValidatorState {
  txInput: string;
  network: NetworkType;
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
  // Load API key from localStorage on initial render
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(KOIOS_API_KEY_STORAGE_KEY) || "";
    }
    return "";
  });
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

  // Save API key to localStorage when it changes
  const handleApiKeyChange = useCallback((value: string) => {
    setApiKey(value);
    if (value.trim()) {
      localStorage.setItem(KOIOS_API_KEY_STORAGE_KEY, value.trim());
    } else {
      localStorage.removeItem(KOIOS_API_KEY_STORAGE_KEY);
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
