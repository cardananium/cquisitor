/**
 * URL format version. Bump when encoding layout changes incompatibly.
 * Parser falls back to raw params (cbor, net, …) and ignores `d` when URL's
 * version is greater than this constant.
 */
export const URL_FORMAT_VERSION = 1;

/**
 * Validation context schema version. Bump when FetchedValidationData shape
 * changes incompatibly (field renamed/removed/retyped). Mismatch causes the
 * parser to discard the embedded context; tx + network still survive so the
 * user can refetch a fresh context.
 */
export const CTX_SCHEMA_VERSION = 1;
