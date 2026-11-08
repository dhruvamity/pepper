import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/server/auth";
import { trackIdFromSha } from "@/lib/server/catalog";
import { config } from "@/lib/server/env";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { choosePlacement, providers } from "@/lib/server/storage";

const body = z.object({
  target: z.object({ kind: z.enum(["track", "artist"]), id: z.string().min(1).max(128).refine((id) => !id.includes("/")) }).optional(),
  audio: z
    .object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().positive().max(1024 * 1024 * 1024),
    contentType: z.string().regex(/^(audio\/[a-z0-9.+-]+|application\/octet-stream)$/i),
    ext: z.string().regex(/^[a-z0-9]{2,5}$/i),
    })
    .optional(),
  cover: z
    .object({
      hash: z.string().regex(/^[0-9a-f]{16,64}$/),
      ext: z.enum(["webp", "jpg"]),
      purpose: z.enum(["cover", "artist"]).default("cover"),
      sm: z.object({ size: z.number().int().positive().max(5_000_000) }),
      lg: z.object({ size: z.number().int().positive().max(15_000_000) }),
    })
    .optional(),
});

/**
 * Step 1 of an upload: pick a bucket with room (see choosePlacement) and hand back presigned
 * PUT URLs. The browser then uploads straight to the bucket — no size limits from serverless
 * functions, and no bandwidth through this server. A song's audio and cover go to the same bucket.
 */
export const POST = route(async (req) => {
  const admin = await requireAdmin(req);
  const input = body.parse(await readJson(req));
  if (!input.audio && !input.cover) throw new HttpError(400, "Nothing to upload");
  const db = await repo();
  const trackId = input.audio ? trackIdFromSha(input.audio.sha256) : undefined;
  if (input.target?.kind === "artist" && input.audio) throw new HttpError(400, "Artist image uploads cannot include audio");
  if (input.target?.kind === "artist" && input.cover?.purpose !== "artist") throw new HttpError(400, "Artist upload target requires artist artwork");
  if (input.target?.kind === "track" && input.cover?.purpose === "artist") throw new HttpError(400, "Track upload target cannot use artist artwork");
  if (input.target?.kind === "track" && trackId && input.target.id !== trackId) throw new HttpError(400, "Upload target does not match the audio file");
  const targetRef = trackId ? { kind: "track" as const, id: trackId } : input.target;
  const existing = trackId ? await db.getTrack(trackId) : null;
  if (existing) {
    return json({ trackId, duplicate: true, existing: { title: existing.title, artists: existing.artists, album: existing.album } });
  }

  const usage = await db.getStorageUsage();
  const list = providers();
  const total = (input.audio?.size ?? 0) + (input.cover ? input.cover.sm.size + input.cover.lg.size : 0);
  const target = choosePlacement(list, usage, total, config.storage.strategy, config.storage.primary);

  let audio;
  if (input.audio && trackId) {
    const contentType = input.audio.contentType;
    const audioKey = `audio/${trackId}.${input.audio.ext.toLowerCase()}`;
    audio = { provider: target.id, key: audioKey, contentType, upload: await target.presignPut(audioKey, contentType) };
  }

  let cover: Record<"sm" | "lg", { provider: string; key: string; contentType: string; upload: unknown | null }> | undefined;
  if (input.cover) {
    const ct = input.cover.ext === "webp" ? "image/webp" : "image/jpeg";
    cover = {} as typeof cover;
    for (const size of ["sm", "lg"] as const) {
      const folder = input.cover.purpose === "artist" ? "artists" : "covers";
      const key = `img/${folder}/${input.cover.hash.slice(0, 20)}-${size}.${input.cover.ext}`;
      // Albums share artwork: reuse an identical cover already stored in any bucket.
      const heads = await Promise.all(list.map((p) => p.head(key)));
      const found = list.find((_, i) => heads[i]);
      cover![size] = found
        ? { provider: found.id, key, contentType: ct, upload: null }
        : { provider: target.id, key, contentType: ct, upload: await target.presignPut(key, ct) };
    }
  }
  const uploadId = randomUUID().replace(/-/g, "").slice(0, 24);
  const objects = [
    ...(audio ? [{ provider: audio.provider, key: audio.key, size: input.audio!.size, contentType: audio.contentType }] : []),
    ...(cover ? (Object.values(cover) as { provider: string; key: string; contentType: string; upload: unknown | null }[])
      .filter((item) => item.upload)
      .map((item) => ({ provider: item.provider, key: item.key, size: item.key.endsWith("-sm.webp") || item.key.endsWith("-sm.jpg") ? input.cover!.sm.size : input.cover!.lg.size, contentType: item.contentType })) : []),
  ];
  await db.saveUploadIntent({ id: uploadId, ownerUid: admin.uid, trackId, target: targetRef, createdAt: Date.now(), expiresAt: Date.now() + 24 * 3600_000, objects });
  return json({ uploadId, trackId, duplicate: false, audio, cover, provider: { id: target.id, label: target.label } });
});
