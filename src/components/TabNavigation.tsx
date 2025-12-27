"use client";

import * as Tabs from "@radix-ui/react-tabs";

export type TabId = "transaction-validator" | "cardano-cbor" | "general-cbor";

const tabs: { name: string; id: TabId }[] = [
  { name: "General CBOR", id: "general-cbor" },
  { name: "Cardano CBOR", id: "cardano-cbor" },
  { name: "Transaction Validator", id: "transaction-validator" },
];

const VALID_TABS: TabId[] = ["general-cbor", "cardano-cbor", "transaction-validator"];

export function isValidHash(hash: string): hash is TabId {
  return VALID_TABS.includes(hash as TabId);
}

export function getTabFromHash(): TabId | null {
  if (typeof window === "undefined") return "transaction-validator";
  const hash = window.location.hash.slice(1);
  
  // Empty hash - default to transaction-validator
  if (!hash) return "transaction-validator";
  
  // Valid hash
  if (isValidHash(hash)) return hash;
  
  // Invalid hash
  return null;
}

interface TabNavigationProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  const handleTabChange = (value: string) => {
    const tab = value as TabId;
    
    // Update URL hash without triggering page reload
    window.history.pushState(null, "", `#${tab}`);
    
    onTabChange(tab);
  };

  return (
    <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
      <Tabs.List className="flex gap-0.5 p-0.5 bg-white/50 backdrop-blur-sm rounded-lg border border-[#d1dbe6]">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.id}
            value={tab.id}
            asChild
          >
            <a
              href={`#${tab.id}`}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 outline-none data-[state=active]:bg-[#3182ce] data-[state=active]:text-white data-[state=active]:shadow-sm text-[#4a5568] hover:bg-[#edf2f7] hover:text-[#2d3748]"
            >
              {tab.name}
            </a>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
