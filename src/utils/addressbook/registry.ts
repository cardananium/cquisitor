// Loading the eternl registry, which gives a contract address a name before
// the viewer has saved anything.
//
// The snapshot in this repository is what the app starts from: it needs no
// network call, and no third party decides what a first visit says. A refresh
// over the network then replaces it, so a contract the registry classified
// after the last release still gets its name. The viewer can turn that off.
//
// What the refresh is trusted with is deliberately small. The data names
// scripts; it never reaches the green check, which only an entry the viewer
// saved can earn. A reply that does not parse, or that carries fewer scripts
// than the floor below, is dropped and the snapshot stands.

import { createStore, get as idbGet, set as idbSet } from "idb-keyval";
import { buildRegistryIndex, type RegistryIndex } from "./lookup";
import { emptyBundle, parseScriptIndex } from "./registryData";
import type { RegistryBundle } from "./types";

export const REGISTRY_REPO = "https://github.com/Tastenkunst/eternl-cardano-registry";

export const REGISTRY_URL =
  "https://raw.githubusercontent.com/Tastenkunst/eternl-cardano-registry/main/registry/scripts/script-index.json";

/** Where the viewer's choice about the refresh is kept. */
export const REGISTRY_LIVE_KEY = "cquisitor:addressbook:registry-live";

/** How long a fetched copy is used before the next refresh. */
export const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 15_000;

/** A reply larger than this is dropped unread. The file is about 0.6 MB. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Scripts a fetched copy needs before it may replace the snapshot. The floor
 * rejects a truncated or emptied file; the registry can still shrink by any
 * normal amount.
 */
const MIN_NETWORK_SCRIPTS = 200;

const idbStore = () => createStore("cquisitor-addressbook", "registry");
const CACHE_KEY = "eternl-script-index";

interface CacheRecord {
  raw: unknown;
  at: number;
}

export type RegistryStatus = "idle" | "loading" | "ready";

export interface RegistryState {
  status: RegistryStatus;
  bundle: RegistryBundle;
  index: RegistryIndex | null;
  /** Whether the refresh over the network is on. */
  live: boolean;
  /** Epoch milliseconds of the copy in use, when it came over the network. */
  fetchedAt: number | null;
  /** A refresh is running. */
  refreshing: boolean;
  /** Why the last refresh gave nothing. The snapshot stands in that case. */
  error: string | null;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserPreferenceStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLivePreference(storage: PreferenceStorage | null): boolean {
  try {
    return storage?.getItem(REGISTRY_LIVE_KEY) !== "false";
  } catch {
    return true;
  }
}

export interface RegistryDeps {
  /** The snapshot, imported late so its 0.2 MB stays out of the first chunk. */
  loadSnapshot?: () => Promise<unknown>;
  fetchIndex?: (url: string, signal: AbortSignal) => Promise<Response>;
  readCache?: () => Promise<CacheRecord | undefined>;
  writeCache?: (record: CacheRecord) => Promise<void>;
  storage?: () => PreferenceStorage | null;
  now?: () => number;
}

export interface RegistryStore {
  state(): RegistryState;
  /** Loads the snapshot, then refreshes when that is on. Runs once. */
  ensure(): void;
  /** Fetches now, whatever the cache says. */
  refresh(): Promise<void>;
  setLive(live: boolean): void;
  subscribe(listener: () => void): () => void;
  version(): number;
}

const hasIdb = (): boolean => {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
};

async function defaultReadCache(): Promise<CacheRecord | undefined> {
  if (!hasIdb()) return undefined;
  try {
    return await idbGet<CacheRecord>(CACHE_KEY, idbStore());
  } catch {
    return undefined;
  }
}

async function defaultWriteCache(record: CacheRecord): Promise<void> {
  if (!hasIdb()) return;
  try {
    await idbSet(CACHE_KEY, record, idbStore());
  } catch {
    // Private mode or quota: the copy lasts for this page only.
  }
}

export function createRegistryStore(deps: RegistryDeps = {}): RegistryStore {
  const loadSnapshot =
    deps.loadSnapshot ??
    (() => import("./eternlRegistry.generated").then((m) => m.ETERNL_SCRIPT_INDEX));
  const fetchIndex =
    deps.fetchIndex ?? ((url: string, signal: AbortSignal) => fetch(url, { signal }));
  const readCache = deps.readCache ?? defaultReadCache;
  const writeCache = deps.writeCache ?? defaultWriteCache;
  const storageOf = deps.storage ?? browserPreferenceStorage;
  const now = deps.now ?? (() => Date.now());

  let state: RegistryState = {
    status: "idle",
    bundle: emptyBundle(),
    index: null,
    live: true,
    fetchedAt: null,
    refreshing: false,
    error: null,
  };
  let liveRead = false;
  let version = 0;
  const listeners = new Set<() => void>();
  let started: Promise<void> | null = null;

  const announce = (patch: Partial<RegistryState>): void => {
    state = { ...state, ...patch };
    version++;
    for (const listener of [...listeners]) listener();
  };

  const live = (): boolean => {
    if (!liveRead) {
      liveRead = true;
      state = { ...state, live: readLivePreference(storageOf()) };
    }
    return state.live;
  };

  /** Takes a parsed document as the bundle in use, when it holds enough. */
  const adopt = (raw: unknown, fetchedAt: number | null): boolean => {
    const bundle = parseScriptIndex(raw, fetchedAt === null ? "snapshot" : "network");
    if (!bundle) return false;
    if (fetchedAt !== null && bundle.scripts.size < MIN_NETWORK_SCRIPTS) return false;
    if (fetchedAt !== null) bundle.fetchedAt = fetchedAt;
    announce({
      bundle,
      index: buildRegistryIndex(bundle),
      status: "ready",
      fetchedAt,
      error: null,
    });
    return true;
  };

  const fetchFresh = async (): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchIndex(REGISTRY_URL, controller.signal);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const length = Number(res.headers?.get?.("content-length") ?? "0");
      if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("reply too large");
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error("reply too large");
      const at = now();
      const raw = JSON.parse(text) as unknown;
      if (!adopt(raw, at)) throw new Error("the reply is not a usable script index");
      await writeCache({ raw, at });
    } finally {
      clearTimeout(timer);
    }
  };

  const refreshNow = async (): Promise<void> => {
    announce({ refreshing: true, error: null });
    try {
      await fetchFresh();
    } catch (error) {
      announce({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      announce({ refreshing: false });
    }
  };

  /** `force` skips the cache and the preference, for an explicit check. */
  const start = async (force: boolean): Promise<void> => {
    announce({ status: "loading" });
    // A fetch may already have answered, through "check now" before the first
    // address was shown. The snapshot is the floor, never a replacement.
    if (state.bundle.scripts.size === 0) {
      try {
        adopt(await loadSnapshot(), null);
      } catch {
        announce({ status: "ready", error: "the snapshot could not be loaded" });
      }
    }
    if (!live() && !force) return;
    if (!force) {
      const cached = await readCache();
      if (cached && now() - cached.at <= REGISTRY_TTL_MS && adopt(cached.raw, cached.at)) return;
    }
    await refreshNow();
  };

  return {
    state() {
      live();
      return state;
    },
    ensure() {
      if (started) return;
      started = start(false);
    },
    /** One fetch, whether or not the load has run: never two for one click. */
    async refresh() {
      if (!started) {
        started = start(true);
        await started;
        return;
      }
      await started;
      await refreshNow();
    },
    setLive(next) {
      // Read the kept choice before writing over it, or a store that nothing
      // has asked yet compares against the default and does nothing.
      const current = live();
      try {
        storageOf()?.setItem(REGISTRY_LIVE_KEY, next ? "true" : "false");
      } catch {
        // The choice lasts for this page only.
      }
      if (current === next) return;
      announce({ live: next });
      // Turning it on refreshes at once; turning it off keeps what is loaded.
      if (!next) return;
      if (started) void refreshNow();
      else started = start(true);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version() {
      return version;
    },
  };
}

/** The app's registry, shared by every view. */
export const registryStore: RegistryStore = createRegistryStore();
