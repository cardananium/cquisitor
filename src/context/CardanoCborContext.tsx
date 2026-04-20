"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import type { NetworkType, PlutusDataSchema } from "@cardananium/cquisitor-lib";
import { parseHash, parseCardanoCborShare } from "@/utils/shareLink";

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

interface InitialCardanoCborState {
  input: string;
  network: NetworkType;
  selectedType: string | null;
  plutusScriptVersion: number | null;
  plutusDataSchema: PlutusDataSchema | null;
}

function readInitialCardanoCborState(): InitialCardanoCborState {
  const defaults: InitialCardanoCborState = {
    input: "",
    network: "mainnet",
    selectedType: null,
    plutusScriptVersion: null,
    plutusDataSchema: null,
  };
  if (typeof window === "undefined") return defaults;
  const { tab, params } = parseHash(window.location.hash);
  if (tab !== "cardano-cbor") return defaults;
  const cbor = params.get("cbor");
  const net = params.get("net");
  const type = params.get("type");
  const psv = params.get("psv");
  const pds = params.get("pds");
  return {
    input: cbor ?? "",
    network:
      net === "mainnet" || net === "preview" || net === "preprod"
        ? (net as NetworkType)
        : "mainnet",
    selectedType: type ?? null,
    plutusScriptVersion:
      psv === "1" || psv === "2" || psv === "3" ? Number(psv) : null,
    plutusDataSchema:
      pds === "d"
        ? "DetailedSchema"
        : pds === "b"
          ? "BasicConversions"
          : pds === "DetailedSchema" || pds === "BasicConversions"
            ? pds
            : null,
  };
}

export function CardanoCborProvider({ children }: { children: ReactNode }) {
  const initial = readInitialCardanoCborState();
  const [input, setInput] = useState(initial.input);
  const [network, setNetwork] = useState<NetworkType>(initial.network);
  const [selectedType, setSelectedType] = useState<string | null>(initial.selectedType);
  const [possibleTypes, setPossibleTypes] = useState<string[]>([]);
  const [decodedJson, setDecodedJson] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [plutusScriptVersion, setPlutusScriptVersion] = useState<number | null>(
    initial.plutusScriptVersion
  );
  const [plutusDataSchema, setPlutusDataSchema] = useState<PlutusDataSchema | null>(
    initial.plutusDataSchema
  );
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

  // Rich payload (v=1&e=b|j) hydration — runs once on mount.
  useEffect(() => {
    const { tab, params } = parseHash(window.location.hash);
    if (tab !== "cardano-cbor" || !params.get("v")) return;
    let cancelled = false;
    parseCardanoCborShare(params)
      .then((parsed) => {
        if (cancelled) return;
        if (parsed.cbor && !params.get("cbor")) setInput(parsed.cbor);
        if (parsed.net && !params.get("net")) setNetwork(parsed.net);
        if (parsed.type && !params.get("type")) setSelectedType(parsed.type);
        if (parsed.psv && !params.get("psv")) setPlutusScriptVersion(parsed.psv);
        if (parsed.pds && !params.get("pds")) setPlutusDataSchema(parsed.pds);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
