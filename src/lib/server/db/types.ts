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

export type LibraryKind = keyof UserLibrary;

/** Many songs at once (bulk import): saved in a few batched writes instead of several per song. */
export interface ImportBatch {
  tracks?: Track[];
  lyrics?: Record<string, Lyrics>;
  artists?: ArtistInfo[];
  playlists?: Playlist[];
  /** Storage used by the objects this batch created, per bucket. */
  storage?: Record<ProviderId, StorageUsage>;
}

export interface Repo {
  kind: "firestore" | "local";

  // Catalog
  getCatalog(): Promise<CatalogSnapshot>;
  getTrack(id: string): Promise<Track | null>;
  saveTrack(track: Track): Promise<void>;
  deleteTrack(id: string): Promise<void>;
  getLyrics(trackId: string): Promise<Lyrics | null>;
  saveLyrics(trackId: string, lyrics: Lyrics | null): Promise<void>;
  saveArtist(artist: ArtistInfo): Promise<void>;
  deleteArtist(id: string): Promise<void>;
  /** Save songs, lyrics, artists, playlists and storage use together (see ImportBatch). */
  importBatch(batch: ImportBatch): Promise<void>;

  // Users
  getUser(uid: string): Promise<UserProfile | null>;
  saveUser(profile: UserProfile): Promise<void>;
  listUsers(limit: number): Promise<UserProfile[]>;
  /** Number of users, optionally only those who joined at or after `since`. */
  countUsers(since?: number): Promise<number>;

  // Library & playlists
  getLibrary(uid: string): Promise<UserLibrary>;
  setLibraryItem(uid: string, kind: LibraryKind, id: string, on: boolean): Promise<void>;
  listPlaylists(uid: string): Promise<Playlist[]>;
  getPlaylist(id: string): Promise<Playlist | null>;
  savePlaylist(p: Playlist): Promise<void>;
  deletePlaylist(id: string, shared?: boolean): Promise<void>;

  // Live listening rooms
  getJam(id: string): Promise<JamDocument | null>;
  createJam(jam: JamDocument): Promise<void>;
  updateJam(id: string, change: (jam: JamDocument | null) => JamDocument): Promise<JamDocument>;
  watchJam(id: string, emit: (jam: JamDocument | null) => void, fail: (error: Error) => void): () => void;

  // Analytics
  recordPlay(event: PlayEvent, update: PlayUpdate): Promise<void>;
  getTaste(uid: string): Promise<UserTaste>;
  addTaste(uid: string, artists: Record<string, number>, genres: Record<string, number>): Promise<void>;
  getTrackStats(): Promise<Record<string, TrackStats>>;
  bumpLikes(trackId: string, delta: number): Promise<void>;
  getCooccurrence(trackIds: string[]): Promise<Record<string, Record<string, number>>>;
  getDaily(days: string[]): Promise<DailyStats[]>;
  recentPlays(limit: number, uid?: string): Promise<PlayEvent[]>;

  // Storage accounting
  getStorageUsage(): Promise<Record<ProviderId, StorageUsage>>;
  addStorageUsage(provider: ProviderId, bytes: number, objects: number): Promise<void>;
  setStorageUsage(provider: ProviderId, usage: StorageUsage): Promise<void>;
}

export function emptyTaste(): UserTaste {
  return { artists: {}, genres: {}, tracks: {}, last: {}, plays: {}, skips: {}, hours: {}, totalMs: 0, totalPlays: 0, updatedAt: 0 };
}

export function emptyLibrary(): UserLibrary {
  return { likes: {}, artists: {}, albums: {}, playlists: {} };
}

export function emptyStats(): TrackStats {
  return { plays: 0, completes: 0, skips: 0, ms: 0, likes: 0, trend: 0 };
}

export function emptyDaily(day: string): DailyStats {
  return { day, plays: 0, ms: 0, skips: 0, completes: 0, events: 0, users: {}, tracks: {}, hours: {}, sources: {} };
}

export function toCatalogTrack(t: Track): CatalogTrack {
  return {
    id: t.id,
    title: t.title,
    subtitle: t.subtitle,
    artists: t.artists,
    albumArtist: t.albumArtist,
    album: t.album,
    film: t.film,
    genres: t.genres,
    year: t.year,
    releaseDate: t.releaseDate,
    trackNo: t.trackNo,
    discNo: t.discNo,
    durationMs: t.durationMs,
    explicit: t.explicit,
    hasLyrics: t.hasLyrics,
    cover: t.cover,
    features: t.features,
    createdAt: t.createdAt,
    language: t.language,
    enrichedAt: t.enrichedAt,
  };
}
