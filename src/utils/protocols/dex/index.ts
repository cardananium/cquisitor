// Shared, protocol-agnostic DEX/dApp decoder layer. Each protocol module
// (src/utils/minswap, src/utils/wingriders, …) builds on these primitives and
// self-registers an adapter via `registerDexAdapter`.

export * from "./plutusData";
export { getPaymentScriptHash, outputAssetPolicyIds } from "./address";
export { decodePlutusJsonOrHex, resolveOutputDatum } from "./datum";
export {
  registerDexAdapter,
  listDexAdapters,
  getDexAdapter,
  formatDexRole,
  type DexAdapter,
  type DexRole,
  type DexIssue,
  type DexRow,
  type DexAssetRow,
  type DexOrderView,
} from "./registry";
export { detectDexOutput, type DexDetection } from "./detect";
export { dexThemeKey } from "./themes";
export {
  buildDexTxContext,
  type DexTxContext,
  type DexInputDetection,
} from "./txContext";
