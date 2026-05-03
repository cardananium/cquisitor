"use client";

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { tokenizeCddl } from "./cddlSyntax";

// Y-pixel position of `charOffset` in `textarea`'s rendered content.
// Builds a one-shot hidden mirror with the same typography + clientWidth
// so wrap behaviour matches; reads `offsetTop` of a probe placed at the
// offset; tears the mirror down. O(value.length) — only called on the
// rare reveal action.
function measureOffsetTop(textarea: HTMLTextAreaElement, charOffset: number): number {
  if (charOffset <= 0) return 0;
  const cs = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.left = "0";
  mirror.style.top = "0";
  mirror.style.height = "auto";
  mirror.style.minHeight = "0";
  mirror.style.maxHeight = "none";
  mirror.style.overflow = "visible";
  mirror.style.pointerEvents = "none";
  // Match content box width — clientWidth excludes padding & scrollbars.
  mirror.style.boxSizing = "content-box";
  mirror.style.width = `${textarea.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`;
  // Inherit only the typography + wrap properties.
  for (const prop of [
    "fontFamily", "fontSize", "fontWeight", "fontStyle",
    "letterSpacing", "lineHeight", "wordSpacing",
    "whiteSpace", "wordBreak", "overflowWrap", "tabSize",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  ] as const) {
    mirror.style.setProperty(
      prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()),
      cs.getPropertyValue(prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())),
    );
  }
  // Render text up to (but not including) the target offset, then a probe.
  // `pre-wrap` honours both `\n` in the text node and the sibling span's
  // position, so the probe lands at the start of the target's visual row.
  const before = textarea.value.slice(0, charOffset);
  mirror.appendChild(document.createTextNode(before));
  const probe = document.createElement("span");
  probe.textContent = "​"; // zero-width space — has metrics but no glyph.
  mirror.appendChild(probe);
  document.body.appendChild(mirror);
  const probeTop = probe.offsetTop;
  const mirrorPadTop = parseFloat(cs.paddingTop) || 0;
  document.body.removeChild(mirror);
  // probeTop already includes the mirror's own padding, but the textarea's
  // scrollTop is relative to its content area (no padding). Subtract back.
  return Math.max(0, probeTop - mirrorPadTop);
}

export interface CddlEditorHandle {
  /** Scroll the textarea so [start, end] is visible and select the range. */
  reveal(range: [number, number]): void;
}

/**
 * One overlay highlight. The editor accepts an array of these and decides
 * how to layer them — higher `priority` wins on overlap. Adding a new
 * kind of highlight is now just adding another entry, no new prop.
 */
export interface OverlayMark {
  range: [number, number];
  className: string;
  message?: string | null;
  /** Higher priority wins overlap. Default 0. */
  priority?: number;
}

interface CddlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Highlights to paint as background marks under the (transparent) text. */
  marks?: OverlayMark[];
  /** Fired on Cmd/Ctrl + click; parent should resolve symbol-at-offset. */
  onSymbolClick?: (offset: number) => void;
  /** Fired on Alt + click; parent uses it to bridge to the CBOR panel. */
  onLinkClick?: (offset: number) => void;
  /** Fired on right-click (after suppressing the native menu). */
  onPinAtOffset?: (offset: number) => void;
  /** Fired on caret move so the parent can recompute references. */
  onCaretMove?: (offset: number) => void;
  /** Rule names declared in the current CDDL — used by the syntax highlighter
   *  to colour rule references differently from prelude types and unknown
   *  identifiers. */
  ruleNames?: ReadonlyArray<string>;
}

/**
 * Textarea with an absolutely-positioned `pre` overlay underneath. The
 * overlay paints both the syntax-highlighted source AND the mark
 * backgrounds (errors, mismatches, references, linked). The textarea on
 * top has transparent text so only its caret + selection are visible —
 * everything the user sees as "the code" comes from the overlay. Scroll
 * is mirrored so the colour stays glued to the bytes.
 */
interface NormalisedMark {
  start: number;
  end: number;
  className: string;
  message?: string | null;
  priority: number;
}

interface SyntaxRun {
  start: number;
  end: number;
  className: string | null;
}

function buildOverlay(
  value: string,
  syntax: SyntaxRun[],
  marks: NormalisedMark[],
): React.ReactNode {
  // Build a sorted list of "cut points" where either a syntax run or a
  // mark begins/ends. Iterating cuts gives us segments of constant
  // (syntaxClass, markClass) — emit one element per segment.
  const cuts = new Set<number>([0, value.length]);
  for (const r of syntax) { cuts.add(r.start); cuts.add(r.end); }
  for (const m of marks)  { cuts.add(m.start); cuts.add(m.end); }
  const points = [...cuts].sort((a, b) => a - b);

  // Index lookups by position. Small N (CDDL editor) — linear scan is
  // acceptable; switch to a sorted-binary-search if profiling says so.
  const findSyntax = (pos: number): SyntaxRun | undefined =>
    syntax.find(r => r.start <= pos && pos < r.end);
  const findMark = (pos: number): NormalisedMark | undefined => {
    let best: NormalisedMark | undefined;
    for (const m of marks) {
      if (m.start <= pos && pos < m.end && (best == null || m.priority > best.priority)) {
        best = m;
      }
    }
    return best;
  };

  const out: React.ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === b) continue;
    const segment = value.slice(a, b);
    if (!segment) continue;

    const syn = findSyntax(a);
    const mk = findMark(a);
    const synClass = syn?.className ?? null;

    // Syntax span (visible, coloured text).
    let node: React.ReactNode = synClass
      ? <span className={synClass}>{segment}</span>
      : segment;

    // Mark wraps the segment to add background / underline. `mark`
    // never overrides the inner text colour.
    if (mk) {
      node = (
        <mark className={mk.className} title={mk.message ?? undefined}>
          {node}
        </mark>
      );
    }
    out.push(<React.Fragment key={a}>{node}</React.Fragment>);
  }

  // Phantom trailing newline so the overlay reserves the same final empty
  // line that <textarea> displays. Skip it when the text already ends
  // in "\n" — otherwise the overlay grows one extra line and scrolls past
  // the bottom of the textarea.
  if (!value.endsWith("\n")) out.push("\n");
  return out;
}

function CddlEditorInner(
  {
    value,
    onChange,
    marks: rawMarks,
    onSymbolClick,
    onLinkClick,
    onPinAtOffset,
    onCaretMove,
    ruleNames,
  }: CddlEditorProps,
  ref: React.Ref<CddlEditorHandle>,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);

  useImperativeHandle(ref, () => ({
    reveal([start, end]) {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      try { ta.setSelectionRange(start, end); } catch { /* invalid range */ }
      // Both panels use `white-space: pre-wrap`, so long lines wrap onto
      // multiple visual rows. Naïve `newlines * lineHeight` math drifts
      // by the number of wrapped rows above the target. Build a hidden
      // mirror with the same typography + width and let the browser do
      // the wrapping for us — measure the y of the probe element.
      const top = measureOffsetTop(ta, start);
      const target = Math.max(0, top - ta.clientHeight / 3);
      ta.scrollTop = target;
      if (overlayRef.current) overlayRef.current.scrollTop = target;
    },
  }), []);

  const syncScroll = useCallback(() => {
    if (taRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = taRef.current.scrollTop;
      overlayRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }, []);

  // Re-sync if value or marks change (so overlay redraws then scrolls to match).
  useEffect(() => { syncScroll(); }, [value, rawMarks, syncScroll]);

  // Tokenize once per (value, ruleNames) — cheap regex pass; cached.
  const syntaxRuns = useMemo(
    () => tokenizeCddl(value, { ruleNames }),
    [value, ruleNames],
  );

  // Normalise marks: clamp ranges, drop empty, expand zero-width to 1 char,
  // attach default priority.
  const marks = useMemo<NormalisedMark[]>(() => {
    if (!rawMarks || rawMarks.length === 0) return [];
    const out: NormalisedMark[] = [];
    for (const m of rawMarks) {
      const s = Math.max(0, Math.min(m.range[0], value.length));
      const e = Math.max(s, Math.min(m.range[1], value.length));
      const end = s === e ? Math.min(s + 1, value.length) : e;
      if (end <= s) continue;
      out.push({
        start: s,
        end,
        className: m.className,
        message: m.message ?? null,
        priority: m.priority ?? 0,
      });
    }
    return out;
  }, [rawMarks, value]);

  // Modifier-click handlers. Cmd/Ctrl = jump-to-definition (existing).
  // Alt = "bridge to CBOR panel" — explicit user action, avoids the
  // "any caret position lights up the world" problem.
  const handleClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.altKey && onLinkClick) {
      e.preventDefault();
      onLinkClick(ta.selectionStart);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && onSymbolClick) {
      onSymbolClick(ta.selectionStart);
    }
  };

  // Right-click → cross-panel pin. Native context menu is suppressed; the
  // browser would otherwise also reposition the caret, which we *want* —
  // we read selectionStart on the next tick after the browser places it.
  const handleContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (!onPinAtOffset) return;
    e.preventDefault();
    const ta = e.currentTarget;
    ta.focus();
    // Browsers move the caret on right-mousedown, but suppressing the
    // contextmenu keeps the previous selection. requestAnimationFrame
    // gives the engine a tick to settle on the click position.
    requestAnimationFrame(() => onPinAtOffset(ta.selectionStart));
  };

  const reportCaret = () => {
    if (!onCaretMove) return;
    const ta = taRef.current;
    if (ta) onCaretMove(ta.selectionStart);
  };

  return (
    <div className="cddl-editor-wrap">
      <pre ref={overlayRef} className="cddl-editor-overlay" aria-hidden>
        {buildOverlay(value, syntaxRuns, marks)}
      </pre>
      <textarea
        ref={taRef}
        className="cddl-editor"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onSelect={reportCaret}
        onKeyUp={reportCaret}
        placeholder="; Paste or type a CDDL schema here"
      />
    </div>
  );
}

const CddlEditor = forwardRef<CddlEditorHandle, CddlEditorProps>(CddlEditorInner);
CddlEditor.displayName = "CddlEditor";
export default CddlEditor;
