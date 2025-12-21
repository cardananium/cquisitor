"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { type CborValue, type CborPosition } from "@cardananium/cquisitor-lib";

interface GeneralCborState {
  input: string;
  hexValue: string;
  decodedJson: CborValue | null;
  error: string | null;
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
  setDecodedJson: (value: CborValue | null) => void;
  setError: (value: string | null) => void;
  setNotification: (value: string | null) => void;
  setHoverPosition: (value: CborPosition | null) => void;
  setFocusPosition: (value: CborPosition | null) => void;
  setHoverPath: (value: string | null) => void;
  setHighlightedTreePosition: (value: CborPosition | null) => void;
  clearAll: () => void;
}

const GeneralCborContext = createContext<GeneralCborContextType | null>(null);

export function GeneralCborProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState("");
  const [hexValue, setHexValue] = useState("");
  const [decodedJson, setDecodedJson] = useState<CborValue | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    setNotification(null);
    setFocusPosition(null);
    setHoverPosition(null);
    setHoverPath(null);
    setHighlightedTreePosition(null);
  }, []);

  return (
    <GeneralCborContext.Provider
      value={{
        input,
        hexValue,
        decodedJson,
        error,
        notification,
        hoverPosition,
        focusPosition,
        hoverPath,
        highlightedTreePosition,
        setInput,
        setHexValue,
        setDecodedJson,
        setError,
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
