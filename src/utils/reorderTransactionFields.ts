/**
 * Reorder transaction fields in a logical order for better readability.
 * Some fields may be absent - only present fields are included.
 */

// Order for transaction body fields
const BODY_FIELD_ORDER = [
  "inputs",
  "outputs",
  "fee",
  "ttl",
  "certs",
  "withdrawals",
  "update",
  "auxiliary_data_hash",
  "validity_start_interval",
  "mint",
  "script_data_hash",
  "collateral",
  "required_signers",
  "network_id",
  "collateral_return",
  "total_collateral",
  "reference_inputs",
  "voting_procedures",
  "voting_proposals",
  "donation",
  "current_treasury_value",
];

// Order for witness_set fields
const WITNESS_SET_FIELD_ORDER = [
  "vkeys",
  "native_scripts",
  "bootstraps",
  "plutus_scripts",
  "plutus_data",
  "redeemers",
];

// Order for transaction fields
const TRANSACTION_FIELD_ORDER = [
  "body",
  "witness_set",
  "is_valid",
  "auxiliary_data",
];

// Order for top-level fields
const TOP_LEVEL_ORDER = [
  "transaction_hash",
  "transaction",
];

/**
 * Reorder object keys according to a specified order.
 * Keys not in the order array are appended at the end.
 */
function reorderObject(
  obj: Record<string, unknown>,
  order: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  // First, add fields in the specified order
  for (const key of order) {
    if (key in obj && obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  
  // Then, add any remaining fields that weren't in the order
  for (const key of Object.keys(obj)) {
    if (!(key in result)) {
      result[key] = obj[key];
    }
  }
  
  return result;
}

/**
 * Reorder transaction fields for better readability.
 * Works with Transaction type decoded from CBOR.
 */
export function reorderTransactionFields<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) return data;

  const obj = data as Record<string, unknown>;

  // Check if this looks like a decoded transaction (has transaction_hash or transaction)
  const hasTransactionHash = "transaction_hash" in obj;
  const hasTransaction = "transaction" in obj;

  if (!hasTransactionHash && !hasTransaction) {
    // Not a transaction object, return as-is
    return data;
  }

  let result = { ...obj };

  // Reorder transaction.body
  if (
    hasTransaction &&
    typeof result.transaction === "object" &&
    result.transaction !== null
  ) {
    const tx = result.transaction as Record<string, unknown>;
    let reorderedTx = { ...tx };

    // Reorder body
    if (typeof tx.body === "object" && tx.body !== null) {
      reorderedTx.body = reorderObject(
        tx.body as Record<string, unknown>,
        BODY_FIELD_ORDER
      );
    }

    // Reorder witness_set
    if (typeof tx.witness_set === "object" && tx.witness_set !== null) {
      reorderedTx.witness_set = reorderObject(
        tx.witness_set as Record<string, unknown>,
        WITNESS_SET_FIELD_ORDER
      );
    }

    // Reorder transaction itself
    reorderedTx = reorderObject(reorderedTx, TRANSACTION_FIELD_ORDER);
    result.transaction = reorderedTx;
  }

  // Reorder top level
  result = reorderObject(result, TOP_LEVEL_ORDER);

  return result as T;
}
