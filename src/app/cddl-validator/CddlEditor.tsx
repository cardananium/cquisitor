"use client";

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

export interface CddlEditorHandle {
  /** Scroll the textarea so [start, end] is visible and select the range. */
  reveal(range: [number, number]): void;
}

interface CddlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Inclusive-exclusive char range to highlight (from CDDL parse error). */
  errorRange?: [number, number] | null;
  /** Tooltip / title text on the highlighted range (e.g. error message). */
  errorMessage?: string | null;
  /** Range mapped from a CBOR vs CDDL mismatch — rendered with a softer style. */
  mismatchRange?: [number, number] | null;
  mismatchMessage?: string | null;
}

/**
 * Textarea with an absolutely-positioned `pre` overlay behind it that paints
 * the error range. Standard "highlight inside a textarea" trick: text in the
 * overlay is `color: transparent` so only its background marks show through;
 * the textarea on top renders the real characters and the caret. Scroll is
 * mirrored so the highlight stays glued to its bytes when the user scrolls.
 */
interface MarkSpan {
  start: number;
  end: number;
  className: string;
  message?: string | null;
}

function buildOverlay(value: string, marks: MarkSpan[]): React.ReactNode {
  if (marks.length === 0) return value + "\n";

  // Clamp + drop empties (or expand zero-width to one char so the mark renders).
  const sane: MarkSpan[] = marks
    .map((m) => {
      const s = Math.max(0, Math.min(m.start, value.length));
      const e = Math.max(s, Math.min(m.end, value.length));
      return { ...m, start: s, end: s === e ? Math.min(s + 1, value.length) : e };
    })
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start);

  // Drop overlaps — first mark wins (the parse error is passed before mismatch).
  const flat: MarkSpan[] = [];
  let cursor = 0;
  for (const m of sane) {
    if (m.start < cursor) continue;
    flat.push(m);
    cursor = m.end;
  }
  if (flat.length === 0) return value + "\n";

  const out: React.ReactNode[] = [];
  let pos = 0;
  flat.forEach((m, i) => {
    if (m.start > pos) out.push(value.slice(pos, m.start));
    out.push(
      <mark key={i} className={m.className} title={m.message ?? undefined}>
        {value.slice(m.start, m.end) || " "}
      </mark>,
    );
    pos = m.end;
  });
  if (pos < value.length) out.push(value.slice(pos));
  out.push("\n");
  return out;
}

function CddlEditorInner(
  {
    value,
    onChange,
    errorRange,
    errorMessage,
    mismatchRange,
    mismatchMessage,
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
      // Scroll the line into view by selecting first, then nudging scrollTop.
      // Approximate line height via computed style; line index from start offset.
      const before = ta.value.slice(0, start);
      const line = (before.match(/\n/g)?.length ?? 0);
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const target = Math.max(0, line * lineHeight - ta.clientHeight / 3);
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

  // Re-sync if value or any range changes (so overlay redraws then scrolls to match).
  useEffect(() => { syncScroll(); }, [value, errorRange, mismatchRange, syncScroll]);

  const marks: MarkSpan[] = [];
  if (errorRange) {
    marks.push({
      start: errorRange[0], end: errorRange[1],
      className: "cddl-editor-error-mark",
      message: errorMessage,
    });
  }
  if (mismatchRange) {
    marks.push({
      start: mismatchRange[0], end: mismatchRange[1],
      className: "cddl-editor-mismatch-mark",
      message: mismatchMessage,
    });
  }

  return (
    <div className="cddl-editor-wrap">
      <pre ref={overlayRef} className="cddl-editor-overlay" aria-hidden>
        {buildOverlay(value, marks)}
      </pre>
      <textarea
        ref={taRef}
        className="cddl-editor"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder="; Paste or type a CDDL schema here"
      />
    </div>
  );
}

const CddlEditor = forwardRef<CddlEditorHandle, CddlEditorProps>(CddlEditorInner);
CddlEditor.displayName = "CddlEditor";
export default CddlEditor;
