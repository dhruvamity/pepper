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
  if (!p || (!p.shared && p.ownerUid !== u.uid)) throw new HttpError(404, "Playlist not found");
  // Shared playlists belong to everyone: admins look after them.
  if (mustOwn && p.ownerUid !== u.uid && !(p.shared && u.isAdmin)) throw new HttpError(403, "Only the owner can change this playlist");
  return { db, p, u };
}

export const GET = route<Ctx>(async (req, ctx) => {
  const { p } = await load(req, ctx, false);
  return json({ playlist: p });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { db, p, u } = await load(req, ctx, true);
  const input = patch.parse(await readJson(req));
  const next = await db.updatePlaylist(p.id, (current) => {
    if (!current) throw new HttpError(404, "Playlist not found");
    const shared = current.shared || p.shared;
    if (current.ownerUid !== u.uid && !(shared && u.isAdmin)) throw new HttpError(403, "Only the owner can change this playlist");
    let ids = [...new Set([...(input.trackIds ?? current.trackIds), ...(input.add ?? [])])];
    if (input.remove?.length) ids = ids.filter((id) => !input.remove!.includes(id));
    if (ids.length > 2000) throw new HttpError(400, "A playlist can contain up to 2,000 songs");
    return { ...current, ...(shared ? { shared: true } : {}), name: input.name ?? current.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      trackIds: ids, updatedAt: Date.now() };
  });
  return json({ playlist: next });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { db, p } = await load(req, ctx, true);
  await db.deletePlaylist(p.id, p.shared);
  return json({ ok: true });
});
