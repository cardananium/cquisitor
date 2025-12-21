"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import logo64 from "../../public/logo-64.png";

const STORAGE_KEY = "cquisitor_welcome_shown";

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
          <div className="welcome-features-grid">
            <FeatureCard
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 12l2 2 4-4"/>
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              }
              title="Transaction Validator"
              description="Validate Cardano transactions with Phase 1 & 2 checks. See execution units and detect errors in real-time."
              color="#22c55e"
            />
            
            <FeatureCard
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M7 7h4M7 12h10M7 17h6"/>
                </svg>
              }
              title="Cardano CBOR"
              description="Decode Cardano-specific CBOR structures like transactions, blocks, witnesses, and protocol params with full type awareness."
              color="#3b82f6"
            />
            
            <FeatureCard
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h12"/>
                  <circle cx="19" cy="18" r="2"/>
                </svg>
              }
              title="General CBOR"
              description="Parse and visualize any CBOR data with an interactive hex view. Click on tree nodes to highlight corresponding bytes."
              color="#8b5cf6"
            />
          </div>

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

