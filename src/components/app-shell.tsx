"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useCatalog } from "@/lib/client/catalog";
import { useMe } from "@/lib/client/me";
import { Logo } from "./icons";
import { BottomNav } from "./nav/bottom-nav";
import { ProfileSheet } from "./nav/profile-sheet";
import { ScrollCtx } from "./nav/scroll";
import { Sidebar } from "./nav/sidebar";
import { PlayerEngine } from "./player/engine";
import { ListeningActivityPublisher } from "./player/listening-activity";
import { JamPanel } from "./player/jam-panel";
import { MiniPlayer } from "./player/mini-player";
import { NowPlaying } from "./player/now-playing";
import { PlayerBar } from "./player/player-bar";
import { QueuePanel } from "./player/queue-panel";
import { AddToPlaylistSheet, CreditsSheet, Toasts, TrackMenuSheet } from "./ui/global-sheets";

const PUBLIC = ["/login"];
const BARE = ["/login", "/onboarding"];

function Splash() {
  return (
    <div className="flex h-dvh items-center justify-center bg-black">
      <Logo className="animate-pulse text-3xl text-white" />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.includes(path);
  const bare = BARE.includes(path);

  useEffect(() => {
    if (status === "signedOut" && !isPublic) router.replace(`/login${path !== "/" ? `?next=${encodeURIComponent(path)}` : ""}`);
    if (status === "signedIn" && path === "/login") {
      const next = new URLSearchParams(location.search).get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/");
    }
  }, [status, isPublic, path, router]);

  if (status === "loading") return <Splash />;
  if (status === "signedOut") return isPublic ? <>{children}</> : <Splash />;
  if (path === "/login") return <Splash />;
  return (
    <SignedIn bare={bare} path={path}>
      {children}
    </SignedIn>
  );
}

/** Shown when Pepper is invite-only and this account isn't on the guest list. */
function NotInvited({ message }: { message: string }) {
  const { signOut } = useAuth();
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-black px-6 text-center">
      <Logo className="text-3xl text-white" />
      <h1 className="text-2xl font-bold">You&apos;re not on the guest list yet</h1>
      <p className="max-w-sm text-subdued">{message}</p>
      <button type="button" onClick={() => void signOut()} className="rounded-full bg-white px-8 py-3 font-bold text-black hover:scale-105">
        Use another account
      </button>
    </div>
  );
}

function SignedIn({ children, bare, path }: { children: React.ReactNode; bare: boolean; path: string }) {
  const { data: me, error: meError } = useMe();
  const { catalog } = useCatalog();
  const router = useRouter();
  const [main, setMain] = useState<HTMLElement | null>(null);

  // First visit: ask for favourite artists so recommendations are good from day one.
  useEffect(() => {
    if (!me || !catalog || me.user.onboarded || path === "/onboarding" || path.startsWith("/admin") || path.startsWith("/jam/")) return;
    if (catalog.artists.size >= 3 && !sessionStorage.getItem("pepper.skipOnboarding")) router.replace("/onboarding");
  }, [me, catalog, path, router]);

  // Scroll to top on navigation (the main element is the scroll container).
  useEffect(() => {
    main?.scrollTo({ top: 0 });
  }, [path, main]);

  if (meError instanceof ApiError && (meError.data as { code?: string } | undefined)?.code === "not_invited") {
    return <NotInvited message={meError.message} />;
  }
  if (bare) {
    return (
      <>
        {children}
        <Toasts />
      </>
    );
  }
  return (
    <div className="flex h-dvh flex-col bg-black">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main ref={setMain} id="main" className="scroll-area relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface">
          <ScrollCtx.Provider value={main}>{children}</ScrollCtx.Provider>
          <div className="h-[calc(var(--mini-player-h)+var(--bottom-nav-h)+env(safe-area-inset-bottom)+20px)] md:h-10" aria-hidden="true" />
        </main>
      </div>
      <PlayerBar />
      <div className="fixed inset-x-0 bottom-0 z-40 md:hidden">
        <MiniPlayer />
        <BottomNav />
      </div>
      <NowPlaying />
      <QueuePanel />
      <TrackMenuSheet />
      <AddToPlaylistSheet />
      <CreditsSheet />
      <ProfileSheet />
      <Toasts />
      <PlayerEngine />
      <ListeningActivityPublisher />
      <JamPanel />
    </div>
  );
}
