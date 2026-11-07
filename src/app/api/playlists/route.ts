import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { json, readJson, route } from "@/lib/server/http";
import type { Playlist } from "@/lib/types";

const body = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(300).optional(),
  trackIds: z.array(z.string().max(40)).max(2000).optional(),
});

export const GET = route(async (req) => {
  const u = await requireUser(req);
  const db = await repo();
  return json({ playlists: await db.listPlaylists(u.uid) });
});

export const POST = route(async (req) => {
  const u = await requireUser(req);
  const input = body.parse(await readJson(req));
  const db = await repo();
  const existing = await db.listPlaylists(u.uid);
  const now = Date.now();
  const p: Playlist = {
    id: `pl_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    ownerUid: u.uid,
    ownerName: u.name,
    ...(u.isAdmin ? { shared: true } : {}),
    name: input.name || `My Playlist #${existing.length + 1}`,
    description: input.description,
    trackIds: [...new Set(input.trackIds ?? [])],
    createdAt: now,
    updatedAt: now,
  };
  await db.savePlaylist(p);
  return json({ playlist: p }, { status: 201 });
});
