"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import { api } from "@/lib/client/api";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { useMe } from "@/lib/client/me";
import { toast } from "@/lib/client/toast";
import { CheckCircleIcon } from "../icons";
import { Cover } from "../ui/cover";

const DISMISSED = "pepper.onboardingDismissed";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
};
const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED);
  } catch {
    return null;
  }
};

/**
 * Cold start without a full-screen gate: a card on Home with the biggest artists in the catalog.
 * Picking a few seeds the taste profile; "Not now" hides the card on this device, and the full
 * picker stays available at /onboarding.
 */
export function OnboardingCard() {
  const { data: me } = useMe();
  const { catalog } = useCatalog();
  const { mutate } = useSWRConfig();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const uid = me?.user.uid;
  // The server snapshot reads as "dismissed" so the card never flashes before hydration.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => uid ?? "") === uid;
  const artists = useMemo(() => [...(catalog?.artists.values() ?? [])].sort((a, b) => b.trackIds.length - a.trackIds.length).slice(0, 24), [catalog]);
  if (!me || me.user.onboarded || dismissed || artists.length < 3) return null;

  const finish = async () => {
    setBusy(true);
    try {
      await api("/api/me/onboarding", { body: { artistIds: picked } });
      await Promise.all([mutate("/api/me"), mutate("/api/home")]);
      toast(picked.length ? "Thanks! Home is now tuned to your taste" : "You can pick favourite artists any time");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, uid!);
    } catch {
      /* ignore */
    }
    for (const fn of listeners) fn();
  };

  return (
    <section className="mx-4 mt-4 rounded-xl bg-gradient-to-br from-[#1f3a2a] to-card p-4 sm:mx-6 sm:p-5" aria-label="Pick your favourite artists">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Make Home yours</h2>
          <p className="mt-0.5 text-sm text-subdued">Pick a few artists you like and your mixes get personal right away.</p>
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 text-sm font-semibold text-subdued hover:text-white">Not now</button>
      </div>
      <div className="no-scrollbar -mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5">
        {artists.map((a) => {
          const on = picked.includes(a.id);
          return (
            <button key={a.id} type="button" onClick={() => setPicked(on ? picked.filter((x) => x !== a.id) : [...picked, a.id])} className="flex w-[88px] shrink-0 flex-col items-center gap-2" aria-pressed={on}>
              <span className="relative block w-full">
                <Cover image={artistImage(a)} className={`aspect-square w-full transition ${on ? "scale-95 opacity-80" : ""}`} rounded="rounded-full" kind="artist" />
                {on && <span className="absolute -right-1 -top-1 rounded-full bg-white text-accent"><CheckCircleIcon size={24} /></span>}
              </span>
              <span className="line-clamp-2 text-center text-xs font-semibold leading-tight">{a.name}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !picked.length} onClick={() => void finish()} className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-40">
          {picked.length >= 3 ? `Done (${picked.length})` : picked.length ? `Pick ${3 - picked.length} more` : "Pick 3 artists"}
        </button>
        <Link href="/onboarding" className="text-sm font-semibold text-subdued hover:text-white">Browse all artists</Link>
      </div>
    </section>
  );
}
