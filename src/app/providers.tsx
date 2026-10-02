"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { WalletProvider } from "@/components/wallet-ctx";
import { ZipKeyProvider } from "@/components/zip-key";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <WalletProvider>
        <ZipKeyProvider>{children}</ZipKeyProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}
