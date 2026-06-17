// The generic PlutusData type + helpers now live in the shared DEX layer so
// every protocol decoder can reuse them. This module re-exports them verbatim
// to keep the original SundaeSwap decoder's imports (`./plutusData`) stable.
export * from "../dex/plutusData";
