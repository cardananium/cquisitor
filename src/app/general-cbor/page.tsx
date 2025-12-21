"use client";

import dynamic from "next/dynamic";

const GeneralCborContent = dynamic(() => import("./GeneralCborContent"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-[#3182ce] border-t-transparent rounded-full" />
    </div>
  ),
});

export default function GeneralCbor() {
  return <GeneralCborContent />;
}
