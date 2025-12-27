"use client";

import { useEffect, useRef } from "react";

export type ViewMode = "tree" | "cards";

interface ViewModeSelectionModalProps {
  isOpen: boolean;
  onSelect: (mode: ViewMode) => void;
  onClose: () => void;
}

const VIEW_MODES: Array<{
  id: ViewMode;
  title: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: "cards",
    title: "Card View",
    description: "Visual representation with organized cards for inputs, outputs, certificates, and other transaction components. Shows additional information like resolved addresses and asset details. Best for quick analysis and readability.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="view-mode-icon">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    id: "tree",
    title: "Tree View",
    description: "Hierarchical JSON tree showing the complete transaction structure. Best for detailed inspection and debugging of raw CBOR data.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="view-mode-icon">
        <path d="M3 9h18M9 21V9M21 3v18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
      </svg>
    ),
  },
];

export default function ViewModeSelectionModal({
  isOpen,
  onSelect,
  onClose,
}: ViewModeSelectionModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay view-mode-modal-overlay">
      <div className="modal-content view-mode-modal" ref={modalRef}>
        <div className="modal-header">
          <h3>Choose Display Mode</h3>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="modal-description view-mode-description">
          How would you like to view the decoded transaction?
        </p>
        <div className="view-mode-options">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              className="view-mode-option"
              onClick={() => onSelect(mode.id)}
            >
              <div className="view-mode-option-icon">
                {mode.icon}
              </div>
              <div className="view-mode-option-content">
                <span className="view-mode-option-title">{mode.title}</span>
                <span className="view-mode-option-description">{mode.description}</span>
              </div>
              <div className="view-mode-option-arrow">→</div>
            </button>
          ))}
        </div>
        <p className="view-mode-hint">
          You can change this later using the toggle in the decoded transaction panel.
        </p>
      </div>
    </div>
  );
}

