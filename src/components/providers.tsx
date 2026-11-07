"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/client/api";
import { AuthProvider } from "@/lib/client/auth";
import { AppShell } from "./app-shell";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, shouldRetryOnError: (err) => (err as { status?: number })?.status !== 401 && (err as { status?: number })?.status !== 403 }}>
      <AuthProvider>
        <AppShell>{children}</AppShell>
      </AuthProvider>
    </SWRConfig>
  );
}
