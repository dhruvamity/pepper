import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { enrichArtistImage } from "@/lib/server/enrich";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { provider } from "@/lib/server/storage";
import { PROVIDER_ID, toMediaRef } from "@/lib/util";

type Ctx = { params: Promise<{ id: string }> };

const objectSchema = z.object({ provider: z.string().regex(PROVIDER_ID), key: z.string().startsWith("img/").max(300), size: z.number().int().nonnegative() });
const body = z.object({
  uploadId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  bio: z.string().max(3000).optional(),
  image: z.object({ sm: objectSchema, lg: objectSchema, color: z.string().regex(/^#[0-9a-f]{6}$/i) }).optional(),
  newObjects: z.array(objectSchema).max(2).default([]),
  refetchImage: z.boolean().optional(),
});

/** Edit an artist: upload a photo, set a bio, or retry the automatic photo lookup. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  const input = body.parse(await readJson(req));
  const db = await repo();
  const catalog = await db.getCatalog();
  const cur = catalog.artists[id];
  if (!cur) throw new HttpError(404, "Artist not found");
  const intent = input.uploadId ? await db.getUploadIntent(input.uploadId) : null;
  if (input.uploadId && (!intent || intent.ownerUid !== admin.uid)) throw new HttpError(403, "Upload session is invalid or expired");
  if (intent && intent.target && (intent.target.kind !== "artist" || intent.target.id !== id)) throw new HttpError(400, "Upload session target does not match this artist");
  if (intent && intent.objects.some((o) => !input.newObjects.some((candidate) => candidate.provider === o.provider && candidate.key === o.key))) {
    throw new HttpError(400, "Upload session objects do not match this artist");
  }
  for (const o of input.newObjects) {
    const head = await provider(o.provider)?.head(o.key);
    if (!head) throw new HttpError(400, `Upload missing: ${o.key}`);
    await db.addStorageUsage(o.provider, head.size, 1);
  }
  if (input.refetchImage) {
    const color = catalog.tracks.find((t) => t.artists.some((a) => a.id === id) && t.cover)?.cover?.color;
    const updated = await enrichArtistImage({ ...cur, image: undefined }, color);
    if (!updated) throw new HttpError(404, "No matching artist photo found");
    return json({ artist: updated });
  }
  const next = {
    ...cur,
    bio: input.bio ?? cur.bio,
    image: input.image
      ? { sm: toMediaRef(input.image.sm.provider, input.image.sm.key), lg: toMediaRef(input.image.lg.provider, input.image.lg.key), color: input.image.color }
      : cur.image,
  };
  await db.saveArtist(next);
  if (intent) await db.deleteUploadIntent(intent.id);
  return json({ artist: next });
});
