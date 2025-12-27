"use client";

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ErrorFormatter } from "../../ErrorDataFormatters";
import type { ValidationDiagnostic } from "../types";

interface DiagnosticBadgeProps {
  diagnostics: ValidationDiagnostic[];
}

export function DiagnosticBadge({ diagnostics }: DiagnosticBadgeProps) {
  if (diagnostics.length === 0) return null;
  
  const hasErrors = diagnostics.some(d => d.severity === "error");
  const errors = diagnostics.filter(d => d.severity === "error");
  const warnings = diagnostics.filter(d => d.severity === "warning");
  
  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={`tcv-diagnostic-badge ${hasErrors ? 'error' : 'warning'}`}>
            {hasErrors ? '⊗' : '⚠'}
            <span className="tcv-diagnostic-count">{diagnostics.length}</span>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="validation-tooltip" sideOffset={5} side="top">
            <div className="validation-tooltip-content">
              {errors.length > 0 && (
                <div className="validation-tooltip-section">
                  <div className="validation-tooltip-title error">
                    Errors ({errors.length})
                  </div>
                  {errors.map((err, i) => (
                    <div key={i} className="validation-tooltip-item">
                      <span className="validation-tooltip-phase">[{err.phase}]</span>
                      <span className="validation-tooltip-message">
                        {err.errorData ? (
                          <ErrorFormatter 
                            error={err.errorData} 
                            errorType={err.errorType}
                            message={err.message} 
                          />
                        ) : (
                          err.message
                        )}
                      </span>
                      {err.hint && (
                        <div className="validation-tooltip-hint">💡 {err.hint}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {warnings.length > 0 && (
                <div className="validation-tooltip-section">
                  <div className="validation-tooltip-title warning">
                    Warnings ({warnings.length})
                  </div>
                  {warnings.map((warn, i) => (
                    <div key={i} className="validation-tooltip-item">
                      <span className="validation-tooltip-phase">[{warn.phase}]</span>
                      <span className="validation-tooltip-message">
                        {warn.errorData ? (
                          <ErrorFormatter 
                            error={warn.errorData} 
                            errorType={warn.errorType}
                            message={warn.message} 
                          />
                        ) : (
                          warn.message
                        )}
                      </span>
                      {warn.hint && (
                        <div className="validation-tooltip-hint">💡 {warn.hint}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Tooltip.Arrow className="validation-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

