/**
 * Optional metadata enrichment from free public APIs (no keys needed):
 *  - LRCLIB  (https://lrclib.net)  synced / plain lyrics
 *  - Deezer  (https://api.deezer.com) artist photos and related artists (exact name matches only)
 *  - Apple   (https://itunes.apple.com/search) the catalog genre of a song ("Bollywood", "Tamil", …);
 *            only the genre name and year are read — no previews or artwork
 * Disable with ENRICH_LYRICS=false / ENRICH_ARTIST_IMAGES=false / ENRICH_GENRES=false.
 */
import { createHash } from "node:crypto";
import type { ArtistInfo, Lyrics, ProviderId, Track } from "@/lib/types";
import { artistIdFor, fold, toMediaRef } from "@/lib/util";
import { guessLanguage } from "@/lib/metadata/language";
import { parseLrc, syncedToPlain } from "@/lib/metadata/lrc";
import { normalizeGenres } from "@/lib/metadata/normalize";
import { canonicalGenres, languageFromGenres } from "@/lib/recs/genres";
import { CACHE_IMMUTABLE, choosePlacement, providers } from "./storage";
import { config } from "./env";
import { repo } from "./db";

const UA = "Pepper/1.0 (self-hosted music player)";

async function getJson<T>(url: string, timeoutMs = 6000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface LrclibRecord {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export async function fetchLyrics(q: { title: string; artist: string; album?: string; durationMs: number }): Promise<Lyrics | null> {
  if (!config.enrich.lyrics) return null;
  const duration = Math.round(q.durationMs / 1000);
  const params = new URLSearchParams({ track_name: q.title, artist_name: q.artist, duration: String(duration) });
  if (q.album) params.set("album_name", q.album);
  let rec = await getJson<LrclibRecord>(`https://lrclib.net/api/get?${params}`);
  if (!rec || (!rec.syncedLyrics && !rec.plainLyrics)) {
    const found = await getJson<LrclibRecord[]>(
      `https://lrclib.net/api/search?${new URLSearchParams({ track_name: q.title, artist_name: q.artist })}`,
    );
    const titleKey = fold(q.title);
    rec =
      found
        ?.filter((r) => Math.abs(r.duration - duration) <= 4 && fold(r.trackName).includes(titleKey))
        .sort((a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)))[0] ?? null;
  }
  if (!rec || rec.instrumental) return null;
  if (rec.syncedLyrics) {
    const synced = parseLrc(rec.syncedLyrics);
    if (synced.length) return { synced, plain: rec.plainLyrics ?? syncedToPlain(synced), source: "lrclib" };
  }
  if (rec.plainLyrics) return { plain: rec.plainLyrics, source: "lrclib" };
  return null;
}

interface DeezerArtist {
  id: number;
  name: string;
  picture_medium: string;
  picture_big: string;
  picture_xl: string;
  nb_fan: number;
}

const deezerArtists = new Map<string, { at: number; artist: DeezerArtist | null }>();

// Deezer allows 50 requests per 5 seconds per IP: keep well under it (a bulk import makes thousands).
let deezerNextAt = 0;
async function deezerJson<T>(url: string): Promise<T | null> {
  const now = Date.now();
  const at = Math.max(now, deezerNextAt);
  deezerNextAt = at + 150;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  return getJson<T>(url);
}

/** The Deezer artist whose name matches exactly (most fans wins), cached for an hour. */
export async function findDeezerArtist(name: string): Promise<DeezerArtist | null> {
  const want = fold(name);
  const hit = deezerArtists.get(want);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.artist;
  const res = await deezerJson<{ data?: DeezerArtist[] }>(`https://api.deezer.com/search/artist?${new URLSearchParams({ q: name, limit: "5" })}`);
  if (!res) return null; // network trouble: do not cache
  const artist = res.data?.filter((a) => fold(a.name) === want).sort((a, b) => b.nb_fan - a.nb_fan)[0] ?? null;
  deezerArtists.set(want, { at: Date.now(), artist });
  return artist;
}

/**
 * Similar artists from Deezer, as Pepper artist ids (they match library artists by name).
 * Returns null when the lookup failed (try again later), [] when Deezer knows no match.
 */
export async function fetchRelatedArtists(name: string): Promise<string[] | null> {
  if (!config.enrich.genres) return [];
  const artist = await findDeezerArtist(name);
  if (!artist) return deezerArtists.has(fold(name)) ? [] : null;
  const res = await deezerJson<{ data?: { name: string }[] }>(`https://api.deezer.com/artist/${artist.id}/related?limit=20`);
  if (!res) return null;
  const self = artistIdFor(name);
  return [...new Set((res.data ?? []).map((a) => artistIdFor(a.name)).filter((id) => id !== self))];
}

// ---------------------------------------------------------------- Apple catalog genre

interface ItunesSong {
  trackName: string;
  artistName: string;
  collectionName?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
}

// Apple allows roughly 20 searches a minute: space them out across all callers in this process.
let itunesQueue: Promise<unknown> = Promise.resolve();
let itunesNextAt = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = itunesQueue.then(async () => {
    const wait = itunesNextAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    itunesNextAt = Date.now() + 3100;
    return fn();
  });
  itunesQueue = run.catch(() => undefined);
  return run;
}

const stripVersion = (s: string) => fold(s.replace(/\s*[([].*?[)\]]\s*/g, " "));

/**
 * The song's genre and release year in Apple's catalog. Only accepts a result whose title and
 * artist match and whose length is within a few seconds. `failed` means try again later.
 */
export async function lookupItunes(q: { title: string; artists: string[]; durationMs: number }): Promise<{ genre?: string; year?: number; failed?: boolean }> {
  if (!config.enrich.genres) return {};
  const title = stripVersion(q.title);
  const names = q.artists.map(fold).filter(Boolean);
  if (!title || !names.length) return {};
  for (const country of ["IN", "US"]) {
    const params = new URLSearchParams({ term: `${q.title} ${q.artists[0]}`, entity: "song", country, limit: "10" });
    let songs: ItunesSong[];
    try {
      const res = await throttled(() => fetch(`https://itunes.apple.com/search?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }));
      if (!res.ok) return { failed: true };
      songs = ((await res.json()) as { results?: ItunesSong[] }).results ?? [];
    } catch {
      return { failed: true };
    }
    const match = songs.find((s) => {
      const t = stripVersion(s.trackName);
      const a = fold(s.artistName);
      const titleOk = t === title || t.startsWith(`${title} `) || title.startsWith(`${t} `);
      const artistOk = names.some((n) => a.includes(n) || n.includes(a));
      const lengthOk = !q.durationMs || !s.trackTimeMillis || Math.abs(s.trackTimeMillis - q.durationMs) <= 6000;
      return titleOk && artistOk && lengthOk;
    });
    if (match) {
      const year = Number(match.releaseDate?.slice(0, 4));
      return { genre: match.primaryGenreName, year: year > 1900 ? year : undefined };
    }
  }
  return {};
}

/**
 * Fill in a song's genre (from Apple's catalog when the file had none of its own kind),
 * language (lyrics → tag → genre → title) and year. Never overwrites what the admin entered.
 * Returns the updated track, or null when a lookup failed and the song should be retried.
 */
export async function enrichTrackDetails(id: string): Promise<Track | null> {
  const db = await repo();
  const track = await db.getTrack(id);
  if (!track) return null;
  const apple = await lookupItunes({ title: track.title, artists: track.artists.map((a) => a.name), durationMs: track.durationMs });
  if (apple.failed) return null;

  // Add Apple's genre unless the song already has it in other words ("Modern Bollywood" ~ "Bollywood").
  const genres = [...track.genres];
  for (const g of apple.genre ? normalizeGenres([apple.genre]) : []) {
    const have = canonicalGenres(genres);
    const ids = [...canonicalGenres([g]).keys()];
    const covered = ids.length ? ids.every((id) => have.has(id)) : genres.some((x) => fold(x) === fold(g));
    if (!covered && genres.length < 6) genres.push(g);
  }
  const lyrics = track.hasLyrics ? await db.getLyrics(id) : null;
  const lyricsText = lyrics?.plain ?? lyrics?.synced?.map((l) => l.text).join("\n");
  const language =
    track.language ??
    guessLanguage({ lyrics: lyricsText, genreLang: languageFromGenres(canonicalGenres(genres)), title: [track.title, track.subtitle].filter(Boolean).join(" ") });

  const fresh = (await db.getTrack(id)) ?? track; // the admin may have edited it meanwhile
  const next: Track = {
    ...fresh,
    genres: fresh.genres.length && fresh.genres.join() !== track.genres.join() ? fresh.genres : genres,
    language: fresh.language ?? language,
    year: fresh.year ?? apple.year,
    enrichedAt: Date.now(),
  };
  await db.saveTrack(next);
  return next;
}

/** Fetch and store lyrics for a song that has none. */
export async function enrichLyrics(track: Track): Promise<boolean> {
  if (!config.enrich.lyrics || track.hasLyrics) return false;
  const lyrics = await fetchLyrics({
    title: track.title,
    artist: track.artists[0]?.name ?? "",
    album: track.film ?? track.album.title,
    durationMs: track.durationMs,
  });
  if (!lyrics) return false;
  const db = await repo();
  await db.saveLyrics(track.id, lyrics);
  const fresh = await db.getTrack(track.id);
  if (fresh) await db.saveTrack({ ...fresh, hasLyrics: true, updatedAt: Date.now() });
  return true;
}

/** Look up related artists for an artist that has none yet. */
export async function enrichArtistRelated(artist: ArtistInfo): Promise<boolean> {
  if (artist.related !== undefined || !config.enrich.genres) return false;
  const related = await fetchRelatedArtists(artist.name);
  if (related === null) return false;
  const db = await repo();
  const cur = (await db.getCatalog()).artists[artist.id] ?? artist;
  await db.saveArtist({ ...cur, related });
  return true;
}

export async function download(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 1000 && buf.length < 5_000_000 ? buf : null;
  } catch {
    return null;
  }
}

/** An artist photo from Deezer (large and small JPEG), or null when there is none. */
export async function fetchArtistPhoto(name: string): Promise<{ lg: Uint8Array; sm: Uint8Array } | null> {
  if (!config.enrich.artistImages) return null;
  const match = await findDeezerArtist(name);
  // Deezer's placeholder for artists without a photo has an empty id in its URL.
  if (!match || /\/artist\/\//.test(match.picture_big)) return null;
  const [lg, sm] = await Promise.all([download(match.picture_xl || match.picture_big), download(match.picture_medium)]);
  return lg && sm ? { lg, sm } : null;
}

/** Find an artist photo and store it in our own buckets (no hot-linking). */
export async function enrichArtistImage(artist: ArtistInfo, fallbackColor?: string): Promise<ArtistInfo | null> {
  if (!config.enrich.artistImages || artist.image) return null;
  const photo = await fetchArtistPhoto(artist.name);
  if (!photo) return null;
  const { lg, sm } = photo;

  const db = await repo();
  const usage = await db.getStorageUsage();
  const target = choosePlacement(providers(), usage, lg.length + sm.length, config.storage.strategy, config.storage.primary);
  const hash = createHash("sha256").update(lg).digest("hex").slice(0, 12);
  const keyLg = `img/artists/${artist.id}-${hash}-lg.jpg`;
  const keySm = `img/artists/${artist.id}-${hash}-sm.jpg`;
  await target.put(keyLg, lg, "image/jpeg", CACHE_IMMUTABLE);
  await target.put(keySm, sm, "image/jpeg", CACHE_IMMUTABLE);
  await db.addStorageUsage(target.id as ProviderId, lg.length + sm.length, 2);
  const updated: ArtistInfo = {
    ...artist,
    image: { lg: toMediaRef(target.id, keyLg), sm: toMediaRef(target.id, keySm), color: fallbackColor ?? "#535353" },
  };
  await db.saveArtist(updated);
  return updated;
}
