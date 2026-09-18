"use client";

// Header chip showing which instance of the pinned construct is current (`2/7`) and stepping it.
// Stepping from any panel moves current in all four; the count reveals it in this panel only.

import { instanceNavLabel, STEP_KEYS_HINT, type InstanceNavOptions } from "./instances";

export interface InstanceNavProps extends InstanceNavOptions {
  /** Current instance, as an index into the pinned construct's group. */
  index: number;
  /** How many instances the construct has; nothing is rendered for none. */
  total: number;
  onStep: (delta: -1 | 1) => void;
  /** Reveal the current instance in this panel again. */
  onReveal: () => void;
}

export default function InstanceNav({
  index,
  total,
  panel,
  byteless,
  onStep,
  onReveal,
}: InstanceNavProps) {
  // A group of one has nothing to step through: the pin marks are enough.
  if (total <= 1) return null;
  const label = instanceNavLabel(index, total, { panel, byteless });
  return (
    <div className="cq-inst-nav" title={label.title}>
      <button
        type="button"
        className="cq-inst-nav-btn"
        onClick={() => onStep(-1)}
        disabled={!label.canStep}
        title={`Previous instance (Alt+,)`}
        aria-label="Previous instance (Alt+,)"
      >‹</button>
      <button
        type="button"
        className="cq-inst-nav-count"
        onClick={onReveal}
        title={label.title}
        aria-label={`Pinned instance ${index + 1} of ${total}; show it again (${STEP_KEYS_HINT} to step)`}
      >
        {label.text}
      </button>
      <button
        type="button"
        className="cq-inst-nav-btn"
        onClick={() => onStep(1)}
        disabled={!label.canStep}
        title="Next instance (Alt+.)"
        aria-label="Next instance (Alt+.)"
      >›</button>
    </div>
  );
}
