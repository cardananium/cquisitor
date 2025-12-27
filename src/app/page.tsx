"use client";

import dynamic from "next/dynamic";

// Dynamically import to avoid WASM loading during SSR
const UnifiedContent = dynamic(
  () => import("@/components/UnifiedContent"),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin w-8 h-8 border-4 border-[#3182ce] border-t-transparent rounded-full" />
      </div>
    )
  }
);

export default function Home() {
  return <UnifiedContent />;
}
