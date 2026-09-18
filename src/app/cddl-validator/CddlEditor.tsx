"use client";

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tokenizeCddl } from "./cddlSyntax";
import {
  layerMark,
  needsPhantomNewline,
  normaliseMarks,
  overlayLines,
  sameSegments,
  type NormalisedMark,
  type OverlayLine as OverlayLineData,
  type OverlayMark,
  type OverlaySegment,
} from "./cddlOverlay";

export type { OverlayMark };

// Y of `charOffset` in the textarea: hidden mirror with the same wrap, then
// tear it down. O(value.length) — only used on reveal.
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
  /** Scroll [start, end] into view without taking focus or moving the selection. */
  scrollTo(range: [number, number]): void;
  /** Scroll to the first line without taking focus. */
  scrollToTop(): void;
}

/** What one indent (or one level of outdent) is worth. */
export const INDENT = "  ";

/** The whole lines a selection touches, as a `[start, end)` char range. */
export function lineBlock(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nl = value.indexOf("\n", end);
  return [from, nl === -1 ? value.length : nl];
}

export interface EditorEdit {
  /** Replaces `[from, to)` in the source. */
  from: number;
  to: number;
  text: string;
  /** Where the selection lands once the edit is in. */
  selection: [number, number];
}

/** Tab/Shift+Tab indent: multi-line selections indent every touched line, otherwise indent at the caret (Shift+Tab outdents that line). Returns `null` when there is nothing to do. */
export function indentEdit(
  value: string,
  start: number,
  end: number,
  outdent: boolean,
): EditorEdit | null {
  const spansLines = value.slice(start, end).includes("\n");
  if (!outdent && !spansLines) {
    return { from: start, to: end, text: INDENT, selection: [start + INDENT.length, start + INDENT.length] };
  }
  const [from, to] = lineBlock(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const next = lines.map(line => {
    // An empty line would only gain trailing whitespace.
    if (!outdent) return line === "" ? line : INDENT + line;
    if (line.startsWith(INDENT)) return line.slice(INDENT.length);
    return line.replace(/^[ \t]/, "");
  });
  const text = next.join("\n");
  if (text === value.slice(from, to)) return null;
  // Keep the same characters selected after the indent shifts them.
  const headDelta = next[0].length - lines[0].length;
  const totalDelta = text.length - (to - from);
  const selStart = Math.max(from, start + headDelta);
  const selEnd = Math.max(selStart, end + totalDelta);
  return { from, to, text, selection: [selStart, selEnd] };
}

/** Enter keeps the indentation of the line the caret leaves. */
export function newlineEdit(value: string, start: number, end: number): EditorEdit {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const indent = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? "";
  const text = `\n${indent}`;
  const caret = start + text.length;
  return { from: start, to: end, text, selection: [caret, caret] };
}

export interface CddlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Highlights to paint as background marks under the (transparent) text. */
  marks?: OverlayMark[];
  /** Hover mark, layered over segmented lines so a hover does not rebuild the document. */
  hoverMark?: OverlayMark | null;
  /** Char offset under the pointer, or `null`. Emitted on the event, not a frame — see `pointerMove`. */
  onHoverOffset?: (offset: number | null) => void;
  /** Fired on Cmd/Ctrl + click; parent should resolve symbol-at-offset. */
  onSymbolClick?: (offset: number) => void;
  /** Fired on Alt + click; parent uses it to bridge to the CBOR panel. */
  onLinkClick?: (offset: number) => void;
  /** Fired on right-click (after suppressing the native menu). */
  onPinAtOffset?: (offset: number) => void;
  /** Return false to keep the native context menu at this offset. */
  canPinAt?: (offset: number) => boolean;
  /** Fired on caret move so the parent can recompute references. */
  onCaretMove?: (offset: number) => void;
  /** Rule names declared in the current CDDL — used by the syntax highlighter
   *  to colour rule references differently from prelude types and unknown
   *  identifiers. */
  ruleNames?: ReadonlyArray<string>;
}

/** The advance of one cell of the textarea's monospace font, in CSS pixels. */
function charWidth(ta: HTMLTextAreaElement): number {
  const canvas = charWidth.canvas ?? (charWidth.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  if (!ctx) return 8;
  ctx.font = getComputedStyle(ta).font;
  return ctx.measureText("0").width || 8;
}
charWidth.canvas = null as HTMLCanvasElement | null;

/**
 * Character whose cell contains `pointerX`, given the caret hit-test's boundary (`caretOffset` at `caretLeft`).
 * Caret APIs name the nearest boundary, so the right half of character k reports k+1; `null` for whitespace, past the end, or more than one cell away.
 */
export function charAtPointer(
  pointerX: number,
  caretOffset: number,
  caretLeft: number,
  cellWidth: number,
  value: string,
): number | null {
  const distance = pointerX - caretLeft;
  if (distance >= cellWidth || distance < -cellWidth) return null;
  const offset = distance >= 0 ? caretOffset : caretOffset - 1;
  if (offset < 0 || offset >= value.length) return null;
  const ch = value[offset];
  return ch === "\n" || ch === " " || ch === "\t" ? null : offset;
}

/** Char offset under `(x, y)`, or `null`. Uses `caretPositionFromPoint` when it returns a usable rect; otherwise hit-tests the overlay (WebKit's offset is visual-line, not document). */
function charOffsetFromPoint(
  ta: HTMLTextAreaElement,
  overlay: HTMLElement | null,
  lines: ReadonlyArray<OverlayLineData>,
  x: number,
  y: number,
): number | null {
  if (typeof document.caretPositionFromPoint === "function") {
    const caret = document.caretPositionFromPoint(x, y);
    if (!caret || caret.offsetNode !== ta) return null;
    const offset = Math.min(caret.offset, ta.value.length);
    // Empty rect (WebKit): overlay hit-test, or the boundary's own character if there is no overlay.
    const here = caret.getClientRect();
    if (here && (here.width > 0 || here.height > 0)) {
      return charAtPointer(x, offset, here.left, charWidth(ta), ta.value);
    }
    const viaOverlay = charOffsetViaOverlay(ta, overlay, lines, x, y);
    return viaOverlay === undefined ? charAtPointer(x, offset, x, Infinity, ta.value) : viaOverlay;
  }
  return charOffsetViaOverlay(ta, overlay, lines, x, y) ?? null;
}

/** Overlay hit-test: `undefined` if unavailable, `null` if no character. */
function charOffsetViaOverlay(
  ta: HTMLTextAreaElement,
  overlay: HTMLElement | null,
  lines: ReadonlyArray<OverlayLineData>,
  x: number,
  y: number,
): number | null | undefined {
  if (typeof document.caretRangeFromPoint !== "function" || !overlay) return undefined;
  const taEvents = ta.style.pointerEvents;
  const overlayEvents = overlay.style.pointerEvents;
  ta.style.pointerEvents = "none";
  overlay.style.pointerEvents = "auto";
  let range: Range | null;
  try {
    range = document.caretRangeFromPoint(x, y);
  } finally {
    ta.style.pointerEvents = taEvents;
    overlay.style.pointerEvents = overlayEvents;
  }
  if (!range || !overlay.contains(range.startContainer)) return null;
  let lineEl: Node = range.startContainer;
  while (lineEl.parentNode && lineEl.parentNode !== overlay) lineEl = lineEl.parentNode;
  const index = Array.prototype.indexOf.call(overlay.children, lineEl);
  const line = lines[index];
  if (!line) return null;
  const inLine = document.createRange();
  inLine.selectNodeContents(lineEl);
  inLine.setEnd(range.startContainer, range.startOffset);
  const offset = Math.min(line.start + inLine.toString().length, line.end);
  // Same boundary-to-cell mapping as the caret path.
  const here = range.getBoundingClientRect();
  if (here.width > 0 || here.height > 0) {
    return charAtPointer(x, offset, here.left, charWidth(ta), ta.value);
  }
  return charAtPointer(x, offset, x, Infinity, ta.value);
}

/** Title of the mark under `(x, y)`, testing every wrapped rectangle. */
function markTitleAt(overlay: HTMLElement, x: number, y: number): string | null {
  const marks = overlay.querySelectorAll<HTMLElement>("mark[title]");
  for (let i = 0; i < marks.length; i++) {
    const el = marks[i];
    const title = el.getAttribute("title");
    if (!title) continue;
    const rects = el.getClientRects();
    for (let r = 0; r < rects.length; r++) {
      const rect = rects[r];
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return title;
    }
  }
  return null;
}

/** The animation frame a pointer-move sequence has pending, if any. */
export interface FrameSlot {
  current: number | null;
}

/** Emit the hover offset on the event; fold tooltip reads into one pending animation frame. Hidden documents receive pointer events but run no frames, so the offset cannot wait for rAF. */
export function pointerMove(
  frame: FrameSlot,
  x: number,
  y: number,
  emitOffset: (x: number, y: number) => void,
  readTip: (x: number, y: number) => void,
  schedule: (callback: () => void) => number,
): void {
  emitOffset(x, y);
  if (frame.current !== null) return;
  frame.current = schedule(() => {
    frame.current = null;
    readTip(x, y);
  });
}

/** One overlay source line. Compared by painted content, not object identity — segments are rebuilt every keystroke. */
const OverlayLine = React.memo(
  function OverlayLine({ segments }: { segments: ReadonlyArray<OverlaySegment> }) {
    return <span>{renderLine(segments)}</span>;
  },
  (before, after) => sameSegments(before.segments, after.segments),
);

/** How many lines one `LineBlock` holds. */
const LINES_PER_BLOCK = 64;

/** `lines` in runs of `size`, the last one shorter. */
export function blockLines<T>(lines: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> {
  const out: Array<ReadonlyArray<T>> = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}

/** Consecutive overlay lines, no wrapper element. Untouched blocks keep identity so a hover rebuilds only the block it hits. */
const LineBlock = React.memo(function LineBlock({ lines }: { lines: ReadonlyArray<OverlayLineData> }) {
  return <>{lines.map((line, i) => <OverlayLine key={i} segments={line.segments} />)}</>;
});

/** Turns one line's segmentation into the overlay's nodes. */
function renderLine(segments: ReadonlyArray<OverlaySegment>): React.ReactNode {
  const out: React.ReactNode[] = [];
  for (const seg of segments) {
    // Syntax span (visible, coloured text).
    let node: React.ReactNode = seg.syntaxClassName
      ? <span className={seg.syntaxClassName}>{seg.text}</span>
      : seg.text;

    // Mark wraps the segment to add background / underline. `mark`
    // never overrides the inner text colour.
    if (seg.mark) {
      node = (
        <mark className={seg.mark.className} title={seg.mark.message ?? undefined}>
          {node}
        </mark>
      );
    }
    out.push(<React.Fragment key={seg.start}>{node}</React.Fragment>);
  }
  return out;
}

/**
 * Textarea with an absolutely-positioned `pre` overlay underneath. The
 * overlay paints both the syntax-highlighted source AND the mark
 * backgrounds (errors, mismatches, references, linked). The textarea on
 * top has transparent text so only its caret + selection are visible —
 * everything the user sees as "the code" comes from the overlay. Scroll
 * is mirrored so the colour stays glued to the bytes.
 */
function CddlEditorInner(
  {
    value,
    onChange,
    marks: rawMarks,
    hoverMark,
    onHoverOffset,
    onSymbolClick,
    onLinkClick,
    onPinAtOffset,
    canPinAt,
    onCaretMove,
    ruleNames,
  }: CddlEditorProps,
  ref: React.Ref<CddlEditorHandle>,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);
  // Restore selection after an edit that bypassed the browser undo pipeline.
  const pendingSelection = useRef<[number, number] | null>(null);
  const [markTip, setMarkTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const tipFrame = useRef<number | null>(null);
  // Set by Escape, consumed by the next Tab so focus can leave.
  const tabLeaves = useRef(false);

  useImperativeHandle(ref, () => {
    // Wrap-aware scroll: newline*lineHeight drifts; measureOffsetTop uses a mirror.
    const scrollTo = (ta: HTMLTextAreaElement, start: number) => {
      const top = measureOffsetTop(ta, start);
      const target = Math.max(0, top - ta.clientHeight / 3);
      ta.scrollTop = target;
      if (overlayRef.current) overlayRef.current.scrollTop = target;
    };
    return {
      reveal([start, end]) {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        try { ta.setSelectionRange(start, end); } catch { /* invalid range */ }
        scrollTo(ta, start);
      },
      scrollTo([start]) {
        if (taRef.current) scrollTo(taRef.current, start);
      },
      scrollToTop() {
        if (taRef.current) taRef.current.scrollTop = 0;
        if (overlayRef.current) overlayRef.current.scrollTop = 0;
      },
    };
  }, []);

  const syncScroll = useCallback(() => {
    if (taRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = taRef.current.scrollTop;
      overlayRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }, []);

  // Pad the overlay by the textarea's classic scrollbar width so wrap columns stay aligned. Written on the element so the memoised overlay is not rebuilt.
  useLayoutEffect(() => {
    const ta = taRef.current;
    const overlayEl = overlayRef.current;
    if (!ta || !overlayEl) return;
    // Reset before adding so padding does not compound.
    overlayEl.style.paddingRight = "";
    const authored = parseFloat(window.getComputedStyle(overlayEl).paddingRight) || 0;
    // Border is 0 on the textarea, so the whole difference is the scrollbar.
    const gutter = Math.max(0, ta.offsetWidth - ta.clientWidth);
    if (gutter > 0) overlayEl.style.paddingRight = `${authored + gutter}px`;
  }, [value]);

  // Re-sync if value or marks change (so overlay redraws then scrolls to match).
  useEffect(() => { syncScroll(); }, [value, rawMarks, syncScroll]);

  // Put the caret back where the edit left it once the new text has landed.
  useEffect(() => {
    const sel = pendingSelection.current;
    if (!sel) return;
    pendingSelection.current = null;
    const ta = taRef.current;
    if (!ta || ta.value !== value) return;
    try { ta.setSelectionRange(sel[0], sel[1]); } catch { /* invalid range */ }
  }, [value]);

  useEffect(() => () => {
    if (tipFrame.current !== null) cancelAnimationFrame(tipFrame.current);
  }, []);

  // Tokenize once per (value, ruleNames) — cheap regex pass; cached.
  const syntaxRuns = useMemo(
    () => tokenizeCddl(value, { ruleNames }),
    [value, ruleNames],
  );

  const marks = useMemo<NormalisedMark[]>(
    () => normaliseMarks(rawMarks, value.length),
    [rawMarks, value],
  );

  const lines = useMemo(
    () => overlayLines(value, syntaxRuns, marks),
    [value, syntaxRuns, marks],
  );

  const blocks = useMemo(() => blockLines(lines, LINES_PER_BLOCK), [lines]);

  // Hover is layered after segmentation so untouched blocks keep identity.
  const hoverNormalised = useMemo<NormalisedMark | null>(
    () => (hoverMark ? normaliseMarks([hoverMark], value.length)[0] ?? null : null),
    [hoverMark, value],
  );
  const layered = useMemo(
    () => (hoverNormalised ? blocks.map((block) => layerMark(block, hoverNormalised)) : blocks),
    [blocks, hoverNormalised],
  );

  // Memo the overlay element so unrelated re-renders skip the subtree.
  const overlay = useMemo(
    () => (
      <pre ref={overlayRef} className="cddl-editor-overlay" aria-hidden>
        {layered.map((block, i) => <LineBlock key={i} lines={block} />)}
        {needsPhantomNewline(value) ? "\n" : null}
      </pre>
    ),
    [layered, value],
  );

  // Cmd/Ctrl = jump to definition. Alt = pin matching CBOR (not on every caret move).
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

  // Right-click → cross-panel pin. Caret is already at the click; suppress the native menu only when there is something to pin.
  const handleContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (!onPinAtOffset) return;
    const ta = e.currentTarget;
    const offset = ta.selectionStart;
    if (canPinAt && !canPinAt(offset)) return;
    e.preventDefault();
    ta.focus();
    onPinAtOffset(offset);
  };

  const reportCaret = () => {
    if (!onCaretMove) return;
    const ta = taRef.current;
    if (ta) onCaretMove(ta.selectionStart);
  };

  // Prefer execCommand so the edit lands on the textarea undo stack; otherwise onChange and restore the selection.
  const applyEdit = (ta: HTMLTextAreaElement, edit: EditorEdit) => {
    const [selStart, selEnd] = edit.selection;
    ta.focus();
    ta.setSelectionRange(edit.from, edit.to);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, edit.text);
    } catch { inserted = false; }
    if (inserted) {
      try { ta.setSelectionRange(selStart, selEnd); } catch { /* invalid range */ }
      reportCaret();
      return;
    }
    pendingSelection.current = edit.selection;
    onChange(value.slice(0, edit.from) + edit.text + value.slice(edit.to));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (e.key === "Escape") {
      tabLeaves.current = true;
      return;
    }
    if (e.key === "Tab") {
      // Tab types an indent here, so Escape-then-Tab is what moves focus on.
      if (tabLeaves.current || e.metaKey || e.ctrlKey || e.altKey) {
        tabLeaves.current = false;
        return;
      }
      const edit = indentEdit(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
      if (!edit) return;
      e.preventDefault();
      applyEdit(ta, edit);
      return;
    }
    tabLeaves.current = false;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const edit = newlineEdit(ta.value, ta.selectionStart, ta.selectionEnd);
      // Nothing to carry over — let the browser insert the newline itself.
      if (edit.text === "\n" && ta.selectionStart === ta.selectionEnd) return;
      e.preventDefault();
      applyEdit(ta, edit);
    }
  };

  // Tooltip via mark rects on the next frame; hover offset on the event — see `pointerMove`.
  const handleMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    pointerMove(
      tipFrame,
      e.clientX,
      e.clientY,
      (x, y) => {
        if (onHoverOffset) onHoverOffset(charOffsetFromPoint(ta, overlayRef.current, lines, x, y));
      },
      (x, y) => {
        const text = overlayRef.current ? markTitleAt(overlayRef.current, x, y) : null;
        setMarkTip(prev => {
          if (!text) return prev === null ? prev : null;
          if (prev && prev.text === text && prev.x === x && prev.y === y) return prev;
          return { x, y, text };
        });
      },
      (callback) => requestAnimationFrame(callback),
    );
  };
  const clearMarkTip = () => {
    if (tipFrame.current !== null) {
      cancelAnimationFrame(tipFrame.current);
      tipFrame.current = null;
    }
    onHoverOffset?.(null);
    setMarkTip(null);
  };

  return (
    <div className="cddl-editor-wrap">
      {overlay}
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
        onKeyDown={handleKeyDown}
        onKeyUp={reportCaret}
        onMouseMove={handleMouseMove}
        onMouseLeave={clearMarkTip}
        aria-label="CDDL schema"
        placeholder="; Paste or type a CDDL schema here"
      />
      {markTip && (
        <div
          className="cddl-mark-tip"
          style={{ left: Math.min(markTip.x + 12, window.innerWidth - 300), top: markTip.y + 18 }}
          role="tooltip"
        >
          {markTip.text}
        </div>
      )}
    </div>
  );
}

const CddlEditor = forwardRef<CddlEditorHandle, CddlEditorProps>(CddlEditorInner);
CddlEditor.displayName = "CddlEditor";
export default CddlEditor;
