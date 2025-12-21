"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";

const tabs = [
  { name: "General CBOR", href: "/general-cbor" },
  { name: "Cardano CBOR", href: "/cardano-cbor" },
  { name: "Transaction Validator", href: "/" },
];

export default function TabNavigation() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <Tabs.Root value={pathname} onValueChange={(value) => router.push(value)}>
      <Tabs.List className="flex gap-0.5 p-0.5 bg-white/50 backdrop-blur-sm rounded-lg border border-[#d1dbe6]">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.href}
            value={tab.href}
            asChild
          >
            <Link
              href={tab.href}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 outline-none data-[state=active]:bg-[#3182ce] data-[state=active]:text-white data-[state=active]:shadow-sm text-[#4a5568] hover:bg-[#edf2f7] hover:text-[#2d3748]"
            >
              {tab.name}
            </Link>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

