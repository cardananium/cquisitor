"use client";

// Floating context menu shown when the user right-clicks any of the four
// CDDL Validator panels (CDDL editor / CBOR hex / Decoded JSON / Tree).
//
// Behaviour:
//   - Lists the candidate node from the click position.
//   - Per-panel checkboxes control which panels mirror the highlight; the
//     selection persists across pins until the user changes it.
//   - "Pin this node" commits the current candidate as the pinned entry.
//   - "Clear pin" removes any active pin.
//   - Click-outside / Escape close without changing the pin.

import { useEffect, useRef } from "react";
import type { CborCddlMapEntry } from "@cardananium/cquisitor-lib";

export type PinTarget = "cddl" | "hex" | "decoded" | "tree";

export const ALL_PIN_TARGETS: PinTarget[] = ["cddl", "hex", "decoded", "tree"];

const TARGET_LABELS: Record<PinTarget, string> = {
  cddl: "CDDL editor",
  hex: "CBOR hex",
  decoded: "Decoded JSON",
  tree: "Structural tree",
};

export interface PinContextMenuProps {
  x: number;
  y: number;
  candidate: CborCddlMapEntry;
  /** Which panel the right-click came from — purely informational in the header. */
  source: PinTarget;
  /** Currently chosen highlight targets. */
  targets: ReadonlySet<PinTarget>;
  /** True when there is already a pinned entry the user can clear. */
  hasActivePin: boolean;
  onToggleTarget: (t: PinTarget) => void;
  onPin: (entry: CborCddlMapEntry) => void;
  onClearPin: () => void;
  onClose: () => void;
}

export default function PinContextMenu({
  x,
  y,
  candidate,
  source,
  targets,
  hasActivePin,
  onToggleTarget,
  onPin,
  onClearPin,
  onClose,
}: PinContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Use capture so we beat any other handlers that might stopPropagation.
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Keep the menu inside the viewport.
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw - 8) el.style.left = `${Math.max(8, vw - rect.width - 8)}px`;
    if (rect.bottom > vh - 8) el.style.top = `${Math.max(8, vh - rect.height - 8)}px`;
  }, [x, y]);

  const role = candidate.entry_role;
  const path = candidate.cbor_path;
  const ruleName = candidate.rule_name;
  const cborType = candidate.cbor_type ?? "node";

  return (
    <div
      ref={ref}
      className="cq-pin-menu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="cq-pin-menu-header">
        <div className="cq-pin-menu-title">
          {cborType} <span className="cq-pin-menu-role">{role}</span>
        </div>
        <div className="cq-pin-menu-path" title={path}>{path}</div>
        {ruleName && <div className="cq-pin-menu-rule">rule: <code>{ruleName}</code></div>}
        <div className="cq-pin-menu-source">from: {TARGET_LABELS[source]}</div>
      </div>

      <div className="cq-pin-menu-section-title">Mirror highlight to:</div>
      <ul className="cq-pin-menu-targets">
        {ALL_PIN_TARGETS.map((t) => (
          <li key={t}>
            <label className="cq-pin-menu-target">
              <input
                type="checkbox"
                checked={targets.has(t)}
                onChange={() => onToggleTarget(t)}
              />
              <span>{TARGET_LABELS[t]}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="cq-pin-menu-actions">
        <button
          type="button"
          className="cq-pin-menu-btn cq-pin-menu-btn-primary"
          onClick={() => { onPin(candidate); onClose(); }}
        >
          Pin this node
        </button>
        {hasActivePin && (
          <button
            type="button"
            className="cq-pin-menu-btn"
            onClick={() => { onClearPin(); onClose(); }}
          >
            Clear current pin
          </button>
        )}
      </div>
    </div>
  );
}
