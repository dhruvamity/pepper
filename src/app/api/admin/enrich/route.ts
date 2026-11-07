import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { enrichArtistRelated, enrichLyrics, enrichTrackDetails } from "@/lib/server/enrich";
import { json, route } from "@/lib/server/http";

// Apple's catalog allows ~20 lookups a minute, so each call handles a few songs.
export const maxDuration = 60;

async function remaining() {
  const catalog = await (await repo()).getCatalog();
  return {
    tracks: catalog.tracks.filter((t) => !t.enrichedAt).length,
    artists: Object.values(catalog.artists).filter((a) => a.related === undefined).length,
  };
}

export const GET = route(async (req) => {
  await requireAdmin(req);
  return json({ remaining: await remaining() });
});

const body = z.object({ limit: z.number().int().min(1).max(10).default(4) });

/**
 * Fill in genre, language and related artists for songs that do not have them yet (for example
 * songs uploaded before this existed). Call repeatedly until nothing remains.
 */
export const POST = route(async (req) => {
  await requireAdmin(req);
  const { limit } = body.parse(await req.json().catch(() => ({})));
  const db = await repo();
  const catalog = await db.getCatalog();
  const updated: { id: string; title: string; genres: string[]; language?: string }[] = [];
  let failed = 0;
  for (const t of catalog.tracks.filter((x) => !x.enrichedAt).slice(0, limit)) {
    const full = await db.getTrack(t.id);
    if (!full) continue;
    try {
      await enrichLyrics(full); // language detection reads the lyrics
    } catch {
      /* lyrics are optional */
    }
    const next = await enrichTrackDetails(t.id).catch(() => null);
    if (next) updated.push({ id: next.id, title: next.title, genres: next.genres, language: next.language });
    else failed++;
  }
  for (const a of Object.values(catalog.artists).filter((x) => x.related === undefined).slice(0, 10)) {
    await enrichArtistRelated(a).catch(() => false);
  }
  return json({ updated, failed, remaining: await remaining() });
});
