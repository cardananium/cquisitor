// Per-protocol accent theme key for the generic DEX panel + badge.
//
// Maps a registered adapter id to a stable, version-agnostic key emitted as a
// `data-dex` attribute on the panel/badge. The actual colours live in
// globals.css, which derives every shade from a single `--dex-accent` per key
// (via color-mix). SundaeSwap is intentionally NOT here — it has its own panel
// + styling.
const KEY_BY_ADAPTER: Record<string, string> = {
  minswap: "minswap",
  "wingriders-v2": "wingriders",
  splash: "splash",
  muesliswap: "muesliswap",
  "genius-yield-v1": "geniusyield",
  "genius-yield-v1_1": "geniusyield",
  danogo: "danogo",
  vyfinance: "vyfinance",
  saturnswap: "saturnswap",
  liqwid: "liqwid",
  "lenfi-v2": "lenfi",
  "fluidtokens-loans-v3": "fluidtokens",
  levvy: "levvy",
  indigo: "indigo",
  "butane-synthetics": "butane",
  djed: "djed",
  optim: "optim",
  "strike-finance": "strike",
  charli3: "charli3",
  orcfax: "orcfax",
  "jpgstore-v3": "jpgstore",
};

/** Version-agnostic theme key for an adapter id (falls back to a stripped id). */
export function dexThemeKey(adapterId: string): string {
  return (
    KEY_BY_ADAPTER[adapterId] ??
    adapterId.replace(/-v[\d_]+.*$/, "").replace(/-(synthetics|finance|loans.*)$/, "")
  );
}
