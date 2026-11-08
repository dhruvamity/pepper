import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";

const body = z.object({
  trackId: z.string().regex(/^t[a-f0-9]{15}$/).nullable(),
  playing: z.boolean(),
  positionMs: z.number().int().min(0).max(6 * 3600_000),
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = body.parse(await readJson(req));
  const db = await repo();
  const profile = await db.getUser(user.uid);
  if (!profile?.activitySharing || !profile.activityVisibleTo?.length || !input.trackId) {
    await db.saveActivity(user.uid, null);
    return json({ ok: true, shared: false });
  }
  const track = await db.getTrack(input.trackId);
  if (!track) throw new HttpError(404, "Song not found");
  const now = Date.now();
  await db.saveActivity(user.uid, {
    uid: user.uid,
    name: user.name,
    trackId: input.trackId,
    playing: input.playing,
    positionMs: Math.min(input.positionMs, track.durationMs),
    updatedAt: now,
    expiresAt: now + 60_000,
  });
  return json({ ok: true, shared: true, expiresAt: now + 60_000 });
});

export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  await (await repo()).saveActivity(user.uid, null);
  return json({ ok: true });
});
