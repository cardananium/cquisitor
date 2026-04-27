"use client";

import { useEffect, useState } from "react";

export interface CddlErrorEntry {
  range: [number, number];
  /** "parse" — schema parse error, "mismatch" — CBOR vs schema mismatch. */
  kind: "parse" | "mismatch";
  message: string;
}

interface CddlErrorNavProps {
  errors: CddlErrorEntry[];
  onJump: (entry: CddlErrorEntry) => void;
}

/**
 * Compact toolbar widget: error count chip + prev/next arrows.
 * Clicking an arrow scrolls the editor to that error and selects its range.
 */
export default function CddlErrorNav({ errors, onJump }: CddlErrorNavProps) {
  const [index, setIndex] = useState(0);

  // Reset to 0 when the error list shrinks below the current index.
  useEffect(() => {
    if (index >= errors.length) setIndex(0);
  }, [errors.length, index]);

  if (errors.length === 0) return null;
  const safeIndex = Math.min(index, errors.length - 1);
  const total = errors.length;
  const current = errors[safeIndex];
  const hasParse = errors.some(e => e.kind === "parse");
  const tone = hasParse ? "parse" : "mismatch";

  const go = (delta: number) => {
    const next = (safeIndex + delta + total) % total;
    setIndex(next);
    onJump(errors[next]);
  };

  return (
    <div className={`cq-err-nav cq-err-nav-${tone}`} title={current.message}>
      <button
        type="button"
        className="cq-err-nav-btn"
        onClick={() => go(-1)}
        disabled={total < 2}
        title="Previous error"
        aria-label="Previous error"
      >‹</button>
      <span className="cq-err-nav-count">
        {total > 1 ? `${safeIndex + 1}/${total}` : "1"} {total === 1 ? "error" : "errors"}
      </span>
      <button
        type="button"
        className="cq-err-nav-btn"
        onClick={() => go(1)}
        disabled={total < 2}
        title="Next error"
        aria-label="Next error"
      >›</button>
    </div>
  );
}
