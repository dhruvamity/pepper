import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

const patch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(300).optional(),
  trackIds: z.array(z.string().max(40)).max(2000).optional(),
  add: z.array(z.string().max(40)).max(500).optional(),
  remove: z.array(z.string().max(40)).max(500).optional(),
});

async function load(req: Request, ctx: Ctx, mustOwn: boolean) {
  const u = await requireUser(req);
  const { id } = await ctx.params;
  const db = await repo();
  const stored = await db.getPlaylist(id);
  const p = stored && (stored.shared ? stored : (await db.getCatalog()).playlists?.find((list) => list.id === id) ?? stored);
  if (!p) throw new HttpError(404, "Playlist not found");
  // Shared playlists belong to everyone: admins look after them.
  if (mustOwn && p.ownerUid !== u.uid && !(p.shared && u.isAdmin)) throw new HttpError(403, "Only the owner can change this playlist");
  return { db, p };
}

export const GET = route<Ctx>(async (req, ctx) => {
  const { p } = await load(req, ctx, false);
  return json({ playlist: p });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { db, p } = await load(req, ctx, true);
  const input = patch.parse(await readJson(req));
  let ids = input.trackIds ?? p.trackIds;
  if (input.add?.length) ids = [...ids, ...input.add.filter((x) => !ids.includes(x))];
  if (input.remove?.length) ids = ids.filter((x) => !input.remove!.includes(x));
  const next = { ...p, ...("name" in input && input.name ? { name: input.name } : {}), description: input.description ?? p.description, trackIds: ids, updatedAt: Date.now() };
  await db.savePlaylist(next);
  return json({ playlist: next });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { db, p } = await load(req, ctx, true);
  await db.deletePlaylist(p.id, p.shared);
  return json({ ok: true });
});
