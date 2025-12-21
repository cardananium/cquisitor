/**
 * ScriptRef Format Utilities
 * 
 * Helpers for formatting raw script bytes into ScriptRef CBOR format
 * that cquisitor-lib expects.
 * 
 * ScriptRef is a 2-element CBOR array: [tag, script]
 * Where tag indicates the script type:
 * - 0 = NativeScript
 * - 1 = PlutusV1
 * - 2 = PlutusV2
 * - 3 = PlutusV3
 */

/**
 * Script type as returned by Koios API
 */
export type KoiosScriptType = 'native' | 'timelock' | 'multisig' | 'plutusv1' | 'plutusv2' | 'plutusv3';

/**
 * Encodes a hex byte string as CBOR bytes with length prefix
 * 
 * CBOR bytes encoding (major type 2):
 * - Length 0-23: 0x40 + length (single byte header)
 * - Length 24-255: 0x58 + 1 byte length
 * - Length 256-65535: 0x59 + 2 byte length  
 * - Length 65536+: 0x5a + 4 byte length
 * 
 * @param hexBytes - Hex-encoded bytes to wrap
 * @returns CBOR-encoded bytes string
 */
export function encodeCborBytes(hexBytes: string): string {
  const byteLength = hexBytes.length / 2;
  
  if (byteLength < 24) {
    return (0x40 + byteLength).toString(16).padStart(2, '0') + hexBytes;
  } else if (byteLength < 256) {
    return '58' + byteLength.toString(16).padStart(2, '0') + hexBytes;
  } else if (byteLength < 65536) {
    return '59' + byteLength.toString(16).padStart(4, '0') + hexBytes;
  } else {
    return '5a' + byteLength.toString(16).padStart(8, '0') + hexBytes;
  }
}

/**
 * Maps Koios script type to ScriptRef tag
 * 
 * ScriptRef in CBOR format is: [tag, script_bytes]
 * Where tag is:
 * - 0 = NativeScript
 * - 1 = PlutusV1
 * - 2 = PlutusV2
 * - 3 = PlutusV3
 */
export function getScriptRefTag(koiosType: string): number {
  const typeMap: Record<string, number> = {
    'native': 0,
    'timelock': 0,
    'multisig': 0,
    'plutusv1': 1,
    'plutusv2': 2,
    'plutusv3': 3,
  };
  return typeMap[koiosType.toLowerCase()] ?? 3; // default to PlutusV3 if unknown
}

/**
 * Checks if the bytes are already in ScriptRef format (2-element CBOR array with valid tag)
 * 
 * ScriptRef format starts with:
 * - 8200... (NativeScript)
 * - 8201... (PlutusV1)
 * - 8202... (PlutusV2)
 * - 8203... (PlutusV3)
 * 
 * @param bytes - Hex-encoded bytes to check
 * @returns true if already in ScriptRef format
 */
export function isScriptRefFormat(bytes: string): boolean {
  return bytes.startsWith('8200') || 
         bytes.startsWith('8201') || 
         bytes.startsWith('8202') || 
         bytes.startsWith('8203');
}

/**
 * Wraps script bytes in ScriptRef format
 * 
 * ScriptRef is a 2-element CBOR array: [tag, script]
 * Format: 82 <tag> <script_bytes>
 * 
 * NOTE: For Plutus scripts, the script bytes should already be 
 * wrapped in CBOR bytes format (using encodeCborBytes) BEFORE
 * calling this function.
 * 
 * Examples:
 * - NativeScript: "830304..." → "8200830304..." = [0, <native_script>]
 * - PlutusV2 (pre-wrapped): "59053059052d..." → "820259053059052d..." = [2, h'...']
 * 
 * @param scriptHex - Script bytes in hex (pre-wrapped for Plutus)
 * @param scriptType - Script type from Koios (e.g., 'plutusv2', 'native')
 * @returns ScriptRef formatted bytes in hex
 */
export function wrapInScriptRefFormat(scriptHex: string, scriptType?: string): string {
  // If already in ScriptRef format, return as is
  if (isScriptRefFormat(scriptHex)) {
    return scriptHex;
  }
  
  const tag = scriptType ? getScriptRefTag(scriptType) : 3; // default to PlutusV3
  const tagHex = tag.toString(16).padStart(2, '0');
  
  return '82' + tagHex + scriptHex;
}

/**
 * Formats script reference bytes for cquisitor-lib
 * 
 * cquisitor-lib expects ScriptRef in the format: [tag, script_bytes]
 * But Koios/get_ref_script_bytes may return:
 * 1. Already formatted ScriptRef (starts with 82 + valid tag)
 * 2. Raw script bytes that need to be wrapped
 * 
 * @param scriptBytes - Script bytes (raw or already formatted)
 * @param scriptType - Optional script type from Koios
 * @returns Properly formatted ScriptRef bytes
 */
export function formatScriptRefForLib(scriptBytes: string, scriptType?: string): string {
  if (!scriptBytes) {
    return scriptBytes;
  }
  return wrapInScriptRefFormat(scriptBytes, scriptType);
}

