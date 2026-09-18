// Cardano era presets from IntersectMBO/cardano-ledger.
// Era URLs are pinned to one commit; an unpinned URL would silently change saved schemas.

/** The cardano-ledger commit every preset is taken from. */
export const LEDGER_REV = "dae069780697449fbd9cda47f03fb72745b0b8c0";
export const LEDGER_REV_SHORT = LEDGER_REV.slice(0, 7);

const LEDGER_BASE =
  `https://raw.githubusercontent.com/IntersectMBO/cardano-ledger/${LEDGER_REV}`;

export interface CardanoPreset {
  id: string;
  label: string;
  /** Upstream file this preset is a copy of, at `LEDGER_REV`. */
  url: string;
  /** Root rule to select on load. Each era schema's first rule is `block`, not a transaction. */
  rootRule: string;
  /** Present when the schema ships with the app rather than being downloaded.
   *  Works where raw.githubusercontent.com does not. */
  bundled?: () => Promise<string>;
}

export const CARDANO_PRESETS: CardanoPreset[] = [
  {
    id: "conway",
    label: "Conway",
    rootRule: "transaction",
    url: `${LEDGER_BASE}/eras/conway/impl/cddl/data/conway.cddl`,
    bundled: () => import("./conwaySchema").then(m => m.CONWAY_CDDL),
  },
  {
    id: "babbage",
    label: "Babbage",
    rootRule: "transaction",
    url: `${LEDGER_BASE}/eras/babbage/impl/cddl/data/babbage.cddl`,
  },
  {
    id: "alonzo",
    label: "Alonzo",
    rootRule: "transaction",
    url: `${LEDGER_BASE}/eras/alonzo/impl/cddl/data/alonzo.cddl`,
  },
  {
    id: "mary",
    label: "Mary",
    rootRule: "transaction",
    url: `${LEDGER_BASE}/eras/mary/impl/cddl/data/mary.cddl`,
  },
  {
    id: "allegra",
    label: "Allegra",
    rootRule: "transaction",
    url: `${LEDGER_BASE}/eras/allegra/impl/cddl/data/allegra.cddl`,
  },
  {
    id: "shelley",
    label: "Shelley",
    rootRule: "transaction",
    url: `${LEDGER_BASE}/eras/shelley/impl/cddl/data/shelley.cddl`,
  },
];

// ---------- loading a preset ----------

/** What a preset load did, kept until the banner reporting it is dismissed. */
export interface PresetLoad {
  /** Era name, or the raw id when the pick wasn't a known preset. */
  label: string;
  /** Root rule the preset asked for — `null` when it named none. */
  requestedRule: string | null;
}

/**
 * Banner text for a preset load, using the rule actually being validated.
 * While `settling`, `effectiveRule` still describes the schema being replaced.
 */
export function describePresetLoad(
  load: PresetLoad,
  effectiveRule: string,
  settling: boolean,
): string {
  const requested = load.requestedRule;
  if (settling || !requested) {
    return `${load.label} loaded — root rule ${requested ?? "picked from the schema"}.`;
  }
  if (effectiveRule === requested) {
    return `${load.label} loaded — root rule ${requested}.`;
  }
  if (!effectiveRule) {
    return `${load.label} loaded, but it declares no ${requested} and no other rule that could be a root.`;
  }
  return `${load.label} loaded — it declares no ${requested}, so ${effectiveRule} is what this validates against.`;
}

/** How long a preset download may take before it is given up on. */
export const PRESET_FETCH_TIMEOUT_MS = 15_000;

const PRESET_HOST = "raw.githubusercontent.com";

export type PresetFetchFailure =
  | { kind: "timeout"; afterMs: number }
  | { kind: "offline" }
  | { kind: "http"; status: number }
  | { kind: "other"; message: string };

/**
 * Classify a download failure. `fetch` rejects with `TypeError` when the
 * request never reached a server — different from an HTTP status.
 */
export function classifyPresetFetchFailure(
  error: unknown,
  timedOut: boolean,
  timeoutMs: number,
): PresetFetchFailure {
  // The only abort this code issues is the timeout's own.
  if (timedOut || (error instanceof Error && error.name === "AbortError")) {
    return { kind: "timeout", afterMs: timeoutMs };
  }
  if (error instanceof TypeError) return { kind: "offline" };
  return { kind: "other", message: error instanceof Error ? error.message : String(error) };
}

/**
 * `offlineAlternative` is named only when that is the way out of this failure.
 */
export function describePresetFetchFailure(
  label: string,
  failure: PresetFetchFailure,
  offlineAlternative?: string,
): string {
  const head = `${label} could not be loaded`;
  const fallback = offlineAlternative
    ? ` The ${offlineAlternative} preset ships with the app rather than being downloaded.`
    : "";
  switch (failure.kind) {
    case "timeout": {
      const budget = failure.afterMs >= 1000
        ? `${failure.afterMs / 1000} seconds`
        : `${failure.afterMs} ms`;
      return `${head} — ${PRESET_HOST} did not answer within ${budget}.${fallback}`;
    }
    case "offline":
      return `${head} — the request to ${PRESET_HOST} failed before it reached a server. You are offline, or the domain is blocked here.${fallback}`;
    case "http":
      return `${head} — ${PRESET_HOST} answered HTTP ${failure.status}.`;
    case "other":
      return `${head} — ${failure.message}`;
  }
}

const PRESET_CACHE_PREFIX = "cquisitor:cddl-preset:";

/** A browser that refuses storage throws on access, not just on write. */
function readCache(id: string): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(PRESET_CACHE_PREFIX + id);
  } catch {
    return null;
  }
}

function writeCache(id: string, text: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(PRESET_CACHE_PREFIX + id, text);
  } catch {
    // Quota, or storage disabled — the schema is already in hand.
  }
}

type FetchOutcome =
  | { ok: true; text: string }
  | { ok: false; failure: PresetFetchFailure };

/** Abort is what stops a hung request; without it the picker would sit on "loading …". */
async function fetchPresetText(preset: CardanoPreset, timeoutMs: number): Promise<FetchOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(preset.url, { signal: controller.signal });
    if (!res.ok) return { ok: false, failure: { kind: "http", status: res.status } };
    return { ok: true, text: await res.text() };
  } catch (e) {
    return { ok: false, failure: classifyPresetFetchFailure(e, timedOut, timeoutMs) };
  } finally {
    clearTimeout(timer);
  }
}

/** `timeoutMs` is the budget for a download that has to leave the app. */
export async function loadCardanoPreset(
  id: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const preset = CARDANO_PRESETS.find(p => p.id === id);
  if (!preset) throw new Error(`Unknown preset: ${id}`);
  if (preset.bundled) return preset.bundled();

  // Per-session cache — avoid re-hitting GitHub on every pick.
  const cached = readCache(id);
  if (cached !== null) return cached;

  const outcome = await fetchPresetText(preset, options.timeoutMs ?? PRESET_FETCH_TIMEOUT_MS);
  if (!outcome.ok) {
    const offline = CARDANO_PRESETS.find(p => p.bundled && p.id !== preset.id);
    throw new Error(describePresetFetchFailure(preset.label, outcome.failure, offline?.label));
  }
  writeCache(id, outcome.text);
  return outcome.text;
}

// ---------- replacing the editor ----------

/**
 * Confirm before throwing away a schema, or `null` when nothing would be lost.
 * `appAuthored` is the last text the app put in the editor; anything else is user work.
 */
export function confirmReplaceMessage(
  current: string,
  appAuthored: string | null,
  replacement: string,
): string | null {
  if (current.trim() === "" || current === appAuthored) return null;
  return `Replace the schema you have edited with ${replacement}? Undo puts it back.`;
}
