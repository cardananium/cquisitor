"use client";

import { useCallback, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { TabId, getTabFromHash } from "./TabNavigation";
import CompactLayout from "./CompactLayout";
import Image from "next/image";
import logo32 from "../../public/logo-32.png";
import GitHubStarButton from "./GitHubStarButton";

// Subscribe to hash changes using useSyncExternalStore
function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getHashSnapshot(): string {
  return window.location.hash;
}

// Use a special marker for SSR to trigger loading state
const SSR_MARKER = "__SSR__";

function getServerSnapshot(): string {
  return SSR_MARKER;
}

// Dynamically import content components to avoid WASM loading during SSR
// These are imported once and kept in memory to preserve state
const TransactionValidatorContent = dynamic(
  () => import("@/app/TransactionValidatorContent"),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Loading Transaction Validator...</div>
      </div>
    )
  }
);

const CardanoCborContent = dynamic(
  () => import("@/app/cardano-cbor/CardanoCborContent"),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Loading Cardano CBOR decoder...</div>
      </div>
    )
  }
);

const GeneralCborContent = dynamic(
  () => import("@/app/general-cbor/GeneralCborContent"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin w-8 h-8 border-4 border-[#3182ce] border-t-transparent rounded-full" />
      </div>
    ),
  }
);

const tabs = [
  { name: "Transaction Validator", id: "transaction-validator" as TabId },
  { name: "Cardano CBOR", id: "cardano-cbor" as TabId },
  { name: "General CBOR", id: "general-cbor" as TabId },
];

function InvalidHashError({ invalidHash }: { invalidHash: string }) {
  const navigateTo = (tabId: TabId) => {
    window.history.pushState(null, "", `#${tabId}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  return (
    <div className="compact-layout">
      <header className="compact-header">
        <div className="compact-header-content">
          <div className="compact-logo">
            <Image
              src={logo32}
              alt="CQuisitor Logo"
              width={24}
              height={24}
              className="rounded"
            />
            <span className="logo-text">CQuisitor</span>
          </div>
          <GitHubStarButton />
        </div>
      </header>
      <main className="compact-main flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Invalid Page</h1>
          <p className="text-gray-500 mb-6">
            The URL hash <code className="px-2 py-1 bg-gray-100 rounded text-red-600 text-sm">#{invalidHash}</code> is not recognized.
          </p>
          <div className="flex flex-col gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => navigateTo(tab.id)}
                className="w-full px-4 py-3 rounded-lg bg-[#3182ce] text-white font-medium hover:bg-[#2c5282] transition-colors"
              >
                Go to {tab.name}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function parseHash(hash: string): { activeTab: TabId | null; invalidHash: string | null } {
  const hashValue = hash.slice(1); // Remove #
  
  // Empty hash - default to transaction-validator
  if (!hashValue) {
    return { activeTab: "transaction-validator", invalidHash: null };
  }
  
  // Valid hash
  const tab = getTabFromHash();
  if (tab !== null) {
    return { activeTab: tab, invalidHash: null };
  }
  
  // Invalid hash
  return { activeTab: null, invalidHash: hashValue };
}

export default function UnifiedContent() {
  // Use useSyncExternalStore for proper subscription to hash changes
  const hash = useSyncExternalStore(subscribeToHash, getHashSnapshot, getServerSnapshot);
  
  const { activeTab, invalidHash } = parseHash(hash);

  const handleTabChange = useCallback((tab: TabId) => {
    window.history.pushState(null, "", `#${tab}`);
    // Dispatch event to trigger useSyncExternalStore update
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  // Prevent hydration mismatch - server returns SSR marker
  if (hash === SSR_MARKER) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin w-8 h-8 border-4 border-[#3182ce] border-t-transparent rounded-full" />
      </div>
    );
  }

  // Show error page for invalid hash
  if (invalidHash !== null) {
    return <InvalidHashError invalidHash={invalidHash} />;
  }

  // Safety check - should not happen but TypeScript needs it
  if (activeTab === null) {
    return <InvalidHashError invalidHash="" />;
  }

  return (
    <CompactLayout activeTab={activeTab} onTabChange={handleTabChange}>
      {/* All content components are rendered but only one is visible.
          This preserves state when switching tabs without re-mounting. */}
      <div className={activeTab === "transaction-validator" ? "block h-full" : "hidden"}>
        <TransactionValidatorContent />
      </div>
      <div className={activeTab === "cardano-cbor" ? "block h-full" : "hidden"}>
        <CardanoCborContent />
      </div>
      <div className={activeTab === "general-cbor" ? "block h-full" : "hidden"}>
        <GeneralCborContent />
      </div>
    </CompactLayout>
  );
}
