import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { ensureInviteCode } from "@/lib/server/social";
import { invitePath } from "@/lib/invite";

/** The signed-in listener's invite link (created on first request). */
export const GET = route(async (req) => {
  const u = await requireUser(req);
  const db = await repo();
  const profile = await db.getUser(u.uid);
  if (!profile) throw new HttpError(404, "Profile not found");
  const { inviteCode } = await ensureInviteCode(db, profile);
  return json({ code: inviteCode, path: invitePath(inviteCode!) });
});

/** Replace the invite link: old links stop working. */
export const POST = route(async (req) => {
  const u = await requireUser(req);
  z.object({ rotate: z.literal(true) }).parse(await readJson(req));
  const db = await repo();
  const profile = await db.getUser(u.uid);
  if (!profile) throw new HttpError(404, "Profile not found");
  const { inviteCode } = await ensureInviteCode(db, profile, true);
  return json({ code: inviteCode, path: invitePath(inviteCode!) });
});
