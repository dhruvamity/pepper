import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { config } from "@/lib/server/env";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { choosePlacement, provider, providers } from "@/lib/server/storage";
import type { ImageSet } from "@/lib/types";
import { toMediaRef } from "@/lib/util";

type Ctx = { params: Promise<{ id: string }> };

const presignBody = z.object({
  hash: z.string().regex(/^[0-9a-f]{16,64}$/),
  ext: z.enum(["webp", "jpg"]),
  sm: z.object({ size: z.number().int().positive().max(5_000_000) }),
  lg: z.object({ size: z.number().int().positive().max(15_000_000) }),
});

const commitBody = z.object({
  uploadId: z.string().min(8).max(64).optional(),
  cover: z
    .object({
      sm: z.object({ provider: z.string().min(1), key: z.string().min(3).max(300), size: z.number().int().nonnegative() }),
      lg: z.object({ provider: z.string().min(1), key: z.string().min(3).max(300), size: z.number().int().nonnegative() }),
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
    })
    .nullable(),
});

const COVER_KEY = /^img\/covers\/[a-f0-9]{16,20}-(sm|lg)\.(webp|jpg)$/;

async function ownPlaylist(req: Request, ctx: Ctx) {
  const u = await requireUser(req);
  const { id } = await ctx.params;
  const db = await repo();
  const p = await db.getPlaylist(id);
  if (!p) throw new HttpError(404, "Playlist not found");
  if (p.ownerUid !== u.uid && !(p.shared && u.isAdmin)) throw new HttpError(403, "Only the owner can change the cover");
  return { u, db, p };
}

/**
 * Step 1 of a playlist cover upload: presigned PUT URLs for the two sizes (same keys and buckets
 * as song covers, so an identical image is stored once). Step 2 is PATCH with the uploaded objects.
 */
export const POST = route<Ctx>(async (req, ctx) => {
  const { u, db, p } = await ownPlaylist(req, ctx);
  const input = presignBody.parse(await readJson(req));
  const list = providers();
  const usage = await db.getStorageUsage();
  const target = choosePlacement(list, usage, input.sm.size + input.lg.size, config.storage.strategy, config.storage.primary);
  const ct = input.ext === "webp" ? "image/webp" : "image/jpeg";
  const cover: Record<"sm" | "lg", { provider: string; key: string; contentType: string; upload: unknown | null; size: number }> = {} as never;
  for (const size of ["sm", "lg"] as const) {
    const key = `img/covers/${input.hash.slice(0, 20)}-${size}.${input.ext}`;
    const heads = await Promise.all(list.map((candidate) => candidate.head(key)));
    const found = list.find((_, i) => heads[i]);
    cover[size] = found
      ? { provider: found.id, key, contentType: ct, upload: null, size: input[size].size }
      : { provider: target.id, key, contentType: ct, upload: await target.presignPut(key, ct), size: input[size].size };
  }
  const objects = (["sm", "lg"] as const).filter((size) => cover[size].upload).map((size) => ({ provider: cover[size].provider, key: cover[size].key, size: cover[size].size, contentType: ct }));
  const uploadId = randomUUID().replace(/-/g, "").slice(0, 24);
  if (objects.length) await db.saveUploadIntent({ id: uploadId, ownerUid: u.uid, target: { kind: "playlist", id: p.id }, createdAt: Date.now(), expiresAt: Date.now() + 24 * 3600_000, objects });
  return json({ uploadId: objects.length ? uploadId : undefined, cover });
});

/** Step 2: point the playlist at the uploaded cover (or `cover: null` to go back to the collage). */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const { u, db, p } = await ownPlaylist(req, ctx);
  const input = commitBody.parse(await readJson(req));
  let image: ImageSet | undefined;
  if (input.cover) {
    const intent = input.uploadId ? await db.getUploadIntent(input.uploadId) : null;
    if (input.uploadId && (!intent || intent.ownerUid !== u.uid || intent.target?.kind !== "playlist" || intent.target.id !== p.id)) throw new HttpError(403, "Upload session is invalid or expired");
    for (const size of ["sm", "lg"] as const) {
      const o = input.cover[size];
      if (!COVER_KEY.test(o.key)) throw new HttpError(400, "Not a cover image");
      const storage = provider(o.provider);
      if (!storage) throw new HttpError(400, `Unknown storage provider ${o.provider}`);
      const head = await storage.head(o.key);
      if (!head) throw new HttpError(400, `Upload missing: ${o.key}. Check the bucket CORS settings.`);
      if (o.size && head.size !== o.size) throw new HttpError(400, `Upload incomplete: ${o.key}`);
    }
    for (const o of intent?.objects ?? []) await db.addStorageUsage(o.provider, o.size, 1);
    if (intent) await db.deleteUploadIntent(intent.id);
    image = { sm: toMediaRef(input.cover.sm.provider, input.cover.sm.key), lg: toMediaRef(input.cover.lg.provider, input.cover.lg.key), color: input.cover.color.toLowerCase() };
  }
  const next = await db.updatePlaylist(p.id, (current) => {
    if (!current) throw new HttpError(404, "Playlist not found");
    const at = Date.now();
    const { cover: _old, ...rest } = current;
    void _old;
    return { ...rest, ...(image ? { cover: image } : {}), updatedAt: at, revision: (current.revision ?? 0) + 1,
      history: [...(current.history ?? []), { at, actorUid: u.uid, actorName: u.name, action: image ? "Changed the cover" : "Removed the cover" }].slice(-50) };
  });
  return json({ playlist: next });
});
