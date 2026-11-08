import { randomUUID } from "node:crypto";
import { z } from "zod";
import { jamSnapshot } from "@/lib/server/jam";
import { buildJamDocument, startJamBody } from "@/lib/server/jam";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { connectionIdFor } from "@/lib/server/social";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ action: z.enum(["accept", "decline"]) });

export const PATCH = route<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const { action } = body.parse(await readJson(req));
  const { id } = await ctx.params;
  if (!/^[a-f0-9]{24}$/.test(id)) throw new HttpError(404, "Jam request not found");
  const db = await repo();
  const request = (await db.listJamRequests(user.uid)).find((item) => item.id === id);
  if (!request || request.toUid !== user.uid) throw new HttpError(404, "Jam request not found");
  if (request.status === "pending" && request.expiresAt <= Date.now()) {
    const expired = await db.resolveJamRequest(id, "declined");
    return json({ request: expired, snapshot: null });
  }
  if (request.status !== "pending") {
    if (request.status === "accepted" && request.jamId) {
      const existing = await db.getJam(request.jamId);
      return json({ request, snapshot: jamSnapshot(existing, user.uid) });
    }
    throw new HttpError(409, "This Jam request has already been answered");
  }
  const contact = await db.getConnection(connectionIdFor(request.fromUid, request.toUid));
  if (contact?.status !== "accepted") throw new HttpError(403, "This listener is no longer a contact");
  if (action === "decline") return json({ request: await db.resolveJamRequest(id, "declined"), snapshot: null });

  const guestProfile = await db.getUser(request.fromUid);
  if (!guestProfile) throw new HttpError(404, "Requesting listener not found");
  const track = request.trackId ?? null;
  const input = startJamBody.parse({ track, queue: [], positionMs: 0, playing: Boolean(track), volume: 1, repeat: "off", shuffle: false });
  const jamId = randomUUID().replace(/-/g, "").slice(0, 24);
  const jam = await buildJamDocument({ uid: user.uid, name: user.name }, input, { uid: request.fromUid, name: guestProfile.name }, jamId);
  if (jam.playback.track) {
    jam.playback.track.addedBy = request.fromUid;
    jam.playback.track.addedByName = guestProfile.name.slice(0, 60);
  }
  const resolved = await db.resolveJamRequest(id, "accepted", jam);
  if (resolved.status !== "accepted" || !resolved.jamId) throw new HttpError(410, "This Jam request has expired");
  const activeJam = resolved.jamId === jam.id ? jam : await db.getJam(resolved.jamId);
  return json({ request: resolved, snapshot: jamSnapshot(activeJam, user.uid) });
});
