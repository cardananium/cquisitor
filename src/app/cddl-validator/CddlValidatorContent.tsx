"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import ResizablePanels from "@/components/ResizablePanels";
import EditableHexView, { type ExtraErrorSpan } from "@/components/EditableHexView";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import CborTreeView from "@/components/CborTreeView";
import DecodedJsonTree from "./DecodedJsonTree";
import type { CborPosition, CborCddlMapEntry } from "@cardananium/cquisitor-lib";
import CddlSchemaToolbar from "./CddlSchemaToolbar";
import CddlEditor, { type CddlEditorHandle, type OverlayMark } from "./CddlEditor";
import CddlErrorNav, { type CddlErrorEntry } from "./CddlErrorNav";
import PinContextMenu, { ALL_PIN_TARGETS, type PinTarget } from "./PinContextMenu";
import { loadCardanoPreset } from "./presets";
import { utf16ToByte } from "./cddlError";
import { safeFormat, safeSymbolAt } from "./cddlValidatorLib";
import {
  useCborCddlMap,
  useCborDecoded,
  useCborValidation,
  useCddlSchema,
  useDebouncedString,
  useDecodeAgainstSchema,
  useLinkedCddlRange,
  useReferenceRanges,
} from "./hooks";

const DEFAULT_CDDL = `; CDDL schema — edit me.
Person = {
  name: tstr,
  age: uint,
  ? nickname: tstr,
}
`;

const DEFAULT_CBOR_HEX = "a3646e616d6565416c69636563616765181e686e69636b6e616d656441416c69";

/** Split a JSONPath like `$.foo["bar"][0]` into a flat list of segment
 *  names. Used to compare paths from the JSON viewer with `decoded_path`
 *  values from `map_cbor_to_cddl`, treating `[N]` and `["N"]` as equal. */
function splitJsonPath(path: string): string[] {
  const out: string[] = [];
  const re = /\.([^.\[\]]+)|\["((?:[^"\\]|\\.)*)"\]|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function sameJsonPath(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Mark priorities — higher wins on overlap. The pinned cross-panel
// selection beats everything else so the user can always see where the
// last RMB went; errors and mismatches still beat passive bridge hover.
const PRIORITY_PINNED = 120;
const PRIORITY_ERROR = 100;
const PRIORITY_MISMATCH = 80;
const PRIORITY_LINKED = 60;
const PRIORITY_REFERENCE = 40;

export default function CddlValidatorContent() {
  // ---------- input state ----------
  const [cddl, setCddl] = useState(DEFAULT_CDDL);
  const [cborInput, setCborInput] = useState(DEFAULT_CBOR_HEX);
  const [selectedRule, setSelectedRule] = useState("Person");
  const [autoPickedRule, setAutoPickedRule] = useState(true);
  const [presetLoading, setPresetLoading] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  const cddlDebounced = useDebouncedString(cddl, 200);
  const hexDebounced = useDebouncedString(cborInput, 200);
  const ruleDebounced = useDebouncedString(selectedRule, 200);

  // ---------- derived: schema, CBOR, validation, decoded JSON, bridge map ----------
  const schema = useCddlSchema(cddlDebounced);
  const ruleNames = schema.ruleNames;
  const schemaIsValid = !!schema.result && schema.result.valid;

  const { cleanHex, decoded } = useCborDecoded(hexDebounced);

  const validation = useCborValidation(cleanHex, cddlDebounced, ruleDebounced, schemaIsValid);
  const cborResult = validation.result;
  const cborIsValid = !!cborResult && cborResult.valid;
  const cborErrorOnCddl = validation.errorsOnCddl[0] ?? null;

  const schemaJson = useDecodeAgainstSchema(cleanHex, cddlDebounced, ruleDebounced, schemaIsValid);

  const cborCddlMap = useCborCddlMap(cleanHex, cddlDebounced, ruleDebounced, schemaIsValid, cborIsValid);

  // Auto-pick first rule from the outline when none of the typed names match
  // and the user hasn't manually overridden the picker.
  useEffect(() => {
    if (!autoPickedRule) return;
    if (ruleNames.length === 0) return;
    if (!ruleNames.includes(selectedRule)) setSelectedRule(ruleNames[0]);
  }, [ruleNames, selectedRule, autoPickedRule]);

  // ---------- hex panel ⇄ tree bridge state ----------
  const [hoverPosition, setHoverPosition] = useState<CborPosition | null>(null);
  const [focusPosition, setFocusPosition] = useState<CborPosition | null>(null);
  const [highlightedTreePosition, setHighlightedTreePosition] = useState<CborPosition | null>(null);
  const noopHoverPath = useCallback(() => {}, []);
  const hexEditorRef = useRef<HTMLDivElement | null>(null);

  const handleTreeHover = useCallback((p: CborPosition | null) => setHoverPosition(p), []);
  const handleTreeHighlightAndScroll = useCallback((p: CborPosition) => {
    setFocusPosition(p);
    setTimeout(() => setFocusPosition(null), 1500);
  }, []);
  const handleShowInTree = useCallback((p: CborPosition) => setHighlightedTreePosition(p), []);
  const handleClearTreeHighlight = useCallback(() => setHighlightedTreePosition(null), []);

  // ---------- editor: caret, references, CDDL→CBOR bridge ----------
  const editorRef = useRef<CddlEditorHandle>(null);
  const [caretOffset, setCaretOffset] = useState<number | null>(null);
  const referenceRanges = useReferenceRanges(cddlDebounced, caretOffset);
  const linkedCddlRange = useLinkedCddlRange(cborCddlMap, hoverPosition);

  // Alt-click in CDDL → narrowest matching CBOR spans, pinned until cleared
  // (or until the schema/CBOR/rule change underneath them — see the
  // consolidated input-change cleanup below).
  const [linkedHexSpans, setLinkedHexSpans] = useState<ExtraErrorSpan[]>([]);
  const clearLinkedHexSpans = useCallback(() => setLinkedHexSpans([]), []);

  // Cross-panel selection. Right-click in any of the 4 panels resolves a
  // candidate map entry, opens a context menu, and the user picks where
  // to mirror the highlight. The pinned entry + chosen targets together
  // drive what each panel projects. Reset when any input changes — see
  // the consolidated cleanup below.
  const [pinnedEntry, setPinnedEntry] = useState<CborCddlMapEntry | null>(null);
  const clearPinnedEntry = useCallback(() => setPinnedEntry(null), []);

  // Per-panel highlight targets — persisted across pins so the user only
  // configures their preference once. Defaults to all four panels.
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

  // Active context menu state — what to show + where on screen.
  interface PinMenuState {
    x: number;
    y: number;
    candidate: CborCddlMapEntry;
    source: PinTarget;
  }
  const [pinMenu, setPinMenu] = useState<PinMenuState | null>(null);
  const closePinMenu = useCallback(() => setPinMenu(null), []);
  // Captured on every contextmenu event so panel callbacks (which only
  // forward an offset / path) can position the menu at the click point.
  const lastRmbPos = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      lastRmbPos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("contextmenu", handler, true);
    return () => window.removeEventListener("contextmenu", handler, true);
  }, []);

  // Consolidated cleanup: when CBOR / schema / rule change, every piece
  // of derived selection state references stale offsets or paths and must
  // be cleared. `pinTargets` is a user preference and is intentionally
  // preserved across input changes.
  useEffect(() => {
    setPinnedEntry(null);
    setLinkedHexSpans([]);
    setHighlightedTreePosition(null);
    setHoverPosition(null);
    setFocusPosition(null);
    setPinMenu(null);
  }, [cleanHex, cddlDebounced, ruleDebounced]);

  // Bridge resolvers — given an offset/path, find the best candidate map
  // entry. These are now exposed as `requestPin*` which open the menu
  // instead of pinning directly. They silently no-op when nothing matches.
  const findFromCborOffset = useCallback((byteOffset: number) => {
    if (cborCddlMap.length === 0) return null;
    const matches = cborCddlMap.filter(e => {
      const a = e.cbor_anchor_span;
      return a && byteOffset >= a.offset && byteOffset < a.offset + a.length;
    });
    if (matches.length === 0) return null;
    matches.sort((a, b) => a.cbor_anchor_span.length - b.cbor_anchor_span.length);
    return matches[0];
  }, [cborCddlMap]);

  const findFromCddlOffset = useCallback((charOffset: number) => {
    if (cborCddlMap.length === 0) return null;
    const matches = cborCddlMap.filter(e => {
      const s = e.cddl_byte_span;
      return s && charOffset >= s.char_offset && charOffset < s.char_offset + s.char_length;
    });
    if (matches.length === 0) return null;
    // `cddl_byte_span` presence is guaranteed by the `.filter` above.
    matches.sort((a, b) => a.cddl_byte_span!.char_length - b.cddl_byte_span!.char_length);
    return matches[0];
  }, [cborCddlMap]);

  const findFromDecodedPath = useCallback((decodedPath: string, preferredRole: "key" | "value" = "value") => {
    if (cborCddlMap.length === 0) return null;
    // The lib emits `["0"]` for numeric map keys and `[0]` for array
    // indices; the JSON viewer can't tell those apart from the DOM
    // (both render as a number key under the same `.data-key-key`).
    // Compare paths segment-wise to ignore that difference.
    const wanted = splitJsonPath(decodedPath);
    const exact = cborCddlMap.filter(e => sameJsonPath(splitJsonPath(e.decoded_path), wanted));
    if (exact.length > 0) {
      // Prefer the role the user clicked on; fall back to the other when
      // the lib only emitted one (e.g. array slots are always "value").
      return exact.find(e => e.entry_role === preferredRole) ?? exact[0];
    }
    // Fallback for synthetic decoder keys (`@tag`, `@positional`,
    // `@extra`, `@entries[N].{key,value,match}`) that don't appear in
    // the bridge map: walk up to the deepest ancestor that does so the
    // user can still pin the surrounding wrapper.
    let bestDepth = -1;
    let best: typeof cborCddlMap[number] | null = null;
    for (const entry of cborCddlMap) {
      const segs = splitJsonPath(entry.decoded_path);
      if (segs.length >= wanted.length) continue;
      let isPrefix = true;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i] !== wanted[i]) { isPrefix = false; break; }
      }
      if (!isPrefix) continue;
      if (segs.length > bestDepth) {
        bestDepth = segs.length;
        best = entry;
      }
    }
    if (!best) return null;
    // Prefer the value-role entry at that depth when the ancestor is a
    // map key with both key/value rows.
    const ancestorSegs = splitJsonPath(best.decoded_path);
    const sameDepth = cborCddlMap.filter(e => {
      const s = splitJsonPath(e.decoded_path);
      return s.length === ancestorSegs.length && sameJsonPath(s, ancestorSegs);
    });
    return sameDepth.find(e => e.entry_role === "value") ?? best;
  }, [cborCddlMap]);

  const openPinMenu = useCallback(
    (source: PinTarget, candidate: CborCddlMapEntry | null) => {
      if (!candidate) return;
      setPinMenu({ x: lastRmbPos.current.x, y: lastRmbPos.current.y, candidate, source });
    },
    [],
  );
  const requestPinFromCborOffset = useCallback((byteOffset: number) => {
    openPinMenu("hex", findFromCborOffset(byteOffset));
  }, [openPinMenu, findFromCborOffset]);
  const requestPinFromCddlOffset = useCallback((charOffset: number) => {
    openPinMenu("cddl", findFromCddlOffset(charOffset));
  }, [openPinMenu, findFromCddlOffset]);
  const requestPinFromDecodedPath = useCallback((decodedPath: string, role: "key" | "value") => {
    openPinMenu("decoded", findFromDecodedPath(decodedPath, role));
  }, [openPinMenu, findFromDecodedPath]);
  const requestPinFromTreePosition = useCallback((position: CborPosition) => {
    openPinMenu("tree", findFromCborOffset(position.offset));
  }, [openPinMenu, findFromCborOffset]);

  const handleLinkClick = useCallback((jsOffset: number) => {
    if (cborCddlMap.length === 0) return;
    const matching = cborCddlMap.filter(e => {
      const s = e.cddl_byte_span;
      return s && jsOffset >= s.char_offset && jsOffset < s.char_offset + s.char_length;
    });
    if (matching.length === 0) { setLinkedHexSpans([]); return; }
    // `cddl_byte_span` presence is guaranteed by the `.filter` above.
    const minLen = Math.min(...matching.map(e => e.cddl_byte_span!.char_length));
    const deepest = matching.filter(e => e.cddl_byte_span!.char_length === minLen);
    const out: ExtraErrorSpan[] = [];
    const seen = new Set<string>();
    for (const e of deepest) {
      const a = e.cbor_anchor_span;
      const key = `${a.offset}:${a.length}:${e.entry_role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const role = e.entry_role === "key" ? "key" : "value";
      out.push({ offset: a.offset, length: a.length, message: `${e.cbor_type ?? "node"} ${role} at ${e.cbor_path}` });
    }
    setLinkedHexSpans(out);
  }, [cborCddlMap]);

  const handleSymbolClick = useCallback((jsOffset: number) => {
    if (!cddl) return;
    const sym = safeSymbolAt(cddl, utf16ToByte(cddl, jsOffset));
    if (!sym?.definition_span) return;
    const d = sym.definition_span;
    editorRef.current?.reveal([d.char_offset, d.char_offset + d.char_length]);
  }, [cddl]);

  // ---------- error nav (CDDL parse error + every mismatch) ----------
  const cddlErrors = useMemo<CddlErrorEntry[]>(() => {
    const list: CddlErrorEntry[] = [];
    if (schema.errorRange && schema.result && !schema.result.valid) {
      const line = schema.errorLine ? ` (line ${schema.errorLine})` : "";
      list.push({
        range: schema.errorRange,
        kind: "parse",
        message: `parse_error: ${schema.result.error.message}${line}`,
      });
    }
    for (const e of validation.errorsOnCddl) {
      list.push({ range: e.range, kind: "mismatch", message: e.message });
    }
    return list;
  }, [schema, validation]);

  const handleJump = useCallback((entry: CddlErrorEntry) => {
    editorRef.current?.reveal(entry.range);
  }, []);

  // ---------- editor marks (priority-ranked) ----------
  const editorMarks = useMemo<OverlayMark[]>(() => {
    const out: OverlayMark[] = [];
    if (schema.errorRange && schema.result && !schema.result.valid) {
      out.push({
        range: schema.errorRange,
        className: "cddl-editor-error-mark",
        message: schema.result.error.message,
        priority: PRIORITY_ERROR,
      });
    }
    if (cborErrorOnCddl) {
      out.push({
        range: cborErrorOnCddl.range,
        className: "cddl-editor-mismatch-mark",
        message: cborErrorOnCddl.message,
        priority: PRIORITY_MISMATCH,
      });
    }
    if (linkedCddlRange) {
      out.push({
        range: linkedCddlRange.range,
        className: "cddl-editor-linked-mark",
        message: linkedCddlRange.message,
        priority: PRIORITY_LINKED,
      });
    }
    for (const r of referenceRanges) {
      out.push({
        range: r,
        className: "cddl-editor-reference-mark",
        priority: PRIORITY_REFERENCE,
      });
    }
    if (pinnedEntry && pinTargets.has("cddl")) {
      // Synthetic wrapper rows (`@positional`, `@extra`, `@entries`)
      // have no CDDL counterpart — skip the editor highlight for those.
      const s = pinnedEntry.cddl_byte_span;
      if (s) {
        out.push({
          range: [s.char_offset, s.char_offset + s.char_length],
          className: "cddl-editor-pinned-mark",
          message: `Pinned: ${pinnedEntry.cbor_type ?? "node"} ${pinnedEntry.entry_role} at ${pinnedEntry.cbor_path}`,
          priority: PRIORITY_PINNED,
        });
      }
    }
    return out;
  }, [schema, cborErrorOnCddl, linkedCddlRange, referenceRanges, pinnedEntry, pinTargets]);

  // Pinned selection projected onto the hex view — extra blue span on top
  // of any other Alt-click linked spans.
  const pinnedHexSpans = useMemo<ExtraErrorSpan[]>(() => {
    if (!pinnedEntry || !pinTargets.has("hex")) return [];
    const a = pinnedEntry.cbor_anchor_span;
    return [{
      offset: a.offset,
      length: a.length,
      message: `Pinned: ${pinnedEntry.cbor_type ?? "node"} at ${pinnedEntry.cbor_path}`,
    }];
  }, [pinnedEntry, pinTargets]);

  const combinedHexLinkedSpans = useMemo<ExtraErrorSpan[]>(
    () => [...linkedHexSpans, ...pinnedHexSpans],
    [linkedHexSpans, pinnedHexSpans],
  );

  // Pinned selection projected onto the structural tree — feed its
  // CBOR position to the existing "highlightedTreePosition" plumbing.
  const treeHighlight = useMemo<CborPosition | null>(() => {
    if (highlightedTreePosition) return highlightedTreePosition;
    if (pinnedEntry && pinTargets.has("tree")) {
      const a = pinnedEntry.cbor_anchor_span;
      return { offset: a.offset, length: a.length };
    }
    return null;
  }, [highlightedTreePosition, pinnedEntry, pinTargets]);

  // Pinned path projected onto the decoded JSON tree.
  const decodedPinnedPath = useMemo(
    () => (pinnedEntry && pinTargets.has("decoded") ? pinnedEntry.decoded_path : null),
    [pinnedEntry, pinTargets],
  );

  // ---------- hex extra-error spans (from CDDL mismatch byte_spans / anchors) ----------
  const extraErrorSpans = useMemo<ExtraErrorSpan[]>(() => {
    if (!cborResult || cborResult.valid) return [];
    const err = cborResult.error;
    const spans: ExtraErrorSpan[] = [];
    const msg = err.message;
    if (err.byte_spans) for (const s of err.byte_spans) spans.push({ offset: s.offset, length: s.length, message: msg });
    if (err.anchor_spans) for (const s of err.anchor_spans) spans.push({ offset: s.offset, length: s.length, message: msg });
    return spans;
  }, [cborResult]);

  // ---------- toolbar handlers ----------
  const handleRulePick = useCallback((value: string) => {
    setAutoPickedRule(false);
    setSelectedRule(value);
  }, []);
  const handleClearSchema = useCallback(() => setCddl(""), []);
  const handleFormatCddl = useCallback(() => {
    const formatted = safeFormat(cddl);
    if (formatted && formatted !== cddl) setCddl(formatted);
  }, [cddl]);
  const handleLoadExample = useCallback(() => {
    setCddl(DEFAULT_CDDL);
    setCborInput(DEFAULT_CBOR_HEX);
    setSelectedRule("Person");
    setAutoPickedRule(true);
  }, []);
  const handleLoadPreset = useCallback(async (id: string) => {
    if (!id) return;
    setPresetError(null);
    setPresetLoading(id);
    try {
      const text = await loadCardanoPreset(id);
      setCddl(text);
      setAutoPickedRule(true);
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : String(e));
    } finally {
      setPresetLoading(null);
    }
  }, []);

  const leftPanel = (
    <div className="panel-content">
      <div className="panel-header-compact">
        <span className="panel-title">CDDL Schema</span>
        <HelpTooltip>
          <strong>How to use:</strong> Write (or paste) a CDDL schema. Pick the root rule to validate against. The CBOR hex on the right is checked automatically.
        </HelpTooltip>
        {schema.result && schema.result.valid && (
          <span className="panel-badge success">valid</span>
        )}
        {schema.result && !schema.result.valid && (
          <span className="panel-badge error" title={schema.result.error.message}>
            {schema.result.error.kind}
          </span>
        )}
        <div className="cq-flex-grow" />
        <button onClick={handleLoadExample} className="btn-icon" title="Load example">⟳</button>
        <button onClick={handleClearSchema} className="btn-icon" title="Clear">✕</button>
      </div>

      <CddlSchemaToolbar
        ruleNames={ruleNames}
        selectedRule={selectedRule}
        onRulePick={handleRulePick}
        presetLoading={presetLoading}
        onLoadPreset={handleLoadPreset}
        onFormat={handleFormatCddl}
        formatDisabled={!schema.result || !schema.result.valid}
        rightSlot={cddlErrors.length > 0 ? <CddlErrorNav errors={cddlErrors} onJump={handleJump} /> : null}
      />

      <HintBanner storageKey="cquisitor_hint_cddl_validator">
        <strong>How to use:</strong> Edit the CDDL schema on the left and CBOR hex on the right.
        Mismatches show in red. <strong>Right-click any panel</strong> (CDDL, hex, tree, decoded JSON)
        → a context menu lets you pin the node and choose which panels mirror the highlight.
        Cmd-click a rule reference → jump to definition. Alt-click in CDDL → pin matching CBOR bytes.
      </HintBanner>
      {pinnedEntry && (
        <div className="cq-link-banner">
          <span className="cq-link-banner-text">
            Pinned: <code>{pinnedEntry.cbor_path}</code>
            {pinnedEntry.rule_name ? ` · rule ${pinnedEntry.rule_name}` : ""}
          </span>
          <button
            type="button"
            className="cq-link-banner-close"
            onClick={clearPinnedEntry}
            title="Clear pinned selection"
            aria-label="Clear pinned selection"
          >✕</button>
        </div>
      )}

      <CddlEditor
        ref={editorRef}
        value={cddl}
        onChange={setCddl}
        marks={editorMarks}
        onSymbolClick={handleSymbolClick}
        onLinkClick={handleLinkClick}
        onPinAtOffset={requestPinFromCddlOffset}
        onCaretMove={setCaretOffset}
        ruleNames={ruleNames}
      />

      {presetError && (
        <div className="cddl-error-card">
          <div className="cddl-error-card-kind">preset fetch failed</div>
          <div className="cddl-error-card-message">{presetError}</div>
        </div>
      )}

      {schema.result && !schema.result.valid && (
        <div className="cddl-error-card">
          <div className="cddl-error-card-kind">{schema.result.error.kind}</div>
          {schema.errorLine !== null && (
            <div className="cddl-error-card-meta">line {schema.errorLine}</div>
          )}
          <div className="cddl-error-card-message">{schema.result.error.message}</div>
        </div>
      )}
    </div>
  );

  const validationCard = (
    <>
      {cborResult && cborResult.valid && (
        <div className="cddl-success-card">
          ✓ CBOR matches <code>{ruleDebounced}</code>
        </div>
      )}

      {cborResult && !cborResult.valid && (
        <div className="cddl-error-card">
          <div className="cddl-error-card-kind">{cborResult.error.kind}</div>
          <div className="cddl-error-card-message">{cborResult.error.message}</div>
          <dl className="cddl-error-card-fields">
            {cborResult.error.expected && (
              <>
                <dt>expected</dt>
                <dd><code>{cborResult.error.expected}</code></dd>
              </>
            )}
            {cborResult.error.path && (
              <>
                <dt>path</dt>
                <dd><code>{cborResult.error.path}</code></dd>
              </>
            )}
            {cborResult.error.byte_spans && cborResult.error.byte_spans.length > 0 && (
              <>
                <dt>byte spans</dt>
                <dd>
                  {cborResult.error.byte_spans.map((s, i) => (
                    <code key={i} className="cddl-span-chip" onClick={() => setHoverPosition(s)}>
                      {s.offset}..{s.offset + s.length}
                    </code>
                  ))}
                </dd>
              </>
            )}
            {cborResult.error.anchor_spans && cborResult.error.anchor_spans.length > 0 && (
              <>
                <dt>anchors</dt>
                <dd>
                  {cborResult.error.anchor_spans.map((s, i) => (
                    <code key={i} className="cddl-span-chip cddl-span-chip-anchor" onClick={() => setHoverPosition(s)}>
                      {s.offset}..{s.offset + s.length}
                    </code>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </>
  );

  const cborPanel = (
    <div className="panel-content" ref={hexEditorRef}>
      <div className="panel-header-compact">
        <span className="panel-title">CBOR Hex</span>
        {cborResult && cborResult.valid && (
          <span className="panel-badge success">matches rule</span>
        )}
        {cborResult && !cborResult.valid && (
          <span className="panel-badge error" title={cborResult.error.message}>
            {cborResult.error.kind}
          </span>
        )}
      </div>
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
      <EditableHexView
        value={cborInput}
        onChange={setCborInput}
        hexValue={cleanHex}
        cborData={decoded}
        hoverPosition={hoverPosition}
        focusPosition={focusPosition}
        extraErrorSpans={extraErrorSpans}
        linkedSpans={combinedHexLinkedSpans}
        onHoverPath={noopHoverPath}
        onShowInTree={handleShowInTree}
        onContextMenuPin={requestPinFromCborOffset}
      />
    </div>
  );

  const outputPanel = (
    <div className="panel-content">
      <Tabs.Root defaultValue="validation" className="cq-tabs-root">
        <Tabs.List className="cq-tabs-list">
          <Tabs.Trigger value="validation" className="cq-tabs-trigger">Validation</Tabs.Trigger>
          <Tabs.Trigger value="decoded" className="cq-tabs-trigger">Decoded against schema</Tabs.Trigger>
          <Tabs.Trigger value="tree" className="cq-tabs-trigger">Structural tree</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="validation" className="cq-tabs-content">
          {!cleanHex ? (
            <div className="cq-decoded-empty">Paste CBOR hex above to see validation results.</div>
          ) : validationCard}
        </Tabs.Content>

        <Tabs.Content value="decoded" className="cq-tabs-content">
          {!schemaJson && (
            <div className="cq-decoded-empty">
              Provide CBOR hex, a valid CDDL schema and a rule to see decoded JSON.
            </div>
          )}
          {schemaJson && !schemaJson.ok && (
            <div className="cddl-error-card">
              <div className="cddl-error-card-kind">decode error</div>
              <div className="cddl-error-card-message">{schemaJson.error}</div>
            </div>
          )}
          {schemaJson && schemaJson.ok && (
            <div className="cq-decoded-viewer">
              <DecodedJsonTree
                data={schemaJson.value}
                expanded={3}
                pinnedPath={decodedPinnedPath}
                onPinPath={requestPinFromDecodedPath}
              />
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="tree" className="cq-tabs-content">
          {decoded ? (
            <div className="cq-tree-pane">
              <CborTreeView
                data={decoded}
                hexValue={cleanHex}
                onHoverPosition={handleTreeHover}
                onHighlightAndScroll={handleTreeHighlightAndScroll}
                highlightedTreePosition={treeHighlight}
                onClearHighlight={handleClearTreeHighlight}
                onPinPosition={requestPinFromTreePosition}
              />
            </div>
          ) : (
            <div className="cq-decoded-empty">CBOR didn&apos;t decode — no tree.</div>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );

  return (
    <div className="cddl-validator-layout">
      <div className="cddl-validator-top">
        <ResizablePanels
          leftPanel={leftPanel}
          rightPanel={cborPanel}
          defaultLeftWidth={50}
          minLeftWidth={25}
          maxLeftWidth={75}
        />
      </div>
      <div className="cddl-validator-bottom">
        {outputPanel}
      </div>
      {pinMenu && (
        <PinContextMenu
          x={pinMenu.x}
          y={pinMenu.y}
          candidate={pinMenu.candidate}
          source={pinMenu.source}
          targets={pinTargets}
          hasActivePin={pinnedEntry !== null}
          onToggleTarget={togglePinTarget}
          onPin={(entry) => setPinnedEntry(entry)}
          onClearPin={clearPinnedEntry}
          onClose={closePinMenu}
        />
      )}
    </div>
  );
}
