"use client";

import { useEffect } from "react";

// The JSON viewer lives at the `#json-viewer` hash route inside the SPA;
// this page only redirects bare `/json-viewer` visits there.
export default function JsonViewerRedirect() {
  useEffect(() => {
    const basePath = window.location.pathname.replace(/\/json-viewer\/?$/, "");
    window.location.replace(`${basePath}/#json-viewer`);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-[#3182ce] border-t-transparent rounded-full" />
    </div>
  );
}
