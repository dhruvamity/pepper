import { z } from "zod";
import { decayBoost, TASTE_HALF_LIFE } from "@/lib/analytics/score";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { json, readJson, route } from "@/lib/server/http";
import { genreKey } from "@/lib/util";

const body = z.object({ artistIds: z.array(z.string().max(80)).max(30) });

/** Cold start: seed the taste profile with the artists picked during onboarding. */
export const POST = route(async (req) => {
  const u = await requireUser(req);
  const { artistIds } = body.parse(await readJson(req));
  const db = await repo();
  const catalog = await db.getCatalog();
  const boost = decayBoost(Date.now(), TASTE_HALF_LIFE);
  const artists: Record<string, number> = {};
  const genres: Record<string, number> = {};
  for (const id of artistIds) {
    if (!catalog.artists[id]) continue;
    artists[id] = 3 * boost; // worth ~3 complete listens
    for (const t of catalog.tracks.filter((t) => t.artists.some((a) => a.id === id))) {
      for (const g of t.genres) genres[genreKey(g)] = (genres[genreKey(g)] ?? 0) + boost / Math.max(1, t.genres.length);
    }
    await db.setLibraryItem(u.uid, "artists", id, true);
  }
  await db.addTaste(u.uid, artists, genres);
  const profile = await db.getUser(u.uid);
  if (profile) await db.saveUser({ ...profile, onboarded: true });
  return json({ ok: true });
});
