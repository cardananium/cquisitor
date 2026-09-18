"use client";

import { useState } from "react";

/** One mismatch of the run, as the navigator steps to it. */
export interface CddlErrorEntry {
  /** Schema span, or `null` when the library pinned none (common for input errors). Still navigable; the editor just has nothing to select. */
  range: [number, number] | null;
  message: string;
  /** Diagnostic index this entry stands for, so nav, list, and trees stay in sync. */
  errorIndex: number;
}

interface CddlErrorNavProps {
  errors: CddlErrorEntry[];
  /** Problems not in `errors` and not steppable: list cap leftovers plus undescribed validator counts. */
  unlisted?: number;
  /** Selection from a card or row badge; arrows step from here. With none, the navigator keeps its own index. */
  current?: number | null;
  onJump: (entry: CddlErrorEntry) => void;
}

/**
 * Count-chip text and its screen-reader label.
 * When `unlisted > 0`, the chip must include the run total so a capped list is not read as complete; it has no noun because the verdict beside it already names the list.
 */
export function errorNavLabel(
  index: number,
  total: number,
  unlisted: number,
): { text: string; ariaLabel: string } {
  const position = `${index + 1}/${total}`;
  if (unlisted <= 0) {
    return {
      text: position,
      ariaLabel: `Show mismatch ${index + 1} of ${total}`,
    };
  }
  const found = total + unlisted;
  return {
    text: `${position} of ${found}`,
    ariaLabel: `Show mismatch ${index + 1} of ${total} listed; ${found} found in this run`,
  };
}

/**
 * Position chip and prev/next arrows through mismatches. The chip also jumps, which is how a single mismatch is reached.
 */
export default function CddlErrorNav({ errors, unlisted = 0, current = null, onJump }: CddlErrorNavProps) {
  const [index, setIndex] = useState(0);

  if (errors.length === 0) return null;
  // Prefer a selection made elsewhere; clamp when the list shrinks, without an effect that would re-render.
  const safeIndex = Math.min(current ?? index, errors.length - 1);
  const total = errors.length;
  const entry = errors[safeIndex];
  const label = errorNavLabel(safeIndex, total, unlisted);

  const go = (delta: number) => {
    const next = (safeIndex + delta + total) % total;
    setIndex(next);
    onJump(errors[next]);
  };

  return (
    <div className="cq-err-nav cq-err-nav-mismatch" title={entry.message}>
      <button
        type="button"
        className="cq-err-nav-btn"
        onClick={() => go(-1)}
        disabled={total < 2}
        title="Previous mismatch"
        aria-label="Previous mismatch"
      >‹</button>
      <button
        type="button"
        className="cq-err-nav-count"
        onClick={() => {
          setIndex(safeIndex);
          onJump(entry);
        }}
        /* The chip is most of the widget, so its tooltip is the error message, not the click action. */
        title={entry.message}
        aria-label={label.ariaLabel}
      >
        {label.text}
      </button>
      <button
        type="button"
        className="cq-err-nav-btn"
        onClick={() => go(1)}
        disabled={total < 2}
        title="Next mismatch"
        aria-label="Next mismatch"
      >›</button>
    </div>
  );
}
