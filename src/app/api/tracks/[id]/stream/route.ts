import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, route } from "@/lib/server/http";
import { provider } from "@/lib/server/storage";

const TTL = 6 * 3600;
const WINDOW = 3600;

/**
 * Returns a short-lived signed URL for the audio file. The browser streams straight from
 * R2/B2 (byte-range requests for seeking), so audio never passes through this server.
 * Signing is aligned to the hour so replays within the hour hit the browser cache.
 */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  const db = await repo();
  const track = await db.getTrack(id);
  if (!track) throw new HttpError(404, "Track not found");
  const p = provider(track.audio.provider);
  if (!p) throw new HttpError(503, `Storage provider ${track.audio.provider} is not configured`);
  const url = await p.presignGet(track.audio.key, {
    expiresIn: TTL,
    stableWindow: WINDOW,
    cacheControl: "private, max-age=21600",
    contentType: track.audio.contentType,
  });
  const issued = Math.floor(Date.now() / 1000 / WINDOW) * WINDOW;
  return json({ url, mime: track.audio.contentType, expiresAt: (issued + TTL) * 1000 });
});
