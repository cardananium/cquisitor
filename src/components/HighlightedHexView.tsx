"use client";

import React, { useRef, useEffect, useCallback, useMemo } from "react";
import type { CborValue, CborPosition } from "@cardananium/cquisitor-lib";

// Colors for CBOR syntax highlighting (light background)
const CBOR_COLORS = [
  "rgba(99, 102, 241, 0.25)",   // indigo
  "rgba(236, 72, 153, 0.25)",   // pink
  "rgba(34, 197, 94, 0.25)",    // green
  "rgba(249, 115, 22, 0.25)",   // orange
  "rgba(14, 165, 233, 0.25)",   // sky
  "rgba(168, 85, 247, 0.25)",   // purple
  "rgba(234, 179, 8, 0.3)",     // yellow
  "rgba(20, 184, 166, 0.25)",   // teal
];

const HOVER_COLOR = "rgba(250, 204, 21, 0.5)"; // yellow highlight for hover
const FOCUS_COLOR = "rgba(239, 68, 68, 0.4)"; // red highlight for focused element

interface HighlightedSpan {
  start: number;
  end: number;
  colorIndex: number;
}

interface HighlightedHexViewProps {
  hexValue: string;
  cborData: CborValue | null;
  hoverPosition: CborPosition | null;
  focusPosition: CborPosition | null;
  onFocusComplete?: () => void;
}

function collectPositions(
  value: CborValue,
  spans: HighlightedSpan[],
  colorCounter: { value: number }
): void {
  if (!value || typeof value !== "object") return;

  const posInfo = value.position_info;
  if (posInfo && typeof posInfo.offset === "number" && typeof posInfo.length === "number") {
    spans.push({
      start: posInfo.offset * 2,
      end: (posInfo.offset + posInfo.length) * 2,
      colorIndex: colorCounter.value % CBOR_COLORS.length,
    });
    colorCounter.value++;
  }

  if ("values" in value && Array.isArray(value.values)) {
    if ("type" in value && value.type === "Map") {
      for (const item of value.values as { key: CborValue; value: CborValue }[]) {
        collectPositions(item.key, spans, colorCounter);
        collectPositions(item.value, spans, colorCounter);
      }
    } else {
      for (const item of value.values as CborValue[]) {
        collectPositions(item, spans, colorCounter);
      }
    }
  }

  if ("value" in value && typeof value.value === "object" && value.value !== null) {
    collectPositions(value.value as CborValue, spans, colorCounter);
  }

  if ("chunks" in value && Array.isArray(value.chunks)) {
    for (const chunk of value.chunks) {
      collectPositions(chunk, spans, colorCounter);
    }
  }
}

export default function HighlightedHexView({
  hexValue,
  cborData,
  hoverPosition,
  focusPosition,
  onFocusComplete,
}: HighlightedHexViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLSpanElement>(null);

  // Calculate spans from CBOR data
  const spans = useMemo(() => {
    if (!cborData) return [];
    const result: HighlightedSpan[] = [];
    const colorCounter = { value: 0 };
    collectPositions(cborData, result, colorCounter);
    return result;
  }, [cborData]);

  // Scroll to focus position
  useEffect(() => {
    if (focusPosition && focusRef.current && containerRef.current) {
      const container = containerRef.current;
      const element = focusRef.current;
      
      // Calculate scroll position to center the element
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const scrollTop = element.offsetTop - container.offsetTop - containerRect.height / 2 + elementRect.height / 2;
      
      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: "smooth",
      });

      // Flash animation
      element.classList.add("flash");
      setTimeout(() => {
        element.classList.remove("flash");
        onFocusComplete?.();
      }, 1500);
    }
  }, [focusPosition, onFocusComplete]);

  const renderHighlightedHex = useCallback(() => {
    if (!hexValue) {
      return <span className="text-gray-400">No data</span>;
    }

    // Create position to color mapping
    const positionColors: Map<number, { colorIndex: number; isHover: boolean; isFocus: boolean }> = new Map();
    
    // First, map base colors from spans
    for (const span of spans) {
      for (let i = span.start; i < span.end && i < hexValue.length; i++) {
        if (!positionColors.has(i)) {
          positionColors.set(i, { colorIndex: span.colorIndex, isHover: false, isFocus: false });
        }
      }
    }

    // Apply hover highlight
    if (hoverPosition && typeof hoverPosition.offset === "number" && typeof hoverPosition.length === "number") {
      const start = hoverPosition.offset * 2;
      const end = (hoverPosition.offset + hoverPosition.length) * 2;
      for (let i = start; i < end && i < hexValue.length; i++) {
        const existing = positionColors.get(i);
        positionColors.set(i, { 
          colorIndex: existing?.colorIndex ?? 0, 
          isHover: true, 
          isFocus: false 
        });
      }
    }

    // Apply focus highlight
    if (focusPosition && typeof focusPosition.offset === "number" && typeof focusPosition.length === "number") {
      const start = focusPosition.offset * 2;
      const end = (focusPosition.offset + focusPosition.length) * 2;
      for (let i = start; i < end && i < hexValue.length; i++) {
        const existing = positionColors.get(i);
        positionColors.set(i, { 
          colorIndex: existing?.colorIndex ?? 0, 
          isHover: existing?.isHover ?? false, 
          isFocus: true 
        });
      }
    }

    const result: React.ReactNode[] = [];
    let i = 0;
    while (i < hexValue.length) {
      const colorInfo = positionColors.get(i);
      let j = i + 1;
      
      // Group consecutive characters with same color info
      while (j < hexValue.length) {
        const nextColor = positionColors.get(j);
        if (colorInfo?.colorIndex !== nextColor?.colorIndex ||
            colorInfo?.isHover !== nextColor?.isHover ||
            colorInfo?.isFocus !== nextColor?.isFocus) {
          break;
        }
        j++;
      }

      const segment = hexValue.slice(i, j);
      let backgroundColor: string | undefined;
      let className = "hex-segment";

      if (colorInfo?.isFocus) {
        backgroundColor = FOCUS_COLOR;
        className += " focus-segment";
      } else if (colorInfo?.isHover) {
        backgroundColor = HOVER_COLOR;
        className += " hover-segment";
      } else if (colorInfo?.colorIndex !== undefined) {
        backgroundColor = CBOR_COLORS[colorInfo.colorIndex];
      }

      // Check if this is the start of focus position (for ref)
      const isFocusStart = focusPosition && typeof focusPosition.offset === "number" && i === focusPosition.offset * 2;

      result.push(
        <span
          key={i}
          ref={isFocusStart ? focusRef : undefined}
          className={className}
          style={{
            backgroundColor,
            borderRadius: "2px",
            padding: "1px 0",
          }}
        >
          {segment}
        </span>
      );
      i = j;
    }

    return result;
  }, [hexValue, spans, hoverPosition, focusPosition]);

  return (
    <div ref={containerRef} className="highlighted-hex-view">
      <pre className="hex-content">
        {renderHighlightedHex()}
      </pre>
    </div>
  );
}
