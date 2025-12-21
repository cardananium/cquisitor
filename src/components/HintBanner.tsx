"use client";

import { useState } from "react";

interface HintBannerProps {
  storageKey: string;
  children: React.ReactNode;
}

export default function HintBanner({ storageKey, children }: HintBannerProps) {
  // Use lazy initializer to read from localStorage on client side
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem(storageKey);
  });

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem(storageKey, "true");
  };

  if (!isVisible) return null;

  return (
    <div className="hint-banner">
      <div className="hint-banner-icon">💡</div>
      <div className="hint-banner-content">{children}</div>
      <button 
        onClick={handleDismiss} 
        className="hint-banner-close"
        aria-label="Dismiss hint"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

