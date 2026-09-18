"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parseHash, parseCddlShare, type ParsedCddlShare } from "@/utils/shareLink";
// Only the boot document is imported statically. This provider is on every page;
// the preset table is ~15 KB and unused elsewhere — see DEFAULT_HYDRATION_DEPS.

/** Where the schema in the editor came from, when it came from a preset. */
export interface PresetSource {
  id: string;
  label: string;
}

interface CddlValidatorState {
  cddl: string;
  cborInput: string;
  selectedRule: string;
  /** Preset the schema came from, if any. */
  presetSource: PresetSource | null;
  /**
   * Last schema text the app wrote — `null` once the editor holds something else.
   * Anything else is user work and should be confirmed before replace.
   */
  appAuthoredCddl: string | null;
  /** Share link still being turned into a document. */
  hydrating: boolean;
  /** Preset id a share link named, while it is loading. */
  hydratingPreset: string | null;
  /** Why the link could not be turned into a document. */
  hydrationError: string | null;
  /** True once a rule was named (user, link, or preset), as opposed to the schema's first rule standing in. */
  ruleGiven: boolean;
}

interface CddlValidatorContextType extends CddlValidatorState {
  setCddl: (value: string) => void;
  setCborInput: (value: string) => void;
  setSelectedRule: (value: string) => void;
  setPresetSource: (value: PresetSource | null) => void;
  setAppAuthoredCddl: (value: string | null) => void;
  dismissHydrationError: () => void;
}

const CddlValidatorContext = createContext<CddlValidatorContextType | null>(null);

interface InitialCddlState {
  cddl: string;
  cborInput: string;
  selectedRule: string;
  /** See `appAuthoredCddl`. */
  appAuthoredCddl: string | null;
  hydrating: boolean;
  hydratingPreset: string | null;
}

const BOOT_STATE: InitialCddlState = {
  cddl: "",
  cborInput: "",
  selectedRule: "",
  appAuthoredCddl: null,
  hydrating: false,
  hydratingPreset: null,
};

/** Whether the hash has fields this provider would restore. */
function hasCddlShareState(params: URLSearchParams): boolean {
  return (
    params.get("v") !== null ||
    params.get("preset") !== null ||
    params.get("cddl") !== null ||
    params.get("rule") !== null ||
    params.get("cbor") !== null
  );
}

/** First-render document: what the link names; pending parts stay empty. */
export function readInitialCddlState(hash: string): InitialCddlState {
  const { tab, params } = parseHash(hash);
  if (tab !== "cddl-validator" || !hasCddlShareState(params)) return BOOT_STATE;
  const presetId = params.get("preset");
  return {
    cddl: params.get("cddl") ?? "",
    cborInput: params.get("cbor") ?? "",
    selectedRule: params.get("rule") ?? "",
    // Link text is user-owned; a preset resolved below replaces this with what it loaded.
    appAuthoredCddl: null,
    hydrating: params.get("v") !== null || presetId !== null,
    hydratingPreset: presetId,
  };
}

/** Document field a share link may still write. */
export type CddlField = "cddl" | "cbor" | "rule";

/**
 * Side effects a hydration run uses. Asks for current state at write time rather than taking a snapshot, because it spans decompression and a download.
 */
export interface CddlHydrationSink {
  /** Whether the user changed this field since the page opened. User edits outrank the link. */
  edited: (field: CddlField) => boolean;
  /** True once the provider has unmounted. */
  cancelled: () => boolean;
  setCddl: (value: string) => void;
  setCborInput: (value: string) => void;
  setSelectedRule: (value: string) => void;
  setAppAuthoredCddl: (value: string) => void;
  setPresetSource: (value: PresetSource) => void;
  setHydratingPreset: (value: string | null) => void;
  setHydrating: (value: boolean) => void;
  setHydrationError: (value: string) => void;
}

/** Loaded preset schema and picker label. */
export interface LoadedPreset {
  text: string;
  label: string;
  /** Default rule for this era; empty when the id is not a preset. */
  rootRule: string;
}

export interface CddlHydrationDeps {
  parseShare: (params: URLSearchParams) => Promise<ParsedCddlShare>;
  loadPreset: (id: string) => Promise<LoadedPreset>;
}

const DEFAULT_HYDRATION_DEPS: CddlHydrationDeps = {
  parseShare: parseCddlShare,
  // Dynamic import: this provider is on every page; only a preset link needs the table.
  loadPreset: async (id) => {
    const { CARDANO_PRESETS, loadCardanoPreset } = await import("@/app/cddl-validator/presets");
    const text = await loadCardanoPreset(id);
    const preset = CARDANO_PRESETS.find((p) => p.id === id);
    return { text, label: preset?.label ?? id, rootRule: preset?.rootRule ?? "" };
  },
};

/** Shown when the link lost a race with user edits, so a mismatch with the URL is explained. */
export const KEPT_EDITS_MESSAGE =
  "This link finished loading after you had started editing. What you changed was kept, " +
  "and the link's own version of it was not applied.";

/**
 * Apply the opening URL to the document after decompression / preset download.
 * Each write is skipped if the user has since edited that field.
 */
export async function hydrateCddlFromHash(
  hash: string,
  sink: CddlHydrationSink,
  deps: CddlHydrationDeps = DEFAULT_HYDRATION_DEPS,
): Promise<void> {
  const { tab, params } = parseHash(hash);
  if (tab !== "cddl-validator") return;
  const rich = params.get("v") !== null;
  let presetId = params.get("preset");
  if (!rich && !presetId) return;

  let linkRule = params.get("rule") ?? "";
  let keptEdits = false;
  let reported = false;

  const write = (field: CddlField, apply: () => void) => {
    if (sink.edited(field)) keptEdits = true;
    else apply();
  };

  if (rich) {
    const parsed = await deps.parseShare(params);
    if (sink.cancelled()) return;
    if (parsed.futureVersion) {
      sink.setHydrationError(
        "This link was made by a newer version of CQuisitor and could not be read. " +
          "Whatever it carried outside the plain query parameters is missing.",
      );
      reported = true;
    } else if (parsed.parseError) {
      sink.setHydrationError(`This link could not be read — ${parsed.parseError}.`);
      reported = true;
    }
    const { cddl, cbor, rule } = parsed;
    if (!linkRule && rule !== undefined) linkRule = rule;
    // A plain query param wins over the same field inside the payload, and is already on screen.
    if (!params.get("cddl") && cddl !== undefined) {
      write("cddl", () => sink.setCddl(cddl));
    }
    if (!params.get("cbor") && cbor !== undefined) {
      write("cbor", () => sink.setCborInput(cbor));
    }
    if (!params.get("rule") && rule !== undefined) {
      write("rule", () => sink.setSelectedRule(rule));
    }
    if (!presetId && parsed.preset !== undefined) {
      presetId = parsed.preset;
      sink.setHydratingPreset(presetId);
    }
  }

  if (presetId) {
    const id = presetId;
    try {
      const loaded = await deps.loadPreset(id);
      if (sink.cancelled()) return;
      write("cddl", () => {
        sink.setCddl(loaded.text);
        sink.setAppAuthoredCddl(loaded.text);
        sink.setPresetSource({ id, label: loaded.label });
        // A preset with no named rule must not fall through to the era schema's first rule (`block`).
        if (!linkRule && loaded.rootRule && !sink.edited("rule")) {
          sink.setSelectedRule(loaded.rootRule);
        }
      });
    } catch (e) {
      if (sink.cancelled()) return;
      sink.setHydrationError(e instanceof Error ? e.message : String(e));
      reported = true;
    }
    sink.setHydratingPreset(null);
  }

  if (keptEdits && !reported) sink.setHydrationError(KEPT_EDITS_MESSAGE);
  sink.setHydrating(false);
}

export function CddlValidatorProvider({ children }: { children: ReactNode }) {
  // Read once: this provider re-renders on every keystroke, and the opening hash cannot change under it.
  const [initial] = useState<InitialCddlState>(() =>
    typeof window === "undefined" ? BOOT_STATE : readInitialCddlState(window.location.hash),
  );

  const [cddl, writeCddl] = useState(initial.cddl);
  const [cborInput, writeCborInput] = useState(initial.cborInput);
  const [selectedRule, writeRule] = useState(initial.selectedRule);
  const [ruleGiven, setRuleGiven] = useState(initial.selectedRule.trim() !== "");
  const writeSelectedRule = useCallback((value: string) => {
    setRuleGiven(value.trim() !== "");
    writeRule(value);
  }, []);
  const [presetSource, setPresetSource] = useState<PresetSource | null>(null);
  const [appAuthoredCddl, setAppAuthoredCddl] = useState<string | null>(initial.appAuthoredCddl);
  const [hydrating, setHydrating] = useState(initial.hydrating);
  const [hydratingPreset, setHydratingPreset] = useState<string | null>(initial.hydratingPreset);
  const [hydrationError, setHydrationError] = useState<string | null>(null);

  // UI setters record edits; hydration writes through the state setters directly.
  const edited = useRef<Record<CddlField, boolean>>({ cddl: false, cbor: false, rule: false });
  const setCddl = useCallback((value: string) => {
    edited.current.cddl = true;
    writeCddl(value);
  }, []);
  const setCborInput = useCallback((value: string) => {
    edited.current.cbor = true;
    writeCborInput(value);
  }, []);
  const setSelectedRule = useCallback((value: string) => {
    edited.current.rule = true;
    writeSelectedRule(value);
  }, [writeSelectedRule]);

  const dismissHydrationError = useCallback(() => setHydrationError(null), []);

  useEffect(() => {
    let cancelled = false;
    void hydrateCddlFromHash(window.location.hash, {
      edited: (field) => edited.current[field],
      cancelled: () => cancelled,
      setCddl: writeCddl,
      setCborInput: writeCborInput,
      setSelectedRule: writeSelectedRule,
      setAppAuthoredCddl,
      setPresetSource,
      setHydratingPreset,
      setHydrating,
      setHydrationError,
    });
    return () => {
      cancelled = true;
    };
  }, [writeSelectedRule]);

  return (
    <CddlValidatorContext.Provider
      value={{
        cddl,
        cborInput,
        selectedRule,
        presetSource,
        appAuthoredCddl,
        hydrating,
        hydratingPreset,
        hydrationError,
        ruleGiven,
        setCddl,
        setCborInput,
        setSelectedRule,
        setPresetSource,
        setAppAuthoredCddl,
        dismissHydrationError,
      }}
    >
      {children}
    </CddlValidatorContext.Provider>
  );
}

export function useCddlValidator() {
  const context = useContext(CddlValidatorContext);
  if (!context) {
    throw new Error("useCddlValidator must be used within a CddlValidatorProvider");
  }
  return context;
}
