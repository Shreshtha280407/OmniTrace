"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { useState } from "react";

import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // A 404 or a contract mismatch will not become truthful on retry;
            // only transport-level failures are worth repeating.
            retry: (failureCount, error) =>
              error instanceof ApiError ? error.retryable && failureCount < 3 : failureCount < 2,
            retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={350} skipDelayDuration={200}>
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
