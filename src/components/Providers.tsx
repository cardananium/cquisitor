"use client";

import { ReactNode } from "react";
import { GeneralCborProvider } from "@/context/GeneralCborContext";
import { CardanoCborProvider } from "@/context/CardanoCborContext";
import { TransactionValidatorProvider } from "@/context/TransactionValidatorContext";
import WelcomeModal from "./WelcomeModal";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <GeneralCborProvider>
      <CardanoCborProvider>
        <TransactionValidatorProvider>
          {children}
          <WelcomeModal />
        </TransactionValidatorProvider>
      </CardanoCborProvider>
    </GeneralCborProvider>
  );
}
