"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { CheckCircleIcon, SearchIcon } from "@/components/icons";
import { Cover } from "@/components/ui/cover";
import { api } from "@/lib/client/api";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { toast } from "@/lib/client/toast";
import { fold } from "@/lib/util";

/** Cold start: pick a few artists so the very first home feed is already personal. */
export default function OnboardingPage() {
  const { mutate } = useSWRConfig();
  const { catalog } = useCatalog();
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const artists = useMemo(() => {
    const list = [...(catalog?.artists.values() ?? [])].sort((a, b) => b.trackIds.length - a.trackIds.length);
    const f = fold(q);
    return f ? list.filter((a) => fold(a.name).includes(f)) : list;
  }, [catalog, q]);

  const done = async (skip = false) => {
    setBusy(true);
    try {
      await api("/api/me/onboarding", { body: { artistIds: skip ? [] : picked } });
      await Promise.all([mutate("/api/me"), mutate("/api/home")]);
      router.replace("/");
    } catch (e) {
      toast((e as Error).message, "error");
      router.replace("/");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-surface pb-32">
      <div className="sticky top-0 z-10 bg-surface/95 px-4 pb-4 pt-[max(24px,env(safe-area-inset-top))] backdrop-blur sm:px-8">
        <h1 className="text-center text-2xl font-bold sm:text-3xl">Choose 3 or more artists you like.</h1>
        <div className="relative mx-auto mt-4 max-w-md">
          <SearchIcon size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-11 w-full rounded-md bg-white pl-10 pr-3 text-black outline-none" aria-label="Search artists" />
        </div>
      </div>
      <div className="mx-auto grid max-w-5xl grid-cols-3 gap-x-4 gap-y-6 px-4 sm:grid-cols-4 sm:px-8 lg:grid-cols-6">
        {artists.map((a) => {
          const on = picked.includes(a.id);
          return (
            <button key={a.id} type="button" onClick={() => setPicked(on ? picked.filter((x) => x !== a.id) : [...picked, a.id])} className="flex flex-col items-center gap-2" aria-pressed={on}>
              <span className="relative block w-full">
                <Cover image={artistImage(a)} className={`aspect-square w-full transition ${on ? "scale-95 opacity-80" : ""}`} rounded="rounded-full" kind="artist" />
                {on && (
                  <span className="absolute right-0 top-0 rounded-full bg-white text-accent">
                    <CheckCircleIcon size={28} />
                  </span>
                )}
              </span>
              <span className="line-clamp-2 text-center text-sm font-semibold">{a.name}</span>
            </button>
          );
        })}
      </div>
      <div className="fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black via-black/90 to-transparent px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-10">
        <button
          type="button"
          disabled={busy || picked.length < 1}
          onClick={() => done()}
          className="rounded-full bg-white px-12 py-3.5 text-base font-bold text-black transition hover:scale-105 disabled:opacity-40"
        >
          {picked.length >= 3 ? "Done" : `Pick ${3 - picked.length} more`}
        </button>
        <button type="button" onClick={() => done(true)} className="text-sm font-semibold text-subdued hover:text-white">
          Skip for now
        </button>
      </div>
    </div>
  );
}
