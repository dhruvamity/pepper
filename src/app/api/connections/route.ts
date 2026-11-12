import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { connectionIdFor } from "@/lib/server/social";
import { INVITE_CODE } from "@/lib/invite";

const userId = z.string().trim().min(1).max(128).refine((id) => !id.includes("/"), "Invalid Pepper ID");
const connectBody = z.union([z.object({ userId }), z.object({ inviteCode: z.string().trim().toLowerCase().regex(INVITE_CODE, "Invalid invite link") })]);
const removeBody = z.object({ userId });
const actionBody = z.object({ userId, action: z.enum(["accept", "decline"]) });

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await repo();
  const rows = await db.listConnections(user.uid);
  const targets = await Promise.all(rows.map(async (connection) => {
    const userId = connection.requesterUid === user.uid ? connection.otherUid : connection.requesterUid;
    const profile = await db.getUser(userId);
    return { connection, userId, profile };
  }));
  const activityByUid = new Map((await db.getActivities(targets.filter((target) => target.connection.status === "accepted").map((target) => target.userId))).map((activity) => [activity.uid, activity]));
  const contacts = targets.map(({ connection, userId, profile }) => {
    const activity = connection.status === "accepted" ? activityByUid.get(userId) ?? null : null;
    const canSeeActivity = Boolean(
      connection.status === "accepted" && profile?.activitySharing && profile.activityVisibleTo?.includes(user.uid) && activity && activity.expiresAt > Date.now(),
    );
    const safeProfile = { uid: profile?.uid ?? userId, name: profile?.name ?? "Pepper listener", photoURL: profile?.photoURL };
    return {
      id: connection.id,
      status: connection.status,
      requestedBy: connection.requesterUid,
      user: safeProfile,
      activity: canSeeActivity ? activity : null,
    };
  });
  const requests = (await db.listJamRequests(user.uid)).map((request) => ({
    ...request,
    status: ["pending", "accepted"].includes(request.status) && request.expiresAt <= Date.now() ? "expired" : request.status,
  }));
  return json({ connections: contacts, jamRequests: requests });
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = connectBody.parse(await readJson(req));
  const db = await repo();
  const other = "inviteCode" in input ? await db.getUserByInviteCode(input.inviteCode) : await db.getUser(input.userId);
  if (!other) throw new HttpError(404, "inviteCode" in input ? "This invite link has expired or was replaced" : "Pepper user not found");
  const otherUid = other.uid;
  if (otherUid === user.uid) throw new HttpError(400, "You cannot connect to yourself");
  const id = connectionIdFor(user.uid, otherUid);
  const now = Date.now();
  const connection = await db.updateConnection(id, (current) => {
    if (current?.status === "accepted") return current;
    if (current?.status === "pending" && current.requesterUid !== user.uid) return { ...current, status: "accepted", updatedAt: now };
    if (current?.status === "pending") throw new HttpError(409, "Connection request already sent");
    return { id, requesterUid: user.uid, otherUid, status: "pending", createdAt: now, updatedAt: now };
  });
  return json({ connection, user: { uid: other.uid, name: other.name, photoURL: other.photoURL } });
});

export const PATCH = route(async (req) => {
  const user = await requireUser(req);
  const { userId: otherUid, action } = actionBody.parse(await readJson(req));
  const db = await repo();
  const id = connectionIdFor(user.uid, otherUid);
  const connection = await db.updateConnection(id, (current) => {
    if (!current || current.status !== "pending" || current.requesterUid === user.uid) throw new HttpError(404, "Incoming connection request not found");
    return action === "accept" ? { ...current, status: "accepted", updatedAt: Date.now() } : { ...current, status: "declined", updatedAt: Date.now() };
  });
  return json({ connection });
});

export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const { userId: otherUid } = removeBody.parse(await readJson(req));
  const db = await repo();
  const id = connectionIdFor(user.uid, otherUid);
  await db.updateConnection(id, (current) => {
    if (!current || (current.requesterUid !== user.uid && current.otherUid !== user.uid)) return current;
    return null;
  });
  const profile = await db.getUser(user.uid);
  if (profile?.activityVisibleTo?.includes(otherUid)) {
    const activityVisibleTo = profile.activityVisibleTo.filter((uid) => uid !== otherUid);
    await db.saveUser({ ...profile, activityVisibleTo });
    if (!activityVisibleTo.length) await db.saveActivity(user.uid, null);
  }
  return json({ ok: true });
});
