// Canonical CDDL schemas from IntersectMBO/cardano-ledger. Paths verified
// against the repo tree on master; update if the upstream layout changes.
const LEDGER_BASE =
  "https://raw.githubusercontent.com/IntersectMBO/cardano-ledger/master";

export interface CardanoPreset {
  id: string;
  label: string;
  url: string;
}

export const CARDANO_PRESETS: CardanoPreset[] = [
  { id: "conway",  label: "Conway",  url: `${LEDGER_BASE}/eras/conway/impl/cddl/data/conway.cddl` },
  { id: "babbage", label: "Babbage", url: `${LEDGER_BASE}/eras/babbage/impl/cddl/data/babbage.cddl` },
  { id: "alonzo",  label: "Alonzo",  url: `${LEDGER_BASE}/eras/alonzo/impl/cddl/data/alonzo.cddl` },
  { id: "mary",    label: "Mary",    url: `${LEDGER_BASE}/eras/mary/impl/cddl/data/mary.cddl` },
  { id: "allegra", label: "Allegra", url: `${LEDGER_BASE}/eras/allegra/impl/cddl/data/allegra.cddl` },
  { id: "shelley", label: "Shelley", url: `${LEDGER_BASE}/eras/shelley/impl/cddl/data/shelley.cddl` },
];

const PRESET_CACHE_PREFIX = "cquisitor:cddl-preset:";

export async function loadCardanoPreset(id: string): Promise<string> {
  const preset = CARDANO_PRESETS.find(p => p.id === id);
  if (!preset) throw new Error(`Unknown preset: ${id}`);
  // Per-session cache — avoid re-hitting GitHub on every pick.
  if (typeof sessionStorage !== "undefined") {
    const cached = sessionStorage.getItem(PRESET_CACHE_PREFIX + id);
    if (cached) return cached;
  }
  const res = await fetch(preset.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${preset.label} CDDL`);
  const text = await res.text();
  if (typeof sessionStorage !== "undefined") {
    try { sessionStorage.setItem(PRESET_CACHE_PREFIX + id, text); } catch { /* quota */ }
  }
  return text;
}
