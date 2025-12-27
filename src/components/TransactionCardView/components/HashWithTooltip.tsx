"use client";

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CopyButton } from "./CopyButton";

interface HashWithTooltipProps {
  hash: string;
  linkUrl?: string;
  className?: string;
}

/**
 * Displays a hash with auto-truncation via CSS.
 * Shows full hash in tooltip on hover with copy button.
 */
export function HashWithTooltip({ hash, linkUrl, className = "" }: HashWithTooltipProps) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {linkUrl ? (
            <a 
              href={linkUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className={`tcv-hash-truncate ${className}`}
              onClick={(e) => e.stopPropagation()}
            >
              {hash}
            </a>
          ) : (
            <span className={`tcv-hash-truncate ${className}`}>
              {hash}
            </span>
          )}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tcv-hash-tooltip" sideOffset={5} side="top">
            <div className="tcv-hash-tooltip-content">
              {hash}
              <CopyButton text={hash} className="tcv-tooltip-copy" />
            </div>
            <Tooltip.Arrow className="tcv-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

