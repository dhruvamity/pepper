import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";

const body = z.object({
  profileVisibility: z.enum(["everyone", "contacts"]).optional(),
  showTopArtists: z.boolean().optional(),
});

/** Profile settings: who can open /user/<uid> and whether it lists top artists. */
export const PATCH = route(async (req) => {
  const u = await requireUser(req);
  const input = body.parse(await readJson(req));
  const db = await repo();
  const existing = await db.getUser(u.uid);
  if (!existing) throw new HttpError(404, "Profile not found");
  const profile = { ...existing, ...(input.profileVisibility ? { profileVisibility: input.profileVisibility } : {}), ...(input.showTopArtists !== undefined ? { showTopArtists: input.showTopArtists } : {}) };
  await db.saveUser(profile);
  return json({ profile: { profileVisibility: profile.profileVisibility ?? "everyone", showTopArtists: profile.showTopArtists ?? true } });
});
