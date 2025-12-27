"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { NetworkType, ExtractedHashes } from "@cardananium/cquisitor-lib";
import type { ValidationResult } from "@/utils/transactionValidation";
import type { TransactionData } from "@/components/TransactionCardView/types";
import type { KoiosUtxoInfo } from "@/utils/koiosTypes";

const KOIOS_API_KEY_STORAGE_KEY = "cquisitor_koios_api_key";

export interface DecodedTransaction {
  transaction_hash?: string;
  transaction?: TransactionData;
}

/**
 * Map of UTxO reference (txHash#outputIndex) to KoiosUtxoInfo
 */
export type InputUtxoInfoMap = Map<string, KoiosUtxoInfo>;

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
  handleApiKeyChange: (value: string) => void;
  clearAll: () => void;
}

const TransactionValidatorContext = createContext<TransactionValidatorContextType | null>(null);

export function TransactionValidatorProvider({ children }: { children: ReactNode }) {
  const [txInput, setTxInput] = useState("");
  const [network, setNetwork] = useState<NetworkType>("mainnet");
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

