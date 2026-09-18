"use client";

// Why the run stopped short of a verdict, above the hex. Not dismissible — it describes the current input.

import { abbreviatePath } from "./cddlError";
import type { HexRefusal } from "./verdict";

export default function RefusalBanner({ refusal }: { refusal: HexRefusal }) {
  const { kind, message, path, limitNote, note } = refusal;
  return (
    <div className="cq-refusal-banner" role="alert">
      <span className="cq-refusal-banner-kind">{kind}</span>
      {path && (
        <code className="cq-refusal-banner-path" title={path}>{abbreviatePath(path)}</code>
      )}
      <span className="cq-refusal-banner-text">
        {/* Library messages end without a full stop; the notes are sentences, so each is set off rather than run on. */}
        {message}
        {limitNote && <span className="cq-refusal-banner-note">{limitNote}</span>}
        {note && <span className="cq-refusal-banner-note">{note}</span>}
      </span>
    </div>
  );
}
