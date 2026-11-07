/**
 * Shared domain types used by the server, the browser and the tests.
 * Keep this file free of runtime imports so it can be used anywhere.
 */

/**
 * Which bucket a file lives in: "r2" (Cloudflare R2), "b2" (the first Backblaze account), or
 * "b2_2", "b2_3", … (more Backblaze accounts, from B2_2_*, B2_3_* settings).
 * Stored with every file, so an account's number must never change once it holds files.
 */
export type ProviderId = string;

/** A file stored in one of the object-storage providers. */
export interface StoredObject {
  provider: ProviderId;
  key: string;
  size: number;
  contentType: string;
}

/** Compact reference to a stored image: "<provider>:<key>". */
export type MediaRef = string;

export interface ImageSet {
  sm: MediaRef; // ~300px, lists & cards
  lg: MediaRef; // ~640-1024px, headers & now playing
  color: string; // dominant colour (hex), used for gradients
}

export interface ArtistRef {
  id: string;
  name: string;
}

export interface AudioFeatures {
  /** Estimated tempo in BPM (null when the detector is not confident). */
  bpm: number | null;
  /** 0..1 perceived energy (RMS based). */
  energy: number;
  /** Integrated loudness estimate in dBFS (negative number). */
  loudness: number;
  /** 0..1 spectral brightness (normalised spectral centroid). */
  brightness: number;
  /** 0..1 dynamic range (crest factor based). */
  dynamics: number;
  /** 0..1 rhythmic density (onsets per second, normalised). */
  rhythm: number;
  /** 0..1 how steady and strong the pulse is. */
  danceability: number;
}

export interface SyncedLine {
  t: number; // milliseconds
  text: string;
}

export interface Lyrics {
  plain?: string;
  synced?: SyncedLine[];
  source: "tag" | "lrc" | "lrclib" | "manual";
}

export interface AudioInfo extends StoredObject {
  sha256: string;
  /** Hash of the original file when the import re-encoded it (the track id comes from this one). */
  sourceSha256?: string;
  originalName: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  container?: string;
  lossless?: boolean;
}

/** Full track document (source of truth). */
export interface Track {
  id: string;
  title: string; // clean display title, e.g. "Channa Ve"
  subtitle?: string; // e.g. From "Bhoot - Part One: The Haunted Ship"
  rawTitle: string; // title exactly as found in the file tags
  artists: ArtistRef[];
  albumArtist?: ArtistRef;
  album: { id: string; title: string };
  film?: string; // movie / show the song is from (common for Indian music)
  genres: string[];
  year?: number;
  releaseDate?: string; // YYYY-MM-DD when known
  trackNo?: number;
  trackTotal?: number;
  discNo?: number;
  discTotal?: number;
  durationMs: number;
  composers?: string[];
  lyricists?: string[];
  producers?: string[];
  label?: string;
  copyright?: string;
  isrc?: string;
  language?: string;
  explicit?: boolean;
  comment?: string;
  sourceUrl?: string;
  hasLyrics: boolean;
  audio: AudioInfo;
  cover?: ImageSet;
  features?: AudioFeatures;
  createdAt: number;
  updatedAt: number;
  uploadedBy: string;
  /** When genre/language lookups last ran for this song (unset: not yet). */
  enrichedAt?: number;
}

/** Compact track used by catalog listings, search and the recommender. */
export interface CatalogTrack {
  id: string;
  title: string;
  subtitle?: string;
  artists: ArtistRef[];
  albumArtist?: ArtistRef;
  album: { id: string; title: string };
  film?: string;
  genres: string[];
  year?: number;
  releaseDate?: string;
  trackNo?: number;
  discNo?: number;
  durationMs: number;
  explicit?: boolean;
  hasLyrics: boolean;
  cover?: ImageSet;
  features?: AudioFeatures;
  createdAt: number;
  /** ISO 639-1 style code: "hi", "pa", "en", "ta", … */
  language?: string;
  enrichedAt?: number;
}

export interface ArtistInfo {
  id: string;
  name: string;
  image?: ImageSet;
  bio?: string;
  createdAt: number;
  /** Ids of similar artists (from Deezer's "related artists"); [] once looked up with no match. */
  related?: string[];
}

export interface CatalogSnapshot {
  version: number;
  tracks: CatalogTrack[];
  artists: Record<string, ArtistInfo>;
  /** Shared playlists: every listener sees them, and autoplay learns from them which songs go together. */
  playlists?: Playlist[];
}

export interface UserProfile {
  uid: string;
  name: string;
  email?: string;
  photoURL?: string;
  createdAt: number;
  lastSeenAt: number;
  onboarded: boolean;
}

export interface UserLibrary {
  likes: Record<string, number>; // trackId -> likedAt
  artists: Record<string, number>; // artistId -> followedAt
  albums: Record<string, number>; // albumId -> savedAt
  playlists: Record<string, number>; // shared playlistId -> savedAt
}

export interface Playlist {
  id: string;
  ownerUid: string;
  ownerName: string;
  name: string;
  description?: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  /** Shown to every listener (Home, Search) and changed only by admins. */
  shared?: boolean;
  /** Where a shared playlist came from, e.g. "import:soft-romantic-hindi-songs-2026", so a re-import updates it. */
  source?: string;
}

export type PlaySourceType =
  | "album"
  | "artist"
  | "playlist"
  | "liked"
  | "search"
  | "home"
  | "mix"
  | "radio"
  | "autoplay"
  | "queue"
  | "genre"
  | "track"
  | "other";

export type PlayEndReason = "ended" | "skip" | "prev" | "switch" | "pause" | "unload";

/** What the client reports after a track stops playing. */
export interface PlayReport {
  trackId: string;
  startedAt: number;
  listenedMs: number;
  durationMs: number;
  endReason: PlayEndReason;
  source: { type: PlaySourceType; id?: string };
  prevTrackId?: string;
  sessionId: string;
  shuffle?: boolean;
  device?: "mobile" | "desktop";
  /** Client timezone offset in minutes (Date#getTimezoneOffset), for the listening clock. */
  tz?: number;
}

/** Stored play event with derived outcome. */
export interface PlayEvent extends PlayReport {
  id: string;
  uid: string;
  at: number;
  outcome: PlayOutcome;
  weight: number;
}

export type PlayOutcome = "complete" | "stream" | "skip" | "brief";

export interface TrackStats {
  plays: number;
  completes: number;
  skips: number;
  ms: number;
  likes: number;
  /** Epoch-anchored exponentially decayed popularity (see analytics/decay.ts). */
  trend: number;
}

/** Per-user taste profile maintained incrementally from play events. */
export interface UserTaste {
  artists: Record<string, number>;
  genres: Record<string, number>;
  tracks: Record<string, number>;
  last: Record<string, number>; // trackId -> last played at
  plays: Record<string, number>; // trackId -> stream count
  skips: Record<string, number>; // trackId -> skip count
  hours: Record<string, number>; // "0".."23" -> plays
  totalMs: number;
  totalPlays: number;
  updatedAt: number;
}

export interface DailyStats {
  day: string; // YYYY-MM-DD (UTC)
  plays: number;
  ms: number;
  skips: number;
  completes: number;
  events: number;
  users: Record<string, number>;
  tracks: Record<string, number>;
  hours: Record<string, number>;
  sources: Record<string, { plays: number; completes: number; skips: number }>;
}

export interface StorageUsage {
  bytes: number;
  objects: number;
}

export interface RecItem {
  id: string;
  score: number;
  reason: string;
}

export interface HomeSection {
  id: string;
  title: string;
  subtitle?: string;
  kind: "tracks" | "albums" | "artists" | "mixes" | "shortcuts" | "playlists";
  items: string[] | MixSummary[] | Shortcut[];
  reasons?: Record<string, string>;
}

export interface MixSummary {
  id: string;
  title: string;
  description: string;
  color: string;
  coverTrackIds: string[];
  trackIds: string[];
}

export interface Shortcut {
  type: "liked" | "album" | "artist" | "playlist" | "mix";
  id: string;
}
