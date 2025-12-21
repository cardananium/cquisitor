"use client";

import * as Tooltip from "@radix-ui/react-tooltip";

interface HelpTooltipProps {
  children: React.ReactNode;
}

export default function HelpTooltip({ children }: HelpTooltipProps) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" className="help-tooltip-trigger" aria-label="How to use">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6.5"/>
              <path d="M6 6.5a2 2 0 1 1 2.5 1.94V9.5" strokeLinecap="round"/>
              <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="help-tooltip-content" sideOffset={5} side="bottom">
            {children}
            <Tooltip.Arrow className="help-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

