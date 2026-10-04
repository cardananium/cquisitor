"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import logo64 from "../../public/logo-64.png";
import { VISIBLE_TABS, type TabDefinition } from "./TabNavigation";
import { DE_UPLC_BASE_URL } from "@cardananium/cquisitor-lib";
import { pageOpenedFromLink } from "@/utils/shareLink/linkNavigation";

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

/** The tool cards of the welcome modal — one per tab shown in the nav; with `onOpen` each opens its tab. */
export function WelcomeFeatures({ onOpen }: { onOpen?: (tab: TabDefinition["id"]) => void } = {}) {
  return (
    <div className="welcome-features-grid">
      {VISIBLE_TABS.map((tab) => (
        <FeatureCard
          key={tab.id}
          icon={TAB_ICONS[tab.id]}
          title={tab.name}
          description={tab.description}
          color={tab.accent}
          onOpen={onOpen ? () => onOpen(tab.id) : undefined}
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
  onOpen?: () => void;
}

function FeatureCard({ icon, title, description, color, onOpen }: FeatureCardProps) {
  const body = (
    <>
      <div className="welcome-feature-icon">{icon}</div>
      <div className="welcome-feature-content">
        <h4 className="welcome-feature-title">{title}</h4>
        <p className="welcome-feature-description">{description}</p>
      </div>
      {onOpen && (
        <svg className="welcome-feature-go" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );
  const style = { "--accent-color": color } as React.CSSProperties;
  return onOpen ? (
    <button type="button" className="welcome-feature-card welcome-feature-link" style={style} onClick={onOpen} aria-label={`Open ${title}`}>
      {body}
    </button>
  ) : (
    <div className="welcome-feature-card" style={style}>
      {body}
    </div>
  );
}

const TIPS: { icon: string; text: React.ReactNode }[] = [
  { icon: "⚡", text: <>Paste CBOR as hex or base64, or load a transaction by hash with <strong>Load on-chain</strong>.</> },
  { icon: "🔗", text: <><strong>Share</strong> builds a link that reopens the same input and result — handy for asking someone to look.</> },
];

export default function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // A link opens straight on its content; the welcome waits for a plain visit.
    if (pageOpenedFromLink()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    // Small delay for smoother appearance after page load
    const timer = setTimeout(() => {
      setIsOpen(true);
      setIsAnimating(true);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsAnimating(false);
    localStorage.setItem(STORAGE_KEY, "true");
    setTimeout(() => setIsOpen(false), 200);
  };

  const openTab = (tab: TabDefinition["id"]) => {
    window.history.pushState(null, "", `#${tab}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    handleClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") handleClose();
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
        <div className="welcome-modal-header">
          <div className="welcome-header-glow" />
          <div className="welcome-logo-container">
            <Image src={logo64} alt="CQuisitor Logo" width={44} height={44} className="welcome-logo" />
          </div>
          <h2 id="welcome-title" className="welcome-title">
            Welcome to <span className="welcome-title-highlight">CQuisitor</span>
          </h2>
          <p className="welcome-subtitle">
            Decode, validate and debug Cardano transactions and CBOR — all in your browser.
          </p>
          <button onClick={handleClose} className="welcome-close-button" aria-label="Close welcome dialog">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="welcome-modal-body">
          <h3 className="welcome-section-title">Pick a tool</h3>
          <WelcomeFeatures onOpen={openTab} />

          <h3 className="welcome-section-title">Plutus scripts</h3>
          <a className="welcome-related" href={DE_UPLC_BASE_URL} target="_blank" rel="noopener noreferrer">
            <span className="welcome-related-name">de-uplc</span>
            <span className="welcome-related-text">
              Step through a script on the CEK machine or read it as decompiled pseudocode. Scripts from a
              validation open there from the Plutus Scripts tab.
            </span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3h7v7M13 3L5 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>

          <div className="welcome-tips">
            {TIPS.map((tip, i) => (
              <div className="welcome-tip" key={i}>
                <span className="welcome-tip-icon">{tip.icon}</span>
                <span>{tip.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="welcome-modal-footer">
          <button onClick={handleClose} className="welcome-start-button">
            <span>Start exploring</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
