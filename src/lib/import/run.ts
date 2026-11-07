/**
 * Bulk import: a folder of playlist folders → songs in the buckets, the catalog and shared
 * playlists. The command is scripts/import.ts (`npm run import -- <folder>`).
 *
 *  1. Scan every audio file: hash, fingerprint (fpcalc), tags. Cached, so a second run is quick.
 *  2. Group copies of the same song (see dedupe.ts) and match songs already in Pepper.
 *  3. For each new song: re-encode (AAC, 160 kbps by default) and analyse in one ffmpeg pass,
 *     resize the cover, upload to a bucket with room, look up lyrics, decide the language.
 *  4. Save songs in batches of 50 (a few database writes per song instead of a dozen).
 *  5. Create the artists (photo + related artists from Deezer), then one shared playlist per folder.
 * Stopping and re-running is safe: songs already saved are recognised and skipped.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { guessLanguage } from "@/lib/metadata/language";
import { AUDIO_EXTENSIONS, audioMimeFor, normalizeGenres, type TrackDraft } from "@/lib/metadata/normalize";
import { canonicalGenres, languageFromGenres } from "@/lib/recs/genres";
import type { ArtistInfo, CatalogSnapshot, ImageSet, Lyrics, Playlist, ProviderId, StorageUsage, Track } from "@/lib/types";
import { artistIdFor, fnv1a, toMediaRef } from "@/lib/util";
import { assembleTrack, metadataSchema, trackIdFromSha } from "../server/catalog";
import type { ImportBatch } from "../server/db/types";
import { repo } from "../server/db";
import { fetchArtistPhoto, fetchLyrics, fetchRelatedArtists, lookupItunes } from "../server/enrich";
import { config } from "../server/env";
import { CACHE_IMMUTABLE, choosePlacement, providers, type StorageProvider } from "../server/storage";
import { catalogLookup, findExisting, groupRecordings, type Recording, type ScannedFile } from "./dedupe";
import { decodeFingerprint, encodeFingerprint } from "./fingerprint";
import { aacEncoder, coverImages, encodeAndAnalyze, fingerprintFile, hasCommand, readTags, sha256File, type CoverImages } from "./media";
import { orderFiles, parseOrderListing, playlistIdFor, playlistNameFromFolder } from "./order";

export interface ImportOptions {
  root: string;
  /** Scan and report only; change nothing. */
  dryRun: boolean;
  /** AAC bitrate in kbps; 0 keeps the original files. */
  bitrate: number;
  concurrency: number;
  playlists: boolean;
  lyrics: boolean;
  artists: boolean;
  /** Add at most this many new songs (to try it out). */
  limit?: number;
  /** Markdown listing with the songs' original order (e.g. MUSIC_CATALOG.md). */
  orderFile?: string;
  /** Where the scan cache and reports go. */
  stateDir: string;
  uploadedBy: string;
  log: (line: string) => void;
  /** Return true to stop after the songs in progress (Ctrl+C). */
  shouldStop?: () => boolean;
  /** Called after the plan is ready and before anything is changed; return false to cancel. */
  confirm?: (plan: ImportPlan) => Promise<boolean>;
}

export interface ImportPlan {
  files: number;
  skipped: { rel: string; reason: string }[];
  recordings: number;
  copiesMerged: number;
  existing: number;
  toAdd: number;
  estimatedBytes: number;
  freeBytes: number;
  playlists: { id: string; name: string; songs: number; exists: boolean }[];
  fingerprints: boolean;
  encoder: string;
}

export interface ImportReport extends ImportPlan {
  added: number;
  failed: { rel: string; error: string }[];
  artistsAdded: number;
  storedBytes: Record<ProviderId, number>;
  writes: number;
  reportFile?: string;
  stopped: boolean;
}

interface WalkedFile {
  abs: string;
  rel: string;
  folder: string;
  size: number;
  mtimeMs: number;
}

type CachedScan = Omit<ScannedFile, "fingerprint"> & { fp?: string };

const AUDIO = new Set(AUDIO_EXTENSIONS);
const FLUSH_EVERY = 50;

async function walk(root: string): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const visit = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await visit(abs);
      else if (e.isFile() && AUDIO.has(path.extname(e.name).slice(1).toLowerCase())) {
        const s = await stat(abs);
        const rel = path.relative(root, abs).split(path.sep).join("/");
        out.push({ abs, rel, folder: rel.includes("/") ? rel.split("/")[0] : "", size: s.size, mtimeMs: Math.round(s.mtimeMs) });
      }
    }
  };
  await visit(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>, stop: () => boolean) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length && !stop()) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 100 * 1024 * 1024 ? 1 : 0)} MB`;
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;

function trimFields(d: TrackDraft, genres: string[], year: number | undefined, language: string | undefined) {
  const names = (list: string[] | undefined) => (list ?? []).map((x) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 30);
  const url = d.sourceUrl && /^https?:\/\/\S+$/.test(d.sourceUrl) && d.sourceUrl.length <= 500 ? d.sourceUrl : undefined;
  const int = (v?: number) => (v && Number.isInteger(v) && v > 0 && v <= 9999 ? v : undefined);
  const artists = names(d.artists);
  return metadataSchema.parse({
    title: (d.title || "Untitled").slice(0, 300),
    subtitle: d.subtitle?.slice(0, 300),
    artists: artists.length ? artists : ["Unknown artist"],
    albumArtist: d.albumArtist?.slice(0, 120),
    album: (d.album || d.title || "Untitled").slice(0, 300),
    film: d.film?.slice(0, 200),
    genres: genres.map((g) => g.slice(0, 60)).filter(Boolean).slice(0, 6),
    year: year && year >= 1800 && year <= 2200 ? year : undefined,
    releaseDate: d.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(d.releaseDate) ? d.releaseDate : undefined,
    trackNo: int(d.trackNo),
    trackTotal: int(d.trackTotal),
    discNo: int(d.discNo),
    discTotal: int(d.discTotal),
    composers: names(d.composers),
    lyricists: names(d.lyricists),
    producers: names(d.producers),
    label: d.label?.slice(0, 200),
    copyright: d.copyright?.slice(0, 300),
    isrc: d.isrc?.slice(0, 20),
    language: language?.slice(0, 10),
    explicit: d.explicit,
    comment: d.comment?.slice(0, 1000),
    sourceUrl: url,
  });
}

export async function runImport(o: ImportOptions): Promise<ImportReport> {
  const log = o.log;
  const stop = () => Boolean(o.shouldStop?.());
  const root = path.resolve(o.root);
  await mkdir(o.stateDir, { recursive: true });
  if (!(await hasCommand("ffmpeg"))) throw new Error("ffmpeg is needed (macOS: brew install ffmpeg · Windows: winget install ffmpeg).");
  const fingerprints = await hasCommand("fpcalc", ["-version"]);
  if (!fingerprints) log("fpcalc not found: copies are matched by file hash and tags only (macOS: brew install chromaprint).");
  const encoder = o.bitrate > 0 ? await aacEncoder() : "copy";

  // ---------------------------------------------------------------- 1. scan
  const walked = await walk(root);
  log(`Found ${walked.length} audio files in ${root}`);
  const cacheFile = path.join(o.stateDir, `scan-${fnv1a(root)}.json`);
  let cache: Record<string, CachedScan> = {};
  try {
    cache = JSON.parse(await readFile(cacheFile, "utf8")).files ?? {};
  } catch {
    // first run
  }
  const saveCache = () => writeFile(cacheFile, JSON.stringify({ root, files: cache }));
  const scanned: ScannedFile[] = new Array(walked.length);
  let done = 0;
  await pool(
    walked,
    Math.max(2, o.concurrency),
    async (w, i) => {
      const hit = cache[w.rel];
      if (hit && hit.size === w.size && hit.mtimeMs === w.mtimeMs && (hit.fp || !fingerprints || hit.error)) {
        const { fp, ...rest } = hit;
        scanned[i] = { ...rest, fingerprint: fp ? decodeFingerprint(fp) : undefined };
      } else {
        const base: ScannedFile = { rel: w.rel, folder: w.folder, size: w.size, mtimeMs: w.mtimeMs, durationMs: 0 };
        if (w.size === 0) base.error = "empty file (0 bytes)";
        else {
          try {
            const [sha256, tags, fp] = await Promise.all([sha256File(w.abs), readTags(w.abs), fingerprints ? fingerprintFile(w.abs) : null]);
            const d = tags.draft;
            Object.assign(base, {
              sha256,
              fingerprint: fp?.values,
              durationMs: d.durationMs,
              title: d.rawTitle || d.title,
              artists: d.artists,
              genres: d.genres,
              year: d.year,
              film: d.film,
              albumArtist: d.albumArtist,
              sourceUrl: d.sourceUrl,
              bitrate: d.format.bitrate,
              hasCover: Boolean(tags.picture),
            });
            if (!d.durationMs) base.error = "no playable audio";
          } catch (err) {
            base.error = `unreadable (${(err as Error).message.slice(0, 120)})`;
          }
        }
        scanned[i] = base;
        const { fingerprint, ...rest } = base;
        cache[w.rel] = { ...rest, fp: fingerprint ? encodeFingerprint(fingerprint) : undefined };
      }
      if (++done % 200 === 0) {
        log(`Scanned ${done}/${walked.length}`);
        await saveCache();
      }
    },
    () => false,
  );
  await saveCache();
  const absOf = new Map(walked.map((w) => [w.rel, w.abs]));
  const skipped = scanned.filter((f) => f.error).map((f) => ({ rel: f.rel, reason: f.error! }));

  // ---------------------------------------------------------------- 2. plan
  const recordings = groupRecordings(scanned);
  const db = await repo();
  const catalog = await db.getCatalog();
  const lookup = catalogLookup(catalog.tracks);
  const idOf = new Map<Recording, string>();
  const fresh: Recording[] = [];
  let existing = 0;
  for (const r of recordings) {
    const id = findExisting(r, lookup, trackIdFromSha);
    if (id) {
      idOf.set(r, id);
      existing++;
    } else {
      idOf.set(r, trackIdFromSha(r.primary.sha256!));
      fresh.push(r);
    }
  }
  const toAdd = o.limit !== undefined ? fresh.slice(0, o.limit) : fresh;
  const trackOfFile = new Map<string, string>();
  for (const r of recordings) for (const f of r.files) trackOfFile.set(f.rel, idOf.get(r)!);

  const list = providers();
  const usage: Record<ProviderId, StorageUsage> = { ...(await db.getStorageUsage()) };
  const freeBytes = list.reduce((a, p) => a + Math.max(0, p.quotaBytes * (1 - config.storage.reserveRatio) - (usage[p.id]?.bytes ?? 0)), 0);
  const estimatedBytes = toAdd.reduce(
    (a, r) => a + (o.bitrate > 0 ? (r.primary.durationMs / 1000) * o.bitrate * 125 : r.primary.size) + (r.primary.hasCover ? 90_000 : 0),
    0,
  );

  const listing = o.orderFile ? parseOrderListing(await readFile(o.orderFile, "utf8")) : new Map<string, string[]>();
  const folders = [...new Set(scanned.filter((f) => f.folder).map((f) => f.folder))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const playlistPlan: ImportPlan["playlists"] = [];
  if (o.playlists) {
    for (const folder of folders) {
      const id = playlistIdFor(folder);
      const ids = new Set(scanned.filter((f) => f.folder === folder && !f.error).map((f) => trackOfFile.get(f.rel)).filter(Boolean));
      playlistPlan.push({ id, name: playlistNameFromFolder(folder), songs: ids.size, exists: Boolean(await db.getPlaylist(id)) });
    }
  }

  const plan: ImportPlan = {
    files: walked.length,
    skipped,
    recordings: recordings.length,
    copiesMerged: walked.length - skipped.length - recordings.length,
    existing,
    toAdd: toAdd.length,
    estimatedBytes,
    freeBytes,
    playlists: playlistPlan,
    fingerprints,
    encoder,
  };
  const report: ImportReport = { ...plan, added: 0, failed: [], artistsAdded: 0, storedBytes: {}, writes: 0, stopped: false };
  if (o.dryRun) {
    report.reportFile = await writeReport(o, report, recordings);
    return report;
  }
  if (estimatedBytes > freeBytes) {
    throw new Error(`These songs need about ${gb(estimatedBytes)} but the buckets have ${gb(freeBytes)} free. Add a bucket or raise a quota, or import fewer songs with --limit.`);
  }
  if (o.confirm && !(await o.confirm(plan))) {
    report.stopped = true;
    return report;
  }

  // ---------------------------------------------------------------- 3./4. songs
  const tmpDir = path.join(os.tmpdir(), "pepper-import");
  await mkdir(tmpDir, { recursive: true });
  const runArtists: Record<string, ArtistInfo> = { ...catalog.artists };
  const snapshot: CatalogSnapshot = { ...catalog, artists: runArtists };
  const coverRefs = new Map<string, ImageSet>();
  const coverColorOfArtist = new Map<string, string>();
  let pending: Required<Pick<ImportBatch, "tracks" | "lyrics" | "storage">> = { tracks: [], lyrics: {}, storage: {} };
  let flushing: Promise<void> = Promise.resolve();
  // A failed save or full buckets stop the import (songs in progress finish first).
  let fatal: Error | null = null;
  const halted = () => stop() || fatal !== null;
  const addUsage = (p: StorageProvider, bytes: number, objects: number) => {
    const u = (usage[p.id] ??= { bytes: 0, objects: 0 });
    u.bytes += bytes;
    u.objects += objects;
    const s = (pending.storage[p.id] ??= { bytes: 0, objects: 0 });
    s.bytes += bytes;
    s.objects += objects;
    report.storedBytes[p.id] = (report.storedBytes[p.id] ?? 0) + bytes;
  };
  const place = (size: number) => choosePlacement(list, usage, size, config.storage.strategy, config.storage.primary);
  const countWrites = (b: ImportBatch) =>
    (b.tracks?.length ?? 0) + Object.keys(b.lyrics ?? {}).length + Math.min(16, (b.tracks?.length ?? 0) + (b.artists?.length ?? 0)) + 2 + (b.playlists?.length ?? 0) * 2;
  const flush = () => {
    flushing = flushing.then(async () => {
      if (fatal || !pending.tracks.length) return;
      const batch = pending;
      pending = { tracks: [], lyrics: {}, storage: {} };
      try {
        await db.importBatch(batch);
        report.writes += countWrites(batch);
        log(`Saved ${report.added - pending.tracks.length} songs so far`);
      } catch (err) {
        fatal = err as Error;
        report.added -= batch.tracks.length;
        log(`Saving to the database failed: ${fatal.message}`);
      }
    });
    return flushing;
  };

  // Songs with no genre of their own get one from Apple's catalog, unless one of their artists has
  // genre-tagged songs here. One lookup per artist is enough: autoplay lends a song its artist's
  // usual genre, so the rest of that artist's untagged songs inherit it.
  const taggedArtists = new Set(scanned.filter((f) => f.genres?.length).flatMap((f) => (f.artists ?? []).map(artistIdFor)));
  const lookedUpArtists = new Set<string>();
  const started = Date.now();

  await pool(
    toAdd,
    o.concurrency,
    async (rec, i) => {
      const abs = absOf.get(rec.primary.rel)!;
      const trackId = idOf.get(rec)!;
      const tmp = path.join(tmpDir, `${trackId}.m4a`);
      try {
        const { draft, picture } = await readTags(abs);
        // Fill gaps from the other copies' tags.
        let genres = draft.genres.length ? draft.genres : (rec.files.find((f) => f.genres?.length)?.genres ?? []);
        let year = draft.year ?? rec.files.find((f) => f.year)?.year;
        if (!draft.film) draft.film = rec.files.find((f) => f.film)?.film;

        let cover: ImageSet | undefined;
        if (picture) {
          const c: CoverImages | null = await coverImages(picture.data);
          if (c) {
            cover = coverRefs.get(c.hash);
            if (!cover) {
              const target = place(c.lg.length + c.sm.length);
              const kSm = `img/covers/${c.hash}-sm.${c.ext}`;
              const kLg = `img/covers/${c.hash}-lg.${c.ext}`;
              await target.put(kSm, c.sm, "image/webp", CACHE_IMMUTABLE);
              await target.put(kLg, c.lg, "image/webp", CACHE_IMMUTABLE);
              addUsage(target, c.sm.length + c.lg.length, 2);
              cover = { sm: toMediaRef(target.id, kSm), lg: toMediaRef(target.id, kLg), color: c.color };
              coverRefs.set(c.hash, cover);
            }
          }
        }

        const enc = await encodeAndAnalyze(abs, tmp, draft.durationMs, o.bitrate, encoder === "copy" ? "aac" : encoder);
        const reencoded = o.bitrate > 0;
        const ext = reencoded ? "m4a" : path.extname(abs).slice(1).toLowerCase();
        const contentType = reencoded ? "audio/mp4" : audioMimeFor(abs);
        const target = place(enc.size);
        const key = `audio/${trackId}.${ext}`;
        await target.put(key, await readFile(enc.file), contentType);
        addUsage(target, enc.size, 1);

        let lyrics: Lyrics | undefined = draft.lyrics;
        if (!lyrics && o.lyrics) {
          lyrics =
            (await fetchLyrics({ title: draft.title, artist: draft.artists[0] ?? "", album: draft.film ?? draft.album, durationMs: draft.durationMs })) ?? undefined;
        }
        const ids = draft.artists.map(artistIdFor);
        if (!genres.length && config.enrich.genres && !ids.some((id) => taggedArtists.has(id) || lookedUpArtists.has(id))) {
          for (const id of ids) lookedUpArtists.add(id);
          const apple = await lookupItunes({ title: draft.title, artists: draft.artists, durationMs: draft.durationMs });
          if (apple.genre) {
            genres = normalizeGenres([apple.genre]);
            for (const id of ids) taggedArtists.add(id);
          } else if (apple.failed) {
            for (const id of ids) lookedUpArtists.delete(id); // try again with their next song
          }
          year ??= apple.year;
        }
        const lyricsText = lyrics?.plain ?? lyrics?.synced?.map((l) => l.text).join("\n");
        const language = guessLanguage({
          lyrics: lyricsText,
          tag: draft.language,
          genreLang: languageFromGenres(canonicalGenres(genres)),
          title: [draft.title, draft.subtitle].filter(Boolean).join(" "),
        });

        const fields = trimFields(draft, genres, year, language);
        const now = Date.now();
        const { track, lyrics: keptLyrics } = assembleTrack(
          {
            ...fields,
            trackId,
            rawTitle: draft.rawTitle.slice(0, 500),
            durationMs: draft.durationMs,
            audio: {
              provider: target.id,
              key,
              size: enc.size,
              contentType,
              sha256: enc.sha256,
              sourceSha256: rec.primary.sha256,
              originalName: path.basename(abs).slice(0, 300),
              bitrate: reencoded ? o.bitrate * 1000 : draft.format.bitrate,
              sampleRate: draft.format.sampleRate,
              channels: draft.format.channels,
              codec: reencoded ? "AAC" : draft.format.codec,
              container: reencoded ? "MPEG-4" : draft.format.container,
              lossless: reencoded ? false : draft.format.lossless,
            },
            cover,
            features: enc.features ?? undefined,
            lyrics,
          },
          snapshot,
          o.uploadedBy,
          now,
        );
        const full: Track = { ...track, enrichedAt: now };
        for (const a of [...full.artists, ...(full.albumArtist ? [full.albumArtist] : [])]) {
          if (!runArtists[a.id]) runArtists[a.id] = { id: a.id, name: a.name, createdAt: now };
          if (cover && !coverColorOfArtist.has(a.id)) coverColorOfArtist.set(a.id, cover.color);
        }
        pending.tracks.push(full);
        if (keptLyrics) pending.lyrics[full.id] = keptLyrics;
        report.added++;
        const rate = (Date.now() - started) / report.added;
        const left = Math.round(((toAdd.length - report.added) * rate) / 60_000);
        log(
          `[${i + 1}/${toAdd.length}] ✓ ${full.title} — ${full.artists.map((a) => a.name).join(", ")} (${mb(enc.size)}, ${target.id}${keptLyrics ? ", lyrics" : ""}${
            language ? `, ${language}` : ""
          })${report.added % 10 === 0 ? ` · about ${left} min left` : ""}`,
        );
        if (pending.tracks.length >= FLUSH_EVERY) await flush();
      } catch (err) {
        if ((err as Error).name === "StorageFullError") fatal ??= err as Error;
        report.failed.push({ rel: rec.primary.rel, error: (err as Error).message });
        log(`[${i + 1}/${toAdd.length}] ✗ ${rec.primary.rel}: ${(err as Error).message}`);
      } finally {
        await rm(tmp, { force: true });
      }
    },
    halted,
  );
  await flush();
  if (fatal) {
    report.stopped = true;
    report.reportFile = await writeReport(o, report, recordings);
    throw new Error(`${(fatal as Error).message}\nSongs saved so far are kept; run the same command again to continue. Report: ${report.reportFile}`);
  }
  report.stopped = stop();

  // ---------------------------------------------------------------- 5a. artists
  if (!report.stopped) {
    const fresh = await db.getCatalog();
    const missing = new Map<string, string>();
    for (const t of fresh.tracks) {
      for (const a of [...t.artists, ...(t.albumArtist ? [t.albumArtist] : [])]) {
        if (!fresh.artists[a.id] && !missing.has(a.id)) missing.set(a.id, a.name);
      }
    }
    if (missing.size) log(`Adding ${missing.size} artists${o.artists ? " (photos and similar artists from Deezer)" : ""}…`);
    let batch: ArtistInfo[] = [];
    const flushArtists = async () => {
      if (!batch.length) return;
      const b: ImportBatch = { artists: batch, storage: pending.storage };
      batch = [];
      pending.storage = {};
      await db.importBatch(b);
      report.writes += countWrites(b);
    };
    let n = 0;
    await pool(
      [...missing],
      3,
      async ([id, name]) => {
        const info: ArtistInfo = { id, name, createdAt: Date.now() };
        if (o.artists) {
          try {
            const photo = await fetchArtistPhoto(name);
            if (photo) {
              const target = place(photo.lg.length + photo.sm.length);
              const hash = fnv1a(`${id}:${photo.lg.length}:${photo.sm.length}`);
              const kLg = `img/artists/${id}-${hash}-lg.jpg`;
              const kSm = `img/artists/${id}-${hash}-sm.jpg`;
              await target.put(kLg, photo.lg, "image/jpeg", CACHE_IMMUTABLE);
              await target.put(kSm, photo.sm, "image/jpeg", CACHE_IMMUTABLE);
              addUsage(target, photo.lg.length + photo.sm.length, 2);
              info.image = { lg: toMediaRef(target.id, kLg), sm: toMediaRef(target.id, kSm), color: coverColorOfArtist.get(id) ?? "#535353" };
            }
            const related = await fetchRelatedArtists(name);
            if (related) info.related = related;
          } catch (err) {
            log(`  artist ${name}: ${(err as Error).message}`);
          }
        }
        batch.push(info);
        report.artistsAdded++;
        if (++n % 50 === 0) log(`  ${n}/${missing.size} artists`);
        if (batch.length >= 100) await flushArtists();
      },
      stop,
    );
    await flushArtists();
  }

  // ---------------------------------------------------------------- 5b. playlists
  if (o.playlists && !report.stopped) {
    const saved = new Set((await db.getCatalog()).tracks.map((t) => t.id));
    const now = Date.now();
    const lists: Playlist[] = [];
    for (const folder of folders) {
      const files = orderFiles(
        scanned.filter((f) => f.folder === folder && !f.error),
        listing.get(folder),
      );
      const ids: string[] = [];
      for (const f of files) {
        const id = trackOfFile.get(f.rel);
        if (id && saved.has(id) && !ids.includes(id)) ids.push(id);
      }
      if (!ids.length) continue;
      const id = playlistIdFor(folder);
      const cur = await db.getPlaylist(id);
      lists.push({
        id,
        ownerUid: cur?.ownerUid ?? "pepper",
        ownerName: cur?.ownerName ?? "Pepper",
        name: cur?.name ?? playlistNameFromFolder(folder),
        description: cur?.description,
        trackIds: ids,
        createdAt: cur?.createdAt ?? now,
        updatedAt: now,
        shared: true,
        source: `import:${folder}`,
      });
    }
    if (lists.length) {
      const b: ImportBatch = { playlists: lists, storage: pending.storage };
      await db.importBatch(b);
      report.writes += countWrites(b);
      log(`Saved ${lists.length} shared playlists`);
    }
  } else if (Object.keys(pending.storage).length) {
    await db.importBatch({ storage: pending.storage });
  }

  report.reportFile = await writeReport(o, report, recordings);
  return report;
}

async function writeReport(o: ImportOptions, r: ImportReport, recordings: Recording[]): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(o.stateDir, `import-report-${stamp}${o.dryRun ? "-dry-run" : ""}.md`);
  const lines: string[] = [];
  lines.push(`# Import ${o.dryRun ? "plan (dry run)" : "report"} — ${new Date().toLocaleString()}`, "", `Folder: \`${path.resolve(o.root)}\``, "");
  lines.push(`- Audio files: ${r.files} (${r.skipped.length} skipped)`);
  lines.push(`- Different songs: ${r.recordings} (${r.copiesMerged} files were copies of another)`);
  lines.push(`- Already in Pepper: ${r.existing}`);
  lines.push(o.dryRun ? `- Would add: ${r.toAdd} songs, about ${gb(r.estimatedBytes)} (${gb(r.freeBytes)} free)` : `- Added: ${r.added} of ${r.toAdd}${r.failed.length ? ` (${r.failed.length} failed)` : ""}${r.stopped ? " — stopped early" : ""}`);
  if (!o.dryRun) {
    lines.push(`- Artists added: ${r.artistsAdded}`);
    lines.push(`- Stored: ${Object.entries(r.storedBytes).map(([id, b]) => `${id} ${gb(b)}`).join(", ") || "nothing"}`);
    lines.push(`- Database writes: about ${r.writes}`);
  }
  lines.push(`- Audio: ${o.bitrate > 0 ? `AAC ${o.bitrate} kbps (${r.encoder})` : "original files"} · duplicate check: ${r.fingerprints ? "audio fingerprints + tags" : "file hash + tags"}`);
  if (r.playlists.length) {
    lines.push("", "## Shared playlists", "");
    for (const p of r.playlists) lines.push(`- ${p.name} — ${p.songs} songs${p.exists ? " (updated)" : ""}`);
  }
  const merged = recordings.filter((x) => x.files.length > 1).sort((a, b) => b.files.length - a.files.length);
  if (merged.length) {
    lines.push("", `## Copies merged (${merged.length} songs)`, "");
    for (const m of merged) {
      lines.push(`- **${m.primary.title ?? m.primary.rel}** — ${m.files.length} files (${m.reasons.join(", ")})`);
      for (const f of m.files) lines.push(`  - ${f === m.primary ? "kept: " : ""}${f.rel}`);
    }
  }
  if (r.skipped.length) {
    lines.push("", `## Skipped files (${r.skipped.length})`, "");
    for (const s of r.skipped) lines.push(`- ${s.rel} — ${s.reason}`);
  }
  if (r.failed.length) {
    lines.push("", `## Failed (${r.failed.length})`, "");
    for (const f of r.failed) lines.push(`- ${f.rel} — ${f.error}`);
  }
  await writeFile(file, lines.join("\n") + "\n");
  return file;
}
