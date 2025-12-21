/**
 * Convert serde_json::private::Number to native BigInt/number recursively.
 * This handles the special format that Rust's serde_json uses for large numbers
 * when serializing to JavaScript.
 */
export function convertSerdeNumbers<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(convertSerdeNumbers) as T;
  }
  
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    
    // Check for serde_json number format
    if ("$serde_json::private::Number" in record) {
      const numStr = record["$serde_json::private::Number"] as string;
      // Use BigInt for large numbers, regular number for small ones
      const num = Number(numStr);
      if (Number.isSafeInteger(num)) {
        return num as T;
      }
      return BigInt(numStr) as T;
    }
    
    // Recursively process all properties
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = convertSerdeNumbers(value);
    }
    return result as T;
  }
  
  return obj;
}
