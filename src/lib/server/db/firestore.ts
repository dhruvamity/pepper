/**
 * Firestore repository, designed around the Spark (free) plan limits:
 *  - The catalog is kept in 16 shard documents (JSON strings per track) so the whole library
 *    loads in ~18 reads and is cached in memory; individual track docs remain the source of truth.
 *    Shared playlists are mirrored into one more document (catalog/lists) the same way.
 *  - Bulk imports save many songs per batched commit (importBatch), so a 2,000-song import costs
 *    a few thousand writes instead of tens of thousands.
 *  - Analytics use increment-only writes (see analytics/score.ts) — one batched commit per play.
 *  - Clients never talk to Firestore directly (rules deny everything); the server uses the Admin SDK.
 */
import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue, getFirestore, type Firestore, type QuerySnapshot } from "firebase-admin/firestore";
import type { JamDocument } from "@/lib/jam";
import type { PlayUpdate } from "@/lib/analytics/score";
import type {
  ArtistInfo,
  CatalogSnapshot,
  CatalogTrack,
  DailyStats,
  Lyrics,
  PlayEvent,
  Playlist,
  ProviderId,
  StorageUsage,
  Track,
  TrackStats,
  UserLibrary,
  UserProfile,
  UserTaste,
} from "@/lib/types";
import { dayKey, fnv1a } from "@/lib/util";
import { config } from "../env";
import { firebaseAdminApp } from "../firebase-admin";
import { emptyDaily, emptyLibrary, emptyStats, emptyTaste, toCatalogTrack, type ImportBatch, type LibraryKind, type Repo } from "./types";

const SHARDS = 16;
const CATALOG_CHECK_MS = 5_000;
const STATS_TTL_MS = 30_000;
const COOC_TTL_MS = 120_000;
// Daily aggregates (UTC days): today's changes with every play, yesterday's around midnight;
// older days only change through late reports.
const DAILY_RECENT_TTL_MS = 60_000;
const DAILY_PAST_TTL_MS = 600_000;
const TRACK_TTL_MS = 10 * 60_000;

function shardOf(id: string): number {
  return parseInt(fnv1a(id), 36) % SHARDS;
}

type Cache = {
  catalog?: { version: number; snapshot: CatalogSnapshot; checkedAt: number };
  catalogLoad?: { gen: number; promise: Promise<CatalogSnapshot> };
  /** Bumped by every catalog write this process makes. */
  catalogGen?: number;
  stats?: { at: number; data: Record<string, TrackStats> };
  cooc?: Map<string, { at: number; row: Record<string, number> | null }>;
  daily?: Map<string, { at: number; data: DailyStats }>;
  /** Recently read track docs: starting a song needs one, and replays shouldn't cost a read. */
  tracks?: Map<string, { at: number; track: Track | null }>;
  warnedIndex?: boolean;
};

const g = globalThis as unknown as { __pepperFsCache?: Cache };

export class FirestoreRepo implements Repo {
  readonly kind = "firestore" as const;
  private db: Firestore;
  private cache: Cache;

  constructor() {
    this.db = getFirestore(firebaseAdminApp());
    try {
      // REST starts faster on serverless hosts, but its transport always asks Google for
      // credentials, which the local emulator doesn't have; the emulator gets gRPC instead.
      this.db.settings({ ignoreUndefinedProperties: true, preferRest: !process.env.FIRESTORE_EMULATOR_HOST });
    } catch {
      // settings() can only be called once per instance (hot reload) — safe to ignore.
    }
    this.cache = g.__pepperFsCache ??= {};
  }

  private shard(n: number) {
    return this.db.collection("catalog").doc(`s${n}`);
  }
  private meta() {
    return this.db.collection("catalog").doc("meta");
  }
  private lists() {
    return this.db.collection("catalog").doc("lists");
  }

  // ---------------------------------------------------------------- catalog
  async getCatalog(): Promise<CatalogSnapshot> {
    const c = this.cache.catalog;
    if (c && Date.now() - c.checkedAt < CATALOG_CHECK_MS) return c.snapshot;
    // Requests arriving together share one refresh instead of each reading every shard.
    const gen = this.cache.catalogGen ?? 0;
    const pending = this.cache.catalogLoad;
    if (pending && pending.gen === gen) return pending.promise;
    const promise = this.loadCatalog(gen).finally(() => {
      if (this.cache.catalogLoad?.promise === promise) this.cache.catalogLoad = undefined;
    });
    this.cache.catalogLoad = { gen, promise };
    return promise;
  }

  private async loadCatalog(gen: number): Promise<CatalogSnapshot> {
    const now = Date.now();
    // A load that started before one of our own writes must not cache what it read.
    const current = () => gen === (this.cache.catalogGen ?? 0);
    const metaSnap = await this.meta().get();
    const version = Number(metaSnap.get("version") ?? 0);
    const c = this.cache.catalog;
    if (c && c.version === version) {
      if (current()) c.checkedAt = now;
      return c.snapshot;
    }
    const refs = [...Array.from({ length: SHARDS }, (_, i) => this.shard(i)), this.lists()];
    const [docs, legacy] = await Promise.all([this.db.getAll(...refs), this.legacyAdminPlaylists()]);
    const tracks: CatalogTrack[] = [];
    const artists: Record<string, ArtistInfo> = {};
    for (const d of docs.slice(0, SHARDS)) {
      const t = (d.get("t") ?? {}) as Record<string, string>;
      const a = (d.get("a") ?? {}) as Record<string, string>;
      for (const json of Object.values(t)) tracks.push(JSON.parse(json));
      for (const [id, json] of Object.entries(a)) artists[id] = JSON.parse(json);
    }
    const lists = (docs[SHARDS].get("p") ?? {}) as Record<string, string>;
    const playlistsById = new Map(legacy.map((p) => [p.id, p]));
    for (const value of Object.values(lists)) {
      const p = JSON.parse(value) as Playlist;
      playlistsById.set(p.id, p);
    }
    const playlists = [...playlistsById.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const snapshot = { version, tracks, artists, playlists };
    if (current()) {
      // Another server changed the catalog: its track docs may have changed too.
      if (c && c.version !== version) this.cache.tracks?.clear();
      this.cache.catalog = { version, snapshot, checkedAt: now };
    }
    return snapshot;
  }

  /** Older app-created admin playlists did not have the shared flag. */
  private async legacyAdminPlaylists(): Promise<Playlist[]> {
    if (config.auth !== "firebase" || !config.adminEmails.length) return [];
    const auth = getAuth(firebaseAdminApp());
    const owners: string[] = [];
    for (let i = 0; i < config.adminEmails.length; i += 100) {
      const { users } = await auth.getUsers(config.adminEmails.slice(i, i + 100).map((email) => ({ email })));
      owners.push(...users.filter((u) => u.emailVerified && !u.disabled).map((u) => u.uid));
    }
    const playlists: Playlist[] = [];
    for (let i = 0; i < owners.length; i += 30) {
      const q = await this.db.collection("playlists").where("ownerUid", "in", owners.slice(i, i + 30)).get();
      for (const doc of q.docs) {
        const p = doc.data() as Playlist;
        if (p.shared == null) playlists.push({ ...p, shared: true });
      }
    }
    return playlists;
  }

  private invalidateCatalog() {
    this.cache.tracks?.clear();
    this.cache.catalogGen = (this.cache.catalogGen ?? 0) + 1;
    if (this.cache.catalog) this.cache.catalog.checkedAt = 0;
  }

  async getTrack(id: string) {
    const cache = (this.cache.tracks ??= new Map());
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TRACK_TTL_MS) return hit.track ? structuredClone(hit.track) : null;
    const s = await this.db.collection("tracks").doc(id).get();
    const track = s.exists ? (s.data() as Track) : null;
    if (track) cache.set(id, { at: Date.now(), track });
    if (cache.size > 4000) for (const k of [...cache.keys()].slice(0, cache.size - 4000)) cache.delete(k);
    return track ? structuredClone(track) : null;
  }

  async saveTrack(track: Track) {
    const batch = this.db.batch();
    batch.set(this.db.collection("tracks").doc(track.id), track);
    batch.set(
      this.shard(shardOf(track.id)),
      { t: { [track.id]: JSON.stringify(toCatalogTrack(track)) } },
      { mergeFields: [new FieldPath("t", track.id)] },
    );
    batch.set(this.meta(), { version: FieldValue.increment(1) }, { merge: true });
    await batch.commit();
    this.invalidateCatalog();
  }

  async deleteTrack(id: string) {
    const batch = this.db.batch();
    batch.delete(this.db.collection("tracks").doc(id));
    batch.delete(this.db.collection("lyrics").doc(id));
    batch.delete(this.db.collection("cooc").doc(id));
    batch.set(this.shard(shardOf(id)), { t: { [id]: FieldValue.delete() } }, { merge: true });
    batch.set(this.db.collection("stats").doc(`s${shardOf(id)}`), { t: { [id]: FieldValue.delete() } }, { merge: true });
    batch.set(this.meta(), { version: FieldValue.increment(1) }, { merge: true });
    await batch.commit();
    this.invalidateCatalog();
  }

  async getLyrics(id: string) {
    const s = await this.db.collection("lyrics").doc(id).get();
    return s.exists ? (s.data() as Lyrics) : null;
  }

  async saveLyrics(id: string, lyrics: Lyrics | null) {
    const ref = this.db.collection("lyrics").doc(id);
    if (lyrics) await ref.set(lyrics);
    else await ref.delete();
  }

  async saveArtist(artist: ArtistInfo) {
    const batch = this.db.batch();
    batch.set(
      this.shard(shardOf(artist.id)),
      { a: { [artist.id]: JSON.stringify(artist) } },
      { mergeFields: [new FieldPath("a", artist.id)] },
    );
    batch.set(this.meta(), { version: FieldValue.increment(1) }, { merge: true });
    await batch.commit();
    this.invalidateCatalog();
  }

  async deleteArtist(id: string) {
    const batch = this.db.batch();
    batch.set(this.shard(shardOf(id)), { a: { [id]: FieldValue.delete() } }, { merge: true });
    batch.set(this.meta(), { version: FieldValue.increment(1) }, { merge: true });
    await batch.commit();
    this.invalidateCatalog();
  }

  async importBatch(input: ImportBatch) {
    const tracks = input.tracks ?? [];
    const artists = input.artists ?? [];
    const playlists = input.playlists ?? [];
    // Up to 150 songs per commit: songs + lyrics + 16 shards + lists + meta + storage stays under
    // Firestore's 500 writes per batch. Each shard is written once per commit, however many songs it gets.
    const CHUNK = 150;
    const chunks = Math.max(1, Math.ceil(tracks.length / CHUNK));
    for (let c = 0; c < chunks; c++) {
      const part = tracks.slice(c * CHUNK, (c + 1) * CHUNK);
      const last = c === chunks - 1;
      const batch = this.db.batch();
      const shardData = new Map<number, { t: Record<string, string>; a: Record<string, string>; fields: FieldPath[] }>();
      const shardEntry = (id: string) => {
        const n = shardOf(id);
        let e = shardData.get(n);
        if (!e) shardData.set(n, (e = { t: {}, a: {}, fields: [] }));
        return e;
      };
      for (const t of part) {
        batch.set(this.db.collection("tracks").doc(t.id), t);
        const lyr = input.lyrics?.[t.id];
        if (lyr) batch.set(this.db.collection("lyrics").doc(t.id), lyr);
        const e = shardEntry(t.id);
        e.t[t.id] = JSON.stringify(toCatalogTrack(t));
        e.fields.push(new FieldPath("t", t.id));
      }
      if (last) {
        for (const a of artists) {
          const e = shardEntry(a.id);
          e.a[a.id] = JSON.stringify(a);
          e.fields.push(new FieldPath("a", a.id));
        }
        if (playlists.length) {
          const p: Record<string, string> = {};
          const fields: FieldPath[] = [];
          for (const pl of playlists) {
            batch.set(this.db.collection("playlists").doc(pl.id), pl);
            if (!pl.shared) continue;
            p[pl.id] = JSON.stringify(pl);
            fields.push(new FieldPath("p", pl.id));
          }
          if (fields.length) batch.set(this.lists(), { p }, { mergeFields: fields });
        }
        const storage = Object.entries(input.storage ?? {}).filter(([, u]) => u.bytes || u.objects);
        if (storage.length) {
          batch.set(
            this.db.collection("system").doc("storage"),
            Object.fromEntries(storage.map(([id, u]) => [id, { bytes: FieldValue.increment(u.bytes), objects: FieldValue.increment(u.objects) }])),
            { merge: true },
          );
        }
      }
      for (const [n, e] of shardData) batch.set(this.shard(n), { t: e.t, a: e.a }, { mergeFields: e.fields });
      batch.set(this.meta(), { version: FieldValue.increment(1) }, { merge: true });
      await batch.commit();
    }
    this.invalidateCatalog();
  }

  // ---------------------------------------------------------------- users
  async getUser(uid: string) {
    const s = await this.db.collection("users").doc(uid).get();
    return s.exists ? (s.data() as UserProfile) : null;
  }
  async saveUser(p: UserProfile) {
    await this.db.collection("users").doc(p.uid).set(p, { merge: true });
  }
  async listUsers(limit: number) {
    const q = await this.db.collection("users").orderBy("lastSeenAt", "desc").limit(limit).get();
    return q.docs.map((d) => d.data() as UserProfile);
  }
  async countUsers(since?: number) {
    // Aggregation: billed as one read per 1,000 users instead of one per user.
    const users = this.db.collection("users");
    const q = since == null ? users : users.where("createdAt", ">=", since);
    return (await q.count().get()).data().count;
  }

  // ---------------------------------------------------------------- library
  async getLibrary(uid: string): Promise<UserLibrary> {
    const s = await this.db.collection("libraries").doc(uid).get();
    return { ...emptyLibrary(), ...((s.data() as Partial<UserLibrary>) ?? {}) };
  }
  async setLibraryItem(uid: string, kind: LibraryKind, id: string, on: boolean) {
    const ref = this.db.collection("libraries").doc(uid);
    await this.db.runTransaction(async (tx) => {
      const library = (await tx.get(ref)).data() as UserLibrary | undefined;
      if (Boolean(library?.[kind]?.[id]) === on) return;
      tx.set(ref, { [kind]: { [id]: on ? Date.now() : FieldValue.delete() } }, { merge: true });
      if (kind === "likes") tx.set(this.db.collection("stats").doc(`s${shardOf(id)}`),
        { t: { [id]: { likes: FieldValue.increment(on ? 1 : -1) } } }, { merge: true });
    });
    if (kind === "likes" && this.cache.stats) this.cache.stats.at = 0;
  }
  async listPlaylists(uid: string) {
    const q = await this.db.collection("playlists").where("ownerUid", "==", uid).get();
    return q.docs.map((d) => d.data() as Playlist).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async getPlaylist(id: string) {
    const s = await this.db.collection("playlists").doc(id).get();
    return s.exists ? (s.data() as Playlist) : null;
  }
  async savePlaylist(p: Playlist) {
    if (!p.shared) {
      await this.db.collection("playlists").doc(p.id).set(p);
      return;
    }
    // Shared playlists are also mirrored into the catalog, so every listener gets them with it.
    const batch = this.db.batch();
    batch.set(this.db.collection("playlists").doc(p.id), p);
    batch.set(this.lists(), { p: { [p.id]: JSON.stringify(p) } }, { mergeFields: [new FieldPath("p", p.id)] });
    batch.set(this.meta(), { version: FieldValue.increment(1) }, { merge: true });
    await batch.commit();
    this.invalidateCatalog();
  }
  async updatePlaylist(id: string, change: (playlist: Playlist | null) => Playlist) {
    const ref = this.db.collection("playlists").doc(id);
    const next = await this.db.runTransaction(async (tx) => {
      const current = ((await tx.get(ref)).data() as Playlist | undefined) ?? null;
      const next = change(current);
      tx.set(ref, next);
      if (next.shared) {
        tx.set(this.lists(), { p: { [id]: JSON.stringify(next) } }, { mergeFields: [new FieldPath("p", id)] });
        tx.set(this.meta(), { version: FieldValue.increment(1) }, { merge: true });
      }
      return next;
    });
    if (next.shared) this.invalidateCatalog();
    return next;
  }
  async deletePlaylist(id: string, shared?: boolean) {
    const ref = this.db.collection("playlists").doc(id);
    const cur = await ref.get();
    if (!shared && !cur.get("shared")) {
      await ref.delete();
      return;
    }
    const batch = this.db.batch();
    batch.delete(ref);
    batch.set(this.lists(), { p: { [id]: FieldValue.delete() } }, { merge: true });
    batch.set(this.meta(), { version: FieldValue.increment(1) }, { merge: true });
    await batch.commit();
    this.invalidateCatalog();
  }

  private jam(id: string) {
    return this.db.collection("jams").doc(id);
  }

  async getJam(id: string) {
    return ((await this.jam(id).get()).data() as JamDocument | undefined) ?? null;
  }

  async createJam(jam: JamDocument) {
    await this.jam(jam.id).create(jam);
  }

  async updateJam(id: string, change: (jam: JamDocument | null) => JamDocument) {
    const ref = this.jam(id);
    return this.db.runTransaction(async (tx) => {
      const previous = ((await tx.get(ref)).data() as JamDocument | undefined) ?? null;
      const next = change(previous);
      if (next !== previous) {
        if (next.closed) tx.delete(ref);
        else tx.set(ref, next);
      }
      return next;
    });
  }

  watchJam(id: string, emit: (jam: JamDocument | null) => void, fail: (error: Error) => void) {
    return this.jam(id).onSnapshot((snap) => emit((snap.data() as JamDocument | undefined) ?? null), fail);
  }

  // ---------------------------------------------------------------- analytics
  async recordPlay(event: PlayEvent, u: PlayUpdate) {
    const inc = FieldValue.increment;
    const batch = this.db.batch();
    batch.set(this.db.collection("plays").doc(event.id), event);

    const taste: Record<string, unknown> = {
      artists: Object.fromEntries(Object.entries(u.artists).map(([k, v]) => [k, inc(v)])),
      genres: Object.fromEntries(Object.entries(u.genres).map(([k, v]) => [k, inc(v)])),
      totalMs: inc(u.ms),
      updatedAt: event.at,
    };
    if (u.weight !== 0) taste.tracks = { [event.trackId]: inc(u.weight * u.tasteBoost) };
    if (u.isStream) {
      taste.last = { [event.trackId]: event.at };
      taste.plays = { [event.trackId]: inc(1) };
      taste.hours = { [u.hour]: inc(1) };
      taste.totalPlays = inc(1);
    }
    if (u.isSkip) taste.skips = { [event.trackId]: inc(1) };
    batch.set(this.db.collection("taste").doc(event.uid), taste, { merge: true });

    batch.set(
      this.db.collection("stats").doc(`s${shardOf(event.trackId)}`),
      {
        t: {
          [event.trackId]: {
            plays: inc(u.isStream ? 1 : 0),
            completes: inc(u.isComplete ? 1 : 0),
            skips: inc(u.isSkip ? 1 : 0),
            ms: inc(u.ms),
            trend: inc(u.trendBoost),
          },
        },
      },
      { merge: true },
    );

    if (u.cooc) {
      batch.set(this.db.collection("cooc").doc(u.cooc.a), { n: { [u.cooc.b]: inc(u.cooc.w) } }, { merge: true });
      batch.set(this.db.collection("cooc").doc(u.cooc.b), { n: { [u.cooc.a]: inc(u.cooc.w) } }, { merge: true });
      this.cache.cooc?.delete(u.cooc.a);
      this.cache.cooc?.delete(u.cooc.b);
    }

    const daily: Record<string, unknown> = {
      day: u.day,
      events: inc(1),
      ms: inc(u.ms),
      users: { [event.uid]: inc(1) },
      sources: {
        [event.source.type]: {
          plays: inc(u.isStream ? 1 : 0),
          completes: inc(u.isComplete ? 1 : 0),
          skips: inc(u.isSkip ? 1 : 0),
        },
      },
    };
    if (u.isStream) {
      daily.plays = inc(1);
      daily.tracks = { [event.trackId]: inc(1) };
      daily.hours = { [u.hour]: inc(1) };
    }
    if (u.isComplete) daily.completes = inc(1);
    if (u.isSkip) daily.skips = inc(1);
    batch.set(this.db.collection("daily").doc(u.day), daily, { merge: true });

    await batch.commit();
    if (this.cache.stats) this.cache.stats.at = 0;
    this.cache.daily?.delete(u.day);
  }

  async getTaste(uid: string): Promise<UserTaste> {
    const s = await this.db.collection("taste").doc(uid).get();
    return { ...emptyTaste(), ...((s.data() as Partial<UserTaste>) ?? {}) };
  }

  async addTaste(uid: string, artists: Record<string, number>, genres: Record<string, number>) {
    const inc = FieldValue.increment;
    await this.db
      .collection("taste")
      .doc(uid)
      .set(
        {
          artists: Object.fromEntries(Object.entries(artists).map(([k, v]) => [k, inc(v)])),
          genres: Object.fromEntries(Object.entries(genres).map(([k, v]) => [k, inc(v)])),
        },
        { merge: true },
      );
  }

  async getTrackStats() {
    const now = Date.now();
    if (this.cache.stats && now - this.cache.stats.at < STATS_TTL_MS) return this.cache.stats.data;
    const refs = Array.from({ length: SHARDS }, (_, i) => this.db.collection("stats").doc(`s${i}`));
    const docs = await this.db.getAll(...refs);
    const data: Record<string, TrackStats> = {};
    for (const d of docs) {
      const t = (d.get("t") ?? {}) as Record<string, Partial<TrackStats>>;
      for (const [id, v] of Object.entries(t)) data[id] = { ...emptyStats(), ...v };
    }
    this.cache.stats = { at: now, data };
    return data;
  }

  async getCooccurrence(ids: string[]) {
    const out: Record<string, Record<string, number>> = {};
    const unique = [...new Set(ids)].slice(0, 30);
    const now = Date.now();
    const rows = (this.cache.cooc ??= new Map());
    const missing = unique.filter((id) => {
      const hit = rows.get(id);
      if (hit && now - hit.at < COOC_TTL_MS) {
        if (hit.row) out[id] = hit.row;
        return false;
      }
      return true;
    });
    if (missing.length) {
      const docs = await this.db.getAll(...missing.map((id) => this.db.collection("cooc").doc(id)));
      for (const d of docs) {
        const row = d.exists ? ((d.get("n") ?? {}) as Record<string, number>) : null;
        rows.set(d.id, { at: now, row });
        if (row) out[d.id] = row;
      }
      if (rows.size > 5000) rows.clear();
    }
    return out;
  }

  async getDaily(days: string[]): Promise<DailyStats[]> {
    if (!days.length) return [];
    const now = Date.now();
    const yesterday = dayKey(now - 86_400_000);
    const cache = (this.cache.daily ??= new Map());
    const fresh = (day: string) => {
      const hit = cache.get(day);
      return hit && now - hit.at < (day >= yesterday ? DAILY_RECENT_TTL_MS : DAILY_PAST_TTL_MS) ? hit.data : null;
    };
    const missing = [...new Set(days)].filter((d) => !fresh(d));
    if (missing.length) {
      const docs = await this.db.getAll(...missing.map((d) => this.db.collection("daily").doc(d)));
      docs.forEach((d, i) => cache.set(missing[i], { at: now, data: { ...emptyDaily(missing[i]), ...((d.data() as Partial<DailyStats>) ?? {}) } }));
    }
    const out = days.map((d) => structuredClone(cache.get(d)?.data ?? emptyDaily(d)));
    if (cache.size > 200) for (const k of [...cache.keys()].sort().slice(0, cache.size - 200)) cache.delete(k);
    return out;
  }

  async recentPlays(limit: number, uid?: string) {
    const plays = this.db.collection("plays");
    const rows = (q: QuerySnapshot) => q.docs.map((d) => d.data() as PlayEvent);
    if (!uid) return rows(await plays.orderBy("at", "desc").limit(limit).get());
    try {
      // Uses the (uid, at desc) composite index from firestore.indexes.json.
      return rows(await plays.where("uid", "==", uid).orderBy("at", "desc").limit(limit).get());
    } catch (err) {
      // FAILED_PRECONDITION: the index hasn't been deployed (or is still building).
      if ((err as { code?: number }).code !== 9) throw err;
      if (!this.cache.warnedIndex) {
        this.cache.warnedIndex = true;
        console.warn(`[pepper] Missing Firestore index; run "firebase deploy --only firestore". ${(err as Error).message}`);
      }
      // Until then: scan the newest plays overall (can miss older plays of quieter listeners).
      const recent = rows(await plays.orderBy("at", "desc").limit(Math.min(500, limit * 10)).get());
      return recent.filter((r) => r.uid === uid).slice(0, limit);
    }
  }

  // ---------------------------------------------------------------- storage
  async getStorageUsage() {
    const s = await this.db.collection("system").doc("storage").get();
    const d = (s.data() ?? {}) as Record<ProviderId, Partial<StorageUsage>>;
    const out: Record<ProviderId, StorageUsage> = {};
    for (const [id, u] of Object.entries(d)) {
      if (u && typeof u === "object") out[id] = { bytes: Number(u.bytes ?? 0), objects: Number(u.objects ?? 0) };
    }
    return out;
  }
  async addStorageUsage(provider: ProviderId, bytes: number, objects: number) {
    await this.db
      .collection("system")
      .doc("storage")
      .set({ [provider]: { bytes: FieldValue.increment(bytes), objects: FieldValue.increment(objects) } }, { merge: true });
  }
  async setStorageUsage(provider: ProviderId, usage: StorageUsage) {
    await this.db.collection("system").doc("storage").set({ [provider]: usage }, { merge: true });
  }
}
