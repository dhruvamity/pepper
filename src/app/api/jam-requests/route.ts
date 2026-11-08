import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { connectionIdFor } from "@/lib/server/social";
import type { JamRequest } from "@/lib/types";

const body = z.object({ toUid: z.string().min(1).max(128).refine((id) => !id.includes("/"), "Invalid Pepper ID"), trackId: z.string().regex(/^t[a-f0-9]{15}$/).optional() });

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = body.parse(await readJson(req));
  if (input.toUid === user.uid) throw new HttpError(400, "You cannot request a Jam with yourself");
  const db = await repo();
  const connection = await db.getConnection(connectionIdFor(user.uid, input.toUid));
  if (connection?.status !== "accepted") throw new HttpError(403, "Connect with this listener before requesting a Jam");
  const other = await db.getUser(input.toUid);
  if (!other) throw new HttpError(404, "Pepper user not found");
  if (input.trackId && !(await db.getTrack(input.trackId))) throw new HttpError(404, "Song not found");
  const current = (await db.listJamRequests(user.uid)).find((request) => request.toUid === input.toUid && request.status === "pending" && request.expiresAt > Date.now());
  if (current) throw new HttpError(409, "You already have a Jam request waiting for this listener");
  const now = Date.now();
  const request: JamRequest = {
    id: randomUUID().replace(/-/g, "").slice(0, 24),
    fromUid: user.uid,
    fromName: user.name,
    toUid: input.toUid,
    trackId: input.trackId,
    status: "pending",
    createdAt: now,
    expiresAt: now + 30 * 60_000,
  };
  await db.saveJamRequest(request);
  return json({ request }, { status: 201 });
});
