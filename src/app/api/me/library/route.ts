import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { json, readJson, route } from "@/lib/server/http";

const body = z.object({
  kind: z.enum(["likes", "artists", "albums", "playlists"]),
  id: z.string().min(1).max(120),
  on: z.boolean(),
});

/** Like/unlike a song, follow/unfollow an artist, save/unsave an album or a shared playlist. */
export const PUT = route(async (req) => {
  const u = await requireUser(req);
  const { kind, id, on } = body.parse(await readJson(req));
  const db = await repo();
  await db.setLibraryItem(u.uid, kind, id, on);
  return json({ ok: true });
});
