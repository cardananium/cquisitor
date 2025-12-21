"use client";

import Image from "next/image";
import TabNavigation from "./TabNavigation";
import GitHubStarButton from "./GitHubStarButton";

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-[#e8f0f7]">
      <header className="sticky top-0 z-50 py-2 px-4 bg-[#e8f0f7]/85 backdrop-blur-md border-b border-[#d1dbe6]/50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-32.png"
              alt="CQuisitor Logo"
              width={24}
              height={24}
              className="rounded-md"
            />
            <span className="text-sm font-semibold text-[#2d3748]">CQuisitor</span>
          </div>
          <div className="flex items-center gap-4">
            <TabNavigation />
            <GitHubStarButton />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-4">{children}</main>
    </div>
  );
}

