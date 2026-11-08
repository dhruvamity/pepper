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
  expectedRevision: z.number().int().nonnegative().optional(),
});

async function load(req: Request, ctx: Ctx, mustEdit: boolean) {
  const u = await requireUser(req);
  const { id } = await ctx.params;
  const db = await repo();
  const stored = await db.getPlaylist(id);
  const p = stored && (stored.shared ? stored : (await db.getCatalog()).playlists?.find((list) => list.id === id) ?? stored);
  const isOwner = Boolean(p && p.ownerUid === u.uid);
  const isCollaborator = Boolean(p?.collaboratorUids?.includes(u.uid) || p?.collaborators?.some((c) => c.uid === u.uid));
  if (!p || (!p.shared && !isOwner && !isCollaborator)) throw new HttpError(404, "Playlist not found");
  // Shared playlists belong to everyone: admins look after them.
  if (mustEdit && !isOwner && !isCollaborator && !(p.shared && u.isAdmin)) throw new HttpError(403, "You cannot edit this playlist");
  return { db, p, u, isOwner, isCollaborator };
}

export const GET = route<Ctx>(async (req, ctx) => {
  const { p } = await load(req, ctx, false);
  return json({ playlist: p });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const { db, p, u } = await load(req, ctx, true);
  const input = patch.parse(await readJson(req));
  if (input.trackIds !== undefined && input.expectedRevision === undefined) {
    throw new HttpError(400, "Replacing the song order requires the playlist revision", "playlist_revision_required");
  }
  const next = await db.updatePlaylist(p.id, (current) => {
    if (!current) throw new HttpError(404, "Playlist not found");
    const shared = current.shared || p.shared;
    const owner = current.ownerUid === u.uid;
    const collaborator = current.collaboratorUids?.includes(u.uid) || current.collaborators?.some((c) => c.uid === u.uid);
    if (!owner && !collaborator && !(shared && u.isAdmin)) throw new HttpError(403, "You cannot edit this playlist");
    if (input.expectedRevision !== undefined && input.expectedRevision !== (current.revision ?? 0)) {
      throw new HttpError(409, "This playlist changed in another session. Refresh and try again.", "playlist_conflict");
    }
    let ids = [...new Set([...(input.trackIds ?? current.trackIds), ...(input.add ?? [])])];
    if (input.remove?.length) ids = ids.filter((id) => !input.remove!.includes(id));
    if (ids.length > 2000) throw new HttpError(400, "A playlist can contain up to 2,000 songs");
    const changes: string[] = [];
    if (input.add?.length) changes.push(`Added ${input.add.length} song${input.add.length === 1 ? "" : "s"}`);
    if (input.remove?.length) changes.push(`Removed ${input.remove.length} song${input.remove.length === 1 ? "" : "s"}`);
    if (input.trackIds) changes.push("Reordered songs");
    if (input.name !== undefined || input.description !== undefined) changes.push("Updated playlist details");
    const at = Date.now();
    return { ...current, ...(shared ? { shared: true } : {}), name: input.name ?? current.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      trackIds: ids, updatedAt: at, revision: (current.revision ?? 0) + 1,
      history: changes.length ? [...(current.history ?? []), { at, actorUid: u.uid, actorName: u.name, action: changes.join(" · ") }].slice(-50) : current.history };
  });
  return json({ playlist: next });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { db, p, u, isOwner } = await load(req, ctx, false);
  if (!isOwner && !(p.shared && u.isAdmin)) throw new HttpError(403, "Only the owner can delete this playlist");
  await db.deletePlaylist(p.id, p.shared);
  return json({ ok: true });
});
