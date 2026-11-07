"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/client/api";
import { AuthProvider, useAuth } from "@/lib/client/auth";
import { persistentCache } from "@/lib/client/persist";
import { AppShell } from "./app-shell";

export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider><AccountData>{children}</AccountData></AuthProvider>;
}

function AccountData({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <SWRConfig
      key={user?.uid ?? "signed-out"}
      value={{
        fetcher,
        provider: () => persistentCache(user?.uid),
        shouldRetryOnError: (err) => (err as { status?: number })?.status !== 401 && (err as { status?: number })?.status !== 403,
      }}
    >
      <AppShell>{children}</AppShell>
    </SWRConfig>
  );
}
