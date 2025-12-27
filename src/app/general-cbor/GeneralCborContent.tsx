"use client";

import { useCallback, useEffect, useRef } from "react";
import ResizablePanels from "@/components/ResizablePanels";
import EditableHexView from "@/components/EditableHexView";
import CborTreeView from "@/components/CborTreeView";
import { cbor_to_json, type CborPosition } from "@cardananium/cquisitor-lib";
import { useGeneralCbor } from "@/context/GeneralCborContext";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import EmptyStatePlaceholder from "@/components/EmptyStatePlaceholder";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";

function isValidBase64(str: string): boolean {
  try {
    const trimmed = str.trim();
    if (trimmed.length === 0) return false;
    // Check if it looks like base64 (contains non-hex chars that are valid base64)
    if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && /[g-zG-Z+/=]/i.test(trimmed)) {
      atob(trimmed);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function base64ToHex(base64: string): string {
  const binary = atob(base64.trim());
  let hex = "";
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

export default function GeneralCborContent() {
  const {
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
  } = useGeneralCbor();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-decode on input change with debounce
  useEffect(() => {
    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Debounce decode to avoid cursor jumping
    debounceRef.current = setTimeout(() => {
      // Clear if empty
      if (!input.trim()) {
        setHexValue("");
        setDecodedJson(null);
        setError(null);
        setNotification(null);
        return;
      }

      try {
        let hex = input.trim();

        // Check if it's base64
        if (isValidBase64(hex)) {
          hex = base64ToHex(hex);
          setNotification("Base64 → hex");
        } else {
          setNotification(null);
        }

        // Clean up hex
        hex = hex.replace(/\s/g, "").toLowerCase();

        // Validate hex
        if (!/^[0-9a-f]*$/.test(hex)) {
          setError("Invalid hex");
          setDecodedJson(null); // Clear decoded structure on error
          return;
        }

        // Decode CBOR
        const result = cbor_to_json(hex);
        
        // The library returns an array containing the CborValue - unwrap it
        // Also convert serde_json numbers to native numbers/BigInt
        const rawValue = Array.isArray(result) ? result[0] : result;
        const cborValue = convertSerdeNumbers(rawValue);
        
        setHexValue(hex);
        setDecodedJson(cborValue);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Decode error");
        setDecodedJson(null); // Clear decoded structure on error
      }
    }, 150); // 150ms debounce

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [input, setDecodedJson, setError, setHexValue, setNotification]);

  const handleClear = () => {
    clearAll();
  };

  const handleHoverPath = useCallback((path: string | null) => {
    setHoverPath(path);
  }, [setHoverPath]);

  const handleHoverPosition = useCallback((position: CborPosition | null) => {
    setHoverPosition(position);
  }, [setHoverPosition]);

  const handleHighlightAndScroll = useCallback((position: CborPosition) => {
    setFocusPosition(position);
    // Clear focus after a moment
    setTimeout(() => setFocusPosition(null), 2000);
  }, [setFocusPosition]);

  // Handler for "Show in DECODED STRUCTURE" from hex view context menu
  const handleShowInTree = useCallback((position: CborPosition) => {
    setHighlightedTreePosition(position);
  }, [setHighlightedTreePosition]);

  // Handler to clear tree highlight
  const handleClearTreeHighlight = useCallback(() => {
    setHighlightedTreePosition(null);
  }, [setHighlightedTreePosition]);

  // Left panel: Input/Hex view
  const leftPanel = (
    <div className="panel-content">
      <div className="panel-header-compact">
        <span className="panel-title">CBOR Hex</span>
        <HelpTooltip>
          <strong>How to use:</strong> Paste any CBOR hex data. Click on tree nodes to highlight corresponding bytes. Right-click on hex to show element in decoded structure.
        </HelpTooltip>
        {hoverPath && <span className="panel-path">{hoverPath}</span>}
        {notification && <span className="panel-badge info">{notification}</span>}
        {error && <span className="panel-badge error">{error}</span>}
        <button onClick={handleClear} className="btn-icon" title="Clear">
          ✕
        </button>
      </div>

      {/* Usage hint */}
      <HintBanner storageKey="cquisitor_hint_general_cbor">
        <strong>How to use:</strong> Paste any CBOR hex data. Click on tree nodes to highlight bytes, or right-click hex to navigate to decoded structure.
      </HintBanner>

      {/* Editable hex view with highlighting */}
      <EditableHexView
        value={input}
        onChange={setInput}
        hexValue={hexValue}
        cborData={decodedJson}
        hoverPosition={hoverPosition}
        focusPosition={focusPosition}
        onHoverPath={handleHoverPath}
        onShowInTree={handleShowInTree}
      />
    </div>
  );

  // Right panel: Tree view
  const rightPanel = (
    <div className="panel-content">
      <div className="panel-header-compact">
        <span className="panel-title">Decoded Structure</span>
      </div>

      <div className="tree-view-container">
        {decodedJson ? (
          <CborTreeView
            data={decodedJson}
            hexValue={hexValue}
            onHoverPosition={handleHoverPosition}
            onHighlightAndScroll={handleHighlightAndScroll}
            highlightedTreePosition={highlightedTreePosition}
            onClearHighlight={handleClearTreeHighlight}
          />
        ) : (
          <EmptyStatePlaceholder
            title="CBOR tree view"
            description="Paste any CBOR hex data in the left panel. Click on tree nodes to highlight corresponding bytes, or right-click hex to navigate to decoded structure."
            showArrow={false}
            icon="tree"
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="general-cbor-layout">
      <ResizablePanels
        leftPanel={leftPanel}
        rightPanel={rightPanel}
        defaultLeftWidth={45}
        minLeftWidth={25}
        maxLeftWidth={75}
      />
    </div>
  );
}
