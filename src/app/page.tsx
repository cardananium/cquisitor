"use client";

import dynamic from "next/dynamic";

// Dynamically import to avoid WASM loading during SSR
const TransactionValidatorContent = dynamic(
  () => import("./TransactionValidatorContent"),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Loading Transaction Validator...</div>
      </div>
    )
  }
);

export default function TransactionValidator() {
  return <TransactionValidatorContent />;
}
