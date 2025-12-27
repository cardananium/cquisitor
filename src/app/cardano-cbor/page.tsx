"use client";

import { useEffect } from "react";

export default function CardanoCborRedirect() {
  useEffect(() => {
    const basePath = window.location.pathname.replace(/\/cardano-cbor\/?$/, "");
    window.location.replace(`${basePath}/#cardano-cbor`);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-[#3182ce] border-t-transparent rounded-full" />
    </div>
  );
}
