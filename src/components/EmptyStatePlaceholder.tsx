"use client";

type IconType = "tree" | "cardano" | "validator" | "default";

interface EmptyStatePlaceholderProps {
  title?: string;
  description?: string;
  showArrow?: boolean;
  arrowTop?: string;
  icon?: IconType;
}

// Tree structure icon for General CBOR (horizontal tree view, left to right)
function TreeIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Root node on the left */}
      <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Line from root to vertical bar */}
      <path d="M6 12H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Vertical connector */}
      <path d="M9 6V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Lines to children */}
      <path d="M9 6H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 12H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 18H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Child nodes */}
      <circle cx="14" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="17" width="2.5" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      {/* Second level from middle child */}
      <path d="M15.5 12H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 9.5V14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 9.5H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 14.5H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Leaf nodes */}
      <circle cx="20.5" cy="9.5" r="1.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="20.5" cy="14.5" r="1.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// Cardano-style icon (hexagon with nested structure)
function CardanoIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer hexagon */}
      <path
        d="M12 2L21 7V17L12 22L3 17V7L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Inner structure */}
      <circle cx="12" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      {/* Connecting lines - from below top circle to above bottom circles */}
      <path d="M12 9.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 11.5L9 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 11.5L15 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Validator icon (shield with checkmark)
function ValidatorIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Shield */}
      <path
        d="M12 3L4 6V11C4 15.5 7.5 19.5 12 21C16.5 19.5 20 15.5 20 11V6L12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Checkmark */}
      <path
        d="M8.5 12L11 14.5L16 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Default icon (dashed box with plus)
function DefaultIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <path
        d="M8 12H16M12 8V16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function EmptyStatePlaceholder({
  title = "Paste data to decode",
  description = "Insert CBOR hex (or base64/bech32) in the left panel. The structure type will be auto-detected, or you'll be able to choose from possible options.",
  showArrow = true,
  arrowTop = "35%",
  icon = "default",
}: EmptyStatePlaceholderProps) {
  const renderIcon = () => {
    switch (icon) {
      case "tree":
        return <TreeIcon />;
      case "cardano":
        return <CardanoIcon />;
      case "validator":
        return <ValidatorIcon />;
      default:
        return <DefaultIcon />;
    }
  };

  return (
    <div className="empty-state-placeholder">
      {showArrow && (
        <div className="empty-state-arrow" style={{ top: arrowTop }}>
          <svg
            width="60"
            height="20"
            viewBox="0 0 60 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="arrow-svg"
          >
            <line
              x1="55"
              y1="10"
              x2="16"
              y2="10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="4 3"
            />
            <polygon points="5,10 16,5 16,15" fill="currentColor" />
          </svg>
          <span className="arrow-label">Paste here</span>
        </div>
      )}
      <div className="empty-state-content">
        <div className="empty-state-icon">
          {renderIcon()}
        </div>
        <h3 className="empty-state-title">{title}</h3>
        <p className="empty-state-description">{description}</p>
      </div>
    </div>
  );
}
