"use client";

import Link from "next/link";
import useSWR from "swr";
import { TopBar } from "@/components/nav/top-bar";
import { EmptyState } from "@/components/ui/collection";
import { Cover } from "@/components/ui/cover";
import { fetcher } from "@/lib/client/api";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { usePlayer } from "@/lib/client/player/store";
import { formatCount } from "@/lib/util";

interface Stats {
  totalMs: number;
  totalPlays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  skipRate: number;
  topTracks: { id: string; plays: number }[];
  topArtists: { id: string; plays: number }[];
  topGenres: { name: string; share: number }[];
  hours: number[];
  persona: string;
  obsession?: string;
  recent: { trackId: string; at: number; outcome: string }[];
}

function Big({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-card p-4 sm:p-5">
      <div className="text-3xl font-extrabold tracking-tight sm:text-4xl">{value}</div>
      <div className="mt-1 text-sm text-subdued">{label}</div>
    </div>
  );
}

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function StatsPage() {
  const { data } = useSWR<Stats>("/api/me/stats", fetcher);
  const { catalog } = useCatalog();
  const maxHour = Math.max(1, ...(data?.hours ?? [1]));
  const obsession = data?.obsession ? catalog?.byId.get(data.obsession) : undefined;

  return (
    <div>
      <TopBar showBack={false}>
        <h1 className="text-2xl font-bold">Your stats</h1>
      </TopBar>
      <div className="-mt-14 bg-gradient-to-b from-[#1d5a3c] to-transparent px-4 pb-4 pt-20 sm:-mt-16 sm:px-6 sm:pt-24">
        <p className="text-sm font-bold uppercase tracking-widest text-white/70">Your listening</p>
        <h2 className="mt-2 text-4xl font-extrabold tracking-tight sm:text-6xl">{data?.persona ?? "…"}</h2>
        {obsession && (
          <p className="mt-3 text-white/80">
            Current obsession:{" "}
            <Link href={`/track/${obsession.id}`} className="font-bold text-white hover:underline">
              {obsession.title}
            </Link>{" "}
            by {obsession.artists.map((a) => a.name).join(", ")}
          </p>
        )}
      </div>
      {!data ? (
        <div className="mx-4 h-40 animate-pulse rounded-xl bg-white/5 sm:mx-6" />
      ) : data.totalPlays === 0 ? (
        <EmptyState title="No listening history yet" body="Play some music — your top songs, artists and habits will show up here." />
      ) : (
        <div className="space-y-8 px-4 sm:px-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <Big value={formatCount(Math.round(data.totalMs / 60000))} label="minutes listened" />
            <Big value={formatCount(data.totalPlays)} label="plays" />
            <Big value={formatCount(data.uniqueArtists)} label="artists" />
            <Big value={`${Math.round((1 - data.skipRate) * 100)}%`} label="songs played through" />
          </div>

          <section>
            <h2 className="mb-4 text-2xl font-bold">Top artists</h2>
            <div className="no-scrollbar flex gap-4 overflow-x-auto pb-1 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
              {data.topArtists.map((a, i) => {
                const artist = catalog?.artists.get(a.id);
                if (!artist) return null;
                return (
                  <Link key={a.id} href={`/artist/${a.id}`} className="w-[120px] shrink-0 sm:w-auto">
                    <Cover image={artistImage(artist)} className="aspect-square w-full shadow-cover" rounded="rounded-full" kind="artist" />
                    <div className="mt-2 truncate text-center text-sm font-bold">
                      {i + 1}. {artist.name}
                    </div>
                    <div className="text-center text-xs text-subdued">{a.plays} plays</div>
                  </Link>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold">Top songs</h2>
            <ol className="space-y-1">
              {data.topTracks.map((x, i) => {
                const t = catalog?.byId.get(x.id);
                if (!t) return null;
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => usePlayer.getState().playList(data.topTracks.map((y) => y.id), i, { type: "other", name: "Your top songs" })}
                      className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-white/10"
                    >
                      <span className="w-6 text-right text-subdued tabular-nums">{i + 1}</span>
                      <Cover image={t.cover} className="h-12 w-12 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{t.title}</div>
                        <div className="truncate text-sm text-subdued">{t.artists.map((a) => a.name).join(", ")}</div>
                      </div>
                      <span className="text-sm text-subdued tabular-nums">{x.plays}×</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <h2 className="mb-4 text-2xl font-bold">Your genres</h2>
              <div className="space-y-3">
                {data.topGenres.map((g) => (
                  <div key={g.name}>
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold">{g.name}</span>
                      <span className="tabular-nums text-subdued">{Math.round(g.share * 100)}%</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-white/10">
                      <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, g.share * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h2 className="mb-1 text-2xl font-bold">Listening clock</h2>
              <p className="mb-4 text-sm text-subdued">When you press play, by hour of day</p>
              <div className="flex h-32 items-end gap-[3px]" role="img" aria-label="Plays by hour of day">
                {data.hours.map((v, h) => (
                  <div key={h} className="group relative flex-1">
                    <div className="w-full rounded-t-sm bg-accent/80 transition-colors group-hover:bg-accent" style={{ height: `${Math.max(2, (v / maxHour) * 128)}px` }} />
                    <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-white px-1.5 text-[10px] font-bold text-black group-hover:block">{v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-subdued">
                <span>12am</span>
                <span>6am</span>
                <span>12pm</span>
                <span>6pm</span>
                <span>11pm</span>
              </div>
            </section>
          </div>

          <section>
            <h2 className="mb-3 text-2xl font-bold">Recently played</h2>
            <ul className="divide-y divide-white/5">
              {data.recent.map((r, i) => {
                const t = catalog?.byId.get(r.trackId);
                if (!t) return null;
                return (
                  <li key={`${r.trackId}-${i}`} className="flex items-center gap-3 py-2">
                    <Cover image={t.cover} className="h-10 w-10 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{t.title}</div>
                      <div className="truncate text-xs text-subdued">{t.artists.map((a) => a.name).join(", ")}</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.outcome === "skip" ? "bg-white/10 text-subdued" : "bg-accent/15 text-accent"}`}>
                      {r.outcome === "complete" ? "Finished" : r.outcome === "skip" ? "Skipped" : "Played"}
                    </span>
                    <span className="w-16 text-right text-xs text-subdued">{ago(r.at)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
