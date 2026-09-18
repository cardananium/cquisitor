"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import logo64 from "../../public/logo-64.png";
import { VISIBLE_TABS, type TabDefinition } from "./TabNavigation";

const STORAGE_KEY = "cquisitor_welcome_shown";

// One icon per tab of the shell, hidden ones included, so that showing a tab
// is a single edit in the tab list and never leaves a card without an icon.
const TAB_ICONS: Record<TabDefinition["id"], React.ReactNode> = {
  "transaction-validator": (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4" />
      <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  "cardano-cbor": (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 7h4M7 12h10M7 17h6" />
    </svg>
  ),
  "general-cbor": (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 12h16M4 18h12" />
      <circle cx="19" cy="18" r="2" />
    </svg>
  ),
  "cddl-validator": (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3H7a2 2 0 00-2 2v4a2 2 0 01-2 2 2 2 0 012 2v4a2 2 0 002 2h1" />
      <path d="M16 3h1a2 2 0 012 2v4a2 2 0 002 2 2 2 0 00-2 2v4a2 2 0 01-2 2h-1" />
      <path d="M9 12h6" />
    </svg>
  ),
};

/** The feature cards of the welcome modal — one per tab shown in the nav. */
export function WelcomeFeatures() {
  return (
    <div className="welcome-features-grid">
      {VISIBLE_TABS.map((tab) => (
        <FeatureCard
          key={tab.id}
          icon={TAB_ICONS[tab.id]}
          title={tab.name}
          description={tab.description}
          color={tab.accent}
        />
      ))}
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}

function FeatureCard({ icon, title, description, color }: FeatureCardProps) {
  return (
    <div className="welcome-feature-card" style={{ "--accent-color": color } as React.CSSProperties}>
      <div className="welcome-feature-icon">{icon}</div>
      <div className="welcome-feature-content">
        <h4 className="welcome-feature-title">{title}</h4>
        <p className="welcome-feature-description">{description}</p>
      </div>
    </div>
  );
}

export default function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Check if user has seen the welcome modal before
    const hasSeenWelcome = localStorage.getItem(STORAGE_KEY);
    if (!hasSeenWelcome) {
      // Small delay for smoother appearance after page load
      const timer = setTimeout(() => {
        setIsOpen(true);
        setIsAnimating(true);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(() => {
      setIsOpen(false);
      localStorage.setItem(STORAGE_KEY, "true");
    }, 200);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className={`welcome-modal-overlay ${isAnimating ? "welcome-visible" : ""}`}
      onClick={handleClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div 
        className={`welcome-modal-content ${isAnimating ? "welcome-visible" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gradient background */}
        <div className="welcome-modal-header">
          <div className="welcome-header-glow" />
          <div className="welcome-logo-container">
            <Image
              src={logo64}
              alt="CQuisitor Logo"
              width={56}
              height={56}
              className="welcome-logo"
            />
          </div>
          <h2 id="welcome-title" className="welcome-title">
            Welcome to <span className="welcome-title-highlight">CQuisitor</span>
          </h2>
          <p className="welcome-subtitle">
            Your powerful toolkit for Cardano CBOR analysis and transaction validation
          </p>
          <button 
            onClick={handleClose} 
            className="welcome-close-button"
            aria-label="Close welcome dialog"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Features section */}
        <div className="welcome-modal-body">
          <WelcomeFeatures />

          {/* Tips section */}
          <div className="welcome-tips">
            <div className="welcome-tip">
              <span className="welcome-tip-icon">💡</span>
              <span>Paste transaction CBOR in hex or base64 format — both are supported</span>
            </div>
            <div className="welcome-tip">
              <span className="welcome-tip-icon">🔗</span>
              <span>Click on validation errors to navigate directly to the problematic field</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="welcome-modal-footer">
          <button onClick={handleClose} className="welcome-start-button">
            <span>Get Started</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

