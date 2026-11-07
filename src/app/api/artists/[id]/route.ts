import { decayed, TREND_HALF_LIFE } from "@/lib/analytics/score";
import { genreTokens, weightedJaccard } from "@/lib/recs/similarity";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, route } from "@/lib/server/http";
import { lastNDays } from "@/lib/util";

/** Artist page data that needs server-side stats: popular tracks, monthly plays, fans also like. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  const db = await repo();
  const [catalog, stats] = await Promise.all([db.getCatalog(), db.getTrackStats()]);
  const mine = catalog.tracks.filter((t) => t.artists.some((a) => a.id === id) || t.albumArtist?.id === id);
  if (!mine.length && !catalog.artists[id]) throw new HttpError(404, "Artist not found");
  const now = Date.now();
  const pop = (tid: string) => decayed(stats[tid]?.trend ?? 0, now, TREND_HALF_LIFE) + (stats[tid]?.plays ?? 0) * 1e-6;
  const popular = [...mine]
    .filter((t) => t.artists.some((a) => a.id === id))
    .sort((a, b) => pop(b.id) - pop(a.id) || b.createdAt - a.createdAt)
    .slice(0, 10)
    .map((t) => t.id);

  // Monthly plays from the last 28 daily aggregates.
  const daily = await db.getDaily(lastNDays(28, now));
  const mineSet = new Set(mine.map((t) => t.id));
  let monthlyPlays = 0;
  for (const d of daily) {
    for (const [tid, n] of Object.entries(d.tracks)) if (mineSet.has(tid)) monthlyPlays += n;
  }

  // Fans also like: co-play neighbours of this artist's top tracks + genre similarity.
  const cooc = await db.getCooccurrence(popular.slice(0, 8));
  const byId = new Map(catalog.tracks.map((t) => [t.id, t]));
  const score = new Map<string, number>();
  for (const row of Object.values(cooc)) {
    for (const [tid, w] of Object.entries(row)) {
      const t = byId.get(tid);
      if (!t || w <= 0) continue;
      for (const a of t.artists) if (a.id !== id) score.set(a.id, (score.get(a.id) ?? 0) + w);
    }
  }
  const myGenres = genreTokens(mine.flatMap((t) => t.genres));
  const artistGenres = new Map<string, string[]>();
  for (const t of catalog.tracks) for (const a of t.artists) artistGenres.set(a.id, [...(artistGenres.get(a.id) ?? []), ...t.genres]);
  const maxCo = Math.max(1, ...score.values());
  const related = [...artistGenres.keys()]
    .filter((a) => a !== id)
    .map((a) => ({ a, s: (score.get(a) ?? 0) / maxCo + weightedJaccard(myGenres, genreTokens(artistGenres.get(a)!)) * 0.8 }))
    .filter((x) => x.s > 0.05)
    .sort((x, y) => y.s - x.s)
    .slice(0, 12)
    .map((x) => x.a);

  return json({ popular, monthlyPlays, related });
});
