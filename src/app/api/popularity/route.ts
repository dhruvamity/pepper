import { decayed, TREND_HALF_LIFE } from "@/lib/analytics/score";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";

/** Play counts and a 0-100 popularity score per track (Spotify-style). */
export const GET = route(async (req) => {
  await requireUser(req);
  const db = await repo();
  const stats = await db.getTrackStats();
  const now = Date.now();
  let max = 0;
  const trend: Record<string, number> = {};
  for (const [id, s] of Object.entries(stats)) {
    trend[id] = decayed(s.trend, now, TREND_HALF_LIFE);
    max = Math.max(max, trend[id]);
  }
  const out: Record<string, { plays: number; pop: number; likes: number }> = {};
  for (const [id, s] of Object.entries(stats)) {
    out[id] = {
      plays: s.plays,
      likes: s.likes,
      pop: max > 0 ? Math.round((100 * Math.log1p(trend[id])) / Math.log1p(max)) : 0,
    };
  }
  return json(out);
});
