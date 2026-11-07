/** Catalog mutations used by the admin API: create, edit and delete tracks. */
import { after } from "next/server";
import { z } from "zod";
import type { ArtistInfo, ArtistRef, AudioFeatures, AudioInfo, CatalogSnapshot, ImageSet, Lyrics, ProviderId, Track } from "@/lib/types";
import { normalizeLanguage } from "@/lib/metadata/language";
import { albumIdFor, artistIdFor, parseMediaRef, PROVIDER_ID, toMediaRef } from "@/lib/util";
import { repo } from "./db";
import { enrichArtistImage, enrichArtistRelated, enrichLyrics, enrichTrackDetails } from "./enrich";
import { HttpError } from "./http";
import { provider } from "./storage";

const providerId = z.string().regex(PROVIDER_ID);
const objectSchema = z.object({
  provider: providerId,
  key: z.string().min(3).max(300),
  size: z.number().int().nonnegative(),
  contentType: z.string().max(100),
});

export const lyricsSchema = z.object({
  plain: z.string().max(60_000).optional(),
  synced: z
    .array(z.object({ t: z.number().nonnegative(), text: z.string().max(500) }))
    .max(2000)
    .optional(),
  source: z.enum(["tag", "lrc", "lrclib", "manual"]),
});

export const featuresSchema = z.object({
  bpm: z.number().min(30).max(300).nullable(),
  energy: z.number().min(0).max(1),
  loudness: z.number().min(-90).max(10),
  brightness: z.number().min(0).max(1),
  dynamics: z.number().min(0).max(1),
  rhythm: z.number().min(0).max(1),
  danceability: z.number().min(0).max(1),
});

const names = z.array(z.string().trim().min(1).max(120)).max(30);
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const optInt = z.number().int().positive().max(9999).optional();

export const metadataSchema = z.object({
  title: z.string().trim().min(1).max(300),
  subtitle: optText(300),
  artists: names.min(1),
  albumArtist: optText(120),
  album: z.string().trim().min(1).max(300),
  film: optText(200),
  genres: z.array(z.string().trim().min(1).max(60)).max(6),
  year: z.number().int().min(1800).max(2200).optional(),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  trackNo: optInt,
  trackTotal: optInt,
  discNo: optInt,
  discTotal: optInt,
  composers: names.optional(),
  lyricists: names.optional(),
  producers: names.optional(),
  label: optText(200),
  copyright: optText(300),
  isrc: optText(20),
  // "Hindi", "hin" or "hi" are all stored as "hi".
  language: optText(10).transform((v) => (v ? (normalizeLanguage(v) ?? v.toLowerCase()) : undefined)),
  explicit: z.boolean().optional(),
  comment: optText(1000),
  sourceUrl: z.string().url().max(500).optional(),
});

export const createTrackSchema = metadataSchema.extend({
  trackId: z.string().regex(/^t[0-9a-f]{15}$/),
  rawTitle: z.string().max(500),
  durationMs: z.number().int().positive().max(6 * 3600 * 1000),
  audio: objectSchema.extend({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    originalName: z.string().max(300),
    bitrate: z.number().positive().optional(),
    sampleRate: z.number().positive().optional(),
    channels: z.number().int().positive().max(16).optional(),
    codec: z.string().max(60).optional(),
    container: z.string().max(60).optional(),
    lossless: z.boolean().optional(),
  }),
  cover: z.object({ sm: objectSchema, lg: objectSchema, color: z.string().regex(/^#[0-9a-f]{6}$/i) }).optional(),
  features: featuresSchema.optional(),
  lyrics: lyricsSchema.optional(),
  enrich: z.object({ lyrics: z.boolean(), artistImages: z.boolean() }).default({ lyrics: true, artistImages: true }),
  newObjects: z.array(objectSchema).max(4).default([]),
});

export type CreateTrackInput = z.infer<typeof createTrackSchema>;

export const patchTrackSchema = metadataSchema.partial().extend({
  cover: z.object({ sm: objectSchema, lg: objectSchema, color: z.string().regex(/^#[0-9a-f]{6}$/i) }).optional(),
  lyrics: lyricsSchema.nullable().optional(),
  newObjects: z.array(objectSchema).max(4).default([]),
});

export function trackIdFromSha(sha256: string): string {
  return `t${sha256.slice(0, 15)}`;
}

/** Map typed names to artist refs, reusing the canonical spelling of existing artists. */
export function resolveArtists(list: string[], catalog: CatalogSnapshot): ArtistRef[] {
  const out: ArtistRef[] = [];
  for (const name of list) {
    const id = artistIdFor(name);
    if (out.some((a) => a.id === id)) continue;
    out.push({ id, name: catalog.artists[id]?.name ?? name.trim() });
  }
  return out;
}

function imageSet(cover: { sm: { provider: string; key: string }; lg: { provider: string; key: string }; color: string }): ImageSet {
  return { sm: toMediaRef(cover.sm.provider, cover.sm.key), lg: toMediaRef(cover.lg.provider, cover.lg.key), color: cover.color.toLowerCase() };
}

async function verifyObject(o: { provider: ProviderId; key: string; size: number }) {
  const p = provider(o.provider);
  if (!p) throw new HttpError(400, `Unknown storage provider ${o.provider}`);
  const head = await p.head(o.key);
  if (!head) throw new HttpError(400, `Upload missing: ${o.key}. Check the bucket CORS settings.`);
  if (o.size && Math.abs(head.size - o.size) > 0) throw new HttpError(400, `Upload incomplete: ${o.key} (${head.size}/${o.size} bytes)`);
}

async function ensureArtists(refs: ArtistRef[], catalog: CatalogSnapshot): Promise<ArtistInfo[]> {
  const db = await repo();
  const created: ArtistInfo[] = [];
  for (const a of refs) {
    if (catalog.artists[a.id] || created.some((c) => c.id === a.id)) continue;
    const info: ArtistInfo = { id: a.id, name: a.name, createdAt: Date.now() };
    await db.saveArtist(info);
    created.push(info);
  }
  return created;
}

function scheduleEnrichment(track: Track, artists: ArtistInfo[], wantLyrics: boolean, wantImages: boolean) {
  after(async () => {
    const db = await repo();
    if (wantImages) {
      for (const a of artists) {
        try {
          await enrichArtistImage(a, track.cover?.color);
        } catch (err) {
          console.warn("[pepper] artist image lookup failed", a.name, err);
        }
      }
    }
    if (wantLyrics) {
      try {
        await enrichLyrics(track);
      } catch (err) {
        console.warn("[pepper] lyrics lookup failed", track.title, err);
      }
    }
    // Genre, language and related artists: what autoplay uses to find songs that fit.
    try {
      await enrichTrackDetails(track.id);
    } catch (err) {
      console.warn("[pepper] genre lookup failed", track.title, err);
    }
    const catalog = await db.getCatalog();
    for (const ref of [...track.artists, ...(track.albumArtist ? [track.albumArtist] : [])]) {
      const a = catalog.artists[ref.id];
      if (!a) continue;
      try {
        await enrichArtistRelated(a);
      } catch (err) {
        console.warn("[pepper] related artists lookup failed", a.name, err);
      }
    }
  });
}

/** Everything needed to build a track document; shared by uploads and the import command. */
export type TrackFields = z.output<typeof metadataSchema> & {
  trackId: string;
  rawTitle: string;
  durationMs: number;
  audio: AudioInfo;
  cover?: ImageSet;
  features?: AudioFeatures;
  lyrics?: Lyrics;
};

/** Build the track document: canonical artist spellings, album id, cleaned optional fields. */
export function assembleTrack(input: TrackFields, catalog: CatalogSnapshot, uploadedBy: string, now = Date.now()): { track: Track; lyrics?: Lyrics } {
  const artists = resolveArtists(input.artists, catalog);
  const albumArtist = input.albumArtist ? resolveArtists([input.albumArtist], catalog)[0] : undefined;
  const albumOwner = albumArtist ?? artists[0];
  const lyrics: Lyrics | undefined = input.lyrics && (input.lyrics.plain || input.lyrics.synced?.length) ? input.lyrics : undefined;
  const track: Track = {
    id: input.trackId,
    title: input.title,
    subtitle: input.subtitle,
    rawTitle: input.rawTitle || input.title,
    artists,
    albumArtist,
    album: { id: albumIdFor(albumOwner.name, input.album), title: input.album },
    film: input.film,
    genres: input.genres,
    year: input.year,
    releaseDate: input.releaseDate,
    trackNo: input.trackNo,
    trackTotal: input.trackTotal,
    discNo: input.discNo,
    discTotal: input.discTotal,
    durationMs: input.durationMs,
    composers: input.composers?.length ? input.composers : undefined,
    lyricists: input.lyricists?.length ? input.lyricists : undefined,
    producers: input.producers?.length ? input.producers : undefined,
    label: input.label,
    copyright: input.copyright,
    isrc: input.isrc,
    language: input.language,
    explicit: input.explicit,
    comment: input.comment,
    sourceUrl: input.sourceUrl,
    hasLyrics: Boolean(lyrics),
    audio: input.audio,
    cover: input.cover,
    features: input.features,
    createdAt: now,
    updatedAt: now,
    uploadedBy,
  };
  return { track, lyrics };
}

export async function createTrack(input: CreateTrackInput, uploadedBy: string): Promise<Track> {
  const db = await repo();
  if (trackIdFromSha(input.audio.sha256) !== input.trackId) throw new HttpError(400, "Track id does not match the audio hash");
  if (!input.audio.key.startsWith(`audio/${input.trackId}.`)) throw new HttpError(400, "Unexpected audio key");
  if (input.cover && (!input.cover.sm.key.startsWith("img/") || !input.cover.lg.key.startsWith("img/"))) {
    throw new HttpError(400, "Unexpected cover key");
  }
  if (await db.getTrack(input.trackId)) throw new HttpError(409, "This song is already in the library");

  await verifyObject(input.audio);
  for (const o of input.newObjects) await verifyObject(o);

  const catalog = await db.getCatalog();
  const { track, lyrics } = assembleTrack({ ...input, cover: input.cover ? imageSet(input.cover) : undefined }, catalog, uploadedBy);
  const { artists, albumArtist } = track;

  await db.saveTrack(track);
  if (lyrics) await db.saveLyrics(track.id, lyrics);

  // Storage accounting for every object this upload created.
  const created = [input.audio, ...input.newObjects.filter((o) => o.key !== input.audio.key)];
  for (const o of created) await db.addStorageUsage(o.provider, o.size, 1);

  const newArtists = await ensureArtists(albumArtist ? [...artists, albumArtist] : artists, catalog);
  scheduleEnrichment(track, newArtists, input.enrich.lyrics, input.enrich.artistImages);
  return track;
}

export async function updateTrack(id: string, patch: z.infer<typeof patchTrackSchema>): Promise<Track> {
  const db = await repo();
  const cur = await db.getTrack(id);
  if (!cur) throw new HttpError(404, "Track not found");
  for (const o of patch.newObjects) await verifyObject(o);
  const catalog = await db.getCatalog();
  const artists = patch.artists ? resolveArtists(patch.artists, catalog) : cur.artists;
  const albumArtist =
    patch.albumArtist !== undefined ? (patch.albumArtist ? resolveArtists([patch.albumArtist], catalog)[0] : undefined) : cur.albumArtist;
  const albumTitle = patch.album ?? cur.album.title;
  const owner = albumArtist ?? artists[0];
  const next: Track = {
    ...cur,
    ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && !["cover", "lyrics", "newObjects", "artists", "albumArtist", "album"].includes(k))),
    artists,
    albumArtist,
    album: { id: albumIdFor(owner.name, albumTitle), title: albumTitle },
    cover: patch.cover ? imageSet(patch.cover) : cur.cover,
    updatedAt: Date.now(),
  } as Track;
  if (patch.lyrics !== undefined) {
    await db.saveLyrics(id, patch.lyrics);
    next.hasLyrics = Boolean(patch.lyrics && (patch.lyrics.plain || patch.lyrics.synced?.length));
  }
  await db.saveTrack(next);
  for (const o of patch.newObjects) await db.addStorageUsage(o.provider, o.size, 1);
  if (patch.cover && cur.cover) await deleteImagesIfUnused(cur.cover, id);
  await ensureArtists(albumArtist ? [...artists, albumArtist] : artists, catalog);
  return next;
}

async function deleteImagesIfUnused(cover: ImageSet, exceptTrackId: string) {
  const db = await repo();
  const catalog = await db.getCatalog();
  const stillUsed = catalog.tracks.some((t) => t.id !== exceptTrackId && t.cover && (t.cover.lg === cover.lg || t.cover.sm === cover.sm));
  if (stillUsed) return;
  for (const ref of [cover.sm, cover.lg]) {
    const r = parseMediaRef(ref);
    const p = r && provider(r.provider);
    if (!r || !p) continue;
    const head = await p.head(r.key);
    if (!head) continue;
    await p.delete(r.key);
    await db.addStorageUsage(p.id, -head.size, -1);
  }
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await repo();
  const t = await db.getTrack(id);
  if (!t) throw new HttpError(404, "Track not found");
  const p = provider(t.audio.provider);
  if (p) {
    await p.delete(t.audio.key);
    await db.addStorageUsage(p.id, -t.audio.size, -1);
  }
  if (t.cover) await deleteImagesIfUnused(t.cover, id);
  await db.deleteTrack(id);
  // Remove artists that no longer have any tracks.
  const catalog = await db.getCatalog();
  const used = new Set(catalog.tracks.flatMap((x) => [...x.artists.map((a) => a.id), ...(x.albumArtist ? [x.albumArtist.id] : [])]));
  for (const a of [...t.artists, ...(t.albumArtist ? [t.albumArtist] : [])]) {
    if (used.has(a.id)) continue;
    const info = catalog.artists[a.id];
    if (info?.image) await deleteImagesIfUnused(info.image, id);
    await db.deleteArtist(a.id);
  }
}
