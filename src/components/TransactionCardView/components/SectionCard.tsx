"use client";

import React, { useEffect, useRef } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import * as Tooltip from "@radix-ui/react-tooltip";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { getPathDiagnostics, getDescendantDiagnosticCounts } from "../utils";
import type { SectionCardProps } from "../types";

export function SectionCard({ 
  title, 
  icon, 
  colorScheme, 
  children, 
  badge, 
  path,
  diagnosticsMap,
  focusedPath,
  defaultExpanded = true 
}: SectionCardProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  
  const pathDiagnostics = path && diagnosticsMap ? getPathDiagnostics(path, diagnosticsMap) : [];
  const descendantCounts = path && diagnosticsMap ? getDescendantDiagnosticCounts(path, diagnosticsMap) : { errors: 0, warnings: 0 };
  const hasChildIssues = descendantCounts.errors > 0 || descendantCounts.warnings > 0;
  // Only highlight if this exact path is focused, NOT if a child is focused
  const isFocused = focusedPath?.includes(path ?? '') ?? false;
  
  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && sectionRef.current) {
      setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    }
  }, [isFocused]);
  
  return (
    <Accordion.Root
      type="single"
      collapsible
      defaultValue={defaultExpanded ? "content" : undefined}
      className={`tcv-section-card tcv-${colorScheme} ${hasChildIssues ? 'has-issues' : ''} ${isFocused ? 'is-focused' : ''}`}
      ref={sectionRef}
    >
      <Accordion.Item value="content" className="tcv-accordion-item">
        <Accordion.Header className="tcv-accordion-header">
          <Accordion.Trigger className="tcv-section-header">
            <span className="tcv-section-icon">{icon}</span>
            {hasChildIssues && (
              <Tooltip.Provider delayDuration={100}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className={`tcv-child-indicator ${descendantCounts.errors > 0 ? 'has-errors' : 'has-warnings'}`}>
                      {descendantCounts.errors > 0 ? '⊗' : '△'}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="validation-tooltip" sideOffset={5} side="bottom">
                      <div className="validation-tooltip-content">
                        <div className="validation-tooltip-title">Issues inside</div>
                        {descendantCounts.errors > 0 && (
                          <div className="validation-tooltip-item">
                            <span className="validation-tooltip-message tcv-child-error-msg">⊗ {descendantCounts.errors} error(s)</span>
                          </div>
                        )}
                        {descendantCounts.warnings > 0 && (
                          <div className="validation-tooltip-item">
                            <span className="validation-tooltip-message tcv-child-warning-msg">△ {descendantCounts.warnings} warning(s)</span>
                          </div>
                        )}
                      </div>
                      <Tooltip.Arrow className="validation-tooltip-arrow" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            )}
            <span className="tcv-section-title">{title}</span>
            {badge !== undefined && (
              <span className="tcv-section-badge">{badge}</span>
            )}
            <DiagnosticBadge diagnostics={pathDiagnostics} />
            <span className="tcv-section-toggle">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="tcv-chevron">
                <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content className="tcv-accordion-content">
          <div className="tcv-section-content">
            {children}
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}
