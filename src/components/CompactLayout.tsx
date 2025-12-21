"use client";

import Image from "next/image";
import TabNavigation from "./TabNavigation";
import GitHubStarButton from "./GitHubStarButton";
import logo32 from "../../public/logo-32.png";

interface CompactLayoutProps {
  children: React.ReactNode;
}

export default function CompactLayout({ children }: CompactLayoutProps) {
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
          <div className="flex items-center gap-4">
            <TabNavigation />
            <GitHubStarButton />
          </div>
        </div>
      </header>
      <main className="compact-main">{children}</main>
    </div>
  );
}
