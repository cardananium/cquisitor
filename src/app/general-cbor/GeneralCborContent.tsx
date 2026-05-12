"use client";

import { useCallback, useEffect, useRef } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import ResizablePanels from "@/components/ResizablePanels";
import EditableHexView from "@/components/EditableHexView";
import CborTreeView from "@/components/CborTreeView";
import { cbor_to_json, type CborPosition, type CborDecodeResult } from "@cardananium/cquisitor-lib";
import { useGeneralCbor } from "@/context/GeneralCborContext";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import EmptyStatePlaceholder from "@/components/EmptyStatePlaceholder";
import ShareButton from "@/components/ShareButton";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import { cborErrorToLocation } from "@/utils/cborError";
import { base64ToHex, stripWhitespace } from "@/utils/inputNormalization";

// Heuristic base64 check that intentionally rejects pure-hex input so we don't
// mis-route hex through a base64 decode. Caller must pass whitespace-stripped
// input. Differs from the strict isValidBase64 in inputNormalization, which
// considers plain hex (e.g. "deadbeef") a valid base64 string.
function looksLikeBase64(input: string): boolean {
  if (input.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+=*$/.test(input)) return false;
  if (!/[g-zG-Z+/=]/.test(input)) return false;
  try {
    atob(input);
    return true;
  } catch {
    return false;
  }
}

export default function GeneralCborContent() {
  const {
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
      // Strip whitespace upfront so wrapped/column-formatted pastes parse correctly.
      let hex = stripWhitespace(input);

      // Clear if empty
      if (hex.length === 0) {
        setHexValue("");
        setDecodedJson(null);
        setError(null);
        setErrorLocation(null);
        setNotification(null);
        return;
      }

      // Check if it's base64
      if (looksLikeBase64(hex)) {
        hex = base64ToHex(hex);
        setNotification("Base64 → hex");
      } else {
        setNotification(null);
      }

      hex = hex.toLowerCase();

      // Decode CBOR — the new API never throws; errors come as { ok: false, ... }.
      const raw = cbor_to_json(hex) as CborDecodeResult;
      const result = convertSerdeNumbers(raw) as CborDecodeResult;
      const hexByteLength = /^[0-9a-f]*$/.test(hex) ? hex.length / 2 : 0;

      if (hexByteLength > 0) setHexValue(hex);
      else setHexValue("");

      if (result.ok) {
        setDecodedJson(result.value);
        setError(null);
        setErrorLocation(null);
      } else {
        setDecodedJson(result.partial ?? null);
        setError(result.error.message);
        setErrorLocation(cborErrorToLocation(result.error, hexByteLength));
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
        {errorLocation && errorLocation.path && errorLocation.path !== "$" && (
          <Tooltip.Provider delayDuration={150}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className="panel-badge error-path">{errorLocation.path}</span>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="cbor-oddity-tooltip" sideOffset={4} side="bottom">
                  <div className="cbor-oddity-tooltip-title">Error location</div>
                  <div>
                    <div>path: <span className="cbor-oddity-tooltip-detail">{errorLocation.path}</span></div>
                    <div>offset: <span className="cbor-oddity-tooltip-detail">{errorLocation.offset}</span>{errorLocation.length > 1 && <> · length: <span className="cbor-oddity-tooltip-detail">{errorLocation.length}</span></>}</div>
                    <div>kind: <span className="cbor-oddity-tooltip-detail">{errorLocation.kind}</span></div>
                  </div>
                  <Tooltip.Arrow className="cbor-oddity-tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        )}
        <ShareButton
          disabled={!input.trim()}
          getTarget={() => ({ kind: "general-cbor", input: { cbor: input.trim() } })}
        />
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
        errorLocation={errorLocation}
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
