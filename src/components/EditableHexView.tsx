"use client";

import { useRef, useEffect, useCallback, useLayoutEffect, useState } from "react";
import type { CborValue, CborPosition } from "@cardananium/cquisitor-lib";

// Colors for CBOR syntax highlighting
const CBOR_COLORS = [
  "rgba(99, 102, 241, 0.25)",
  "rgba(236, 72, 153, 0.25)",
  "rgba(34, 197, 94, 0.25)",
  "rgba(249, 115, 22, 0.25)",
  "rgba(14, 165, 233, 0.25)",
  "rgba(168, 85, 247, 0.25)",
  "rgba(234, 179, 8, 0.3)",
  "rgba(20, 184, 166, 0.25)",
];

const HOVER_COLOR = "rgba(250, 204, 21, 0.5)";
const FOCUS_COLOR = "rgba(239, 68, 68, 0.4)";

interface HighlightedSpan {
  start: number;
  end: number;
  colorIndex: number;
  label: string; // CBOR type label for tooltip
  path: string; // Path like "array → map → uint8"
}

interface HexContextMenuState {
  x: number;
  y: number;
  charPosition: number; // Position in hex string (char index)
  selectedText: string; // Currently selected text
  chunkPosition: CborPosition | null; // The CBOR chunk at this position
}

interface EditableHexViewProps {
  value: string;
  onChange: (value: string) => void;
  hexValue: string;
  cborData: CborValue | null;
  hoverPosition: CborPosition | null;
  focusPosition: CborPosition | null;
  onHoverPath?: (path: string | null) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onShowInTree?: (position: CborPosition) => void;
  placeholder?: string;
}

// Format value for display (same logic as CborTreeView)
function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") return String(val);
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (val instanceof Uint8Array || (Array.isArray(val) && val.every(v => typeof v === "number"))) {
    const arr = val instanceof Uint8Array ? Array.from(val) : val as number[];
    return arr.map(b => b.toString(16).padStart(2, "0")).join("");
  }
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    if ("value" in obj) {
      return formatValue(obj.value);
    }
    try {
      return JSON.stringify(val);
    } catch {
      return "[object]";
    }
  }
  return String(val);
}

function getTypeLabel(value: CborValue): string {
  if (!("type" in value) || typeof value.type !== "string") {
    return "value";
  }

  const rawValue = (value as { value?: unknown }).value;

  switch (value.type) {
    // Complex types
    case "Array": {
      const count = value.items === "Indefinite" ? "∞" : value.items;
      return `array (${count} items)`;
    }
    case "Map": {
      const count = value.items === "Indefinite" ? "∞" : value.items;
      return `map (${count} entries)`;
    }
    case "Tag":
      return `tag #${value.tag}`;
    case "IndefiniteLengthString":
      return `text (indefinite, ${value.chunks.length} chunks)`;
    case "IndefiniteLengthBytes":
      return `bytes (indefinite, ${value.chunks.length} chunks)`;
    
    // Simple types (CborSimpleType)
    case "Null": return "null";
    case "Undefined": return "undefined";
    case "Bool": return `bool: ${formatValue(rawValue)}`;
    case "U8": return `uint8: ${formatValue(rawValue)}`;
    case "U16": return `uint16: ${formatValue(rawValue)}`;
    case "U32": return `uint32: ${formatValue(rawValue)}`;
    case "U64": return `uint64: ${formatValue(rawValue)}`;
    case "I8": return `nint8: ${formatValue(rawValue)}`;
    case "I16": return `nint16: ${formatValue(rawValue)}`;
    case "I32": return `nint32: ${formatValue(rawValue)}`;
    case "I64": return `nint64: ${formatValue(rawValue)}`;
    case "Int": return `bigint: ${formatValue(rawValue)}`;
    case "F16": return `float16: ${formatValue(rawValue)}`;
    case "F32": return `float32: ${formatValue(rawValue)}`;
    case "F64": return `float64: ${formatValue(rawValue)}`;
    case "Bytes": {
      const hex = formatValue(rawValue);
      return `bytes (${hex.length / 2} bytes)`;
    }
    case "String": {
      const str = formatValue(rawValue);
      const preview = str.length > 30 ? str.slice(0, 30) + "..." : str;
      return `text: ${preview}`;
    }
    case "Simple": return `simple(${formatValue(rawValue)})`;
    case "Break": return "break";
    default: return String((value as { type: string }).type).toLowerCase();
  }
}

// Get short type name for path display
function getShortTypeName(value: CborValue): string {
  if (!("type" in value) || typeof value.type !== "string") return "?";
  
  switch (value.type) {
    case "Array": return "array";
    case "Map": return "map";
    case "Tag": return `tag#${value.tag}`;
    case "IndefiniteLengthString": return "tstr~";
    case "IndefiniteLengthBytes": return "bytes~";
    case "Null": return "null";
    case "Undefined": return "undefined";
    case "Bool": return "bool";
    case "U8": return "uint8";
    case "U16": return "uint16";
    case "U32": return "uint32";
    case "U64": return "uint64";
    case "I8": return "nint8";
    case "I16": return "nint16";
    case "I32": return "nint32";
    case "I64": return "nint64";
    case "Int": return "bigint";
    case "F16": return "float16";
    case "F32": return "float32";
    case "F64": return "float64";
    case "Bytes": return "bytes";
    case "String": return "tstr";
    case "Simple": return "simple";
    case "Break": return "break";
    default: return String((value as { type: string }).type).toLowerCase();
  }
}

interface ChunkInfo {
  position: CborPosition;
  label: string;
  path: string;
}

function collectPositions(
  value: CborValue,
  spans: HighlightedSpan[],
  colorCounter: { value: number },
  path: string[] = []
): void {
  if (!value || typeof value !== "object") return;

  const currentPath = [...path, getShortTypeName(value)];
  const posInfo = value.position_info;
  
  if (posInfo && typeof posInfo.offset === "number" && typeof posInfo.length === "number") {
    spans.push({
      start: posInfo.offset * 2,
      end: (posInfo.offset + posInfo.length) * 2,
      colorIndex: colorCounter.value % CBOR_COLORS.length,
      label: getTypeLabel(value),
      path: currentPath.join(" → "),
    });
    colorCounter.value++;
  }

  if ("values" in value && Array.isArray(value.values)) {
    if ("type" in value && value.type === "Map") {
      for (const item of value.values as { key: CborValue; value: CborValue }[]) {
        collectPositions(item.key, spans, colorCounter, currentPath);
        collectPositions(item.value, spans, colorCounter, currentPath);
      }
    } else {
      for (const item of value.values as CborValue[]) {
        collectPositions(item, spans, colorCounter, currentPath);
      }
    }
  }

  if ("value" in value && typeof value.value === "object" && value.value !== null) {
    collectPositions(value.value as CborValue, spans, colorCounter, currentPath);
  }

  if ("chunks" in value && Array.isArray(value.chunks)) {
    for (const chunk of value.chunks) {
      collectPositions(chunk, spans, colorCounter, currentPath);
    }
  }
}

// Collect all chunk positions for context menu
function collectChunkPositions(
  value: CborValue,
  chunks: ChunkInfo[],
  path: string[] = []
): void {
  if (!value || typeof value !== "object") return;

  const currentPath = [...path, getShortTypeName(value)];
  const posInfo = value.position_info;
  
  if (posInfo && typeof posInfo.offset === "number" && typeof posInfo.length === "number") {
    chunks.push({
      position: posInfo,
      label: getTypeLabel(value),
      path: currentPath.join(" → "),
    });
  }

  if ("values" in value && Array.isArray(value.values)) {
    if ("type" in value && value.type === "Map") {
      for (const item of value.values as { key: CborValue; value: CborValue }[]) {
        collectChunkPositions(item.key, chunks, currentPath);
        collectChunkPositions(item.value, chunks, currentPath);
      }
    } else {
      for (const item of value.values as CborValue[]) {
        collectChunkPositions(item, chunks, currentPath);
      }
    }
  }

  if ("value" in value && typeof value.value === "object" && value.value !== null) {
    collectChunkPositions(value.value as CborValue, chunks, currentPath);
  }

  if ("chunks" in value && Array.isArray(value.chunks)) {
    for (const chunk of value.chunks) {
      collectChunkPositions(chunk, chunks, currentPath);
    }
  }
}

// Find the smallest (most specific) chunk containing a given hex character position
function findChunkAtPosition(charPos: number, cborData: CborValue | null): CborPosition | null {
  if (!cborData) return null;
  
  const chunks: ChunkInfo[] = [];
  collectChunkPositions(cborData, chunks);
  
  // Convert char position to byte position
  const bytePos = Math.floor(charPos / 2);
  
  // Find all chunks containing this position
  const containing = chunks.filter(chunk => {
    const start = chunk.position.offset;
    const end = chunk.position.offset + chunk.position.length;
    return bytePos >= start && bytePos < end;
  });
  
  if (containing.length === 0) return null;
  
  // Return the smallest (most specific) chunk
  containing.sort((a, b) => a.position.length - b.position.length);
  return containing[0].position;
}

// Save and restore cursor position
function saveSelection(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

function restoreSelection(el: HTMLElement, pos: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  
  let charCount = 0;
  const nodeStack: Node[] = [el];
  let node: Node | undefined;
  let foundStart = false;
  
  while (!foundStart && (node = nodeStack.pop())) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textLen = (node.textContent || "").length;
      if (charCount + textLen >= pos) {
        const range = document.createRange();
        range.setStart(node, pos - charCount);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        foundStart = true;
      } else {
        charCount += textLen;
      }
    } else {
      const children = node.childNodes;
      for (let i = children.length - 1; i >= 0; i--) {
        nodeStack.push(children[i]);
      }
    }
  }
}

// Context menu portal with smart positioning
function HexContextMenuPortal({ 
  x, 
  y, 
  onClose, 
  children 
}: { 
  x: number; 
  y: number; 
  onClose: () => void; 
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const frame = requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = x;
      let top = y;

      if (x + menuRect.width > viewportWidth - 10) {
        left = x - menuRect.width;
      }
      if (y + menuRect.height > viewportHeight - 10) {
        top = viewportHeight - menuRect.height - 10;
      }
      if (left < 10) left = 10;
      if (top < 10) top = 10;

      if (left !== x || top !== y) {
        setPosition({ left, top });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [x, y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="hex-context-menu"
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
      }}
    >
      {children}
    </div>
  );
}

export default function EditableHexView({
  value,
  onChange,
  hexValue,
  cborData,
  hoverPosition,
  focusPosition,
  onHoverPath,
  onKeyDown,
  onShowInTree,
  placeholder = "Paste CBOR hex or base64 here...",
}: EditableHexViewProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const cursorPosRef = useRef<number>(0);
  const isUserTypingRef = useRef<boolean>(false);
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<HexContextMenuState | null>(null);
  
  // Undo/Redo history
  const historyRef = useRef<{ text: string; cursor: number }[]>([{ text: "", cursor: 0 }]);
  const historyIndexRef = useRef<number>(0);
  const isUndoRedoRef = useRef<boolean>(false);
  
  // Store position -> path mapping for hover detection
  const positionPathsRef = useRef<Map<number, string>>(new Map());

  // Save to history (debounced to avoid saving every keystroke)
  const saveToHistory = useCallback((text: string, cursor: number) => {
    if (isUndoRedoRef.current) return;
    
    const history = historyRef.current;
    const currentIndex = historyIndexRef.current;
    
    // Remove any future history if we're not at the end
    if (currentIndex < history.length - 1) {
      history.splice(currentIndex + 1);
    }
    
    // Don't save if same as last entry
    if (history.length > 0 && history[history.length - 1].text === text) {
      return;
    }
    
    // Add new entry
    history.push({ text, cursor });
    
    // Keep history size reasonable
    if (history.length > 100) {
      history.shift();
    } else {
      historyIndexRef.current = history.length - 1;
    }
  }, []);

  // Handle input
  const handleInput = useCallback(() => {
    if (editorRef.current) {
      // Mark that user is typing (to prevent React from overwriting content)
      isUserTypingRef.current = true;
      // Save cursor position BEFORE triggering state update
      cursorPosRef.current = saveSelection(editorRef.current);
      const text = editorRef.current.textContent || "";
      
      // Save to history
      saveToHistory(text, cursorPosRef.current);
      
      onChange(text);
      // Reset flag after a small delay
      setTimeout(() => {
        isUserTypingRef.current = false;
      }, 0);
    }
  }, [onChange, saveToHistory]);

  // Handle paste - get plain text only
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  // Handle keyboard shortcuts (undo/redo)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Undo: Ctrl+Z or Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      const history = historyRef.current;
      const currentIndex = historyIndexRef.current;
      
      if (currentIndex > 0) {
        isUndoRedoRef.current = true;
        historyIndexRef.current = currentIndex - 1;
        const entry = history[currentIndex - 1];
        
        if (editorRef.current) {
          editorRef.current.textContent = entry.text;
          restoreSelection(editorRef.current, entry.cursor);
        }
        onChange(entry.text);
        
        setTimeout(() => {
          isUndoRedoRef.current = false;
        }, 0);
      }
      return;
    }
    
    // Redo: Ctrl+Shift+Z or Cmd+Shift+Z or Ctrl+Y
    if (((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) || 
        ((e.ctrlKey || e.metaKey) && e.key === "y")) {
      e.preventDefault();
      const history = historyRef.current;
      const currentIndex = historyIndexRef.current;
      
      if (currentIndex < history.length - 1) {
        isUndoRedoRef.current = true;
        historyIndexRef.current = currentIndex + 1;
        const entry = history[currentIndex + 1];
        
        if (editorRef.current) {
          editorRef.current.textContent = entry.text;
          restoreSelection(editorRef.current, entry.cursor);
        }
        onChange(entry.text);
        
        setTimeout(() => {
          isUndoRedoRef.current = false;
        }, 0);
      }
      return;
    }
    
    // Pass through to parent handler
    onKeyDown?.(e);
  }, [onChange, onKeyDown]);

  // Scroll to focused element
  useEffect(() => {
    if (focusPosition && editorRef.current) {
      // Small delay to let React render the new content first
      setTimeout(() => {
        const focusTarget = editorRef.current?.querySelector('[data-focus-target="true"]');
        if (focusTarget) {
          focusTarget.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 50);
    }
  }, [focusPosition]);

  const isEmpty = !value && !hexValue;
  
  // Check if current input matches the decoded hex
  const normalizedInput = value.replace(/\s/g, "").toLowerCase();
  const inputMatchesHex = hexValue && normalizedInput === hexValue;
  const showHighlighted = cborData && inputMatchesHex;
  
  // Track last rendered state to detect transitions
  const lastRenderedRef = useRef<{ showHighlighted: boolean; hexValue: string }>({ 
    showHighlighted: false, 
    hexValue: "" 
  });

  // Build HTML string for highlighted content
  const buildHighlightedHTML = useCallback((): string => {
    if (!cborData || !hexValue) return "";
    
    const spans: HighlightedSpan[] = [];
    const colorCounter = { value: 0 };
    collectPositions(cborData, spans, colorCounter);

    const positionColors: Map<number, { colorIndex: number; isHover: boolean; isFocus: boolean; label: string; path: string }> = new Map();
    
    for (const span of spans) {
      for (let i = span.start; i < span.end && i < hexValue.length; i++) {
        if (!positionColors.has(i)) {
          positionColors.set(i, { colorIndex: span.colorIndex, isHover: false, isFocus: false, label: span.label, path: span.path });
        }
      }
    }

    // Apply hover
    if (hoverPosition && typeof hoverPosition.offset === "number" && typeof hoverPosition.length === "number") {
      const start = hoverPosition.offset * 2;
      const end = (hoverPosition.offset + hoverPosition.length) * 2;
      for (let i = start; i < end && i < hexValue.length; i++) {
        const existing = positionColors.get(i);
        positionColors.set(i, { 
          colorIndex: existing?.colorIndex ?? 0, 
          isHover: true, 
          isFocus: false,
          label: existing?.label ?? "",
          path: existing?.path ?? "",
        });
      }
    }

    // Apply focus
    if (focusPosition && typeof focusPosition.offset === "number" && typeof focusPosition.length === "number") {
      const start = focusPosition.offset * 2;
      const end = (focusPosition.offset + focusPosition.length) * 2;
      for (let i = start; i < end && i < hexValue.length; i++) {
        const existing = positionColors.get(i);
        positionColors.set(i, { 
          colorIndex: existing?.colorIndex ?? 0, 
          isHover: existing?.isHover ?? false, 
          isFocus: true,
          label: existing?.label ?? "",
          path: existing?.path ?? "",
        });
      }
    }

    // Build position -> path mapping for hover detection
    const newPathMap = new Map<number, string>();
    for (const [pos, info] of positionColors) {
      if (info.path) {
        newPathMap.set(pos, info.path);
      }
    }
    positionPathsRef.current = newPathMap;

    // Build HTML string
    let html = "";
    let i = 0;
    while (i < hexValue.length) {
      const colorInfo = positionColors.get(i);
      let j = i + 1;
      const isSpecialHighlight = colorInfo?.isHover || colorInfo?.isFocus;
      
      while (j < hexValue.length) {
        const nextColor = positionColors.get(j);
        if (colorInfo?.isHover !== nextColor?.isHover || colorInfo?.isFocus !== nextColor?.isFocus) break;
        if (!isSpecialHighlight) {
          if (colorInfo?.colorIndex !== nextColor?.colorIndex || colorInfo?.label !== nextColor?.label) break;
        }
        j++;
      }

      const segment = hexValue.slice(i, j);
      let backgroundColor: string | undefined;

      if (colorInfo?.isFocus) {
        backgroundColor = FOCUS_COLOR;
      } else if (colorInfo?.isHover) {
        backgroundColor = HOVER_COLOR;
      } else if (colorInfo?.colorIndex !== undefined) {
        backgroundColor = CBOR_COLORS[colorInfo.colorIndex];
      }

      if (backgroundColor) {
        const className = colorInfo?.isFocus ? "hex-focus-highlight" : colorInfo?.isHover ? "hex-hover-highlight" : "";
        const isFocusStart = colorInfo?.isFocus && focusPosition && i === focusPosition.offset * 2;
        // Add data-pos for hover path detection
        html += `<span class="${className}" style="background-color:${backgroundColor};border-radius:2px" title="${colorInfo?.label || ""}" data-pos="${i}"${isFocusStart ? ' data-focus-target="true"' : ''}>${segment}</span>`;
      } else {
        html += segment;
      }
      i = j;
    }
    return html;
  }, [cborData, hexValue, hoverPosition, focusPosition]);

  // Update DOM using useLayoutEffect (runs before paint)
  useLayoutEffect(() => {
    if (!editorRef.current) return;
    
    const last = lastRenderedRef.current;
    const isHighlighted = Boolean(showHighlighted);
    const isFocused = document.activeElement === editorRef.current;
    
    if (isHighlighted) {
      // Render highlighted HTML
      const html = buildHighlightedHTML();
      if (editorRef.current.innerHTML !== html) {
        const cursorPos = isFocused ? saveSelection(editorRef.current) : 0;
        editorRef.current.innerHTML = html;
        if (isFocused) {
          // Restore cursor - use saved position from handleInput if typing, otherwise use local
          const posToRestore = isUserTypingRef.current ? cursorPosRef.current : cursorPos;
          restoreSelection(editorRef.current, posToRestore);
        }
      }
    } else if (last.showHighlighted && !isHighlighted) {
      // Transitioning from highlighted to plain - set text content
      const cursorPos = isFocused ? cursorPosRef.current : 0;
      editorRef.current.textContent = value;
      if (isFocused) {
        restoreSelection(editorRef.current, cursorPos);
      }
    }
    
    lastRenderedRef.current = { showHighlighted: isHighlighted, hexValue };
  }, [showHighlighted, hexValue, hoverPosition, focusPosition, value, buildHighlightedHTML]);

  // Handle clear
  useEffect(() => {
    if (editorRef.current && value === "" && !showHighlighted) {
      editorRef.current.textContent = "";
    }
  }, [value, showHighlighted]);

  // Handle mouse move for path detection
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!onHoverPath) return;
    
    const target = e.target as HTMLElement;
    const posAttr = target.getAttribute?.("data-pos");
    
    if (posAttr !== null) {
      const pos = parseInt(posAttr, 10);
      const path = positionPathsRef.current.get(pos);
      onHoverPath(path || null);
    } else {
      onHoverPath(null);
    }
  }, [onHoverPath]);

  const handleMouseLeave = useCallback(() => {
    onHoverPath?.(null);
  }, [onHoverPath]);

  // Get current selection text
  const getSelectedText = useCallback((): string => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    return selection.toString();
  }, []);

  // Get cursor position in the hex string
  const getCursorCharPosition = useCallback((e: React.MouseEvent): number => {
    const target = e.target as HTMLElement;
    const posAttr = target.getAttribute?.("data-pos");
    if (posAttr !== null) {
      return parseInt(posAttr, 10);
    }
    // Fallback: try to calculate from cursor position
    if (editorRef.current) {
      return saveSelection(editorRef.current);
    }
    return 0;
  }, []);

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    
    const selectedText = getSelectedText();
    const charPosition = getCursorCharPosition(e);
    const chunkPosition = findChunkAtPosition(charPosition, cborData);
    
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      charPosition,
      selectedText,
      chunkPosition,
    });
  }, [getSelectedText, getCursorCharPosition, cborData]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Copy chunk hex
  const handleCopyChunk = useCallback(() => {
    if (contextMenu?.chunkPosition && hexValue) {
      const start = contextMenu.chunkPosition.offset * 2;
      const end = (contextMenu.chunkPosition.offset + contextMenu.chunkPosition.length) * 2;
      const chunkHex = hexValue.slice(start, end);
      navigator.clipboard.writeText(chunkHex);
    }
    closeContextMenu();
  }, [contextMenu, hexValue, closeContextMenu]);

  // Copy selected text
  const handleCopySelected = useCallback(() => {
    if (contextMenu?.selectedText) {
      navigator.clipboard.writeText(contextMenu.selectedText);
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  // Paste
  const handlePasteFromMenu = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (editorRef.current) {
        editorRef.current.focus();
        document.execCommand("insertText", false, text);
      }
    } catch {
      // Clipboard access denied
    }
    closeContextMenu();
  }, [closeContextMenu]);

  // Show in tree
  const handleShowInTree = useCallback(() => {
    if (contextMenu?.chunkPosition && onShowInTree) {
      onShowInTree(contextMenu.chunkPosition);
    }
    closeContextMenu();
  }, [contextMenu, onShowInTree, closeContextMenu]);

  // Check if we have a valid selection (more than just partial chunk)
  const hasSelection = contextMenu?.selectedText && contextMenu.selectedText.length > 0;
  const hasChunk = contextMenu?.chunkPosition !== null;

  return (
    <div 
      className="editable-hex-container"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={editorRef}
        className={`editable-hex-view ${isEmpty ? "is-empty" : ""}`}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        data-placeholder={placeholder}
        spellCheck={false}
      />
      
      {/* Context Menu */}
      {contextMenu && (
        <HexContextMenuPortal x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu}>
          {hasChunk && (
            <button onClick={handleCopyChunk}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Chunk
            </button>
          )}
          {hasSelection && (
            <button onClick={handleCopySelected}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Selection
            </button>
          )}
          <button onClick={handlePasteFromMenu}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            Paste
          </button>
          {hasChunk && onShowInTree && (
            <button onClick={handleShowInTree}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Show in Tree
            </button>
          )}
        </HexContextMenuPortal>
      )}
    </div>
  );
}
