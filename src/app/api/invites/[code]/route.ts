import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, route } from "@/lib/server/http";
import { connectionIdFor } from "@/lib/server/social";
import { INVITE_CODE } from "@/lib/invite";

/** Who an invite link belongs to, and where the signed-in listener stands with them. */
export const GET = route<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const u = await requireUser(req);
  const code = (await params).code.toLowerCase();
  if (!INVITE_CODE.test(code)) throw new HttpError(404, "This invite link is not valid");
  const db = await repo();
  const other = await db.getUserByInviteCode(code);
  if (!other) throw new HttpError(404, "This invite link has expired or was replaced");
  const connection = other.uid === u.uid ? null : await db.getConnection(connectionIdFor(u.uid, other.uid));
  return json({
    user: { uid: other.uid, name: other.name, photoURL: other.photoURL },
    self: other.uid === u.uid,
    status: connection?.status ?? null,
    requestedBy: connection?.requesterUid ?? null,
  });
});
