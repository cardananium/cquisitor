"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ResizablePanels from "@/components/ResizablePanels";
import JsonViewer from "@/components/JsonViewer";
import TypeSelectionModal from "@/components/TypeSelectionModal";
import Select from "@/components/Select";
import {
  type NetworkType,
  type PlutusDataSchema,
  type DecodingParams,
} from "@cardananium/cquisitor-lib";
import { useCardanoCbor } from "@/context/CardanoCborContext";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import EmptyStatePlaceholder from "@/components/EmptyStatePlaceholder";
import ShareButton from "@/components/ShareButton";
import { CheckCircleIcon, ExternalLinkIcon } from "@/components/Icons";
import { callLib, isLibRefusal, libErrorMessage } from "@/lib/cquisitorWorker";
import { reorderTransactionFields } from "@/utils/reorderTransactionFields";
import {
  buildTxStudioUrl,
  buildValidatorUrl,
  openExternalUrlDeferred,
} from "@/utils/externalApps";
import { isValidBase64, isValidHex, base64ToHex, stripWhitespace } from "@/utils/inputNormalization";
import { nestsPastTypedDecoding, TYPED_DECODING_DEPTH_LIMIT } from "@/utils/cborDepth";

// Types that require DecodingParams
const TYPES_WITH_PLUTUS_SCRIPT_VERSION = ["PlutusScript"];
const TYPES_WITH_PLUTUS_DATA_SCHEMA = ["PlutusData"];

// Result of trying to detect types
interface DetectionResult {
  types: string[];
  processedInput: string;
  notification: string | null;
  /** True when typed decoding was skipped because the document nests too deep. */
  deeperThanTypedDecoding: boolean;
}

/** Typed decoders return no types past this nesting; check depth first so we can say why. */
const TYPED_DECODING_DEPTH_MESSAGE =
  `This document nests deeper than the ${TYPED_DECODING_DEPTH_LIMIT}-level typed-decoding limit, so no`
  + " Cardano type can be tried against it. The general CBOR tab decodes it as plain CBOR.";

// Address subtypes that should be filtered out when "Address" is present
const ADDRESS_SUBTYPES = [
  "ByronAddress",
  "RewardAddress", 
  "PointerAddress",
  "BaseAddress",
  "EnterpriseAddress",
];

// Filter types to remove redundant subtypes
function filterTypes(types: string[]): string[] {
  // If "Address" is in the list, remove specific address subtypes
  if (types.includes("Address")) {
    return types.filter((t) => !ADDRESS_SUBTYPES.includes(t));
  }
  return types;
}

// Try to detect types for input, with fallback to base64 conversion
async function detectTypesWithFallback(
  rawInput: string,
  signal?: AbortSignal,
): Promise<DetectionResult> {
  const normalized = stripWhitespace(rawInput);
  const tooDeep = (hex: string): DetectionResult => ({
    types: [],
    processedInput: hex,
    notification: null,
    deeperThanTypedDecoding: true,
  });

  if (isValidHex(normalized) && nestsPastTypedDecoding(normalized)) return tooDeep(normalized);

  // First, try the normalized input directly
  // This handles: hex, bech32, base58, and potentially base64 if decoder supports it
  try {
    const rawTypes = await callLib<string[]>("get_possible_types_for_input", [normalized], { signal });
    const types = filterTypes(rawTypes);
    if (types.length > 0) {
      return {
        types,
        processedInput: normalized,
        notification: null,
        deeperThanTypedDecoding: false,
      };
    }
  } catch (e) {
    // A refused call never ran; do not treat it as "no Cardano type".
    if (isLibRefusal(e)) throw e;
    // Continue to fallback
  }

  // If original input didn't work and it could be base64, try converting to hex
  if (isValidBase64(normalized)) {
    try {
      const hexFromBase64 = base64ToHex(normalized);
      if (nestsPastTypedDecoding(hexFromBase64)) return tooDeep(hexFromBase64);
      const rawTypes = await callLib<string[]>("get_possible_types_for_input", [hexFromBase64], { signal });
      const types = filterTypes(rawTypes);
      if (types.length > 0) {
        return {
          types,
          processedInput: hexFromBase64,
          notification: "Base64 → hex",
          deeperThanTypedDecoding: false,
        };
      }
    } catch (e) {
      if (isLibRefusal(e)) throw e;
      // Base64 conversion failed
    }
  }

  // Nothing worked
  return {
    types: [],
    processedInput: normalized,
    notification: null,
    deeperThanTypedDecoding: false,
  };
}

export default function CardanoCborContent() {
  const {
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
  } = useCardanoCbor();

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [pendingTypes, setPendingTypes] = useState<string[]>([]);

  // Detect possible types when input changes
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    // Ignore a late worker result after the input has changed.
    let cancelled = false;
    const controller = new AbortController();

    debounceRef.current = setTimeout(() => {
      if (!input.trim()) {
        setPossibleTypes([]);
        setSelectedType(null);
        setDecodedJson(null);
        setError(null);
        setNotification(null);
        setShowTypeModal(false);
        return;
      }

      void (async () => {
        try {
          // Try to detect types with fallback to base64 conversion
          const { types, notification: notificationMsg, deeperThanTypedDecoding } =
            await detectTypesWithFallback(input, controller.signal);
          if (cancelled) return;

          setPossibleTypes(types);
          setNotification(notificationMsg);

          if (types.length === 0) {
            setSelectedType(null);
            setDecodedJson(null);
            setError(
              deeperThanTypedDecoding
                ? TYPED_DECODING_DEPTH_MESSAGE
                : "No valid Cardano type detected for this input",
            );
            setShowTypeModal(false);
          } else if (types.length === 1) {
            // Auto-select if only one type available
            setSelectedType(types[0]);
            setShowTypeModal(false);
          } else if (!selectedType || !types.includes(selectedType)) {
            // Multiple types available - show modal for selection
            setPendingTypes(types);
            setShowTypeModal(true);
          }
        } catch (e) {
          if (cancelled) return;
          setError(libErrorMessage(e));
          setPossibleTypes([]);
          setSelectedType(null);
          setShowTypeModal(false);
        }
      })();
    }, 200);

    return () => {
      cancelled = true;
      controller.abort();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [input, setPossibleTypes, setSelectedType, setDecodedJson, setError, setNotification, selectedType]);

  const handleTypeSelect = useCallback((type: string) => {
    setSelectedType(type);
    setShowTypeModal(false);
    
    // Reset params when type changes
    if (!TYPES_WITH_PLUTUS_SCRIPT_VERSION.includes(type)) {
      setPlutusScriptVersion(null);
    }
    if (!TYPES_WITH_PLUTUS_DATA_SCHEMA.includes(type)) {
      setPlutusDataSchema(null);
    }
  }, [setSelectedType, setPlutusScriptVersion, setPlutusDataSchema]);

  const handleModalClose = useCallback(() => {
    setShowTypeModal(false);
    // If no type was selected, select the first one
    if (!selectedType && pendingTypes.length > 0) {
      handleTypeSelect(pendingTypes[0]);
    }
  }, [selectedType, pendingTypes, handleTypeSelect]);

  // Decode when type is selected or params change
  useEffect(() => {
    if (!selectedType || !input.trim()) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const decode = async () => {
      setIsLoading(true);
      try {
        // Use the same detection logic to get the processed input
        const { processedInput } = await detectTypesWithFallback(input, controller.signal);

        // Build DecodingParams
        const params: DecodingParams = {};
        if (TYPES_WITH_PLUTUS_SCRIPT_VERSION.includes(selectedType) && plutusScriptVersion) {
          params.plutus_script_version = plutusScriptVersion;
        }
        if (TYPES_WITH_PLUTUS_DATA_SCHEMA.includes(selectedType) && plutusDataSchema) {
          params.plutus_data_schema = plutusDataSchema;
        }

        // Worker already converted serde numbers.
        let result = await callLib<unknown>(
          "decode_specific_type",
          [processedInput, selectedType, params],
          { signal: controller.signal },
        );
        if (cancelled) return;

        // Reorder transaction fields for better readability
        if (selectedType === "Transaction") {
          result = reorderTransactionFields(result);
        }

        setDecodedJson(result);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(libErrorMessage(e));
        setDecodedJson(null);
      } finally {
        // Do not clear loading if a newer decode has already started.
        if (!cancelled) setIsLoading(false);
      }
    };

    void decode();
    return () => {
      cancelled = true;
      controller.abort();
      // Stop the spinner if nothing replaces this run (empty input / no type).
      setIsLoading(false);
    };
  }, [selectedType, input, plutusScriptVersion, plutusDataSchema, setDecodedJson, setError, setIsLoading]);

  const handleClear = useCallback(() => {
    clearAll();
  }, [clearAll]);

  const handleNetworkChange = useCallback(
    (value: string) => {
      setNetwork(value as NetworkType);
    },
    [setNetwork]
  );

  const handleTypeChange = useCallback(
    (value: string) => {
      setSelectedType(value);
      
      // Reset params when type changes
      if (!TYPES_WITH_PLUTUS_SCRIPT_VERSION.includes(value)) {
        setPlutusScriptVersion(null);
      }
      if (!TYPES_WITH_PLUTUS_DATA_SCHEMA.includes(value)) {
        setPlutusDataSchema(null);
      }
    },
    [setSelectedType, setPlutusScriptVersion, setPlutusDataSchema]
  );

  const needsPlutusScriptVersion = selectedType && TYPES_WITH_PLUTUS_SCRIPT_VERSION.includes(selectedType);
  const needsPlutusDataSchema = selectedType && TYPES_WITH_PLUTUS_DATA_SCHEMA.includes(selectedType);

  // Left panel: Input and controls
  const leftPanel = (
    <div className="panel-content cardano-cbor-left">
      <div className="panel-header-compact">
        <span className="panel-title">CBOR or Bech32 input</span>
        <HelpTooltip>
          <strong>How to use:</strong> Paste CBOR hex (or base64/bech32) data below. The structure type will be auto-detected, or you&apos;ll see a modal to choose from possible types. You can change the type later using the dropdown.
        </HelpTooltip>
        {notification && <span className="panel-badge info">{notification}</span>}
        {error && (
          <span className="panel-badge error" title={error}>
            {error}
          </span>
        )}
        <ShareButton
          disabled={!input.trim()}
          getTarget={() => ({
            kind: "cardano-cbor",
            input: {
              cbor: input.trim(),
              net: network,
              type: selectedType,
              psv: plutusScriptVersion,
              pds: plutusDataSchema,
            },
          })}
        />
        {selectedType === "Transaction" && input.trim() && (
          <>
            <button
              type="button"
              className="external-link-btn"
              title="Open this transaction in the Transaction Validator"
              onClick={() =>
                // Open the destination in this click; navigate once the worker returns the hex.
                openExternalUrlDeferred(async () => {
                  const { processedInput } = await detectTypesWithFallback(input);
                  return buildValidatorUrl(processedInput, network);
                })
              }
            >
              <CheckCircleIcon size={12} />
              <span>Open in Validator</span>
            </button>
            <button
              type="button"
              className="external-link-btn"
              title="Open this transaction in Tx Studio"
              onClick={() =>
                // Open the destination in this click; navigate once the worker returns the hex.
                openExternalUrlDeferred(async () => {
                  const { processedInput } = await detectTypesWithFallback(input);
                  return buildTxStudioUrl(processedInput, network);
                })
              }
            >
              <ExternalLinkIcon size={12} />
              <span>Tx Studio</span>
            </button>
          </>
        )}
        <button onClick={handleClear} className="btn-icon" title="Clear">
          ✕
        </button>
      </div>

      {/* Controls row */}
      <div className="cardano-cbor-controls">
        <div className="control-group">
          <label>Network</label>
          <Select
            value={network}
            onValueChange={handleNetworkChange}
            options={[
              { value: "mainnet", label: "Mainnet" },
              { value: "preview", label: "Preview" },
              { value: "preprod", label: "Preprod" },
            ]}
          />
        </div>

        <div className="control-group">
          <label>Decoded structure</label>
          <Select
            value={selectedType || ""}
            onValueChange={handleTypeChange}
            disabled={possibleTypes.length === 0}
            placeholder="No types available"
            options={possibleTypes.map((type) => ({ value: type, label: type }))}
          />
        </div>
      </div>

      {/* DecodingParams section */}
      {(needsPlutusScriptVersion || needsPlutusDataSchema) && (
        <div className="cardano-cbor-params">
          <div className="params-header">Decoding Parameters</div>
          
          {needsPlutusScriptVersion && (
            <div className="control-group">
              <label>Plutus Script Version</label>
              <Select
                value={String(plutusScriptVersion || 1)}
                onValueChange={(value) => setPlutusScriptVersion(Number(value))}
                options={[
                  { value: "1", label: "PlutusV1" },
                  { value: "2", label: "PlutusV2" },
                  { value: "3", label: "PlutusV3" },
                ]}
              />
            </div>
          )}

          {needsPlutusDataSchema && (
            <div className="control-group">
              <label>Plutus Data Schema</label>
              <Select
                value={plutusDataSchema || "BasicConversions"}
                onValueChange={(value) => setPlutusDataSchema(value as PlutusDataSchema)}
                options={[
                  { value: "BasicConversions", label: "BasicConversions" },
                  { value: "DetailedSchema", label: "DetailedSchema" },
                ]}
              />
            </div>
          )}
        </div>
      )}

      {/* Usage hint */}
      <HintBanner storageKey="cquisitor_hint_cardano_cbor">
        <strong>How to use:</strong> Paste CBOR hex (or base64/bech32) below. The type will be auto-detected or you&apos;ll choose from options. Change type later via dropdown.
      </HintBanner>

      {/* Input textarea */}
      <div className="cardano-cbor-input-wrapper">
        {!input.trim() && (
          <div className="paste-hint-overlay">
            <svg
              className="paste-hint-icon"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="8" y="2" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M16 4H18C19.1046 4 20 4.89543 20 6V20C20 21.1046 19.1046 22 18 22H6C4.89543 22 4 21.1046 4 20V6C4 4.89543 4.89543 4 6 4H8" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="paste-hint-text">Paste here</span>
            <span className="paste-hint-formats">HEX · Base64 · Bech32</span>
          </div>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder=""
          className="cardano-cbor-textarea"
          spellCheck={false}
        />
      </div>
    </div>
  );

  // Right panel: JSON viewer (shown directly without extra wrapper)
  const rightPanel = (
    <div className="panel-content cardano-cbor-right">
      <div className="panel-header-compact">
        <span className="panel-title">Decoded Structure</span>
        {isLoading && <span className="panel-badge info">Decoding...</span>}
      </div>
      {decodedJson ? (
        <JsonViewer data={decodedJson} expanded={3} network={network} />
      ) : error ? (
        <div className="empty-state">
          <p className="empty-hint">
            {error}
            {error === TYPED_DECODING_DEPTH_MESSAGE && (
              <>
                {" "}
                <a href="#general-cbor">Open the general CBOR tab</a>
              </>
            )}
          </p>
        </div>
      ) : (
        <EmptyStatePlaceholder
          title="Cardano data viewer"
          description="Paste CBOR hex, base64, or bech32 data in the left panel. The structure type will be auto-detected, or you'll be able to choose from possible options."
          showArrow={false}
          icon="cardano"
        />
      )}
    </div>
  );

  return (
    <>
      <div className="cardano-cbor-layout">
        <ResizablePanels
          leftPanel={leftPanel}
          rightPanel={rightPanel}
          defaultLeftWidth={45}
          minLeftWidth={25}
          maxLeftWidth={75}
        />
      </div>
      
      <TypeSelectionModal
        isOpen={showTypeModal}
        types={pendingTypes}
        onSelect={handleTypeSelect}
        onClose={handleModalClose}
      />
    </>
  );
}
