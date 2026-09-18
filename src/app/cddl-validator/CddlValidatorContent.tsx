"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ShareButton from "@/components/ShareButton";
import type { ExtraErrorSpan } from "@/components/EditableHexView";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import type { CborPosition } from "@cardananium/cquisitor-lib";
import type { PanelMenuAction } from "@/components/panelMenuActions";
import CddlSchemaToolbar, { type ActivePreset } from "./CddlSchemaToolbar";
import { type CddlEditorHandle } from "./CddlEditor";
import { DecodedPane, EditorPane, HexPane, TreePane } from "./linkedPanes";
import { createHoverLinkStore } from "./hoverLink";
import CddlErrorNav, { type CddlErrorEntry } from "./CddlErrorNav";
import { RootSuggestionNote, WalkRefusalCard } from "./CddlValidationPanel";
import InstanceNav from "./InstanceNav";
import MismatchDrawer from "./MismatchDrawer";
import DockWorkspace, { type DockWorkspaceHandle, type PanelRegistry } from "./DockWorkspace";
import PinContextMenu from "./PinContextMenu";
import RefusalBanner from "./RefusalBanner";
import TypeSelectionModal from "@/components/TypeSelectionModal";
import SchemaErrorLine from "./SchemaErrorLine";
import VerdictChip from "./VerdictChip";
import { useCddlValidator } from "@/context/CddlValidatorContext";
import {
  CARDANO_PRESETS,
  confirmReplaceMessage,
  describePresetLoad,
  loadCardanoPreset,
  type PresetLoad,
} from "./presets";
import {
  abbreviatePath,
  cddlErrorReason,
  describeDiagnostic,
  isRootMismatch,
  utf16ToByte,
} from "./cddlError";
import { formatCddlChecked, safeSymbolAt } from "./cddlValidatorLib";
import type { CborCddlNode } from "./cborCddlBridge";
import { diagnosticDecodedRows, diagnosticTreeRows } from "./diagnosticRows";
import {
  currentIndex,
  makePin,
  nextReveal,
  pinStepKey,
  pinnedOtherDecodedPaths,
  pinnedOtherTreeKeys,
  scrollFlagFor,
  stepPin as stepPinState,
  visitedDecodedPaths,
  visitedTreePositions,
  type PinState,
  type Reveal,
} from "./instances";
import {
  buildEditorMarks,
  buildExtraErrorSpans,
  linkedHexSpansForCddlOffset,
  pinMenuNotice,
  pinTargetBlockers,
  pinnedHexSpans,
  pinnedOtherHexSpans,
  projectNode,
  resolveProbe,
  ALL_PIN_TARGETS,
  type PinTarget,
} from "./pinResolvers";
import { candidateRootRules, resolveRootRule } from "./ruleSelection";
import { cborRootKind } from "./rootKinds";
import { hexRefusalFor, isListable, verdictFor } from "./verdict";
import { type PanelId } from "./workspaceLayout";
import {
  caretForReferences,
  settleDelayFor,
  useCborCddlMap,
  useCborDecoded,
  useCborValidation,
  useCddlSchema,
  useDebouncedString,
  useDebouncedValue,
  useDecodeAgainstSchema,
  useReferenceRanges,
  useRootSuggestions,
  shareCborState,
  type CaretProbe,
} from "./hooks";

const NO_ROOT_CANDIDATES: string[] = [];

/** Spinner in a panel header while that panel's inputs are still settling. */
function PendingSpinner({ label }: { label: string }) {
  return (
    <span
      className="cddl-pending-spinner animate-spin"
      role="status"
      aria-label={label}
      title={label}
    />
  );
}

export default function CddlValidatorContent() {
  // ---------- input state ----------
  // Document state lives above the router so a hash change or share-link
  // hydration cannot unmount a schema being edited.
  const {
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
  } = useCddlValidator();
  const [localPresetLoading, setPresetLoading] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const presetLoading = localPresetLoading ?? hydratingPreset;
  /** Last preset load's effect on the rule, until dismissed. */
  const [presetNotice, setPresetNotice] = useState<PresetLoad | null>(null);
  // Format refusal + one-step undo for React schema replacements (textarea
  // undo does not cover those). Undo also restores rule, authorship, and
  // preset so the tab does not validate a different document.
  const [formatError, setFormatError] = useState<string | null>(null);
  const [replaced, setReplaced] = useState<
    {
      text: string;
      rule: string;
      label: string;
      /** Authorship flag to restore with the text. */
      appAuthored: string | null;
      /** Preset provenance to restore with the text. */
      preset: { id: string; label: string } | null;
    } | null
  >(null);
  // Visible tabs, plus every panel shown at least once. Bodies stay mounted
  // so expanded rows and decode stay; an unshown panel costs nothing.
  const workspaceRef = useRef<DockWorkspaceHandle>(null);
  const [visible, setVisible] = useState<ReadonlySet<PanelId>>(() => new Set());
  const [shownPanels, setShownPanels] = useState<ReadonlySet<PanelId>>(() => new Set());
  const handleVisibleChange = useCallback((next: ReadonlySet<PanelId>) => {
    setVisible(next);
    setShownPanels(prev => ([...next].every(p => prev.has(p)) ? prev : new Set([...prev, ...next])));
  }, []);
  const activatePanel = useCallback((panel: PanelId) => workspaceRef.current?.activate(panel), []);
  const [selectedError, setSelectedError] = useState<number | null>(null);
  // Mismatch sheet; opened only by the user, never by a run.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleDrawer = useCallback(() => setDrawerOpen(open => !open), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const settleDelay = settleDelayFor(cddl);
  const cddlDebounced = useDebouncedString(cddl, settleDelay);
  const hexDebounced = useDebouncedString(cborInput, 200);
  // Debounce typed rule names; picker selections are already complete.
  const ruleTyped = useDebouncedString(selectedRule, 200);

  // ---------- derived: schema, CBOR, validation, decoded JSON, bridge map ----------
  // Passes read debounced text; schema offsets are into live `cddl`.
  const schema = useCddlSchema(cddlDebounced, cddl);
  const ruleNames = schema.ruleNames;
  const schemaIsValid = !!schema.result && schema.result.valid;

  // Resolve the root in render, not via an effect that would validate the
  // previous (now-invalid) rule for one pass.
  const effectiveRule = useMemo(
    () => resolveRootRule(ruleNames, selectedRule, ruleTyped),
    [ruleNames, selectedRule, ruleTyped],
  );

  const {
    cleanHex, decoded, decodeError, errorLocation, decoderFailure, notification,
    pending: cborDecodePending, slow: cborDecodeSlow,
  } = useCborDecoded(hexDebounced);

  const validation = useCborValidation(cleanHex, cddlDebounced, effectiveRule, schemaIsValid, cddl);
  const cborOutcome = validation.outcome;
  const diagnostics = validation.diagnostics;
  // Badge counts everything the run found; the panel shows the capped subset.
  const reportedDiagnostics = validation.totalDiagnostics;
  const unlistedErrors = validation.hiddenDiagnostics + validation.undescribedDiagnostics;

  // Root-refusal sweep: only after a settled, non-slow pass, against the
  // outline of the text that pass validated.
  const head = diagnostics[0];
  const refusedAtRoot =
    schemaIsValid &&
    schema.outlineSource === cddlDebounced &&
    !validation.pending &&
    !validation.wasSlow &&
    !decodeError &&
    !decoderFailure &&
    decoded !== null &&
    cborOutcome?.ok === true &&
    !cborOutcome.result.valid &&
    head !== undefined &&
    isRootMismatch(head);
  const rootKind = useMemo(() => cborRootKind(decoded), [decoded]);
  const rootCandidates = useMemo(
    () =>
      refusedAtRoot
        ? candidateRootRules(schema.outline, schema.outlineSource, effectiveRule, rootKind)
        : NO_ROOT_CANDIDATES,
    [refusedAtRoot, schema.outline, schema.outlineSource, effectiveRule, rootKind],
  );
  const rootSuggestions = useRootSuggestions(cleanHex, cddlDebounced, rootCandidates, refusedAtRoot);

  // ---------- picking the root rule ----------
  // Keep a chosen rule (picker, chooser, link, preset) for that document.
  // Otherwise take the unique matching root, or ask if several match.
  const ruleChosenFor = useRef<{ cddl: string; cbor: string } | null>(null);
  const markRuleChosen = useCallback((forCddl?: string, forCbor?: string) => {
    ruleChosenFor.current = { cddl: forCddl ?? cddl, cbor: forCbor ?? cborInput };
  }, [cddl, cborInput]);
  const ruleSettled =
    ruleChosenFor.current !== null &&
    ruleChosenFor.current.cddl === cddl &&
    ruleChosenFor.current.cbor === cborInput;
  // A share-link / boot rule is settled from the first render.
  const linkRuleMarked = useRef(false);
  useEffect(() => {
    if (hydrating || linkRuleMarked.current) return;
    linkRuleMarked.current = true;
    if (ruleGiven) markRuleChosen();
  }, [hydrating, ruleGiven, markRuleChosen]);
  const [ruleChoice, setRuleChoice] = useState<string[] | null>(null);
  const [detectNotice, setDetectNotice] = useState<string | null>(null);
  const detecting = !hydrating && refusedAtRoot && !rootSuggestions.pending && !ruleSettled;
  const detectedMatches = rootSuggestions.matches;
  useEffect(() => {
    if (!detecting || detectedMatches.length === 0) return;
    // Defer setState so the chooser does not open during the sweep's render.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (detectedMatches.length === 1) {
        markRuleChosen();
        setSelectedRule(detectedMatches[0]);
        setDetectNotice(`Root rule set to ${detectedMatches[0]} — the one rule this CBOR matches.`);
      } else {
        setRuleChoice(detectedMatches);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detecting, detectedMatches, markRuleChosen, setSelectedRule]);
  const chooseDetectedRule = useCallback((rule: string) => {
    markRuleChosen();
    setSelectedRule(rule);
    setRuleChoice(null);
  }, [markRuleChosen, setSelectedRule]);
  const dismissRuleChoice = useCallback(() => {
    // Dismissing still settles the document; the toolbar offer remains.
    markRuleChosen();
    setRuleChoice(null);
  }, [markRuleChosen]);

  // Decode-against-schema is as expensive as validate; skip until the panel
  // has been shown (it then stays mounted).
  const schemaJson = useDecodeAgainstSchema(
    cleanHex, cddlDebounced, effectiveRule, schemaIsValid, shownPanels.has("decoded"),
  );

  // Map offsets are into live `cddl`; entries from a previous document must
  // not be used while a pass is still catching up.
  const { bridge: cborCddlMap, pending: mapPending, refusal: mapRefusal } = useCborCddlMap(
    cleanHex, cddlDebounced, effectiveRule, schemaIsValid, cddl,
  );

  // "checking…" while inputs are settling or a worker pass is in flight.
  const schemaSettling = cddl !== cddlDebounced || schema.pending;
  const resultsPending =
    schemaSettling ||
    cborInput !== hexDebounced ||
    cborDecodePending ||
    validation.pending ||
    // Debounce the typed rule only when the schema has no picker roots.
    (ruleNames.length === 0 && selectedRule.trim() !== ruleTyped.trim());
  const passIsSlow = schema.slow || cborDecodeSlow || validation.slow;

  // ---------- hover link ----------
  // Not React state: the panel under the pointer writes, others subscribe
  // to their projection. See hoverLink.ts.
  const [hoverStore] = useState(createHoverLinkStore);

  // ---------- hex panel ⇄ tree bridge state ----------
  const [focusPosition, setFocusPosition] = useState<CborPosition | null>(null);
  const [highlightedTreePosition, setHighlightedTreePosition] = useState<CborPosition | null>(null);

  // Transient hex flash; persistent highlights go through `linkedSpans`.
  const revealInHex = useCallback((p: CborPosition) => {
    setFocusPosition(p);
    setTimeout(() => setFocusPosition(null), 1500);
  }, []);
  // Hex "show in tree" must bring the tree tab forward (its strip is elsewhere).
  const handleShowInTree = useCallback((p: CborPosition) => {
    setHighlightedTreePosition(p);
    activatePanel("tree");
  }, [activatePanel]);
  const handleClearTreeHighlight = useCallback(() => setHighlightedTreePosition(null), []);

  // ---------- editor: caret, references, CDDL→CBOR bridge ----------
  const editorRef = useRef<CddlEditorHandle>(null);
  const [caretOffset, setCaretOffset] = useState<number | null>(null);
  // Debounce caret with the schema text; `caretForReferences` drops a probe
  // whose text no longer matches the editor.
  const caretProbe = useMemo<CaretProbe>(() => ({ text: cddl, caret: caretOffset }), [cddl, caretOffset]);
  const settledCaret = useDebouncedValue(caretProbe, settleDelay);
  const referenceRanges = useReferenceRanges(cddl, caretForReferences(settledCaret, cddl));

  // Alt-click CDDL → matching CBOR spans, until inputs change.
  const [linkedHexSpans, setLinkedHexSpans] = useState<ExtraErrorSpan[]>([]);
  const clearLinkedHexSpans = useCallback(() => setLinkedHexSpans([]), []);

  // Right-click pin: current instance + dim others; cleared when inputs change.
  const [pinned, setPinned] = useState<PinState | null>(null);
  // Schema text the pin's char offsets address; dropped on a keystroke, while
  // byte/path/rule pins on other panels stay.
  const [pinnedSource, setPinnedSource] = useState<string | null>(null);
  // Last "scroll this instance into view" request, and which panels it is for.
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const clearPinnedNode = useCallback(() => {
    setPinned(null);
    setPinnedSource(null);
    setReveal(null);
  }, []);

  // Per-panel pin targets persist across pins (user preference).
  const [pinTargets, setPinTargets] = useState<Set<PinTarget>>(
    () => new Set<PinTarget>(ALL_PIN_TARGETS),
  );
  const togglePinTarget = useCallback((t: PinTarget) => {
    setPinTargets((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  // One context menu for pin + any panel-owned actions.
  interface PinMenuState {
    x: number;
    y: number;
    candidate: CborCddlNode | null;
    source: PinTarget;
    actions: PanelMenuAction[];
  }
  const [pinMenu, setPinMenu] = useState<PinMenuState | null>(null);
  const closePinMenu = useCallback(() => setPinMenu(null), []);
  // Last right-click position for menus opened from offset/path callbacks.
  const lastRmbPos = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      lastRmbPos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("contextmenu", handler, true);
    return () => window.removeEventListener("contextmenu", handler, true);
  }, []);

  // Drop derived selection when CBOR/schema/rule change. Keep `pinTargets`.
  // Hover is cleared in the bridge swap below, same commit.
  useEffect(() => {
    setPinned(null);
    setPinnedSource(null);
    setReveal(null);
    setLinkedHexSpans([]);
    setHighlightedTreePosition(null);
    setFocusPosition(null);
    setPinMenu(null);
    setSelectedError(null);
  }, [cleanHex, cddlDebounced, effectiveRule]);

  // Bind hover to the on-screen bridge (and document) so a previous
  // document's probe is never resolved against this one.
  useLayoutEffect(() => {
    hoverStore.setContext(cborCddlMap, cddl, cleanHex);
  }, [hoverStore, cborCddlMap, cddl, cleanHex]);

  // Same `resolveProbe` as hover; open the menu instead of pinning immediately.
  const openPinMenu = useCallback(
    (source: PinTarget, candidate: CborCddlNode | null, actions: PanelMenuAction[] = []) => {
      setPinMenu({ x: lastRmbPos.current.x, y: lastRmbPos.current.y, candidate, source, actions });
    },
    [],
  );
  const requestPinFromCborOffset = useCallback((byteOffset: number, actions: PanelMenuAction[]) => {
    openPinMenu("hex", resolveProbe(cborCddlMap, { source: "hex", byteOffset }), actions);
  }, [openPinMenu, cborCddlMap]);
  const requestPinFromCddlOffset = useCallback((charOffset: number) => {
    openPinMenu("cddl", resolveProbe(cborCddlMap, { source: "cddl", charOffset }));
  }, [openPinMenu, cborCddlMap]);
  const canPinAtCddlOffset = useCallback(
    (charOffset: number) => resolveProbe(cborCddlMap, { source: "cddl", charOffset }) !== null,
    [cborCddlMap],
  );
  const requestPinFromDecodedPath = useCallback((path: string, role: "key" | "value") => {
    openPinMenu("decoded", resolveProbe(cborCddlMap, { source: "decoded", path, role }));
  }, [openPinMenu, cborCddlMap]);
  const requestPinFromTreePosition = useCallback((position: CborPosition | null, actions: PanelMenuAction[]) => {
    openPinMenu("tree", position ? resolveProbe(cborCddlMap, { source: "tree", position }) : null, actions);
  }, [openPinMenu, cborCddlMap]);

  const pinMenuEmptyNotice = useMemo(
    () => pinMenuNotice({
      schemaIsValid,
      hasCbor: cleanHex !== "",
      mapPending,
      mapRefusal,
      mapIsEmpty: cborCddlMap.entries.length === 0,
      rule: effectiveRule,
    }),
    [schemaIsValid, cleanHex, mapPending, mapRefusal, cborCddlMap.entries.length, effectiveRule],
  );

  const handleLinkClick = useCallback((jsOffset: number) => {
    if (cborCddlMap.entries.length === 0) return;
    setLinkedHexSpans(linkedHexSpansForCddlOffset(cborCddlMap, jsOffset));
  }, [cborCddlMap]);

  // Live schema text, for the one async callback that can outlive a keystroke.
  const liveCddlRef = useRef(cddl);
  useEffect(() => { liveCddlRef.current = cddl; }, [cddl]);

  const handleSymbolClick = useCallback((jsOffset: number) => {
    if (!cddl) return;
    void (async () => {
      const sym = await safeSymbolAt(cddl, utf16ToByte(cddl, jsOffset));
      if (!sym?.definition_span) return;
      // Drop the jump if the schema changed while the worker round-trip ran.
      if (liveCddlRef.current !== cddl) return;
      const d = sym.definition_span;
      editorRef.current?.reveal([d.char_offset, d.char_offset + d.char_length]);
    })();
  }, [cddl]);

  // ---------- error nav (every mismatch of the run) ----------
  // Schema parse errors have their own toolbar line.
  const cddlErrors = useMemo<CddlErrorEntry[]>(
    () => diagnostics.map((d, i) => ({ range: d.cddlRange, message: describeDiagnostic(d), errorIndex: i })),
    [diagnostics],
  );

  // Selecting a mismatch lights editor/hex/list/trees. `source` decides
  // whether the editor takes focus (list/nav) or only scrolls (tree badge).
  type DiagnosticSource = "list" | "tree" | "decoded";
  const selectDiagnostic = useCallback((index: number, source: DiagnosticSource = "list") => {
    setSelectedError(index);
    const d = diagnostics[index];
    if (!d) return;
    if (d.cddlRange) {
      if (source === "list") editorRef.current?.reveal(d.cddlRange);
      else editorRef.current?.scrollTo(d.cddlRange);
    }
    const span = d.byteSpans[0] ?? d.anchorSpans[0];
    if (span) revealInHex(span);
    const target = source === "tree" ? "decoded" : source === "decoded" ? "tree" : "all";
    setReveal(prev => nextReveal(prev, target, "diagnostic"));
  }, [diagnostics, revealInHex]);
  // Tree badge on the selected row toggles it off.
  const selectFromTree = useCallback(
    (index: number | null) => (index === null ? setSelectedError(null) : selectDiagnostic(index, "tree")),
    [selectDiagnostic],
  );
  const selectFromDecoded = useCallback(
    (index: number | null) => (index === null ? setSelectedError(null) : selectDiagnostic(index, "decoded")),
    [selectDiagnostic],
  );
  const selectFromList = useCallback((index: number) => selectDiagnostic(index, "list"), [selectDiagnostic]);

  const handleJump = useCallback((entry: CddlErrorEntry) => {
    selectDiagnostic(entry.errorIndex, "list");
  }, [selectDiagnostic]);

  const revealSchemaError = useCallback(() => {
    if (schema.errorRange) editorRef.current?.reveal(schema.errorRange);
  }, [schema.errorRange]);

  const revealSchemaRange = useCallback((range: [number, number]) => {
    editorRef.current?.reveal(range);
  }, []);

  // Clamp a stale index for one render after the list shrinks.
  const selectedErrorIndex =
    selectedError !== null && selectedError < diagnostics.length ? selectedError : null;

  // ---------- the verdict, and what the trees and the hex say of it ----------
  // From the settled pass; chip hides while checking, sheet stays on the
  // previous run until the new verdict has nothing to list.
  const verdict = useMemo(
    () => verdictFor({
      outcome: cborOutcome,
      diagnostics,
      reportedDiagnostics,
      rule: effectiveRule,
      decodeError,
      decoderFailure,
    }),
    [cborOutcome, diagnostics, reportedDiagnostics, effectiveRule, decodeError, decoderFailure],
  );
  const listable = isListable(verdict);
  // Close during render to avoid one frame of an empty sheet.
  if (drawerOpen && !listable) setDrawerOpen(false);
  const drawerShown = drawerOpen && listable;
  const hexRefusal = useMemo(
    () => hexRefusalFor({ decodeError, decoderFailure, outcome: cborOutcome, diagnostics }),
    [decodeError, decoderFailure, cborOutcome, diagnostics],
  );
  // Diagnostic row keys for both trees; computed once per run (identity compare).
  const rootHeader = decoded?.position_info ?? null;
  const treeDiagnosticRows = useMemo(
    () => diagnosticTreeRows(diagnostics, rootHeader),
    [diagnostics, rootHeader],
  );
  const decodedDiagnosticRows = useMemo(
    () => diagnosticDecodedRows(diagnostics, cborCddlMap, rootHeader),
    [diagnostics, cborCddlMap, rootHeader],
  );

  // ---------- editor marks (priority-ranked) ----------
  const pinnedNode = pinned?.node ?? null;
  const editorMarks = useMemo(
    () => buildEditorMarks({
      schemaError: schema.errorRanges.length > 0 && schema.result && !schema.result.valid
        ? { ranges: schema.errorRanges, message: cddlErrorReason(schema.result.error.message) }
        : null,
      diagnostics,
      selectedDiagnostic: selectedErrorIndex,
      referenceRanges,
      pinnedNode,
      pinnedInstance: pinned,
      pinInCddl: pinTargets.has("cddl") && pinnedSource === cddl,
      pinnedSite: pinned && pinned.source !== "cddl" ? pinned.bridge.referenceSiteOf(pinned.node.entry) : null,
    }),
    [schema, diagnostics, selectedErrorIndex, referenceRanges,
     pinned, pinnedNode, pinnedSource, cddl, pinTargets],
  );

  // Pin projection matches hover of the same row.
  const pinnedProjection = useMemo(
    () => (pinnedNode ? projectNode(pinnedNode) : null),
    [pinnedNode],
  );
  const pinnedBlockers = useMemo(() => pinTargetBlockers(pinnedNode), [pinnedNode]);
  const pinIndex = pinned ? currentIndex(pinned) : -1;
  const pinTotal = pinned ? pinned.instances.length : 0;

  // Separate hex prop so the pin paints purple, not Alt-click blue.
  const hexPinnedSpans = useMemo<ExtraErrorSpan[]>(
    () => pinnedHexSpans(pinned, pinTargets.has("hex")),
    [pinned, pinTargets],
  );
  const hexPinnedOtherSpans = useMemo<ExtraErrorSpan[]>(
    () => pinnedOtherHexSpans(pinned, pinTargets.has("hex")),
    [pinned, pinTargets],
  );

  // Structural tree keys by header bytes; schema-only rows have none.
  const treePinned = useMemo<CborPosition | null>(
    () => (pinnedProjection && pinTargets.has("tree") ? pinnedProjection.tree : null),
    [pinnedProjection, pinTargets],
  );
  const treePinnedOthers = useMemo(
    () => pinnedOtherTreeKeys(pinned, pinTargets.has("tree")),
    [pinned, pinTargets],
  );
  // Keep visited instance rows expanded so stepping does not collapse them.
  const treeVisited = useMemo(
    () => visitedTreePositions(pinned, pinTargets.has("tree")),
    [pinned, pinTargets],
  );

  const decodedPinnedPath = useMemo(
    () => (pinnedProjection && pinTargets.has("decoded") ? pinnedProjection.decoded : null),
    [pinnedProjection, pinTargets],
  );
  const decodedPinnedOthers = useMemo(
    () => pinnedOtherDecodedPaths(pinned, pinned?.bridge ?? null, pinTargets.has("decoded")),
    [pinned, pinTargets],
  );
  const decodedVisited = useMemo(
    () => visitedDecodedPaths(pinned, pinTargets.has("decoded")),
    [pinned, pinTargets],
  );

  // Reveal the current instance in the named panels. Skip a panel the row
  // cannot reach. Trees scroll when visible; editor scroll does not steal
  // focus unless asked (chip steps must keep the chip focused).
  const revealCurrent = useCallback((
    pin: PinState,
    target: PinTarget | "all",
    editor: "select" | "scroll",
  ) => {
    const blocked = pinTargetBlockers(pin.node);
    const wants = (t: PinTarget) =>
      (target === "all" || target === t) && pinTargets.has(t) && !blocked[t];
    const projection = projectNode(pin.node);
    if (wants("cddl") && projection.cddl) {
      if (editor === "select") editorRef.current?.reveal(projection.cddl);
      else editorRef.current?.scrollTo(projection.cddl);
    }
    if (wants("hex") && projection.hex) revealInHex(projection.hex);
    setReveal(prev => nextReveal(prev, target));
  }, [pinTargets, revealInHex]);

  // Pin and reveal. If both trees are hidden, bring forward one that can show it.
  const handlePin = useCallback((node: CborCddlNode, source: PinTarget) => {
    const pin = makePin(cborCddlMap, node, source);
    setPinned(pin);
    setPinnedSource(cddl);
    if (!visible.has("decoded") && !visible.has("tree")) {
      const blocked = pinTargetBlockers(node);
      const target = (["decoded", "tree"] as const).find(p => pinTargets.has(p) && !blocked[p]);
      if (target) activatePanel(target);
    }
    revealCurrent(pin, "all", "select");
  }, [cborCddlMap, cddl, revealCurrent, visible, pinTargets, activatePanel]);

  // Step and reveal in the same tick (compute next pin here, not in a setter).
  const stepPin = useCallback((delta: number) => {
    if (!pinned) return;
    const next = stepPinState(pinned, delta);
    setPinned(next);
    revealCurrent(next, "all", "scroll");
  }, [pinned, revealCurrent]);
  // Chip count reveals in that chip's panel only.
  const revealPin = useCallback((target: PinTarget | "all") => {
    if (pinned) revealCurrent(pinned, target, "scroll");
  }, [pinned, revealCurrent]);
  // Trees scroll on pin XOR diagnostic reveal — never both (would steal the row).
  const pinRevealSeq = reveal?.subject === "pin" ? reveal.seq : undefined;
  const diagnosticRevealSeq = reveal?.subject === "diagnostic" ? reveal.seq : undefined;
  const scrollTreeToPin = scrollFlagFor("tree", reveal, visible.has("tree"), "pin");
  const scrollTreeToDiagnostic = scrollFlagFor("tree", reveal, visible.has("tree"), "diagnostic");
  const scrollDecodedToPin = scrollFlagFor("decoded", reveal, visible.has("decoded"), "pin");
  const scrollDecodedToDiagnostic = scrollFlagFor("decoded", reveal, visible.has("decoded"), "diagnostic");

  // ---------- the mismatch sheet's focus ----------
  const verdictChipRef = useRef<HTMLButtonElement>(null);
  // Return focus to the chip when the sheet's own close unmounts the focused node.
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (drawerWasOpen.current && !drawerShown && document.activeElement === document.body) {
      verdictChipRef.current?.focus();
    }
    drawerWasOpen.current = drawerShown;
  }, [drawerShown]);

  // Alt+, / Alt+. step the pin; preventDefault so the chord does not type a glyph.
  const hasPin = pinned !== null;
  useEffect(() => {
    if (!hasPin) return;
    const onKey = (e: KeyboardEvent) => {
      const delta = pinStepKey(e);
      if (delta === null) return;
      e.preventDefault();
      stepPin(delta);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPin, stepPin]);

  // ---------- hex extra-error spans (from every mismatch's byte_spans / anchors) ----------
  const extraErrorSpans = useMemo(
    () => buildExtraErrorSpans(diagnostics, selectedErrorIndex),
    [diagnostics, selectedErrorIndex],
  );

  // ---------- toolbar handlers ----------
  const handleRulePick = useCallback((value: string) => {
    markRuleChosen();
    setSelectedRule(value);
  }, [markRuleChosen, setSelectedRule]);
  const handleCborChange = useCallback((next: string) => {
    setCborInput(next);
    setPresetNotice(null);
  }, [setCborInput]);
  // Typing retires the whole-schema undo buffer.
  const handleCddlChange = useCallback((next: string) => {
    setCddl(next);
    setReplaced(null);
    setFormatError(null);
    setPresetNotice(null);
    dismissHydrationError();
  }, [setCddl, dismissHydrationError]);
  // Whole-schema swap with undo. Reset viewport unless formatting in place.
  const replaceCddl = useCallback((
    next: string,
    label: string,
    opts: {
      keepViewport?: boolean;
      authored?: boolean;
      /** Era the text came from, or `null`. Omit to leave provenance unchanged. */
      preset?: { id: string; label: string } | null;
    } = {},
  ) => {
    setReplaced(
      cddl.trim() === "" || cddl === next
        ? null
        : {
            text: cddl,
            rule: selectedRule,
            label,
            appAuthored: appAuthoredCddl,
            preset: presetSource,
          },
    );
    setCddl(next);
    // Format rewrites the user's schema; do not mark it as app-authored.
    setAppAuthoredCddl(opts.authored ? next : null);
    if (opts.preset !== undefined) setPresetSource(opts.preset);
    setFormatError(null);
    setPresetNotice(null);
    dismissHydrationError();
    if (!opts.keepViewport) editorRef.current?.scrollToTop();
  }, [
    cddl, selectedRule, appAuthoredCddl, presetSource,
    setCddl, setAppAuthoredCddl, setPresetSource, dismissHydrationError,
  ]);
  const handleUndoReplace = useCallback(() => {
    if (!replaced) return;
    setCddl(replaced.text);
    setSelectedRule(replaced.rule);
    markRuleChosen(replaced.text, cborInput);
    setAppAuthoredCddl(replaced.appAuthored);
    setPresetSource(replaced.preset);
    setReplaced(null);
    setFormatError(null);
    setPresetNotice(null);
  }, [replaced, cborInput, markRuleChosen, setCddl, setSelectedRule, setAppAuthoredCddl, setPresetSource]);
  /** Confirm before discarding a schema the user wrote. */
  const confirmReplace = useCallback((replacement: string) => {
    const question = confirmReplaceMessage(cddl, appAuthoredCddl, replacement);
    if (question === null) return true;
    return typeof window === "undefined" || window.confirm(question);
  }, [cddl, appAuthoredCddl]);
  const handleClearSchema = useCallback(() => {
    if (!confirmReplace("an empty editor")) return;
    replaceCddl("", "clear", { authored: true, preset: null });
  }, [confirmReplace, replaceCddl]);
  const handleFormatCddl = useCallback(async () => {
    const outcome = await formatCddlChecked(cddl);
    if (!outcome.ok) {
      setFormatError(outcome.reason);
      return;
    }
    if (outcome.text === cddl) {
      setFormatError(null);
      return;
    }
    replaceCddl(outcome.text, "format", { keepViewport: true });
  }, [cddl, replaceCddl]);
  const handleLoadPreset = useCallback(async (id: string) => {
    if (!id) return;
    const preset = CARDANO_PRESETS.find(p => p.id === id);
    if (!confirmReplace(`the ${preset?.label ?? id} schema`)) return;
    setPresetError(null);
    dismissHydrationError();
    setPresetLoading(id);
    try {
      const text = await loadCardanoPreset(id);
      replaceCddl(text, "preset", {
        authored: true,
        preset: preset ? { id: preset.id, label: preset.label } : null,
      });
      if (preset) setSelectedRule(preset.rootRule);
      setPresetNotice({
        label: preset?.label ?? id,
        requestedRule: preset?.rootRule ?? null,
      });
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : String(e));
    } finally {
      setPresetLoading(null);
    }
  }, [confirmReplace, replaceCddl, dismissHydrationError, setSelectedRule]);
  // An edit does not drop the preset; it marks it edited.
  const activePreset = useMemo<ActivePreset | null>(
    () => presetSource && { ...presetSource, edited: cddl !== appAuthoredCddl },
    [presetSource, cddl, appAuthoredCddl],
  );

  // ---------- share link ----------
  // Share uses live (not debounced) hex; non-hex cannot go in the link.
  const share = useMemo(() => shareCborState(cborInput), [cborInput]);
  const shareCbor = share.hex;
  // Unedited preset is a name, not 8 KB of schema, in the share link.
  const sharePreset = activePreset && !activePreset.edited ? activePreset.id : null;

  const navFor = (panel: PanelId) => pinned ? (
    <InstanceNav
      index={pinIndex}
      total={pinTotal}
      panel={panel}
      byteless={panel === "cddl" ? undefined : pinnedBlockers[panel] !== null}
      onStep={stepPin}
      onReveal={() => revealPin(panel)}
    />
  ) : null;

  const cddlExtras = (
    <>
      <HelpTooltip>
        <strong>How to use:</strong> Write (or paste) a CDDL schema. Pick the root rule to validate against. The CBOR hex panel is checked automatically.
      </HelpTooltip>
      {schemaSettling && <PendingSpinner label="Checking the schema" />}
      {passIsSlow && (
        <span
          className="panel-badge info"
          title="This schema and document are expensive to check, or an earlier pass is still holding the library. A pass is abandoned once it has spent ten seconds waiting its turn, or ten seconds running, and the panels will say which."
        >
          still working
        </span>
      )}
      {!schemaSettling && schema.result && schema.result.valid && (
        <span className="panel-badge success">valid</span>
      )}
      {!schemaSettling && schema.result && !schema.result.valid && (
        <span className="panel-badge error" title={cddlErrorReason(schema.result.error.message)}>
          {schema.result.error.kind}
        </span>
      )}
      {!schemaSettling && schema.checkerFailure && (
        <span className="panel-badge error" title={schema.checkerFailure}>
          checker failed
        </span>
      )}
      <span className="cq-flex-grow" />
      <ShareButton
        disabled={hydrating || (!cddl.trim() && !shareCbor)}
        title={
          hydrating
            ? "Still restoring the shared state"
            : !cddl.trim() && !shareCbor
              ? (share.dropped ?? "Nothing to share yet")
              : "Share a link to this schema, rule and CBOR"
        }
        getTarget={() => ({
          kind: "cddl",
          input: { cddl, cbor: shareCbor, rule: effectiveRule, preset: sharePreset },
          warning: share.dropped,
        })}
      />
      <button onClick={handleClearSchema} className="btn-icon" title="Clear" aria-label="Clear the schema">✕</button>
    </>
  );

  const cddlBody = (
    <>
      <CddlSchemaToolbar
        ruleNames={ruleNames}
        effectiveRule={effectiveRule}
        selectedRule={selectedRule}
        ruleNamesAreStale={schema.outlineIsStale}
        schemaIsValid={schemaIsValid}
        onRulePick={handleRulePick}
        presetLoading={presetLoading}
        activePreset={activePreset}
        onLoadPreset={handleLoadPreset}
        onFormat={handleFormatCddl}
        formatDisabled={!schema.result || !schema.result.valid}
        undoLabel={replaced?.label}
        onUndoReplace={handleUndoReplace}
        rightSlot={refusedAtRoot
          ? <RootSuggestionNote suggestions={rootSuggestions} onRulePick={handleRulePick} compact />
          : null}
      />

      <HintBanner storageKey="cquisitor_hint_cddl_validator">
        <strong>How to use:</strong> Edit the CDDL schema and the CBOR hex; mismatches show in red.
        <strong> Hover any panel</strong> (CDDL schema, CBOR hex, CBOR tree, Decoded JSON)
        to see the same node lit in the other three. <strong>Right-click any panel</strong>
        → a context menu lets you pin the node and choose which panels mirror the highlight;
        pinning works as soon as the schema parses, whether or not the CBOR matches it.
        Cmd-click a rule reference → jump to definition. Alt-click in CDDL → pin matching CBOR bytes.
        A construct pinned from the schema marks every run it matched; the <strong>‹ k/N ›</strong>
        chip in each panel&apos;s strip (or Alt+, and Alt+.) steps through them. A run pinned from
        the hex or a tree is pinned alone.
        The <strong>✗ chip</strong> beside the CBOR hex tab counts the mismatches and opens the list;
        each one is also flagged on its row in both trees.
        <strong> Drag a tab</strong> onto another group, or use a group&apos;s <strong>⋮ menu</strong>,
        to rearrange the panels.
        In the schema editor <strong>Tab indents</strong> — press Escape, then Tab, to move focus on.
      </HintBanner>

      {/* Schema-error UI sits above the editor (editor fills remaining height). */}
      {hydrating && (
        <div className="cq-link-banner">
          <span className="cq-link-banner-text">
            {hydratingPreset
              ? `Opening a shared link — loading the ${hydratingPreset} schema…`
              : "Opening a shared link…"}
          </span>
        </div>
      )}

      {hydrationError && (
        <div className="cddl-error-card">
          <div className="cddl-error-card-head">
            <span className="cddl-error-card-kind">shared link</span>
            <button
              type="button"
              className="cddl-error-card-close"
              onClick={dismissHydrationError}
              title="Dismiss"
              aria-label="Dismiss"
            >✕</button>
          </div>
          <div className="cddl-error-card-message">{hydrationError}</div>
        </div>
      )}

      {detectNotice && (
        <div className="cq-link-banner" role="status">
          <span className="cq-link-banner-text">{detectNotice}</span>
          <button
            type="button"
            className="cq-link-banner-close"
            onClick={() => setDetectNotice(null)}
            title="Dismiss"
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}
      {presetNotice && (
        <div className="cq-link-banner">
          <span className="cq-link-banner-text">
            {describePresetLoad(presetNotice, effectiveRule, schemaSettling)}
          </span>
          <button
            type="button"
            className="cq-link-banner-close"
            onClick={() => setPresetNotice(null)}
            title="Dismiss"
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      {formatError && (
        <div className="cddl-error-card">
          <div className="cddl-error-card-kind">format not applied</div>
          <div className="cddl-error-card-message">
            The schema was left as it is because {formatError}.
          </div>
        </div>
      )}

      {pinnedNode && (
        <div className="cq-link-banner">
          <span className="cq-link-banner-text">
            Pinned: <code title={pinnedNode.cborPath}>{abbreviatePath(pinnedNode.cborPath)}</code>
            {pinnedNode.entry.rule_name ? ` · rule ${pinnedNode.entry.rule_name}` : ""}
            {pinTotal > 1 ? ` · instance ${pinIndex + 1} of ${pinTotal}` : ""}
          </span>
          <button
            type="button"
            className="cq-link-banner-close"
            onClick={clearPinnedNode}
            title="Clear pinned selection"
            aria-label="Clear pinned selection"
          >✕</button>
        </div>
      )}

      <SchemaErrorLine
        result={schema.result}
        checkerFailure={schema.checkerFailure}
        errorLine={schema.errorLine}
        unresolvedNames={schema.unresolvedNames}
        rangesAreStale={schema.rangesAreStale}
        onRevealError={revealSchemaError}
        onRevealRange={revealSchemaRange}
      />

      <EditorPane
        store={hoverStore}
        ref={editorRef}
        value={cddl}
        onChange={handleCddlChange}
        marks={editorMarks}
        onSymbolClick={handleSymbolClick}
        onLinkClick={handleLinkClick}
        onPinAtOffset={requestPinFromCddlOffset}
        canPinAt={canPinAtCddlOffset}
        onCaretMove={setCaretOffset}
        ruleNames={schema.declaredNames}
      />

      {presetError && (
        <div className="cddl-error-card">
          <div className="cddl-error-card-kind">preset fetch failed</div>
          <div className="cddl-error-card-message">{presetError}</div>
        </div>
      )}
    </>
  );

  // Verdict lives on the hex strip; hide it while a pass is owed or decode failed.
  const hexExtras = (
    <>
      {notification && <span className="panel-badge info">{notification}</span>}
      {!resultsPending && decodeError && (
        <span className="panel-badge error" title={decodeError.message}>
          {decodeError.kind}
        </span>
      )}
      {!resultsPending && decoderFailure && (
        <span className="panel-badge error" title={decoderFailure}>
          decoder failed
        </span>
      )}
      <span className="cq-flex-grow" />
      {resultsPending && (
        <span className="cddl-pending-tab-note" role="status" aria-label="Checking this CBOR against the schema">
          <span className="cddl-pending-spinner animate-spin" />
          checking…
        </span>
      )}
      {!resultsPending && verdict.kind !== "none" && (
        <div className="cq-strip-verdict">
          <VerdictChip
            verdict={verdict}
            open={drawerShown}
            onToggle={toggleDrawer}
            buttonRef={verdictChipRef}
          />
          {cddlErrors.length > 0 && (
            <CddlErrorNav
              errors={cddlErrors}
              unlisted={unlistedErrors}
              current={selectedErrorIndex}
              onJump={handleJump}
            />
          )}
        </div>
      )}
    </>
  );

  const hexBody = (
    <>
      {!resultsPending && hexRefusal && <RefusalBanner refusal={hexRefusal} />}
      {linkedHexSpans.length > 0 && (
        <div className="cq-link-banner">
          <span className="cq-link-banner-text">
            {linkedHexSpans.length} byte span{linkedHexSpans.length > 1 ? "s" : ""} highlighted from CDDL
          </span>
          <button
            type="button"
            className="cq-link-banner-close"
            onClick={clearLinkedHexSpans}
            title="Clear highlight"
            aria-label="Clear highlight"
          >✕</button>
        </div>
      )}
      <HexPane
        store={hoverStore}
        value={cborInput}
        onChange={handleCborChange}
        hexValue={cleanHex}
        cborData={decoded}
        focusPosition={focusPosition}
        errorLocation={errorLocation}
        extraErrorSpans={extraErrorSpans}
        linkedSpans={linkedHexSpans}
        pinnedSpans={hexPinnedSpans}
        pinnedOtherSpans={hexPinnedOtherSpans}
        onShowInTree={handleShowInTree}
        onContextMenuPin={requestPinFromCborOffset}
      />
    </>
  );

  const decodedBody = (
    <>
      {!schemaJson && (
        <div className="cq-decoded-empty">
          Provide CBOR hex, a valid CDDL schema and a rule to see decoded JSON.
        </div>
      )}
      {schemaJson && !schemaJson.ok && (
        <WalkRefusalCard refusal={schemaJson.error} walker="decoder" />
      )}
      {schemaJson && schemaJson.ok && (
        // Scroll-into-view only when the decoded panel is actually on screen.
        <DecodedPane
          store={hoverStore}
          data={schemaJson.value}
          expanded={3}
          pinnedPath={decodedPinnedPath}
          pinnedOtherPaths={decodedPinnedOthers}
          pinnedRole={pinned?.node.entry.entry_role ?? null}
          openPaths={decodedVisited}
          revealSeq={pinRevealSeq}
          onPinPath={requestPinFromDecodedPath}
          scrollOnHighlight={scrollDecodedToPin}
          rowDiagnostics={decodedDiagnosticRows}
          selectedDiagnostic={selectedErrorIndex}
          onSelectDiagnostic={selectFromDecoded}
          onRevealBytes={revealInHex}
          diagnosticRevealSeq={diagnosticRevealSeq}
          scrollOnDiagnostic={scrollDecodedToDiagnostic}
        />
      )}
    </>
  );

  const treeBody = decoded ? (
    <TreePane
      store={hoverStore}
      data={decoded}
      hexValue={cleanHex}
      onHighlightAndScroll={revealInHex}
      highlightedTreePosition={highlightedTreePosition}
      onClearHighlight={handleClearTreeHighlight}
      pinnedPosition={treePinned}
      pinnedOtherSpans={treePinnedOthers}
      openPositions={treeVisited}
      revealSeq={pinRevealSeq}
      scrollOnHighlight={scrollTreeToPin}
      onPinPosition={requestPinFromTreePosition}
      rowDiagnostics={treeDiagnosticRows}
      selectedDiagnostic={selectedErrorIndex}
      onSelectDiagnostic={selectFromTree}
      diagnosticRevealSeq={diagnosticRevealSeq}
      scrollOnDiagnostic={scrollTreeToDiagnostic}
    />
  ) : (
    <div className="cq-decoded-empty">CBOR didn&apos;t decode — no tree.</div>
  );

  // Mount a panel body only after it has been shown once.
  const bodyOf = (panel: PanelId, body: ReactNode) => (shownPanels.has(panel) ? body : null);
  const panelSpecs: PanelRegistry = {
    cddl: { extras: cddlExtras, nav: navFor("cddl"), body: bodyOf("cddl", cddlBody) },
    hex: { extras: hexExtras, nav: navFor("hex"), body: bodyOf("hex", hexBody) },
    decoded: { extras: null, nav: navFor("decoded"), body: bodyOf("decoded", decodedBody) },
    tree: { extras: null, nav: navFor("tree"), body: bodyOf("tree", treeBody) },
  };

  return (
    <div className="cddl-validator-layout">
      <DockWorkspace ref={workspaceRef} panels={panelSpecs} onVisibleChange={handleVisibleChange} />
      {drawerShown && (
        <MismatchDrawer
          verdict={verdict}
          outcome={cborOutcome}
          diagnostics={diagnostics}
          hiddenDiagnostics={validation.hiddenDiagnostics}
          undescribedDiagnostics={validation.undescribedDiagnostics}
          selectedIndex={selectedErrorIndex}
          onSelectDiagnostic={selectFromList}
          onRevealBytes={revealInHex}
          rootSuggestions={refusedAtRoot ? rootSuggestions : null}
          onRulePick={handleRulePick}
          onClose={closeDrawer}
        />
      )}
      <TypeSelectionModal
        isOpen={ruleChoice !== null}
        types={ruleChoice ?? []}
        onSelect={chooseDetectedRule}
        onClose={dismissRuleChoice}
        title="Which rule is this CBOR?"
        description="It matches more than one root rule of the schema. Pick the one to validate against:"
      />
      {pinMenu && (
        <PinContextMenu
          x={pinMenu.x}
          y={pinMenu.y}
          candidate={pinMenu.candidate}
          emptyNotice={pinMenuEmptyNotice}
          source={pinMenu.source}
          actions={pinMenu.actions}
          targets={pinTargets}
          hasActivePin={pinned !== null}
          onToggleTarget={togglePinTarget}
          onPin={handlePin}
          onClearPin={clearPinnedNode}
          onClose={closePinMenu}
        />
      )}
    </div>
  );
}
