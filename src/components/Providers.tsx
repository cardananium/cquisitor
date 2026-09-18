"use client";

import { ReactNode } from "react";
import { GeneralCborProvider } from "@/context/GeneralCborContext";
import { CardanoCborProvider } from "@/context/CardanoCborContext";
import { TransactionValidatorProvider } from "@/context/TransactionValidatorContext";
import { CddlValidatorProvider } from "@/context/CddlValidatorContext";
import WelcomeModal from "./WelcomeModal";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <GeneralCborProvider>
      <CardanoCborProvider>
        <TransactionValidatorProvider>
          <CddlValidatorProvider>
            {children}
            <WelcomeModal />
          </CddlValidatorProvider>
        </TransactionValidatorProvider>
      </CardanoCborProvider>
    </GeneralCborProvider>
  );
}
