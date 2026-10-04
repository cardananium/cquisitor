"use client";

// Dark scrim over the whole page with rounded holes over the focused target's
// parts. One fixed SVG on document.body, drawn as a single layer: a dark rect
// masked by a white rect with a black rounded rect per hole. Passes every
// pointer event through; sits above the app and below the hint card.

import { useId } from "react";
import { createPortal } from "react-dom";
import type { ScrimHole } from "@/utils/annotations/scrim";

export interface AnnotationScrimProps {
  visible: boolean;
  holes: readonly ScrimHole[];
}

export default function AnnotationScrim({ visible, holes }: AnnotationScrimProps) {
  const maskId = `cq-scrim-mask-${useId().replace(/:/g, "")}`;
  if (typeof document === "undefined") return null;
  return createPortal(
    <svg className={`cq-ann-scrim${visible ? " cq-ann-scrim-on" : ""}`} aria-hidden focusable="false">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {holes.map((h, i) => (
            <rect key={i} x={h.x} y={h.y} width={h.width} height={h.height} rx={h.radius} ry={h.radius} fill="black" />
          ))}
        </mask>
      </defs>
      <rect className="cq-ann-scrim-fill" x="0" y="0" width="100%" height="100%" mask={`url(#${maskId})`} />
    </svg>,
    document.body,
  );
}
