"use client";

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useTransactionValidator } from "@/context/TransactionValidatorContext";
import { formatSlotDate, formatSlotRelative } from "@/utils/slotTime";

interface SlotWithTooltipProps {
  slot: number | bigint | string;
  className?: string;
  /** Render the slot number with locale grouping (default true). */
  localeFormat?: boolean;
}

export function SlotWithTooltip({ slot, className = "", localeFormat = true }: SlotWithTooltipProps) {
  const { network } = useTransactionValidator();
  const slotNum = typeof slot === "string" ? Number(slot) : slot;
  const display = localeFormat ? Number(slotNum).toLocaleString() : String(slot);
  const utc = formatSlotDate(slotNum, network);
  const rel = formatSlotRelative(slotNum, network);

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={`tcv-slot-trigger ${className}`}>{display}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tcv-hash-tooltip" sideOffset={5} side="top">
            <div className="tcv-slot-tooltip-content">
              <div className="tcv-slot-tooltip-utc">{utc}</div>
              <div className="tcv-slot-tooltip-rel">{rel}</div>
            </div>
            <Tooltip.Arrow className="tcv-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
