import { randomBytes } from "node:crypto";
import { z } from "zod";
import { buildPlayUpdate, classifyPlay } from "@/lib/analytics/score";
import { bearer, verifyToken } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, route } from "@/lib/server/http";
import type { PlayEvent } from "@/lib/types";

const report = z.object({
  trackId: z.string().max(40),
  startedAt: z.number(),
  listenedMs: z.number().min(0).max(6 * 3600 * 1000),
  durationMs: z.number().positive().max(6 * 3600 * 1000),
  endReason: z.enum(["ended", "skip", "prev", "switch", "pause", "unload"]),
  source: z.object({
    type: z.enum(["album", "artist", "playlist", "liked", "search", "home", "mix", "radio", "autoplay", "queue", "genre", "track", "other"]),
    id: z.string().max(120).optional(),
  }),
  prevTrackId: z.string().max(40).optional(),
  sessionId: z.string().max(64),
  shuffle: z.boolean().optional(),
  device: z.enum(["mobile", "desktop"]).optional(),
  tz: z.number().min(-900).max(900).optional(),
});

const body = z.object({ token: z.string().max(4096).optional(), events: z.array(report).min(1).max(25) });

/**
 * Listening analytics. Called when a track ends/is skipped, and via navigator.sendBeacon on
 * page hide (which cannot set headers — so the ID token may also travel in the body).
 */
export const POST = route(async (req) => {
  const raw = await req.text();
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof z.ZodError) throw err;
    throw new HttpError(400, "Expected a JSON body");
  }
  const user = await verifyToken(bearer(req) ?? parsed.token);
  if (!user) throw new HttpError(401, "Sign in required");
  if (!user.invited) throw new HttpError(403, "Not on the guest list", "not_invited");

  const db = await repo();
  const catalog = await db.getCatalog();
  const byId = new Map(catalog.tracks.map((t) => [t.id, t]));
  const now = Date.now();
  let recorded = 0;
  for (const r of parsed.events) {
    const track = byId.get(r.trackId);
    if (!track) continue;
    if (r.startedAt > now + 60_000 || r.startedAt < now - 7 * 86_400_000) continue;
    const durationMs = track.durationMs || r.durationMs;
    const listenedMs = Math.min(r.listenedMs, durationMs * 1.5, now - r.startedAt + 5_000);
    const { outcome, weight } = classifyPlay({ listenedMs, durationMs, endReason: r.endReason });
    const event: PlayEvent = {
      ...r,
      durationMs,
      listenedMs,
      prevTrackId: r.prevTrackId && byId.has(r.prevTrackId) ? r.prevTrackId : undefined,
      id: `${now.toString(36)}-${randomBytes(4).toString("hex")}`,
      uid: user.uid,
      at: Math.min(now, r.startedAt + listenedMs),
      outcome,
      weight,
    };
    await db.recordPlay(event, buildPlayUpdate(event, track, Boolean(event.prevTrackId)));
    recorded++;
  }
  return json({ recorded });
});
