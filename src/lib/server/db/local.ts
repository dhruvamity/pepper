/**
 * Zero-setup database for local mode: everything lives in memory and is flushed to
 * `<dataDir>/db.json` (atomic rename, debounced). Same semantics as the Firestore repo.
 * When another process (the import command) rewrites the file, it is reloaded before use.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { JamDocument } from "@/lib/jam";
import type { PlayUpdate } from "@/lib/analytics/score";
import type {
  ArtistInfo,
  CatalogSnapshot,
  Connection,
  DailyStats,
  JamRequest,
  ListeningActivity,
  Lyrics,
  PlayEvent,
  Playlist,
  ProviderId,
  StorageUsage,
  Track,
  TrackStats,
  UploadIntent,
  UserLibrary,
  UserProfile,
  UserTaste,
} from "@/lib/types";
import { config } from "../env";
import { emptyDaily, emptyLibrary, emptyStats, emptyTaste, toCatalogTrack, type ImportBatch, type LibraryKind, type Repo } from "./types";

interface State {
  version: number;
  catalogVersion: number;
  tracks: Record<string, Track>;
  lyrics: Record<string, Lyrics>;
  artists: Record<string, ArtistInfo>;
  users: Record<string, UserProfile>;
  libraries: Record<string, UserLibrary>;
  playlists: Record<string, Playlist>;
  plays: PlayEvent[];
  taste: Record<string, UserTaste>;
  stats: Record<string, TrackStats>;
  cooc: Record<string, Record<string, number>>;
  daily: Record<string, DailyStats>;
  storage: Partial<Record<ProviderId, StorageUsage>>;
  connections: Record<string, Connection>;
  activities: Record<string, ListeningActivity>;
  jamRequests: Record<string, JamRequest>;
  uploadIntents: Record<string, UploadIntent>;
}

const MAX_PLAYS = 100_000;

function freshState(): State {
  return {
    version: 1,
    catalogVersion: Date.now(),
    tracks: {},
    lyrics: {},
    artists: {},
    users: {},
    libraries: {},
    playlists: {},
    plays: [],
    taste: {},
    stats: {},
    cooc: {},
    daily: {},
    storage: {},
    connections: {},
    activities: {},
    jamRequests: {},
    uploadIntents: {},
  };
}

function inc(map: Record<string, number>, key: string, by: number) {
  map[key] = (map[key] ?? 0) + by;
}

export class LocalRepo implements Repo {
  readonly kind = "local" as const;
  private state: State;
  private file: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mtime = 0;
  private jams = new Map<string, JamDocument>();
  private jamListeners = new Map<string, Set<(jam: JamDocument | null) => void>>();
  private activityListeners = new Set<(uid: string) => void>();

  constructor(dir = config.dataDir) {
    this.file = path.join(dir, "db.json");
    mkdirSync(dir, { recursive: true });
    this.state = existsSync(this.file) ? this.read() : freshState();
  }

  private read(): State {
    this.mtime = statSync(this.file).mtimeMs;
    return { ...freshState(), ...JSON.parse(readFileSync(this.file, "utf8")) };
  }

  /** Pick up changes another process (e.g. the import command) saved since we last read or wrote. */
  private fresh() {
    if (this.timer) return; // our own unsaved changes win; they are written within 250 ms
    try {
      if (statSync(this.file).mtimeMs !== this.mtime) this.state = this.read();
    } catch {
      // no file yet
    }
  }

  private persist(immediate = false) {
    const write = () => {
      this.timer = null;
      try {
        mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.state));
        renameSync(tmp, this.file);
        this.mtime = statSync(this.file).mtimeMs;
      } catch (err) {
        console.error("[pepper] could not save local database", err);
      }
    };
    if (immediate) {
      if (this.timer) clearTimeout(this.timer);
      write();
      return;
    }
    if (!this.timer) this.timer = setTimeout(write, 250);
  }

  private bump() {
    this.state.catalogVersion = Math.max(Date.now(), this.state.catalogVersion + 1);
  }

  private shared(p: Playlist) {
    const email = this.state.users[p.ownerUid]?.email?.toLowerCase();
    return p.shared || (config.allowDemoLogin && p.ownerUid.startsWith("demo-admin-")) || Boolean(email && config.adminEmails.includes(email));
  }

  // ---------------------------------------------------------------- catalog
  async getCatalog(): Promise<CatalogSnapshot> {
    this.fresh();
    return {
      version: this.state.catalogVersion,
      tracks: Object.values(this.state.tracks).map(toCatalogTrack),
      artists: { ...this.state.artists },
      playlists: Object.values(this.state.playlists)
        .filter((p) => this.shared(p))
        .map((p) => ({ ...p, shared: true }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    };
  }
  async getTrack(id: string) {
    this.fresh();
    return this.state.tracks[id] ?? null;
  }
  async saveTrack(track: Track) {
    this.fresh();
    this.state.tracks[track.id] = structuredClone(track);
    this.bump();
    this.persist(true);
  }
  async deleteTrack(id: string) {
    delete this.state.tracks[id];
    delete this.state.lyrics[id];
    delete this.state.stats[id];
    delete this.state.cooc[id];
    for (const n of Object.values(this.state.cooc)) delete n[id];
    this.bump();
    this.persist(true);
  }
  async getLyrics(id: string) {
    return this.state.lyrics[id] ?? null;
  }
  async saveLyrics(id: string, lyrics: Lyrics | null) {
    if (lyrics) this.state.lyrics[id] = lyrics;
    else delete this.state.lyrics[id];
    this.persist();
  }
  async saveArtist(artist: ArtistInfo) {
    this.state.artists[artist.id] = { ...this.state.artists[artist.id], ...artist };
    this.bump();
    this.persist();
  }
  async deleteArtist(id: string) {
    delete this.state.artists[id];
    this.bump();
    this.persist();
  }
  async importBatch(b: ImportBatch) {
    this.fresh();
    for (const t of b.tracks ?? []) this.state.tracks[t.id] = structuredClone(t);
    for (const [id, l] of Object.entries(b.lyrics ?? {})) this.state.lyrics[id] = structuredClone(l);
    for (const a of b.artists ?? []) this.state.artists[a.id] = { ...this.state.artists[a.id], ...structuredClone(a) };
    for (const p of b.playlists ?? []) this.state.playlists[p.id] = structuredClone(p);
    for (const [id, u] of Object.entries(b.storage ?? {})) {
      const cur = (this.state.storage[id] ??= { bytes: 0, objects: 0 });
      cur.bytes = Math.max(0, cur.bytes + u.bytes);
      cur.objects = Math.max(0, cur.objects + u.objects);
    }
    this.bump();
    this.persist(true);
  }

  // ---------------------------------------------------------------- users
  async getUser(uid: string) {
    return this.state.users[uid] ?? null;
  }
  async getUserByInviteCode(code: string) {
    return Object.values(this.state.users).find((u) => u.inviteCode === code) ?? null;
  }
  async saveUser(p: UserProfile) {
    this.state.users[p.uid] = { ...this.state.users[p.uid], ...p };
    this.persist();
  }
  async listUsers(limit: number) {
    return Object.values(this.state.users)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, limit);
  }
  async countUsers(since?: number) {
    return Object.values(this.state.users).filter((u) => since == null || u.createdAt >= since).length;
  }

  // ---------------------------------------------------------------- library
  async getLibrary(uid: string) {
    this.fresh();
    return { ...emptyLibrary(), ...structuredClone(this.state.libraries[uid] ?? {}) };
  }
  async setLibraryItem(uid: string, kind: LibraryKind, id: string, on: boolean) {
    this.fresh();
    const lib = (this.state.libraries[uid] = { ...emptyLibrary(), ...this.state.libraries[uid] });
    if (Boolean(lib[kind][id]) === on) return;
    if (kind === "likes") {
      const stats = (this.state.stats[id] ??= emptyStats());
      stats.likes = Math.max(0, stats.likes + (on ? 1 : -1));
    }
    if (on) lib[kind][id] = Date.now();
    else delete lib[kind][id];
    this.persist();
  }
  async listPlaylists(uid: string) {
    this.fresh();
    return Object.values(this.state.playlists)
      .filter((p) => p.ownerUid === uid || p.collaborators?.some((c) => c.uid === uid))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async getPlaylist(id: string) {
    this.fresh();
    return this.state.playlists[id] ?? null;
  }
  async savePlaylist(p: Playlist) {
    const wasShared = this.state.playlists[p.id]?.shared;
    this.state.playlists[p.id] = structuredClone(p);
    if (p.shared || wasShared) this.bump();
    this.persist(Boolean(p.shared || wasShared));
  }
  async updatePlaylist(id: string, change: (playlist: Playlist | null) => Playlist) {
    this.fresh();
    const next = change(structuredClone(this.state.playlists[id] ?? null));
    await this.savePlaylist(next);
    return next;
  }
  async deletePlaylist(id: string, shared?: boolean) {
    const wasShared = shared || this.state.playlists[id]?.shared;
    delete this.state.playlists[id];
    if (wasShared) this.bump();
    this.persist(Boolean(wasShared));
  }

  async listConnections(uid: string) {
    this.fresh();
    return Object.values(this.state.connections).filter((c) => c.requesterUid === uid || c.otherUid === uid);
  }
  async getConnection(id: string) {
    this.fresh();
    return this.state.connections[id] ?? null;
  }
  async updateConnection(id: string, change: (connection: Connection | null) => Connection | null) {
    this.fresh();
    const next = change(structuredClone(this.state.connections[id] ?? null));
    if (next) this.state.connections[id] = next;
    else delete this.state.connections[id];
    this.persist(true);
    return next;
  }
  watchActivities(uids: string[], emit: (activities: ListeningActivity[]) => void) {
    const wanted = new Set(uids);
    const snapshot = () => emit([...wanted].map((uid) => this.state.activities[uid]).filter((a): a is ListeningActivity => Boolean(a)));
    const listener = (uid: string) => {
      if (wanted.has(uid)) snapshot();
    };
    this.activityListeners.add(listener);
    queueMicrotask(() => {
      if (this.activityListeners.has(listener)) snapshot();
    });
    return () => {
      this.activityListeners.delete(listener);
    };
  }
  async getActivity(uid: string) {
    this.fresh();
    return this.state.activities[uid] ?? null;
  }
  async getActivities(uids: string[]) {
    this.fresh();
    return [...new Set(uids)].map((uid) => this.state.activities[uid]).filter((a): a is ListeningActivity => Boolean(a));
  }
  async saveActivity(uid: string, activity: ListeningActivity | null) {
    this.fresh();
    if (activity) this.state.activities[uid] = structuredClone(activity);
    else delete this.state.activities[uid];
    for (const emit of this.activityListeners) emit(uid);
    this.persist();
  }
  async deleteExpiredActivities(now: number, limit: number) {
    this.fresh();
    const expired = Object.values(this.state.activities).filter((activity) => activity.expiresAt <= now).slice(0, limit);
    for (const activity of expired) delete this.state.activities[activity.uid];
    if (expired.length) this.persist(true);
    return expired.length;
  }
  async listJamRequests(uid: string) {
    this.fresh();
    return Object.values(this.state.jamRequests).filter((r) => r.fromUid === uid || r.toUid === uid).sort((a, b) => b.createdAt - a.createdAt);
  }
  async saveJamRequest(request: JamRequest) {
    this.fresh();
    this.state.jamRequests[request.id] = structuredClone(request);
    this.persist(true);
  }
  async resolveJamRequest(id: string, status: "accepted" | "declined", jam?: JamDocument) {
    this.fresh();
    const current = this.state.jamRequests[id];
    if (!current) throw new Error("Jam request not found");
    if (current.status !== "pending") return current;
    if (current.expiresAt <= Date.now()) {
      const expired = { ...current, status: "expired" as const };
      this.state.jamRequests[id] = expired;
      this.persist(true);
      return expired;
    }
    if (status === "accepted" && jam) {
      this.jams.set(jam.id, structuredClone(jam));
      const accepted = { ...current, status, jamId: jam.id, expiresAt: jam.expiresAt };
      this.state.jamRequests[id] = accepted;
      this.persist(true);
      return accepted;
    }
    const resolved = { ...current, status };
    this.state.jamRequests[id] = resolved;
    this.persist(true);
    return resolved;
  }
  async deleteExpiredJamRequests(now: number, limit: number) {
    this.fresh();
    const expired = Object.values(this.state.jamRequests).filter((request) => request.expiresAt <= now).slice(0, limit);
    for (const request of expired) delete this.state.jamRequests[request.id];
    if (expired.length) this.persist(true);
    return expired.length;
  }

  async getJam(id: string) {
    return this.jams.get(id) ?? null;
  }

  async createJam(jam: JamDocument) {
    for (const [id, room] of this.jams) {
      if (room.expiresAt <= Date.now() || room.closed) this.jams.delete(id);
    }
    this.jams.set(jam.id, jam);
  }

  async deleteExpiredJams(now: number, limit: number) {
    let deleted = 0;
    for (const [id, jam] of this.jams) {
      if (deleted >= limit) break;
      if (jam.expiresAt <= now || jam.closed) {
        this.jams.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async saveUploadIntent(intent: UploadIntent) {
    this.fresh();
    this.state.uploadIntents[intent.id] = structuredClone(intent);
    this.persist(true);
  }
  async getUploadIntent(id: string) {
    this.fresh();
    return this.state.uploadIntents[id] ?? null;
  }
  async listActiveUploadIntents(now: number, limit: number) {
    this.fresh();
    return Object.values(this.state.uploadIntents).filter((i) => i.expiresAt > now).slice(0, limit);
  }
  async listExpiredUploadIntents(now: number, limit: number) {
    this.fresh();
    return Object.values(this.state.uploadIntents).filter((i) => i.expiresAt <= now).sort((a, b) => a.expiresAt - b.expiresAt).slice(0, limit);
  }
  async deleteUploadIntent(id: string) {
    this.fresh();
    delete this.state.uploadIntents[id];
    this.persist(true);
  }

  async updateJam(id: string, change: (jam: JamDocument | null) => JamDocument) {
    const previous = this.jams.get(id) ?? null;
    const jam = change(previous);
    if (jam !== previous) {
      this.jams.set(id, jam);
      for (const emit of this.jamListeners.get(id) ?? []) emit(jam);
    }
    return jam;
  }

  watchJam(id: string, emit: (jam: JamDocument | null) => void) {
    const listeners = this.jamListeners.get(id) ?? new Set();
    this.jamListeners.set(id, listeners);
    listeners.add(emit);
    queueMicrotask(() => {
      if (listeners.has(emit)) emit(this.jams.get(id) ?? null);
    });
    return () => {
      listeners.delete(emit);
      if (!listeners.size) this.jamListeners.delete(id);
    };
  }

  // ---------------------------------------------------------------- analytics
  async recordPlay(event: PlayEvent, u: PlayUpdate) {
    const s = this.state;
    s.plays.push(event);
    if (s.plays.length > MAX_PLAYS) s.plays.splice(0, s.plays.length - MAX_PLAYS);

    const taste = (s.taste[event.uid] ??= emptyTaste());
    for (const [k, v] of Object.entries(u.artists)) inc(taste.artists, k, v);
    for (const [k, v] of Object.entries(u.genres)) inc(taste.genres, k, v);
    if (u.weight !== 0) inc(taste.tracks, event.trackId, u.weight * u.tasteBoost);
    if (u.isStream) {
      taste.last[event.trackId] = event.at;
      inc(taste.plays, event.trackId, 1);
      inc(taste.hours, u.hour, 1);
      taste.totalPlays += 1;
    }
    if (u.isSkip) inc(taste.skips, event.trackId, 1);
    taste.totalMs += u.ms;
    taste.updatedAt = event.at;

    const st = (s.stats[event.trackId] ??= emptyStats());
    st.plays += u.isStream ? 1 : 0;
    st.completes += u.isComplete ? 1 : 0;
    st.skips += u.isSkip ? 1 : 0;
    st.ms += u.ms;
    st.trend += u.trendBoost;

    if (u.cooc) {
      inc((s.cooc[u.cooc.a] ??= {}), u.cooc.b, u.cooc.w);
      inc((s.cooc[u.cooc.b] ??= {}), u.cooc.a, u.cooc.w);
    }

    const d = (s.daily[u.day] ??= emptyDaily(u.day));
    d.events += 1;
    d.ms += u.ms;
    if (u.isStream) {
      d.plays += 1;
      inc(d.tracks, event.trackId, 1);
      inc(d.hours, u.hour, 1);
    }
    if (u.isComplete) d.completes += 1;
    if (u.isSkip) d.skips += 1;
    inc(d.users, event.uid, 1);
    const src = (d.sources[event.source.type] ??= { plays: 0, completes: 0, skips: 0 });
    src.plays += u.isStream ? 1 : 0;
    src.completes += u.isComplete ? 1 : 0;
    src.skips += u.isSkip ? 1 : 0;
    this.persist();
  }
  async getTaste(uid: string) {
    return structuredClone(this.state.taste[uid] ?? emptyTaste());
  }
  async addTaste(uid: string, artists: Record<string, number>, genres: Record<string, number>) {
    const taste = (this.state.taste[uid] ??= emptyTaste());
    for (const [k, v] of Object.entries(artists)) inc(taste.artists, k, v);
    for (const [k, v] of Object.entries(genres)) inc(taste.genres, k, v);
    this.persist();
  }
  async getTrackStats() {
    return structuredClone(this.state.stats);
  }
  async getCooccurrence(ids: string[]) {
    const out: Record<string, Record<string, number>> = {};
    for (const id of ids) if (this.state.cooc[id]) out[id] = { ...this.state.cooc[id] };
    return out;
  }
  async getDaily(days: string[]) {
    return days.map((d) => structuredClone(this.state.daily[d] ?? emptyDaily(d)));
  }
  async recentPlays(limit: number, uid?: string) {
    const out: PlayEvent[] = [];
    for (let i = this.state.plays.length - 1; i >= 0 && out.length < limit; i--) {
      const p = this.state.plays[i];
      if (!uid || p.uid === uid) out.push(p);
    }
    return out;
  }

  /** All play events (used by the offline recommender evaluation). */
  allPlays(): PlayEvent[] {
    return this.state.plays;
  }

  // ---------------------------------------------------------------- storage
  async getStorageUsage() {
    this.fresh();
    const out: Record<ProviderId, StorageUsage> = {};
    for (const [id, u] of Object.entries(this.state.storage)) if (u) out[id] = { ...u };
    return out;
  }
  async addStorageUsage(provider: ProviderId, bytes: number, objects: number) {
    const cur = (this.state.storage[provider] ??= { bytes: 0, objects: 0 });
    cur.bytes = Math.max(0, cur.bytes + bytes);
    cur.objects = Math.max(0, cur.objects + objects);
    this.persist();
  }
  async setStorageUsage(provider: ProviderId, usage: StorageUsage) {
    this.state.storage[provider] = usage;
    this.persist();
  }
}
