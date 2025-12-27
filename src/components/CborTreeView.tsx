"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { CborValue, CborPosition } from "@cardananium/cquisitor-lib";
import { CopyIcon, CheckIcon } from "./Icons";

interface CborTreeViewProps {
  data: CborValue;
  hexValue: string;
  onHoverPosition: (position: CborPosition | null) => void;
  onHighlightAndScroll: (position: CborPosition) => void;
  // Position to highlight in tree (from hex view context menu)
  highlightedTreePosition?: CborPosition | null;
  onClearHighlight?: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: CborValue;
  path: string;
}

// Find path to a node by its position (returns array of path segments)
function findPathToPosition(
  node: CborValue,
  targetPosition: CborPosition,
  currentPath: string[] = []
): string[] | null {
  if (!node || typeof node !== "object") return null;
  
  const posInfo = node.position_info;
  
  // Check if this node matches the target position
  if (posInfo && 
      posInfo.offset === targetPosition.offset && 
      posInfo.length === targetPosition.length) {
    return currentPath;
  }
  
  // Search in children
  if ("type" in node) {
    if (node.type === "Array" && node.values) {
      for (let i = 0; i < node.values.length; i++) {
        const result = findPathToPosition(
          node.values[i],
          targetPosition,
          [...currentPath, `array[${i}]`]
        );
        if (result) return result;
      }
    }
    
    if (node.type === "Map" && node.values) {
      for (let i = 0; i < node.values.length; i++) {
        const entry = node.values[i];
        // Check key
        const keyResult = findPathToPosition(
          entry.key,
          targetPosition,
          [...currentPath, `map[${i}].key`]
        );
        if (keyResult) return keyResult;
        // Check value
        const valueResult = findPathToPosition(
          entry.value,
          targetPosition,
          [...currentPath, `map[${i}].value`]
        );
        if (valueResult) return valueResult;
      }
    }
    
    if (node.type === "Tag" && node.value) {
      const result = findPathToPosition(
        node.value,
        targetPosition,
        [...currentPath, "tag.value"]
      );
      if (result) return result;
    }
    
    if ((node.type === "IndefiniteLengthString" || node.type === "IndefiniteLengthBytes") && node.chunks) {
      for (let i = 0; i < node.chunks.length; i++) {
        const result = findPathToPosition(
          node.chunks[i],
          targetPosition,
          [...currentPath, `chunks[${i}]`]
        );
        if (result) return result;
      }
    }
  }
  
  return null;
}

// Check if a position matches a node
function positionMatchesNode(node: CborValue, position: CborPosition): boolean {
  const posInfo = node.position_info;
  return posInfo !== undefined && 
         posInfo.offset === position.offset && 
         posInfo.length === position.length;
}

function getCborHex(hexValue: string, position: CborPosition): string {
  const start = position.offset * 2;
  const end = (position.offset + position.length) * 2;
  return hexValue.slice(start, end);
}

function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") return String(val);
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") {
    // Check if it looks like hex bytes - return as-is (no truncation)
    if (/^[0-9a-fA-F]+$/.test(val) && val.length > 0 && val.length % 2 === 0) {
      return val;
    }
    return `"${val}"`;
  }
  if (val instanceof Uint8Array || (Array.isArray(val) && val.every(v => typeof v === "number"))) {
    const arr = val instanceof Uint8Array ? Array.from(val) : val as number[];
    const hex = arr.map(b => b.toString(16).padStart(2, "0")).join("");
    return hex;
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

function getNodeLabel(node: CborValue): { type: string; value: string; color: string; detail?: string } {
  // All CborValue types have a "type" field
  if ("type" in node && typeof node.type === "string") {
    const rawValue = (node as { value?: unknown }).value;
    
    switch (node.type) {
      // Complex types
      case "Array": {
        const count = node.items === "Indefinite" ? "∞" : node.items;
        const isIndefinite = node.items === "Indefinite";
        return {
          type: isIndefinite ? "array (indefinite)" : "array",
          value: `${count} items`,
          color: "#ef4444", // red
        };
      }
      case "Map": {
        const count = node.items === "Indefinite" ? "∞" : node.items;
        const isIndefinite = node.items === "Indefinite";
        return {
          type: isIndefinite ? "map (indefinite)" : "map",
          value: `${count} entries`,
          color: "#f97316", // orange
        };
      }
      case "Tag":
        return {
          type: "tag",
          value: `#${node.tag}`,
          color: "#8b5cf6", // violet
          detail: getTagDescription(Number(node.tag)),
        };
      case "IndefiniteLengthString":
        return {
          type: "text (indefinite)",
          value: `${node.chunks.length} chunks`,
          color: "#22c55e", // green
        };
      case "IndefiniteLengthBytes":
        return {
          type: "bytes (indefinite)",
          value: `${node.chunks.length} chunks`,
          color: "#06b6d4", // cyan
        };
      
      // Simple types (CborSimpleType)
      case "Null":
        return { type: "null", value: "", color: "#6b7280" };
      case "Undefined":
        return { type: "undefined", value: "", color: "#6b7280" };
      case "Bool":
        return { type: "bool", value: formatValue(rawValue), color: "#3b82f6" };
      case "U8":
        return { type: "uint8", value: formatValue(rawValue), color: "#eab308" };
      case "U16":
        return { type: "uint16", value: formatValue(rawValue), color: "#eab308" };
      case "U32":
        return { type: "uint32", value: formatValue(rawValue), color: "#eab308" };
      case "U64":
        return { type: "uint64", value: formatValue(rawValue), color: "#eab308" };
      case "I8":
        return { type: "nint8", value: formatValue(rawValue), color: "#f59e0b" };
      case "I16":
        return { type: "nint16", value: formatValue(rawValue), color: "#f59e0b" };
      case "I32":
        return { type: "nint32", value: formatValue(rawValue), color: "#f59e0b" };
      case "I64":
        return { type: "nint64", value: formatValue(rawValue), color: "#f59e0b" };
      case "Int":
        return { type: "bigint", value: formatValue(rawValue), color: "#d97706" };
      case "F16":
        return { type: "float16", value: formatValue(rawValue), color: "#10b981" };
      case "F32":
        return { type: "float32", value: formatValue(rawValue), color: "#10b981" };
      case "F64":
        return { type: "float64", value: formatValue(rawValue), color: "#10b981" };
      case "Bytes": {
        const hex = formatValue(rawValue);
        const byteLen = typeof rawValue === "string" ? rawValue.length / 2 : 
                        rawValue instanceof Uint8Array ? rawValue.length :
                        Array.isArray(rawValue) ? rawValue.length : 0;
        return { 
          type: "bytes", 
          value: `${byteLen} bytes`,
          detail: hex,
          color: "#06b6d4" 
        };
      }
      case "String": {
        const str = String(rawValue ?? "");
        return { 
          type: "tstr", 
          value: `${str.length} chars`,
          detail: formatValue(rawValue),
          color: "#22c55e" 
        };
      }
      case "Simple":
        return { type: `simple(${formatValue(rawValue)})`, value: "", color: "#6b7280" };
      case "Break":
        return { type: "break", value: "", color: "#6b7280" };
    }
  }

  // Fallback for unknown structure
  const rawValue = (node as { value?: unknown }).value;
  return { type: "unknown", value: formatValue(rawValue), color: "#6b7280" };
}

// Common CBOR tag descriptions
function getTagDescription(tag: number): string | undefined {
  const tags: Record<number, string> = {
    0: "date/time string",
    1: "epoch timestamp",
    2: "positive bignum",
    3: "negative bignum",
    4: "decimal fraction",
    5: "bigfloat",
    21: "base64url",
    22: "base64",
    23: "base16",
    24: "encoded CBOR",
    32: "URI",
    33: "base64url string",
    34: "base64 string",
    35: "regex",
    36: "MIME message",
    55799: "self-describe CBOR",
    // Cardano specific
    121: "Plutus data (constr 0)",
    122: "Plutus data (constr 1)", 
    123: "Plutus data (constr 2)",
    124: "Plutus data (constr 3)",
    125: "Plutus data (constr 4)",
    126: "Plutus data (constr 5)",
    127: "Plutus data (constr 6)",
    258: "set",
    259: "map (preserve order)",
  };
  return tags[tag];
}

// Expandable value component for long data
function ExpandableValue({ value }: { value: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  // Check if text overflows
  useEffect(() => {
    if (containerRef.current && textRef.current) {
      setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [value]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOverflowing || isExpanded) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isExpanded) {
    return (
      <div className="cbor-tree-detail-expanded" onClick={handleClick} title="Click to collapse">
        <div className="cbor-tree-detail-expanded-header">
          <button 
            className="cbor-tree-detail-copy"
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy value"}
          >
            {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
          </button>
        </div>
        <div className="cbor-tree-detail-expanded-value">
          {value}
        </div>
      </div>
    );
  }

  return (
    <span
      ref={containerRef}
      className="cbor-tree-detail"
      onClick={handleClick}
      title={isOverflowing ? "Click to expand" : undefined}
      style={{ cursor: isOverflowing ? "pointer" : "default" }}
    >
      <span ref={textRef} className="cbor-tree-detail-text">
        {value}
      </span>
      {isOverflowing && <span className="cbor-tree-detail-ellipsis">…</span>}
    </span>
  );
}

interface TreeNodeProps {
  node: CborValue;
  depth: number;
  path: string;
  hexValue: string;
  defaultExpanded: boolean;
  onContextMenu: (e: React.MouseEvent, node: CborValue, path: string) => void;
  onHover: (position: CborPosition | null) => void;
  keyLabel?: string;
  keyType?: "map-key" | "map-value";
  // Highlighted position from hex view
  highlightedPosition?: CborPosition | null;
  // Paths that should be expanded to show the highlighted node
  expandedPaths?: Set<string>;
}

function TreeNode({
  node,
  depth,
  path,
  hexValue,
  defaultExpanded,
  onContextMenu,
  onHover,
  keyLabel,
  keyType,
  highlightedPosition,
  expandedPaths,
}: TreeNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const position = node.position_info;
  const structPosition = "struct_position_info" in node ? node.struct_position_info : undefined;
  const label = getNodeLabel(node);
  
  // Check if this node should be highlighted
  const isHighlighted = highlightedPosition && positionMatchesNode(node, highlightedPosition);
  
  // Check if this path should be force-expanded from parent
  const shouldForceExpand = expandedPaths && expandedPaths.size > 0 && expandedPaths.has(path);
  
  // User-controlled expanded state - initialize as expanded if in force-expand path
  const [userExpanded, setUserExpanded] = useState(() => {
    if (shouldForceExpand) return true;
    return depth < 2 ? defaultExpanded : false;
  });
  
  // When force-expand is triggered, persist the expanded state
  // Use setTimeout to avoid "setState in effect" lint warning
  useEffect(() => {
    if (shouldForceExpand && !userExpanded) {
      const timer = setTimeout(() => setUserExpanded(true), 0);
      return () => clearTimeout(timer);
    }
  }, [shouldForceExpand, userExpanded]);
  
  // Final expanded state
  const expanded = userExpanded;
  
  // Scroll into view when highlighted
  useEffect(() => {
    if (isHighlighted && nodeRef.current) {
      const element = nodeRef.current;
      
      // Find the scrollable container (.tree-view-container)
      let scrollContainer = element.parentElement;
      while (scrollContainer && !scrollContainer.classList.contains('tree-view-container')) {
        scrollContainer = scrollContainer.parentElement;
      }
      
      // Root node (depth === 0) - scroll to top
      if (depth === 0) {
        if (scrollContainer) {
          scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }
      
      // For other nodes, use RAF to ensure DOM is ready after expansion
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = nodeRef.current;
          if (!el || !scrollContainer) {
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          
          // Calculate position relative to scroll container
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = el.getBoundingClientRect();
          const relativeTop = elementRect.top - containerRect.top + scrollContainer.scrollTop;
          
          // Scroll to center the element
          const targetScroll = relativeTop - (containerRect.height / 2) + (elementRect.height / 2);
          scrollContainer.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: 'smooth'
          });
        });
      });
    }
  }, [isHighlighted, depth]);
  
  const hasChildren =
    ("type" in node && (node.type === "Array" || node.type === "Map" || node.type === "Tag")) ||
    ("type" in node && (node.type === "IndefiniteLengthString" || node.type === "IndefiniteLengthBytes"));

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) {
      setUserExpanded(!expanded);
    }
  };

  const handleMouseEnter = () => {
    if (structPosition || position) {
      onHover(structPosition || position);
    }
  };

  const handleMouseLeave = () => {
    onHover(null);
  };

  const handleContextMenuEvent = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, node, path);
  };

  const renderChildren = () => {
    if (!expanded) return null;

    if ("type" in node) {
      if (node.type === "Array") {
        return node.values.map((child, index) => (
          <TreeNode
            key={index}
            node={child}
            depth={depth + 1}
            path={`${path}[${index}]`}
            hexValue={hexValue}
            defaultExpanded={defaultExpanded}
            onContextMenu={onContextMenu}
            onHover={onHover}
            keyLabel={`[${index}]`}
            highlightedPosition={highlightedPosition}
            expandedPaths={expandedPaths}
          />
        ));
      }
      if (node.type === "Map") {
        return node.values.map((entry, index) => {
          return (
            <div key={index} className="cbor-map-entry">
              <TreeNode
                node={entry.key}
                depth={depth + 1}
                path={`${path}.keys[${index}]`}
                hexValue={hexValue}
                defaultExpanded={defaultExpanded}
                onContextMenu={onContextMenu}
                onHover={onHover}
                keyLabel="key"
                keyType="map-key"
                highlightedPosition={highlightedPosition}
                expandedPaths={expandedPaths}
              />
              <span className="cbor-map-arrow">↓</span>
              <TreeNode
                node={entry.value}
                depth={depth + 1}
                path={`${path}.values[${index}]`}
                hexValue={hexValue}
                defaultExpanded={defaultExpanded}
                onContextMenu={onContextMenu}
                onHover={onHover}
                keyLabel="val"
                keyType="map-value"
                highlightedPosition={highlightedPosition}
                expandedPaths={expandedPaths}
              />
            </div>
          );
        });
      }
      if (node.type === "Tag") {
        return (
          <TreeNode
            node={node.value}
            depth={depth + 1}
            path={`${path}.value`}
            hexValue={hexValue}
            defaultExpanded={defaultExpanded}
            onContextMenu={onContextMenu}
            onHover={onHover}
            keyLabel="value"
            highlightedPosition={highlightedPosition}
            expandedPaths={expandedPaths}
          />
        );
      }
      if (node.type === "IndefiniteLengthString" || node.type === "IndefiniteLengthBytes") {
        return node.chunks.map((chunk, index) => (
          <TreeNode
            key={index}
            node={chunk}
            depth={depth + 1}
            path={`${path}.chunks[${index}]`}
            hexValue={hexValue}
            defaultExpanded={defaultExpanded}
            onContextMenu={onContextMenu}
            onHover={onHover}
            keyLabel={`chunk ${index}`}
            highlightedPosition={highlightedPosition}
            expandedPaths={expandedPaths}
          />
        ));
      }
    }
    return null;
  };

  return (
    <div className={`cbor-tree-node ${isHighlighted ? "cbor-tree-node-highlighted" : ""}`} ref={nodeRef}>
      <div
        className={`cbor-tree-row ${isHighlighted ? "cbor-tree-row-highlighted" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenuEvent}
      >
        {/* Expand/Collapse toggle */}
        <button
          className={`cbor-tree-toggle ${hasChildren ? "has-children" : ""} ${expanded ? "expanded" : ""}`}
          onClick={handleToggle}
          tabIndex={-1}
        >
          {hasChildren ? (expanded ? "▼" : "▶") : "•"}
        </button>

        {/* Key label if present */}
        {keyLabel && (
          <span className={`cbor-tree-key ${keyType === "map-key" ? "is-map-key" : ""} ${keyType === "map-value" ? "is-map-value" : ""}`}>
            {keyLabel}
          </span>
        )}

        {/* Type badge */}
        <span
          className="cbor-tree-type"
          style={{
            backgroundColor: label.color,
            color: "#fff",
          }}
        >
          {label.type}
        </span>

        {/* Value info */}
        {label.value && (
          <span className="cbor-tree-info">{label.value}</span>
        )}

        {/* Detail (actual value) */}
        {label.detail && (
          <ExpandableValue value={label.detail} />
        )}

        {/* Action button */}
        <button
          className="cbor-tree-action"
          onClick={handleContextMenuEvent}
          title="Actions"
        >
          ⋮
        </button>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="cbor-tree-children">{renderChildren()}</div>
      )}
    </div>
  );
}

// Context menu with smart positioning
interface ContextMenuPortalProps {
  x: number;
  y: number;
  onClickOutside: () => void;
  children: React.ReactNode;
}

function ContextMenuPortal({ x, y, onClickOutside, children }: ContextMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Adjust position after mount
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    // Use requestAnimationFrame to wait for paint
    const frame = requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = x;
      let top = y;

      // Check right overflow - if menu would go past viewport, show on left side
      if (x + menuRect.width > viewportWidth - 10) {
        left = x - menuRect.width;
      }

      // Check bottom overflow
      if (y + menuRect.height > viewportHeight - 10) {
        top = viewportHeight - menuRect.height - 10;
      }

      // Ensure not off left edge
      if (left < 10) left = 10;
      // Ensure not off top edge
      if (top < 10) top = 10;

      if (left !== x || top !== y) {
        setPosition({ left, top });
      }
    });
    
    return () => cancelAnimationFrame(frame);
  }, [x, y]);

  // Handle click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onClickOutside]);

  return (
    <div
      ref={menuRef}
      className="cbor-context-menu"
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

export default function CborTreeView({
  data,
  hexValue,
  onHoverPosition,
  onHighlightAndScroll,
  highlightedTreePosition,
  onClearHighlight,
}: CborTreeViewProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  
  // Compute expanded paths when highlighted position changes
  const expandedPaths = useMemo(() => {
    if (!highlightedTreePosition || !data) {
      return new Set<string>();
    }
    
    const pathSegments = findPathToPosition(data, highlightedTreePosition);
    if (!pathSegments) {
      return new Set<string>();
    }
    
    // Build all parent paths
    const paths = new Set<string>();
    let currentPath = "root";
    paths.add(currentPath);
    
    for (const segment of pathSegments) {
      // Build the actual path based on segment type
      if (segment.startsWith("array[")) {
        const index = segment.match(/\[(\d+)\]/)?.[1];
        currentPath = `${currentPath}[${index}]`;
      } else if (segment.startsWith("map[")) {
        const match = segment.match(/map\[(\d+)\]\.(key|value)/);
        if (match) {
          const [, index, type] = match;
          currentPath = `${currentPath}.${type === "key" ? "keys" : "values"}[${index}]`;
        }
      } else if (segment === "tag.value") {
        currentPath = `${currentPath}.value`;
      } else if (segment.startsWith("chunks[")) {
        const index = segment.match(/\[(\d+)\]/)?.[1];
        currentPath = `${currentPath}.chunks[${index}]`;
      }
      paths.add(currentPath);
    }
    
    return paths;
  }, [highlightedTreePosition, data]);
  
  // Clear highlight after animation (3 seconds)
  useEffect(() => {
    if (highlightedTreePosition) {
      const timer = setTimeout(() => {
        onClearHighlight?.();
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [highlightedTreePosition, onClearHighlight]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: CborValue, path: string) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        node,
        path,
      });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopyCbor = useCallback(() => {
    if (contextMenu) {
      const position = contextMenu.node.struct_position_info || contextMenu.node.position_info;
      if (position) {
        const hex = getCborHex(hexValue, position);
        navigator.clipboard.writeText(hex);
      }
    }
    closeContextMenu();
  }, [contextMenu, hexValue, closeContextMenu]);

  const handleHighlightCbor = useCallback(() => {
    if (contextMenu) {
      const position = contextMenu.node.struct_position_info || contextMenu.node.position_info;
      if (position) {
        onHighlightAndScroll(position);
      }
    }
    closeContextMenu();
  }, [contextMenu, onHighlightAndScroll, closeContextMenu]);

  return (
    <div className="cbor-tree-view">
      <TreeNode
        node={data}
        depth={0}
        path="root"
        hexValue={hexValue}
        defaultExpanded={true}
        onContextMenu={handleContextMenu}
        onHover={onHoverPosition}
        highlightedPosition={highlightedTreePosition}
        expandedPaths={expandedPaths}
      />

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenuPortal
          x={contextMenu.x}
          y={contextMenu.y}
          onClickOutside={closeContextMenu}
        >
          <button onClick={handleCopyCbor}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy CBOR Hex
          </button>
          <button onClick={handleHighlightCbor}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Highlight in Hex View
          </button>
        </ContextMenuPortal>
      )}
    </div>
  );
}
