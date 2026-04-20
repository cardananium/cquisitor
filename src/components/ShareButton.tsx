"use client";

import { useState } from "react";
import ShareDialog, { type ShareDialogInput } from "./ShareDialog";

interface ShareButtonProps {
  disabled?: boolean;
  title?: string;
  getTarget: () => ShareDialogInput;
}

export default function ShareButton({ disabled, title, getTarget }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ShareDialogInput | null>(null);

  const handleOpen = () => {
    if (disabled) return;
    setTarget(getTarget());
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className="share-btn"
        onClick={handleOpen}
        disabled={disabled}
        title={title ?? "Share a link to this state"}
        aria-label="Share a link to this state"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <span>Share</span>
      </button>
      {open && target && (
        <ShareDialog open={open} onOpenChange={setOpen} target={target} />
      )}
    </>
  );
}
