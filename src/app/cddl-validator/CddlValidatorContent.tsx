"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import ResizablePanels from "@/components/ResizablePanels";
import EditableHexView, { type ExtraErrorSpan } from "@/components/EditableHexView";
import HintBanner from "@/components/HintBanner";
import HelpTooltip from "@/components/HelpTooltip";
import JsonViewer from "@/components/JsonViewer";
import {
  cbor_to_json,
  validate_cddl,
  validate_cbor_against_cddl,
  decode_cbor_against_cddl,
  type CborPosition,
  type CborDecodeResult,
  type CddlValidationResult,
  type CborValidationResult,
  type CborValue,
  type CborPartialValue,
} from "@cardananium/cquisitor-lib";
import { convertSerdeNumbers } from "@/utils/serdeNumbers";
import CddlSchemaToolbar from "./CddlSchemaToolbar";
import CddlEditor, { type CddlEditorHandle } from "./CddlEditor";
import CddlErrorNav, { type CddlErrorEntry } from "./CddlErrorNav";
import { loadCardanoPreset } from "./presets";
import { parseCddlErrorPosition, locateCborErrorInCddl } from "./cddlError";

const DEFAULT_CDDL = `; CDDL schema — edit me.
Person = {
  name: tstr,
  age: uint,
  ? nickname: tstr,
}
`;

const DEFAULT_CBOR_HEX = "a3646e616d6565416c69636563616765181e686e69636b6e616d656441416c69";

const RULE_NAME_RE = /^[ \t]*([a-zA-Z_][\w-]*)\s*=/gm;

function extractRuleNames(cddl: string): string[] {
  const names = new Set<string>();
  for (const m of cddl.matchAll(RULE_NAME_RE)) names.add(m[1]);
  return [...names];
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setOut(value), delayMs);
    return () => clearTimeout(h);
  }, [value, delayMs]);
  return out;
}

export default function CddlValidatorContent() {
  const [cddl, setCddl] = useState(DEFAULT_CDDL);
  const [cborInput, setCborInput] = useState(DEFAULT_CBOR_HEX);
  const [selectedRule, setSelectedRule] = useState("Person");
  const [autoPickedRule, setAutoPickedRule] = useState(true);
  const [presetLoading, setPresetLoading] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  const cddlDebounced = useDebounced(cddl, 200);
  const hexDebounced = useDebounced(cborInput, 200);
  const ruleDebounced = useDebounced(selectedRule, 200);

  // Available rules parsed from the current CDDL. Auto-select when only one exists.
  const ruleNames = useMemo(() => extractRuleNames(cddlDebounced), [cddlDebounced]);
  useEffect(() => {
    if (!autoPickedRule) return;
    if (ruleNames.length === 0) return;
    if (!ruleNames.includes(selectedRule)) setSelectedRule(ruleNames[0]);
  }, [ruleNames, selectedRule, autoPickedRule]);

  // Normalise hex for all downstream work.
  const cleanHex = useMemo(() => {
    const t = hexDebounced.trim().replace(/\s/g, "").toLowerCase();
    return /^[0-9a-f]*$/.test(t) ? t : "";
  }, [hexDebounced]);

  // Decode CBOR for structural colours in the hex view.
  const decoded = useMemo<CborValue | CborPartialValue | null>(() => {
    if (!cleanHex) return null;
    const raw = cbor_to_json(cleanHex) as CborDecodeResult;
    const result = convertSerdeNumbers(raw) as CborDecodeResult;
    if (result.ok) return result.value;
    return result.partial ?? null;
  }, [cleanHex]);

  // Validate CDDL schema.
  const cddlResult = useMemo<CddlValidationResult | null>(() => {
    if (!cddlDebounced.trim()) return null;
    const raw = validate_cddl(cddlDebounced);
    return convertSerdeNumbers(raw) as CddlValidationResult;
  }, [cddlDebounced]);

  // Position info parsed from the cddl-cat error message — drives the
  // in-editor highlight and the line/column on the error card.
  const cddlErrorPos = useMemo(() => {
    if (!cddlResult || cddlResult.valid) return null;
    return parseCddlErrorPosition(cddlResult.error.message);
  }, [cddlResult]);

  // Validate CBOR against CDDL.
  const cborResult = useMemo<CborValidationResult | null>(() => {
    if (!cleanHex || !cddlDebounced.trim() || !ruleDebounced.trim()) return null;
    if (cddlResult && !cddlResult.valid) return null; // can't validate against a broken schema
    const raw = validate_cbor_against_cddl(cleanHex, cddlDebounced, ruleDebounced);
    return convertSerdeNumbers(raw) as CborValidationResult;
  }, [cleanHex, cddlDebounced, ruleDebounced, cddlResult]);

  // Heuristic mapping of CBOR validation errors (primary + additional) onto
  // CDDL source ranges. Only computed when the schema itself parses cleanly.
  const cborErrorsOnCddl = useMemo<{ range: [number, number]; message: string }[]>(() => {
    if (!cborResult || cborResult.valid) return [];
    if (cddlResult && !cddlResult.valid) return [];
    const all = [cborResult.error, ...((cborResult.error as { additional?: typeof cborResult.error[] }).additional ?? [])];
    const out: { range: [number, number]; message: string }[] = [];
    const seen = new Set<string>();
    for (const err of all) {
      const range = locateCborErrorInCddl(cddlDebounced, ruleDebounced, err.path);
      if (!range) continue;
      const key = `${range[0]}:${range[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const expected = err.expected ? `expected ${err.expected}` : err.kind;
      const at = err.path ? ` at ${err.path}` : "";
      out.push({ range, message: `${expected}${at} — ${err.message}` });
    }
    return out;
  }, [cborResult, cddlResult, cddlDebounced, ruleDebounced]);
  // Primary mismatch — first hit, used for the in-editor amber highlight.
  const cborErrorOnCddl = cborErrorsOnCddl[0] ?? null;

  // Combined list of CDDL-level errors for the navigator chip.
  const cddlErrors = useMemo<CddlErrorEntry[]>(() => {
    const list: CddlErrorEntry[] = [];
    if (cddlErrorPos) {
      list.push({
        range: cddlErrorPos.range,
        kind: "parse",
        message: `parse_error: ${cddlErrorPos.reason} (line ${cddlErrorPos.line}, col ${cddlErrorPos.column})`,
      });
    }
    for (const e of cborErrorsOnCddl) {
      list.push({ range: e.range, kind: "mismatch", message: e.message });
    }
    return list;
  }, [cddlErrorPos, cborErrorsOnCddl]);

  const editorRef = useRef<CddlEditorHandle>(null);
  const handleJump = useCallback((entry: CddlErrorEntry) => {
    editorRef.current?.reveal(entry.range);
  }, []);

  // Schema-mapped JSON: turns positional CBOR (numeric map keys, raw arrays)
  // into named fields per the CDDL rule. Throws on missing rule / mismatched
  // shapes — we surface that as an error rather than letting it crash render.
  const schemaJson = useMemo<{ ok: true; value: unknown } | { ok: false; error: string } | null>(() => {
    if (!cleanHex || !cddlDebounced.trim() || !ruleDebounced.trim()) return null;
    if (cddlResult && !cddlResult.valid) return null;
    try {
      const raw = decode_cbor_against_cddl(cleanHex, cddlDebounced, ruleDebounced);
      return { ok: true, value: convertSerdeNumbers(raw) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [cleanHex, cddlDebounced, ruleDebounced, cddlResult]);

  // Collect byte spans for hex highlighting: failure byte_spans + anchor_spans.
  const extraErrorSpans = useMemo<ExtraErrorSpan[]>(() => {
    if (!cborResult || cborResult.valid) return [];
    const err = cborResult.error;
    const spans: ExtraErrorSpan[] = [];
    const msg = err.message;
    if (err.byte_spans) {
      for (const s of err.byte_spans) spans.push({ offset: s.offset, length: s.length, message: msg });
    }
    if (err.anchor_spans) {
      for (const s of err.anchor_spans) spans.push({ offset: s.offset, length: s.length, message: msg });
    }
    return spans;
  }, [cborResult]);

  // Keep user edits from overriding auto-pick forever.
  const handleRulePick = useCallback((value: string) => {
    setAutoPickedRule(false);
    setSelectedRule(value);
  }, []);

  const handleClearSchema = useCallback(() => setCddl(""), []);
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
      setAutoPickedRule(true); // let rule picker pick the first rule from the freshly loaded schema
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : String(e));
    } finally {
      setPresetLoading(null);
    }
  }, []);

  // noop stubs to satisfy EditableHexView props
  const [hoverPosition, setHoverPosition] = useState<CborPosition | null>(null);
  const [focusPosition] = useState<CborPosition | null>(null);
  const noopHoverPath = useCallback(() => {}, []);
  const hexEditorRef = useRef<HTMLDivElement | null>(null);

  const leftPanel = (
    <div className="panel-content">
      <div className="panel-header-compact">
        <span className="panel-title">CDDL Schema</span>
        <HelpTooltip>
          <strong>How to use:</strong> Write (or paste) a CDDL schema. Pick the root rule to validate against. The CBOR hex on the right is checked automatically.
        </HelpTooltip>
        {cddlResult && cddlResult.valid && (
          <span className="panel-badge success">valid</span>
        )}
        {cddlResult && !cddlResult.valid && (
          <span className="panel-badge error" title={cddlResult.error.message}>
            {cddlResult.error.kind}
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
        rightSlot={cddlErrors.length > 0 ? <CddlErrorNav errors={cddlErrors} onJump={handleJump} /> : null}
      />

      <HintBanner storageKey="cquisitor_hint_cddl_validator">
        <strong>How to use:</strong> Edit the CDDL schema on the left and CBOR hex on the right. The validator picks up changes automatically; mismatches are highlighted in red on the hex bytes.
      </HintBanner>

      <CddlEditor
        ref={editorRef}
        value={cddl}
        onChange={setCddl}
        errorRange={cddlErrorPos?.range ?? null}
        errorMessage={cddlErrorPos?.reason ?? (cddlResult && !cddlResult.valid ? cddlResult.error.message : null)}
        mismatchRange={cborErrorOnCddl?.range ?? null}
        mismatchMessage={cborErrorOnCddl?.message ?? null}
      />

      {presetError && (
        <div className="cddl-error-card">
          <div className="cddl-error-card-kind">preset fetch failed</div>
          <div className="cddl-error-card-message">{presetError}</div>
        </div>
      )}

      {cddlResult && !cddlResult.valid && (
        <div className="cddl-error-card">
          <div className="cddl-error-card-kind">{cddlResult.error.kind}</div>
          {cddlErrorPos && (
            <div className="cddl-error-card-meta">
              line {cddlErrorPos.line}, column {cddlErrorPos.column}
            </div>
          )}
          <div className="cddl-error-card-message">
            {cddlErrorPos?.reason ?? cddlResult.error.message}
          </div>
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

  const rightPanel = (
    <div className="panel-content">
      <Tabs.Root defaultValue="cbor" className="cq-tabs-root">
        <Tabs.List className="cq-tabs-list">
          <Tabs.Trigger value="cbor" className="cq-tabs-trigger">
            CBOR + Validation
          </Tabs.Trigger>
          <Tabs.Trigger value="decoded" className="cq-tabs-trigger">
            Decoded against schema
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="cbor" className="cq-tabs-content">
          <div className="cq-vsplit">
            <div className="cq-vsplit-top" ref={hexEditorRef}>
              <EditableHexView
                value={cborInput}
                onChange={setCborInput}
                hexValue={cleanHex}
                cborData={decoded}
                hoverPosition={hoverPosition}
                focusPosition={focusPosition}
                extraErrorSpans={extraErrorSpans}
                onHoverPath={noopHoverPath}
              />
            </div>
            <div className="cq-vsplit-bottom">
              {cleanHex ? validationCard : (
                <div className="cq-decoded-empty">
                  Paste CBOR hex above to see validation results.
                </div>
              )}
            </div>
          </div>
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
              <JsonViewer data={schemaJson.value} expanded={3} />
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );

  return (
    <div className="general-cbor-layout">
      <ResizablePanels
        leftPanel={leftPanel}
        rightPanel={rightPanel}
        defaultLeftWidth={45}
        minLeftWidth={25}
        maxLeftWidth={75}
      />
    </div>
  );
}
