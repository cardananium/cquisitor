"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ResizablePanels from "@/components/ResizablePanels";
import JsonViewer from "@/components/JsonViewer";
import TypeSelectionModal from "@/components/TypeSelectionModal";
import Select from "@/components/Select";
import {
  get_possible_types_for_input,
  decode_specific_type,
  type NetworkType,
  type PlutusDataSchema,
  type DecodingParams,
} from "@cardananium/cquisitor-lib";
import { useCardanoCbor } from "@/context/CardanoCborContext";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import EmptyStatePlaceholder from "@/components/EmptyStatePlaceholder";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import { reorderTransactionFields } from "@/utils/reorderTransactionFields";

// Types that require DecodingParams
const TYPES_WITH_PLUTUS_SCRIPT_VERSION = ["PlutusScript"];
const TYPES_WITH_PLUTUS_DATA_SCHEMA = ["PlutusData"];

// Check if string is valid base64
function isValidBase64(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed.length === 0) return false;
  // Check base64 format: alphanumeric, +, /, and optional padding =
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)) return false;
  if (trimmed.length % 4 !== 0) return false;
  try {
    const decoded = Buffer.from(trimmed, "base64");
    // Verify it's actually valid by re-encoding
    return decoded.length > 0 && Buffer.from(decoded).toString("base64") === trimmed;
  } catch {
    return false;
  }
}

function base64ToHex(base64: string): string {
  return Buffer.from(base64.trim(), "base64").toString("hex");
}

// Result of trying to detect types
interface DetectionResult {
  types: string[];
  processedInput: string;
  notification: string | null;
}

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
function detectTypesWithFallback(rawInput: string): DetectionResult {
  const trimmed = rawInput.trim();
  
  // First, try the original input directly
  // This handles: hex, bech32, base58, and potentially base64 if decoder supports it
  try {
    const rawTypes = get_possible_types_for_input(trimmed);
    const types = filterTypes(rawTypes);
    if (types.length > 0) {
      return {
        types,
        processedInput: trimmed,
        notification: null,
      };
    }
  } catch {
    // Continue to fallback
  }
  
  // If original input didn't work and it could be base64, try converting to hex
  if (isValidBase64(trimmed)) {
    try {
      const hexFromBase64 = base64ToHex(trimmed);
      const rawTypes = get_possible_types_for_input(hexFromBase64);
      const types = filterTypes(rawTypes);
      if (types.length > 0) {
        return {
          types,
          processedInput: hexFromBase64,
          notification: "Base64 → hex",
        };
      }
    } catch {
      // Base64 conversion failed
    }
  }
  
  // Nothing worked
  return {
    types: [],
    processedInput: trimmed,
    notification: null,
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

      try {
        // Try to detect types with fallback to base64 conversion
        const { types, notification: notificationMsg } = detectTypesWithFallback(input);
        
        setPossibleTypes(types);
        setNotification(notificationMsg);

        if (types.length === 0) {
          setSelectedType(null);
          setDecodedJson(null);
          setError("No valid Cardano type detected for this input");
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
        setError(e instanceof Error ? e.message : "Error detecting types");
        setPossibleTypes([]);
        setSelectedType(null);
        setShowTypeModal(false);
      }
    }, 200);

    return () => {
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

    const decode = async () => {
      setIsLoading(true);
      try {
        // Use the same detection logic to get the processed input
        const { processedInput } = detectTypesWithFallback(input);

        // Build DecodingParams
        const params: DecodingParams = {};
        if (TYPES_WITH_PLUTUS_SCRIPT_VERSION.includes(selectedType) && plutusScriptVersion) {
          params.plutus_script_version = plutusScriptVersion;
        }
        if (TYPES_WITH_PLUTUS_DATA_SCHEMA.includes(selectedType) && plutusDataSchema) {
          params.plutus_data_schema = plutusDataSchema;
        }

        const result = decode_specific_type(processedInput, selectedType, params);
        // Convert serde_json numbers to native BigInt/number
        let convertedResult = convertSerdeNumbers(result);
        
        // Reorder transaction fields for better readability
        if (selectedType === "Transaction") {
          convertedResult = reorderTransactionFields(convertedResult);
        }
        
        setDecodedJson(convertedResult);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Decode error");
        setDecodedJson(null);
      } finally {
        setIsLoading(false);
      }
    };

    decode();
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
        {error && <span className="panel-badge error">{error}</span>}
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
          <p className="empty-hint">{error}</p>
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
