"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import type { NetworkType, EvalRedeemerResult } from "@cardananium/cquisitor-lib";
import type { ValidationResult } from "@/utils/transactionValidation";

const KOIOS_API_KEY_STORAGE_KEY = "cquisitor_koios_api_key";

interface DecodedTransaction {
  transaction_hash: string;
  transaction: unknown;
}

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
  handleApiKeyChange: (value: string) => void;
  clearAll: () => void;
}

const TransactionValidatorContext = createContext<TransactionValidatorContextType | null>(null);

export function TransactionValidatorProvider({ children }: { children: ReactNode }) {
  const [txInput, setTxInput] = useState("");
  const [network, setNetwork] = useState<NetworkType>("mainnet");
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decodedTx, setDecodedTx] = useState<DecodedTransaction | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("validation");
  const [focusedPath, setFocusedPath] = useState<string[] | null>(null);

  // Load API key from localStorage on mount
  useEffect(() => {
    const savedApiKey = localStorage.getItem(KOIOS_API_KEY_STORAGE_KEY);
    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
  }, []);

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

export type { DecodedTransaction, TransactionValidatorState };

