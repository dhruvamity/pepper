"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { ColumnChart, Meter, RankList, SERIES_1, SERIES_2, StatTile } from "@/components/admin/charts";
import { Cover } from "@/components/ui/cover";
import { api, fetcher } from "@/lib/client/api";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { toast } from "@/lib/client/toast";
import { formatBytes, formatCount, formatDuration } from "@/lib/util";

interface Rate {
  plays: number;
  completes: number;
  skips: number;
  completionRate: number;
  skipRate: number;
}
interface Analytics {
  range: { from: string; to: string; days: number };
  kpis: {
    tracks: number;
    artists: number;
    albums: number;
    users: number;
    newUsers: number;
    plays: number;
    hours: number;
    completionRate: number;
    skipRate: number;
    dau: number;
    wau: number;
    mau: number;
    libraryHours: number;
  };
  series: { day: string; plays: number; minutes: number; users: number }[];
  hours: number[];
  topTracks: { id: string; plays: number }[];
  topArtists: { id: string; plays: number }[];
  topGenres: { name: string; plays: number }[];
  mostSkipped: { id: string; skipRate: number; events: number }[];
  recommendations: { recommended: Rate; organic: Rate; bySource: Record<string, { plays: number; completes: number; skips: number }> };
  recent: { id: string; at: number; user: string; trackId: string; outcome: string; listenedMs: number; durationMs: number; source: string }[];
  users: { uid: string; name: string; email?: string; lastSeenAt: number; createdAt: number }[];
  storage: { id: string; label: string; bucket?: string; quotaBytes: number; used: number; objects: number }[];
  backends: { db: string; storage: string; strategy: string };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function Card({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {sub && <p className="text-xs text-subdued">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function RecRow({ name, color, r }: { name: string; color: string; r: Rate }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} />
          {name}
        </span>
        <span className="text-xs text-subdued">{r.plays.toLocaleString()} plays</span>
      </div>
      <div className="mt-2 grid grid-cols-[80px_1fr_44px] items-center gap-2 text-xs text-subdued">
        <span>Finished</span>
        <Meter value={r.completionRate} max={1} color={color} label={`${name} completion rate`} />
        <span className="text-right font-semibold tabular-nums text-white">{pct(r.completionRate)}</span>
        <span>Skipped</span>
        <Meter value={r.skipRate} max={1} color={color} label={`${name} skip rate`} />
        <span className="text-right font-semibold tabular-nums text-white">{pct(r.skipRate)}</span>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useSWR<Analytics>(`/api/admin/analytics?days=${days}`, fetcher, { keepPreviousData: true, refreshInterval: 60_000 });
  const { catalog } = useCatalog();
  const [showTable, setShowTable] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const k = data?.kpis;

  return (
    <div className={`space-y-4 px-4 pb-6 sm:px-6 ${isLoading && data ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${days === d ? "bg-white text-black" : "bg-white/10 hover:bg-white/20"}`}
          >
            Last {d} days
          </button>
        ))}
        {data && (
          <span className="ml-auto text-xs text-muted">
            Database: {data.backends.db} · Storage: {data.backends.storage} ({data.backends.strategy})
          </span>
        )}
      </div>

      {!data ? (
        <div className="h-64 animate-pulse rounded-lg bg-card" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Plays" value={formatCount(k!.plays)} sub={`last ${days} days`} />
            <StatTile label="Listening time" value={k!.hours < 1 ? `${Math.round(k!.hours * 60)} min` : `${k!.hours.toFixed(k!.hours < 10 ? 1 : 0)} h`} sub={`${Math.round((k!.hours * 60) / Math.max(1, k!.mau))} min per listener`} />
            <StatTile label="Active listeners" value={String(k!.mau)} sub={`${k!.dau} today · ${k!.wau} this week`} />
            <StatTile label="Finish rate" value={pct(k!.completionRate)} sub="streams played to the end" />
            <StatTile label="Skip rate" value={pct(k!.skipRate)} sub="skipped in the first 30 s" />
            <StatTile label="Library" value={formatCount(k!.tracks)} sub={`${k!.artists} artists · ${k!.albums} albums · ${k!.libraryHours.toFixed(1)} h`} />
          </div>

          <Card
            title="Plays per day"
            sub={`${shortDay(data.range.from)} – ${shortDay(data.range.to)}`}
            action={
              <button type="button" onClick={() => setShowTable(!showTable)} className="text-xs font-semibold text-subdued hover:text-white">
                {showTable ? "Show chart" : "Show table"}
              </button>
            }
          >
            {showTable ? (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-subdued">
                    <tr>
                      <th className="py-1 font-semibold">Day</th>
                      <th className="py-1 text-right font-semibold">Plays</th>
                      <th className="py-1 text-right font-semibold">Minutes</th>
                      <th className="py-1 text-right font-semibold">Listeners</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {[...data.series].reverse().map((s) => (
                      <tr key={s.day} className="border-t border-white/5">
                        <td className="py-1">{shortDay(s.day)}</td>
                        <td className="py-1 text-right">{s.plays}</td>
                        <td className="py-1 text-right">{s.minutes}</td>
                        <td className="py-1 text-right">{s.users}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ColumnChart
                ariaLabel="Plays per day"
                xEvery={days <= 7 ? 1 : days <= 30 ? 5 : 15}
                data={data.series.map((s) => ({
                  label: shortDay(s.day),
                  value: s.plays,
                  detail: [
                    { k: "Minutes", v: s.minutes.toLocaleString() },
                    { k: "Listeners", v: String(s.users) },
                  ],
                }))}
              />
            )}
          </Card>

          {/* grid-cols-1 = minmax(0, 1fr): without it, phones get an auto-sized column that wide content can stretch past the screen. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Recommendation quality" sub="Plays from mixes, radio & autoplay vs. songs listeners picked themselves">
              <div className="space-y-5">
                <RecRow name="Recommended by Pepper" color={SERIES_1} r={data.recommendations.recommended} />
                <RecRow name="Chosen by listeners" color={SERIES_2} r={data.recommendations.organic} />
              </div>
              <p className="mt-4 text-xs text-muted">
                A recommended finish rate at or above the organic one means recommendations are landing. Sources:{" "}
                {Object.entries(data.recommendations.bySource)
                  .filter(([, v]) => v.plays)
                  .map(([s, v]) => `${s} ${v.plays}`)
                  .join(" · ") || "none yet"}
              </p>
            </Card>
            <Card title="Listening clock" sub="Plays by hour of day (listener's local time)">
              <ColumnChart ariaLabel="Plays by hour of day" xEvery={6} height={160} data={data.hours.map((v, h) => ({ label: `${String(h).padStart(2, "0")}:00`, value: v }))} />
            </Card>
          </div>

          <Card
            title="Storage"
            sub={
              data.storage.length < 2
                ? "All uploads go to this bucket"
                : data.backends.strategy === "balance"
                  ? "Each upload goes to the bucket with the most free space"
                  : "Uploads fill one bucket at a time, moving on when it is full"
            }
            action={
              <button
                type="button"
                disabled={reconciling}
                onClick={async () => {
                  setReconciling(true);
                  try {
                    await api("/api/admin/storage", { method: "POST" });
                    await mutate(`/api/admin/analytics?days=${days}`);
                    toast("Storage usage re-counted");
                  } catch (e) {
                    toast((e as Error).message, "error");
                  } finally {
                    setReconciling(false);
                  }
                }}
                className="shrink-0 whitespace-nowrap text-xs font-semibold text-subdued hover:text-white"
              >
                {reconciling ? "Counting…" : "Re-count"}
              </button>
            }
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.storage.map((p) => {
                const ratio = p.quotaBytes ? p.used / p.quotaBytes : 0;
                return (
                  <div key={p.id} className="min-w-0">
                    <p className="truncate text-sm font-semibold" title={p.label}>
                      {p.label}
                    </p>
                    <p className="mt-0.5 truncate text-xs tabular-nums text-subdued">
                      {p.bucket && <span className="text-muted">{p.bucket} · </span>}
                      {formatBytes(p.used)}
                      {p.quotaBytes ? ` of ${formatBytes(p.quotaBytes)}` : ""} · {p.objects} files
                    </p>
                    {p.quotaBytes > 0 && (
                      <div className="mt-2">
                        <Meter value={p.used} max={p.quotaBytes} color={ratio > 0.85 ? "#fab219" : SERIES_1} label={`${p.label} usage`} />
                      </div>
                    )}
                    {p.quotaBytes === 0 ? (
                      <p className="mt-1 text-xs text-subdued">Quota is 0: still plays its songs, takes no new uploads</p>
                    ) : (
                      ratio > 0.85 && (
                        <p className="mt-1 text-xs font-semibold text-warning">
                          {data.storage.length > 1 ? "⚠ Almost full — new uploads go to the other buckets" : "⚠ Almost full — raise the quota or add another bucket"}
                        </p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Top songs">
              <RankList
                rows={data.topTracks.map((t) => {
                  const tr = catalog?.byId.get(t.id);
                  return { key: t.id, label: tr?.title ?? t.id, sub: tr?.artists.map((a) => a.name).join(", "), value: t.plays, lead: <Cover image={tr?.cover} className="h-9 w-9 shrink-0" /> };
                })}
              />
            </Card>
            <Card title="Top artists">
              <RankList
                rows={data.topArtists.map((a) => {
                  const ar = catalog?.artists.get(a.id);
                  return { key: a.id, label: ar?.name ?? a.id, value: a.plays, lead: <Cover image={artistImage(ar)} className="h-9 w-9 shrink-0" rounded="rounded-full" kind="artist" /> };
                })}
              />
            </Card>
            <Card title="Top genres">
              <RankList rows={data.topGenres.map((g) => ({ key: g.name, label: g.name, value: g.plays }))} />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Recent activity" sub="Latest listening events">
              <ul className="divide-y divide-white/5">
                {data.recent.map((e) => {
                  const t = catalog?.byId.get(e.trackId);
                  return (
                    <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                      <Cover image={t?.cover} className="h-9 w-9 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          <span className="font-semibold">{e.user}</span> <span className="text-subdued">played</span> {t?.title ?? "a deleted song"}
                        </div>
                        <div className="text-xs text-subdued">
                          {formatDuration(e.listenedMs)} of {formatDuration(e.durationMs)} · from {e.source} · {new Date(e.at).toLocaleString()}
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.outcome === "skip" ? "bg-white/10 text-subdued" : e.outcome === "complete" ? "bg-accent/15 text-accent" : "bg-white/10 text-white"}`}>
                        {e.outcome === "complete" ? "Finished" : e.outcome === "skip" ? "Skipped" : e.outcome === "stream" ? "Played" : "Brief"}
                      </span>
                    </li>
                  );
                })}
                {!data.recent.length && <li className="py-6 text-center text-sm text-subdued">No listening yet.</li>}
              </ul>
            </Card>
            <div className="min-w-0 space-y-4">
              <Card title="Most skipped" sub="Songs listeners skip early (min. 3 plays)">
                <ul className="space-y-2">
                  {data.mostSkipped.map((s) => {
                    const t = catalog?.byId.get(s.id);
                    return (
                      <li key={s.id} className="flex items-center gap-3 text-sm">
                        <Cover image={t?.cover} className="h-9 w-9 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{t?.title}</span>
                        <span className="text-xs tabular-nums text-subdued">
                          {pct(s.skipRate)} of {s.events}
                        </span>
                      </li>
                    );
                  })}
                  {!data.mostSkipped.length && <li className="py-4 text-center text-sm text-subdued">Not enough data yet.</li>}
                </ul>
              </Card>
              <Card title="Listeners" sub={`${k!.users} total · ${k!.newUsers} new in the last ${days} days`}>
                <ul className="divide-y divide-white/5 text-sm">
                  {data.users.slice(0, 8).map((u) => (
                    <li key={u.uid} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{u.name}</div>
                        <div className="truncate text-xs text-subdued">{u.email ?? u.uid}</div>
                      </div>
                      <span className="shrink-0 text-xs text-subdued">seen {new Date(u.lastSeenAt).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
          <p className="text-center text-xs text-muted">
            <Link href="/admin/upload" className="hover:text-white hover:underline">
              Upload more music
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
