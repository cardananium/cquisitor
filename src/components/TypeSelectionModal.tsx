"use client";

import { useEffect, useRef } from "react";

interface TypeSelectionModalProps {
  isOpen: boolean;
  types: string[];
  onSelect: (type: string) => void;
  onClose: () => void;
}

export default function TypeSelectionModal({
  isOpen,
  types,
  onSelect,
  onClose,
}: TypeSelectionModalProps) {
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
    <div className="modal-overlay">
      <div className="modal-content" ref={modalRef}>
        <div className="modal-header">
          <h3>Select Structure Type</h3>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="modal-description">
          Multiple types detected. Please select the structure you want to decode:
        </p>
        <div className="modal-types-list">
          {types.map((type) => (
            <button
              key={type}
              className="modal-type-button"
              onClick={() => onSelect(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
