"use client";

import * as Tabs from "@radix-ui/react-tabs";

export type TabId =
  | "transaction-validator"
  | "cardano-cbor"
  | "general-cbor"
  | "cddl-validator"
  | "json-viewer";

/** A tab of the main shell. `json-viewer` is not one — see STANDALONE_HASHES. */
export type ShellTabId = Exclude<TabId, "json-viewer">;

export interface TabDefinition {
  id: ShellTabId;
  /** Nav label, and the name the tab is called by everywhere else. */
  name: string;
  /** One line about the tab, for the welcome modal card. */
  description: string;
  /** Accent colour of that card. */
  accent: string;
  /** When false, hidden from nav/welcome/invalid-hash fallback but still reachable by hash. */
  visible: boolean;
}

/** Canonical tab list; nav, invalid-hash fallback, and welcome modal all render this order. */
export const TABS: readonly TabDefinition[] = [
  {
    id: "general-cbor",
    name: "General CBOR",
    description:
      "Any CBOR as an editable hex view linked to a tree: click a node to light its bytes, see non-canonical encodings and where malformed input breaks.",
    accent: "#8b5cf6",
    visible: true,
  },
  {
    id: "cardano-cbor",
    name: "Cardano CBOR",
    description:
      "Decode CBOR as a ledger type — transaction, block, witness set, datum, address, script and more. The possible types are detected for you.",
    accent: "#3b82f6",
    visible: true,
  },
  {
    id: "cddl-validator",
    name: "CDDL Tool",
    description:
      "Check CBOR against a CDDL schema — your own or any ledger era. Each mismatch points at the bytes and the schema rule; pin a node to light it in every panel.",
    accent: "#f59e0b",
    visible: true,
  },
  {
    id: "transaction-validator",
    name: "Transaction Validator",
    description:
      "Phase-1 and Phase-2 validation against live chain data. Load a tx by hash, see each script's budget, jump from an error to its field, debug scripts in de-uplc.",
    accent: "#22c55e",
    visible: true,
  },
];

export const VISIBLE_TABS: readonly TabDefinition[] = TABS.filter((t) => t.visible);

/** Hash routes that are full-page views rather than tabs of the shell. */
const STANDALONE_HASHES = ["json-viewer"] as const;

const VALID_TABS: readonly TabId[] = [...TABS.map((t) => t.id), ...STANDALONE_HASHES];

function stripQuery(hashPart: string): string {
  const qIdx = hashPart.indexOf("?");
  return qIdx >= 0 ? hashPart.slice(0, qIdx) : hashPart;
}

export function isValidHash(hash: string): hash is TabId {
  return VALID_TABS.includes(stripQuery(hash) as TabId);
}

export function getTabFromHash(): TabId | null {
  if (typeof window === "undefined") return "transaction-validator";
  const hash = stripQuery(window.location.hash.slice(1));

  // Empty hash - default to transaction-validator
  if (!hash) return "transaction-validator";

  // Valid hash
  if (VALID_TABS.includes(hash as TabId)) return hash as TabId;

  // Invalid hash
  return null;
}

interface TabNavigationProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  // The parent records the tab in the URL hash (one history entry per switch).
  const handleTabChange = (value: string) => {
    onTabChange(value as TabId);
  };

  return (
    <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
      <Tabs.List className="flex gap-0.5 p-0.5 bg-white/50 backdrop-blur-sm rounded-lg border border-[#d1dbe6]">
        {VISIBLE_TABS.map((tab) => (
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
