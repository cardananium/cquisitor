"use client";

import dynamic from "next/dynamic";

// Dynamically import to avoid WASM loading during SSR
const CardanoCborContent = dynamic(
  () => import("./CardanoCborContent"),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Loading Cardano CBOR decoder...</div>
      </div>
    )
  }
);

export default function CardanoCbor() {
  return <CardanoCborContent />;
}
