"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { NetworkType, PlutusDataSchema } from "@cardananium/cquisitor-lib";

interface CardanoCborState {
  input: string;
  network: NetworkType;
  selectedType: string | null;
  possibleTypes: string[];
  decodedJson: unknown;
  error: string | null;
  notification: string | null;
  // DecodingParams
  plutusScriptVersion: number | null;
  plutusDataSchema: PlutusDataSchema | null;
  isLoading: boolean;
}

interface CardanoCborContextType extends CardanoCborState {
  setInput: (value: string) => void;
  setNetwork: (value: NetworkType) => void;
  setSelectedType: (value: string | null) => void;
  setPossibleTypes: (value: string[]) => void;
  setDecodedJson: (value: unknown) => void;
  setError: (value: string | null) => void;
  setNotification: (value: string | null) => void;
  setPlutusScriptVersion: (value: number | null) => void;
  setPlutusDataSchema: (value: PlutusDataSchema | null) => void;
  setIsLoading: (value: boolean) => void;
  clearAll: () => void;
}

const CardanoCborContext = createContext<CardanoCborContextType | null>(null);

export function CardanoCborProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState("");
  const [network, setNetwork] = useState<NetworkType>("mainnet");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [possibleTypes, setPossibleTypes] = useState<string[]>([]);
  const [decodedJson, setDecodedJson] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [plutusScriptVersion, setPlutusScriptVersion] = useState<number | null>(null);
  const [plutusDataSchema, setPlutusDataSchema] = useState<PlutusDataSchema | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const clearAll = useCallback(() => {
    setInput("");
    setSelectedType(null);
    setPossibleTypes([]);
    setDecodedJson(null);
    setError(null);
    setNotification(null);
    setPlutusScriptVersion(null);
    setPlutusDataSchema(null);
    setIsLoading(false);
  }, []);

  return (
    <CardanoCborContext.Provider
      value={{
        input,
        network,
        selectedType,
        possibleTypes,
        decodedJson,
        error,
        notification,
        plutusScriptVersion,
        plutusDataSchema,
        isLoading,
        setInput,
        setNetwork,
        setSelectedType,
        setPossibleTypes,
        setDecodedJson,
        setError,
        setNotification,
        setPlutusScriptVersion,
        setPlutusDataSchema,
        setIsLoading,
        clearAll,
      }}
    >
      {children}
    </CardanoCborContext.Provider>
  );
}

export function useCardanoCbor() {
  const context = useContext(CardanoCborContext);
  if (!context) {
    throw new Error("useCardanoCbor must be used within a CardanoCborProvider");
  }
  return context;
}
