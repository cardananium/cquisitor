"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import {
  parseGeneralCborShare,
  parseHash,
  type CborErrorLocation,
  type CborPartialValue,
  type CborPosition,
  type CborValue,
} from "@cardananium/cquisitor-lib";
import { annotationStore } from "@/utils/annotations/store";

interface GeneralCborState {
  input: string;
  hexValue: string;
  decodedJson: CborValue | CborPartialValue | null;
  error: string | null;
  errorLocation: CborErrorLocation | null;
  notification: string | null;
  hoverPosition: CborPosition | null;
  focusPosition: CborPosition | null;
  hoverPath: string | null;
  // Position to highlight in tree view (triggered from hex view context menu)
  highlightedTreePosition: CborPosition | null;
}

interface GeneralCborContextType extends GeneralCborState {
  setInput: (value: string) => void;
  setHexValue: (value: string) => void;
  setDecodedJson: (value: CborValue | CborPartialValue | null) => void;
  setError: (value: string | null) => void;
  setErrorLocation: (value: CborErrorLocation | null) => void;
  setNotification: (value: string | null) => void;
  setHoverPosition: (value: CborPosition | null) => void;
  setFocusPosition: (value: CborPosition | null) => void;
  setHoverPath: (value: string | null) => void;
  setHighlightedTreePosition: (value: CborPosition | null) => void;
  clearAll: () => void;
}

const GeneralCborContext = createContext<GeneralCborContextType | null>(null);

function readInitialInput(): string {
  if (typeof window === "undefined") return "";
  const { tab, params } = parseHash(window.location.hash);
  if (tab !== "general-cbor") return "";
  return params.get("cbor") ?? "";
}

export function GeneralCborProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState(readInitialInput);
  const [hexValue, setHexValue] = useState("");
  const [decodedJson, setDecodedJson] = useState<CborValue | CborPartialValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLocation, setErrorLocation] = useState<CborErrorLocation | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState<CborPosition | null>(null);
  const [focusPosition, setFocusPosition] = useState<CborPosition | null>(null);
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [highlightedTreePosition, setHighlightedTreePosition] = useState<CborPosition | null>(null);

  const clearAll = useCallback(() => {
    setInput("");
    setHexValue("");
    setDecodedJson(null);
    setError(null);
    setErrorLocation(null);
    setNotification(null);
    setFocusPosition(null);
    setHoverPosition(null);
    setHoverPath(null);
    setHighlightedTreePosition(null);
  }, []);

  // Rich payload (v=1&e=b|j) hydration — runs once on mount.
  useEffect(() => {
    const { tab, params } = parseHash(window.location.hash);
    if (tab !== "general-cbor" || !params.get("v")) return;
    let cancelled = false;
    parseGeneralCborShare(params)
      .then((parsed) => {
        if (cancelled) return;
        if (parsed.cbor && !params.get("cbor")) setInput(parsed.cbor);
        annotationStore.apply(
          "general-cbor",
          parsed.annotations,
          parsed.annotationFocus,
          params.get("cbor") ?? parsed.cbor ?? null,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GeneralCborContext.Provider
      value={{
        input,
        hexValue,
        decodedJson,
        error,
        errorLocation,
        notification,
        hoverPosition,
        focusPosition,
        hoverPath,
        highlightedTreePosition,
        setInput,
        setHexValue,
        setDecodedJson,
        setError,
        setErrorLocation,
        setNotification,
        setHoverPosition,
        setFocusPosition,
        setHoverPath,
        setHighlightedTreePosition,
        clearAll,
      }}
    >
      {children}
    </GeneralCborContext.Provider>
  );
}

export function useGeneralCbor() {
  const context = useContext(GeneralCborContext);
  if (!context) {
    throw new Error("useGeneralCbor must be used within a GeneralCborProvider");
  }
  return context;
}
