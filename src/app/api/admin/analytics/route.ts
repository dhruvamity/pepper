import { requireAdmin } from "@/lib/server/auth";
import { describeBackends } from "@/lib/server/env";
import { repo } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { lastNDays } from "@/lib/util";

const REC_SOURCES = new Set(["mix", "radio", "autoplay"]);

/** Everything the admin dashboard shows, from daily aggregates (one read per day). */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days")) || 30));
  const db = await repo();
  const dayKeys = lastNDays(days);
  const [daily, catalog, stats, users, userCount, newUsers, recent, usage] = await Promise.all([
    db.getDaily(dayKeys),
    db.getCatalog(),
    db.getTrackStats(),
    db.listUsers(50),
    db.countUsers(),
    db.countUsers(Date.now() - days * 86_400_000),
    db.recentPlays(25),
    db.getStorageUsage(),
  ]);
  const byId = new Map(catalog.tracks.map((t) => [t.id, t]));

  const sum = (f: (d: (typeof daily)[number]) => number) => daily.reduce((a, d) => a + f(d), 0);
  const plays = sum((d) => d.plays);
  const events = sum((d) => d.events);
  const completes = sum((d) => d.completes);
  const skips = sum((d) => d.skips);
  const ms = sum((d) => d.ms);
  const unionUsers = (n: number) => {
    const s = new Set<string>();
    for (const d of daily.slice(-n)) Object.keys(d.users).forEach((u) => s.add(u));
    return s.size;
  };

  const trackTotals = new Map<string, number>();
  const hours = Array.from({ length: 24 }, () => 0);
  const sources: Record<string, { plays: number; completes: number; skips: number }> = {};
  for (const d of daily) {
    for (const [id, n] of Object.entries(d.tracks)) trackTotals.set(id, (trackTotals.get(id) ?? 0) + n);
    for (const [h, n] of Object.entries(d.hours)) hours[Number(h)] += n;
    for (const [k, v] of Object.entries(d.sources)) {
      const s = (sources[k] ??= { plays: 0, completes: 0, skips: 0 });
      s.plays += v.plays;
      s.completes += v.completes;
      s.skips += v.skips;
    }
  }
  const topTracks = [...trackTotals]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, n]) => ({ id, plays: n }));
  const artistTotals = new Map<string, number>();
  const genreTotals = new Map<string, number>();
  for (const [id, n] of trackTotals) {
    const t = byId.get(id);
    if (!t) continue;
    for (const a of t.artists) artistTotals.set(a.id, (artistTotals.get(a.id) ?? 0) + n);
    for (const g of t.genres) genreTotals.set(g, (genreTotals.get(g) ?? 0) + n);
  }
  const topArtists = [...artistTotals].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ id, plays: n }));
  const topGenres = [...genreTotals].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, plays: n }));

  // Recommendation quality: completion/skip rates of plays we recommended vs. ones users chose.
  const agg = (pred: (k: string) => boolean) => {
    const a = { plays: 0, completes: 0, skips: 0 };
    for (const [k, v] of Object.entries(sources)) {
      if (!pred(k)) continue;
      a.plays += v.plays;
      a.completes += v.completes;
      a.skips += v.skips;
    }
    return { ...a, completionRate: a.plays ? a.completes / a.plays : 0, skipRate: a.plays + a.skips ? a.skips / (a.plays + a.skips) : 0 };
  };

  const mostSkipped = Object.entries(stats)
    .filter(([id, s]) => byId.has(id) && s.plays + s.skips >= 3)
    .map(([id, s]) => ({ id, skipRate: s.skips / (s.plays + s.skips), events: s.plays + s.skips }))
    .sort((a, b) => b.skipRate - a.skipRate)
    .slice(0, 6);

  const userNames = new Map(users.map((u) => [u.uid, u.name]));
  const unnamed = [...new Set(recent.map((e) => e.uid))].filter((uid) => !userNames.has(uid));
  for (const p of await Promise.all(unnamed.map((uid) => db.getUser(uid)))) if (p) userNames.set(p.uid, p.name);
  const today = daily[daily.length - 1];
  const backends = describeBackends();

  return json({
    range: { from: dayKeys[0], to: dayKeys[dayKeys.length - 1], days },
    kpis: {
      tracks: catalog.tracks.length,
      artists: new Set(catalog.tracks.flatMap((t) => t.artists.map((a) => a.id))).size,
      albums: new Set(catalog.tracks.map((t) => t.album.id)).size,
      users: userCount,
      newUsers,
      plays,
      hours: ms / 3_600_000,
      completionRate: plays ? completes / plays : 0,
      skipRate: events ? skips / events : 0,
      dau: Object.keys(today?.users ?? {}).length,
      wau: unionUsers(7),
      mau: unionUsers(30),
      libraryHours: catalog.tracks.reduce((a, t) => a + t.durationMs, 0) / 3_600_000,
    },
    series: daily.map((d) => ({ day: d.day, plays: d.plays, minutes: Math.round(d.ms / 60000), users: Object.keys(d.users).length })),
    hours,
    topTracks,
    topArtists,
    topGenres,
    mostSkipped,
    recommendations: { recommended: agg((k) => REC_SOURCES.has(k)), organic: agg((k) => !REC_SOURCES.has(k)), bySource: sources },
    recent: recent.map((e) => ({
      id: e.id,
      at: e.at,
      user: userNames.get(e.uid) ?? e.uid.slice(0, 8),
      trackId: e.trackId,
      outcome: e.outcome,
      listenedMs: e.listenedMs,
      durationMs: e.durationMs,
      source: e.source.type,
    })),
    users: users.map((u) => ({ uid: u.uid, name: u.name, email: u.email, lastSeenAt: u.lastSeenAt, createdAt: u.createdAt })),
    storage: backends.providers.map((p) => ({ ...p, used: usage[p.id]?.bytes ?? 0, objects: usage[p.id]?.objects ?? 0 })),
    backends: { db: backends.db, storage: backends.storage, strategy: backends.strategy },
  });
});
