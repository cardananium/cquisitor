"use client";

import { useEffect, useState } from "react";
import { parseTxPath, txLinkHash } from "@/utils/shareLink/txLink";

// The site is a static export, so this page is what the host serves for any path it has no file
// for. `/tx/<hash>` is one of those on purpose: it is the short link to an on-chain transaction,
// and this page forwards it to the hash route the Transaction Validator reads.
export default function NotFound() {
  const [forwarding, setForwarding] = useState(true);

  useEffect(() => {
    const target = parseTxPath(window.location.pathname, window.location.search);
    if (target) {
      window.location.replace(`${target.basePath}/${txLinkHash(target)}`);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForwarding(false);
  }, []);

  if (forwarding) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-[#3182ce] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-center px-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm opacity-80">
        Nothing lives at this address. Transactions are at <code>/tx/&lt;hash&gt;</code>.
      </p>
      <a href="./" className="text-[#3182ce] underline text-sm">
        Go to CQuisitor
      </a>
    </div>
  );
}
