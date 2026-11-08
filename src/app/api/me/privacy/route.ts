import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { connectionIdFor } from "@/lib/server/social";
import type { UserProfile } from "@/lib/types";

const body = z.object({ activitySharing: z.boolean(), activityVisibleTo: z.array(z.string().min(1).max(128)).max(100) });

export const PATCH = route(async (req) => {
  const user = await requireUser(req);
  const input = body.parse(await readJson(req));
  const db = await repo();
  const existing = await db.getUser(user.uid);
  const selected = [...new Set(input.activityVisibleTo)].filter((uid) => uid !== user.uid);
  const friends = await Promise.all(selected.map((uid) => db.getConnection(connectionIdFor(user.uid, uid))));
  if (friends.some((connection) => connection?.status !== "accepted")) throw new HttpError(400, "Listening activity can only be shared with accepted contacts");
  const now = Date.now();
  const profile: UserProfile = {
    uid: user.uid,
    name: user.name || existing?.name || "Listener",
    email: user.email ?? existing?.email,
    photoURL: user.photoURL ?? existing?.photoURL,
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
    onboarded: existing?.onboarded ?? false,
    activitySharing: input.activitySharing,
    activityVisibleTo: input.activitySharing ? selected : [],
  };
  await db.saveUser(profile);
  if (!input.activitySharing || !selected.length) await db.saveActivity(user.uid, null);
  return json({ privacy: { activitySharing: profile.activitySharing, activityVisibleTo: profile.activityVisibleTo } });
});
