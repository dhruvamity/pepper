import { decayed, TASTE_HALF_LIFE } from "@/lib/analytics/score";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";

/** Personal listening stats ("Your Pepper Wrapped"). */
export const GET = route(async (req) => {
  const u = await requireUser(req);
  const db = await repo();
  const [taste, catalog, recent] = await Promise.all([db.getTaste(u.uid), db.getCatalog(), db.recentPlays(40, u.uid)]);
  const byId = new Map(catalog.tracks.map((t) => [t.id, t]));
  const now = Date.now();

  const topTracks = Object.entries(taste.plays)
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, plays]) => ({ id, plays }));

  const artistPlays = new Map<string, number>();
  const genrePlays = new Map<string, number>();
  for (const [id, plays] of Object.entries(taste.plays)) {
    const t = byId.get(id);
    if (!t) continue;
    for (const a of t.artists) artistPlays.set(a.id, (artistPlays.get(a.id) ?? 0) + plays);
    for (const g of t.genres) genrePlays.set(g, (genrePlays.get(g) ?? 0) + plays / t.genres.length);
  }
  const topArtists = [...artistPlays].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, plays]) => ({ id, plays }));
  const genreTotal = [...genrePlays.values()].reduce((a, b) => a + b, 0) || 1;
  const topGenres = [...genrePlays]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, v]) => ({ name, share: v / genreTotal }));

  // "Current obsession": strongest recent decayed affinity
  const obsession = Object.entries(taste.tracks)
    .map(([id, v]) => ({ id, v: decayed(v, now, TASTE_HALF_LIFE) }))
    .filter((x) => byId.has(x.id) && x.v > 0)
    .sort((a, b) => b.v - a.v)[0]?.id;

  const hours = Array.from({ length: 24 }, (_, h) => taste.hours[String(h)] ?? 0);
  const peak = hours.indexOf(Math.max(...hours));
  const persona =
    taste.totalPlays < 5
      ? "Just getting started"
      : peak >= 22 || peak < 4
        ? "Night owl"
        : peak < 10
          ? "Early riser"
          : peak < 17
            ? "Daytime groover"
            : "Evening unwinder";

  const skips = Object.values(taste.skips).reduce((a, b) => a + b, 0);
  return json({
    totalMs: taste.totalMs,
    totalPlays: taste.totalPlays,
    uniqueTracks: Object.keys(taste.plays).length,
    uniqueArtists: artistPlays.size,
    skipRate: taste.totalPlays + skips ? skips / (taste.totalPlays + skips) : 0,
    topTracks,
    topArtists,
    topGenres,
    hours,
    persona,
    obsession,
    recent: recent.filter((e) => byId.has(e.trackId)).slice(0, 20).map((e) => ({ trackId: e.trackId, at: e.at, outcome: e.outcome, source: e.source })),
  });
});
