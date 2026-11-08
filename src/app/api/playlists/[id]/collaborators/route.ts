import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { connectionIdFor } from "@/lib/server/social";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ uid: z.string().min(1).max(128).refine((id) => !id.includes("/"), "Invalid Pepper ID") });

async function resolve(req: Request, ctx: Ctx, targetUid: string) {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const db = await repo();
  const playlist = await db.getPlaylist(id);
  if (!playlist) throw new HttpError(404, "Playlist not found");
  if (playlist.ownerUid !== user.uid) throw new HttpError(403, "Only the playlist owner can manage collaborators");
  if (playlist.shared) throw new HttpError(400, "Shared curated playlists do not use private collaborators");
  if (targetUid === user.uid) throw new HttpError(400, "The owner already has access");
  const relation = await db.getConnection(connectionIdFor(user.uid, targetUid));
  if (relation?.status !== "accepted") throw new HttpError(403, "Collaborators must be accepted contacts");
  const profile = await db.getUser(targetUid);
  if (!profile) throw new HttpError(404, "Pepper user not found");
  return { db, playlist, user, profile };
}

export const POST = route<Ctx>(async (req, ctx) => {
  const { uid } = body.parse(await readJson(req));
  const { db, playlist, user, profile } = await resolve(req, ctx, uid);
  const next = await db.updatePlaylist(playlist.id, (current) => {
    if (!current || current.ownerUid !== user.uid) throw new HttpError(404, "Playlist not found");
    if (current.shared) throw new HttpError(400, "Shared curated playlists do not use private collaborators");
    if (current.collaboratorUids?.includes(uid)) return current;
    if ((current.collaborators?.length ?? 0) >= 50) throw new HttpError(409, "A playlist can have up to 50 collaborators");
    const at = Date.now();
    const collaborators = [...(current.collaborators ?? []), { uid, name: profile.name }];
    return {
      ...current,
      collaborators,
      collaboratorUids: collaborators.map((item) => item.uid),
      updatedAt: at,
      revision: (current.revision ?? 0) + 1,
      history: [...(current.history ?? []), { at, actorUid: user.uid, actorName: user.name, action: `Invited ${profile.name} to collaborate` }].slice(-50),
    };
  });
  return json({ playlist: next });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const { uid } = body.parse(await readJson(req));
  const { db, playlist, user } = await resolve(req, ctx, uid);
  const next = await db.updatePlaylist(playlist.id, (current) => {
    if (!current || current.ownerUid !== user.uid) throw new HttpError(404, "Playlist not found");
    const collaborator = current.collaborators?.find((item) => item.uid === uid);
    if (!collaborator) return current;
    const at = Date.now();
    const collaborators = current.collaborators!.filter((item) => item.uid !== uid);
    return {
      ...current,
      collaborators,
      collaboratorUids: collaborators.map((item) => item.uid),
      updatedAt: at,
      revision: (current.revision ?? 0) + 1,
      history: [...(current.history ?? []), { at, actorUid: user.uid, actorName: user.name, action: `Removed ${collaborator.name} from collaborators` }].slice(-50),
    };
  });
  return json({ playlist: next });
});
