"use client";

// Right-click menu for pin + the clicked panel's own actions.
// Checkboxes persist across pins; click-outside / Escape close without changing the pin.

import { useEffect, useRef } from "react";
import type { PanelMenuAction } from "@/components/panelMenuActions";
import type { CborCddlNode } from "./cborCddlBridge";
import {
  ALL_PIN_TARGETS,
  pinTargetBlockers,
  type PinTarget,
} from "./pinResolvers";
import { PANEL_NAMES } from "./workspaceLayout";

export interface PinContextMenuProps {
  x: number;
  y: number;
  /** Node under the cursor, or `null` when nothing there maps to CDDL. */
  candidate: CborCddlNode | null;
  /** Shown in place of the node details when `candidate` is null. */
  emptyNotice?: string;
  /** Panel the right-click came from — named in the header, and handed back with the pin. */
  source: PinTarget;
  /** Actions the clicked panel contributes to this menu. */
  actions?: ReadonlyArray<PanelMenuAction>;
  /** Currently chosen highlight targets. */
  targets: ReadonlySet<PinTarget>;
  /** True when there is already a pinned entry the user can clear. */
  hasActivePin: boolean;
  onToggleTarget: (t: PinTarget) => void;
  /** Pin `node` from `source`; that panel decides which of the node's instances starts current. */
  onPin: (node: CborCddlNode, source: PinTarget) => void;
  onClearPin: () => void;
  onClose: () => void;
}

export default function PinContextMenu({
  x,
  y,
  candidate,
  emptyNotice,
  source,
  actions,
  targets,
  hasActivePin,
  onToggleTarget,
  onPin,
  onClearPin,
  onClose,
}: PinContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const blockers = pinTargetBlockers(candidate);

  // Close on outside click / Escape. preventDefault so another sheet does not close on the same keystroke.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
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

  return (
    <div
      ref={ref}
      className="cq-pin-menu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="cq-pin-menu-header">
        {candidate ? (
          <>
            <div className="cq-pin-menu-title">
              {candidate.entry.cbor_type ?? "node"}{" "}
              <span className="cq-pin-menu-role">{candidate.entry.entry_role}</span>
            </div>
            <div className="cq-pin-menu-path" title={candidate.cborPath}>{candidate.cborPath}</div>
            {candidate.entry.rule_name && (
              <div className="cq-pin-menu-rule">rule: <code>{candidate.entry.rule_name}</code></div>
            )}
          </>
        ) : (
          <>
            <div className="cq-pin-menu-title">Nothing to pin here</div>
            {emptyNotice && <div className="cq-pin-menu-notice">{emptyNotice}</div>}
          </>
        )}
        <div className="cq-pin-menu-source">from: {PANEL_NAMES[source]}</div>
      </div>

      {candidate && (
        <>
          <div className="cq-pin-menu-section-title">Mirror highlight to:</div>
          <ul className="cq-pin-menu-targets">
            {ALL_PIN_TARGETS.map((t) => {
              // Show unreachable targets disabled, with the reason. Hiding them looks like the panel vanished; leaving them enabled would tick a no-op.
              const blocked = blockers[t];
              return (
                <li key={t} className={blocked ? "cq-pin-menu-target-blocked" : undefined}>
                  <label className="cq-pin-menu-target" title={blocked ?? undefined}>
                    <input
                      type="checkbox"
                      checked={targets.has(t) && !blocked}
                      disabled={!!blocked}
                      onChange={() => onToggleTarget(t)}
                    />
                    <span>{PANEL_NAMES[t]}</span>
                  </label>
                  {blocked && <div className="cq-pin-menu-target-reason">{blocked}</div>}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="cq-pin-menu-actions">
        {candidate && (
          <button
            type="button"
            className="cq-pin-menu-btn cq-pin-menu-btn-primary"
            onClick={() => { onPin(candidate, source); onClose(); }}
          >
            Pin this node
          </button>
        )}
        {hasActivePin && (
          <button
            type="button"
            className="cq-pin-menu-btn"
            onClick={() => { onClearPin(); onClose(); }}
          >
            Clear current pin
          </button>
        )}
        {actions?.map((a) => (
          <button
            key={a.id}
            type="button"
            className="cq-pin-menu-btn"
            onClick={() => { a.run(); onClose(); }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
