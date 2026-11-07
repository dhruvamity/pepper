import { requireAdmin } from "@/lib/server/auth";
import { deleteTrack, patchTrackSchema, updateTrack } from "@/lib/server/catalog";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const db = await repo();
  const [track, lyrics] = await Promise.all([db.getTrack(id), db.getLyrics(id)]);
  if (!track) throw new HttpError(404, "Track not found");
  return json({ track, lyrics });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const patch = patchTrackSchema.parse(await readJson(req));
  return json({ track: await updateTrack(id, patch) });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  await deleteTrack(id);
  return json({ ok: true });
});
