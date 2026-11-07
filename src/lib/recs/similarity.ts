/**
 * Content similarity between tracks: shared playlists ("these go together"), artists (and
 * related artists), genres (as a map of related genres), language, album/film, era and audio
 * features (tempo, energy, brightness, … measured from the waveform at upload time).
 */
import { languageSimilarity, normalizeLanguage } from "../metadata/language";
import { songKey } from "../metadata/normalize";
import type { ArtistInfo, AudioFeatures, CatalogTrack } from "../types";
import { genreKey, seededRandom } from "../util";
import { canonicalGenres, genreSimilarity, languageFromGenres, type GenreWeights } from "./genres";

const GENERIC_WORDS = new Set(["modern", "contemporary", "new", "classic", "music", "the", "and", "of", "old", "school"]);

export type TokenWeights = Map<string, number>;

/** "Modern Bollywood" -> { modern-bollywood: 1, bollywood: 0.5 } */
export function genreTokens(genres: string[]): TokenWeights {
  const out: TokenWeights = new Map();
  for (const g of genres) {
    const key = genreKey(g);
    if (!key) continue;
    out.set(key, Math.max(out.get(key) ?? 0, 1));
    const words = key.split("-").filter((w) => w.length > 1 && !GENERIC_WORDS.has(w));
    if (words.length > 1 || (words.length === 1 && words[0] !== key)) {
      for (const w of words) out.set(w, Math.max(out.get(w) ?? 0, 0.5));
    }
  }
  return out;
}

export function weightedJaccard(a: TokenWeights, b: TokenWeights): number {
  if (!a.size || !b.size) return 0;
  let min = 0;
  let max = 0;
  for (const [k, wa] of a) {
    const wb = b.get(k) ?? 0;
    min += Math.min(wa, wb);
    max += Math.max(wa, wb);
  }
  for (const [k, wb] of b) if (!a.has(k)) max += wb;
  return max ? min / max : 0;
}

function foldBpm(bpm: number): number {
  let b = bpm;
  while (b < 80) b *= 2;
  while (b > 165) b /= 2;
  return b;
}

/** Audio-feature similarity in [0,1]; null when either side lacks features. */
export function audioSimilarity(a?: AudioFeatures, b?: AudioFeatures): number | null {
  if (!a || !b) return null;
  const dims: [number, number, number][] = [
    [a.energy, b.energy, 1.2],
    [a.brightness, b.brightness, 0.8],
    [a.danceability, b.danceability, 1.0],
    [a.rhythm, b.rhythm, 0.7],
    [a.dynamics, b.dynamics, 0.5],
    [clampLoud(a.loudness), clampLoud(b.loudness), 0.5],
  ];
  if (a.bpm && b.bpm) {
    const fa = foldBpm(a.bpm);
    const fb = foldBpm(b.bpm);
    const ratio = Math.abs(Math.log2(fa / fb));
    // Octave-equivalent tempo distance, ~0.12 per 10% tempo difference.
    dims.push([0, Math.min(1, ratio * 0.9), 1.0]);
  }
  let d2 = 0;
  let w = 0;
  for (const [x, y, wt] of dims) {
    d2 += wt * (x - y) ** 2;
    w += wt;
  }
  return Math.exp(-(d2 / w) / 0.035);
}

function clampLoud(db: number): number {
  // -30 dBFS (quiet) .. -6 dBFS (loud) -> 0..1
  return Math.min(1, Math.max(0, (db + 30) / 24));
}

/** What an artist's songs say about them: their usual genres and language, and who they're linked to. */
export interface ArtistTraits {
  genres: GenreWeights;
  lang?: string;
  /** Related artists (Deezer) and artists they share songs with. */
  links: Set<string>;
}

/** What the shared playlists say about a song. */
export interface ListTraits {
  /** Playlists the song is in → how focused each one is (1 for a small, specific list; 0.5 for a big mixed one). */
  member: Map<string, number>;
  /** Playlists the song is in or near (they share songs with one it is in) → closeness 0..1. */
  near: Map<string, number>;
}

/** Playlist focus by size: ~30 songs or fewer count fully, 200+ songs half. */
export function playlistFocus(size: number): number {
  return Math.max(0.5, Math.min(1, 1.25 - 0.3 * Math.log2(size / 30)));
}

/**
 * How consistent each playlist is (0.35..1): its songs' similarity to each other (artists, genre,
 * language, era, sound) compared with two random songs from the library. A focused mood list
 * scores high; a catch-all like "Me" (a bit of everything) scores low, so sharing it says little.
 */
export function playlistCoherence(playlists: { id: string; trackIds: string[] }[], vecs: Map<string, TrackVec>): Map<string, number> {
  const rand = seededRandom(17);
  const mean = (pool: TrackVec[], pairs: number) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < pairs; i++) {
      const a = pool[Math.floor(rand() * pool.length)];
      const b = pool[Math.floor(rand() * pool.length)];
      if (a === b) continue;
      s += contentSimilarity(a, b);
      n++;
    }
    return n ? s / n : 0;
  };
  const all = [...vecs.values()];
  const base = mean(all, 600);
  const out = new Map<string, number>();
  for (const p of playlists) {
    const members = p.trackIds.map((id) => vecs.get(id)).filter((v): v is TrackVec => Boolean(v));
    if (members.length < 2) continue;
    const m = mean(members, Math.min(300, members.length * 6));
    out.set(p.id, Math.max(0.35, Math.min(1, ((m - base) / Math.max(0.05, 1 - base)) * 2.5)));
  }
  return out;
}

/**
 * Playlists as a "these songs go together" signal — the kind of data Spotify learns similarity
 * from (track vectors trained on millions of user playlists). A song is close to the other songs
 * in its playlists, and somewhat close to songs in playlists that share many songs with its own
 * (closeness = shared songs / √(size × size), at most 0.8).
 */
export function buildListTraits(
  playlists: { id: string; trackIds: string[] }[] | undefined,
  known: (id: string) => boolean,
  coherence?: Map<string, number>,
): Map<string, ListTraits> {
  const out = new Map<string, ListTraits>();
  const lists = (playlists ?? [])
    .map((p) => ({ id: p.id, ids: [...new Set(p.trackIds.filter(known))] }))
    .filter((p) => p.ids.length >= 2);
  if (!lists.length) return out;
  const sets = lists.map((l) => new Set(l.ids));
  const closeness = lists.map((a, i) =>
    lists.map((b, j) => {
      if (i === j) return 1;
      let shared = 0;
      for (const id of a.ids) if (sets[j].has(id)) shared++;
      return shared ? (0.8 * shared) / Math.sqrt(a.ids.length * b.ids.length) : 0;
    }),
  );
  lists.forEach((l, i) => {
    const focus = playlistFocus(l.ids.length) * (coherence?.get(l.id) ?? 1);
    for (const id of l.ids) {
      let t = out.get(id);
      if (!t) out.set(id, (t = { member: new Map(), near: new Map() }));
      t.member.set(l.id, focus);
      // Near other playlists through this one — weakly when this one is a loose catch-all.
      lists.forEach((m, j) => {
        const c = i === j ? 1 : closeness[i][j] * focus;
        if (c > 0.02) t.near.set(m.id, Math.max(t.near.get(m.id) ?? 0, c));
      });
    }
  });
  return out;
}

/** How strongly b sits in a's playlists; several shared playlists add up like probabilities. */
function listAffinity(a: ListTraits, b: ListTraits): number {
  let keep = 1;
  for (const [id, focus] of a.member) keep *= 1 - focus * (b.near.get(id) ?? 0);
  return 1 - keep;
}

/** Playlist similarity in [0,1]; null when either song is in no shared playlist. */
export function togetherSimilarity(a?: ListTraits, b?: ListTraits): number | null {
  if (!a || !b) return null;
  return 0.5 * (listAffinity(a, b) + listAffinity(b, a));
}

export interface TrackVec {
  track: CatalogTrack;
  /** Same for every version of a song ("Tum Hi Ho", "Tum Hi Ho (Reprise)"). */
  key: string;
  artists: Set<string>;
  /** Free-text genre words (catch labels the canonical list does not know). */
  genres: TokenWeights;
  /** Canonical genres: the song's own, or its artist's when the song has none. */
  canon: GenreWeights;
  lang?: string;
  /** Artists related to this song's artists. */
  linked: Set<string>;
  film?: string;
  /** Shared playlists it is in (undefined: none). */
  lists?: ListTraits;
}

/**
 * Per-artist genres and language (from their songs, like streaming services that tag artists
 * rather than songs) plus links between artists: Deezer's related artists and shared songs.
 */
export function buildArtistTraits(tracks: CatalogTrack[], artists?: Record<string, ArtistInfo>): Map<string, ArtistTraits> {
  const agg = new Map<string, { genres: Map<string, number>; langs: Map<string, number>; links: Set<string> }>();
  const get = (id: string) => {
    let a = agg.get(id);
    if (!a) agg.set(id, (a = { genres: new Map(), langs: new Map(), links: new Set() }));
    return a;
  };
  for (const t of tracks) {
    const canon = canonicalGenres(t.genres);
    const lang = normalizeLanguage(t.language) ?? languageFromGenres(canon);
    const ids = [...new Set([...t.artists.map((a) => a.id), ...(t.albumArtist ? [t.albumArtist.id] : [])])];
    for (const id of ids) {
      const a = get(id);
      for (const [g, w] of canon) a.genres.set(g, (a.genres.get(g) ?? 0) + w);
      if (lang) a.langs.set(lang, (a.langs.get(lang) ?? 0) + 1);
      for (const other of ids) if (other !== id) a.links.add(other);
    }
  }
  for (const info of Object.values(artists ?? {})) {
    for (const r of info.related ?? []) {
      get(info.id).links.add(r);
      get(r).links.add(info.id);
    }
  }
  const out = new Map<string, ArtistTraits>();
  for (const [id, a] of agg) {
    const max = Math.max(0, ...a.genres.values());
    const genres: GenreWeights = new Map(
      [...a.genres]
        .filter(([, w]) => w >= max * 0.3)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 3)
        .map(([g, w]) => [g, w / max]),
    );
    let lang: string | undefined;
    const total = [...a.langs.values()].reduce((s, n) => s + n, 0);
    for (const [l, n] of a.langs) if (n >= total * 0.6) lang = l;
    out.set(id, { genres, lang, links: a.links });
  }
  return out;
}

export function vecOf(track: CatalogTrack, traits?: Map<string, ArtistTraits>, lists?: Map<string, ListTraits>): TrackVec {
  const artists = new Set(track.artists.map((a) => a.id));
  const own = canonicalGenres(track.genres);
  const canon: GenreWeights = new Map(own);
  const linked = new Set<string>();
  const artistLangs: string[] = [];
  for (const id of artists) {
    const t = traits?.get(id);
    if (!t) continue;
    if (!own.size) for (const [g, w] of t.genres) canon.set(g, Math.max(canon.get(g) ?? 0, w * 0.7));
    if (t.lang) artistLangs.push(t.lang);
    for (const l of t.links) if (!artists.has(l)) linked.add(l);
  }
  const lang =
    normalizeLanguage(track.language) ??
    languageFromGenres(own) ??
    (artistLangs.length && artistLangs.every((l) => l === artistLangs[0]) ? artistLangs[0] : undefined);
  return {
    track,
    key: songKey(track.title),
    artists,
    genres: genreTokens(track.genres),
    canon,
    lang,
    linked,
    film: track.film?.toLowerCase(),
    lists: lists?.get(track.id),
  };
}

/** Weighted content similarity in [0,1]. */
export function contentSimilarity(a: TrackVec, b: TrackVec): number {
  let s = 0;
  let w = 0;

  // Shared playlists: people put these songs together — the best "same vibe" evidence there is.
  const together = togetherSimilarity(a.lists, b.lists);
  if (together !== null) {
    s += 0.35 * together;
    w += 0.35;
  }

  // Same artist, or artists known to be related (similar artists, featured together).
  let shared = 0;
  for (const id of b.artists) if (a.artists.has(id)) shared++;
  let artist = shared / Math.max(1, Math.min(a.artists.size, b.artists.size));
  if (!artist && [...b.artists].some((id) => a.linked.has(id))) artist = 0.55;
  s += 0.25 * artist;
  w += 0.25;

  // Genre: related genres count (Bollywood ~ Indian Pop); raw tag words are the fallback.
  const canon = genreSimilarity(a.canon, b.canon);
  const words = a.genres.size && b.genres.size ? weightedJaccard(a.genres, b.genres) : null;
  const genre = canon === null ? words : Math.max(canon, words ?? 0);
  if (genre !== null) {
    s += 0.25 * genre;
    w += 0.25;
  }

  const lang = languageSimilarity(a.lang, b.lang);
  if (lang !== null) {
    s += 0.15 * lang;
    w += 0.15;
  }

  const sameAlbum = a.track.album.id === b.track.album.id;
  const sameFilm = Boolean(a.film && a.film === b.film);
  s += 0.07 * (sameAlbum ? 1 : sameFilm ? 0.85 : 0);
  w += 0.07;

  if (a.track.year && b.track.year) {
    s += 0.06 * Math.exp(-Math.abs(a.track.year - b.track.year) / 6);
    w += 0.06;
  }

  const audio = audioSimilarity(a.track.features, b.track.features);
  if (audio !== null) {
    s += 0.22 * audio;
    w += 0.22;
  }
  return w ? s / w : 0;
}

/** Similarity used for diversification (penalise same artist / album strongly). */
export function redundancy(a: TrackVec, b: TrackVec): number {
  if (a.key && a.key === b.key) return 1; // another version of the same song
  for (const id of b.artists) if (a.artists.has(id)) return 1;
  if (a.track.album.id === b.track.album.id) return 0.9;
  return contentSimilarity(a, b) * 0.6;
}
