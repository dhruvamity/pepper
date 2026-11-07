"use client";

import useSWR from "swr";
import type { ArtistInfo, ArtistRef, CatalogSnapshot, CatalogTrack, ImageSet, Playlist } from "@/lib/types";
import { fold, genreKey } from "@/lib/util";
import { fetcher } from "./api";

export interface AlbumView {
  id: string;
  title: string;
  artist: ArtistRef;
  artists: ArtistRef[];
  year?: number;
  releaseDate?: string;
  film?: string;
  cover?: ImageSet;
  trackIds: string[];
  durationMs: number;
  createdAt: number;
  genres: string[];
  kind: "Album" | "Single" | "EP";
}

export interface ArtistView {
  id: string;
  name: string;
  image?: ImageSet;
  fallbackImage?: ImageSet;
  bio?: string;
  trackIds: string[];
  albumIds: string[];
  appearsOn: string[];
  genres: string[];
}

export interface GenreView {
  key: string;
  name: string;
  trackIds: string[];
  color: string;
  coverTrackId?: string;
}

export interface CatalogIndex {
  version: number;
  tracks: CatalogTrack[];
  byId: Map<string, CatalogTrack>;
  albums: Map<string, AlbumView>;
  artists: Map<string, ArtistView>;
  genres: GenreView[];
  /** Shared playlists (everyone sees them), in the catalog's order. */
  playlists: Map<string, Playlist>;
  search(q: string): SearchResults;
}

export interface SearchResults {
  top?: { type: "track" | "artist" | "album" | "playlist"; id: string };
  tracks: string[];
  artists: string[];
  albums: string[];
  genres: string[];
  playlists: string[];
}

const GENRE_COLORS = ["#e13300", "#1e3264", "#8400e7", "#e8115b", "#148a08", "#bc5900", "#509bf5", "#dc148c", "#27856a", "#477d95", "#af2896", "#e91429", "#8d67ab", "#ba5d07", "#0d73ec", "#608108"];

let cached: CatalogIndex | null = null;

function buildIndex(snap: CatalogSnapshot): CatalogIndex {
  if (cached && cached.version === snap.version && cached.tracks.length === snap.tracks.length) return cached;
  const tracks = [...snap.tracks].sort((a, b) => b.createdAt - a.createdAt);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const albums = new Map<string, AlbumView>();
  const artists = new Map<string, ArtistView>();
  const genres = new Map<string, GenreView>();

  const artistOf = (ref: ArtistRef, info?: ArtistInfo): ArtistView => {
    let a = artists.get(ref.id);
    if (!a) {
      a = { id: ref.id, name: info?.name ?? ref.name, image: info?.image, bio: info?.bio, trackIds: [], albumIds: [], appearsOn: [], genres: [] };
      artists.set(ref.id, a);
    }
    return a;
  };

  for (const t of tracks) {
    const owner = t.albumArtist ?? t.artists[0];
    let al = albums.get(t.album.id);
    if (!al) {
      al = {
        id: t.album.id,
        title: t.album.title,
        artist: owner,
        artists: [],
        year: t.year,
        releaseDate: t.releaseDate,
        film: t.film,
        cover: t.cover,
        trackIds: [],
        durationMs: 0,
        createdAt: t.createdAt,
        genres: [],
        kind: "Single",
      };
      albums.set(t.album.id, al);
    }
    al.trackIds.push(t.id);
    al.durationMs += t.durationMs;
    al.createdAt = Math.max(al.createdAt, t.createdAt);
    if (!al.cover && t.cover) al.cover = t.cover;
    if (!al.year && t.year) al.year = t.year;
    for (const a of t.artists) if (!al.artists.some((x) => x.id === a.id)) al.artists.push(a);
    for (const g of t.genres) if (!al.genres.includes(g)) al.genres.push(g);

    for (const a of t.artists) {
      const av = artistOf(a, snap.artists[a.id]);
      av.trackIds.push(t.id);
      if (!av.fallbackImage && t.cover) av.fallbackImage = t.cover;
      for (const g of t.genres) if (!av.genres.includes(g)) av.genres.push(g);
    }
    if (t.albumArtist) artistOf(t.albumArtist, snap.artists[t.albumArtist.id]);

    for (const g of t.genres) {
      const k = genreKey(g);
      const gv = genres.get(k) ?? { key: k, name: g, trackIds: [], color: GENRE_COLORS[genres.size % GENRE_COLORS.length] };
      gv.trackIds.push(t.id);
      if (!gv.coverTrackId && t.cover) gv.coverTrackId = t.id;
      genres.set(k, gv);
    }
  }

  for (const al of albums.values()) {
    al.trackIds.sort((a, b) => {
      const x = byId.get(a)!;
      const y = byId.get(b)!;
      return (x.discNo ?? 1) - (y.discNo ?? 1) || (x.trackNo ?? 999) - (y.trackNo ?? 999) || x.title.localeCompare(y.title);
    });
    al.kind = al.trackIds.length >= 7 ? "Album" : al.trackIds.length >= 3 ? "EP" : "Single";
    const owner = artists.get(al.artist.id);
    if (owner && !owner.albumIds.includes(al.id)) owner.albumIds.push(al.id);
    for (const a of al.artists) {
      const av = artists.get(a.id);
      if (av && a.id !== al.artist.id && !av.appearsOn.includes(al.id)) av.appearsOn.push(al.id);
    }
  }
  for (const a of artists.values()) {
    a.albumIds.sort((x, y) => (albums.get(y)!.year ?? 0) - (albums.get(x)!.year ?? 0) || albums.get(y)!.createdAt - albums.get(x)!.createdAt);
  }

  const genreList = [...genres.values()].sort((a, b) => b.trackIds.length - a.trackIds.length);
  const playlists = new Map((snap.playlists ?? []).map((p) => [p.id, { ...p, trackIds: p.trackIds.filter((id) => byId.has(id)) }]));
  const searchIdx = buildSearch(tracks, [...albums.values()], [...artists.values()], genreList, [...playlists.values()]);

  cached = {
    version: snap.version,
    tracks,
    byId,
    albums,
    artists,
    genres: genreList,
    playlists,
    search: searchIdx,
  };
  return cached;
}

/* ---------------------------------------------------------------- search */

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Score how well query tokens match a field (prefix > fuzzy). */
function matchScore(qTokens: string[], field: string, fieldTokens: string[]): number {
  if (!field) return 0;
  const q = qTokens.join(" ");
  if (field === q) return 10;
  if (field.startsWith(q)) return 8;
  let total = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const ft of fieldTokens) {
      if (ft === qt) best = Math.max(best, 3);
      else if (ft.startsWith(qt)) best = Math.max(best, qt.length >= 2 ? 2.4 : 1.2);
      else if (qt.length >= 4 && ft.length >= 4) {
        const d = editDistance(qt, ft.slice(0, qt.length + 1), qt.length >= 7 ? 2 : 1);
        if (d <= (qt.length >= 7 ? 2 : 1)) best = Math.max(best, 1.6 - d * 0.4);
      }
    }
    if (best === 0) return 0; // every query word must match something
    total += best;
  }
  return total / qTokens.length + (field.includes(q) ? 1 : 0);
}

function buildSearch(tracks: CatalogTrack[], albums: AlbumView[], artists: ArtistView[], genres: GenreView[], playlists: Playlist[]) {
  const prep = (s: string) => {
    const f = fold(s);
    return { f, tokens: f.split(" ").filter(Boolean) };
  };
  const T = tracks.map((t) => ({
    id: t.id,
    title: prep(t.title),
    extra: prep(`${t.subtitle ?? ""} ${t.film ?? ""} ${t.album.title}`),
    artists: prep(t.artists.map((a) => a.name).join(" ")),
  }));
  const A = artists.map((a) => ({ id: a.id, name: prep(a.name), weight: a.trackIds.length }));
  const L = albums.map((a) => ({ id: a.id, title: prep(`${a.title} ${a.film ?? ""}`), artist: prep(a.artist.name) }));
  const G = genres.map((g) => ({ id: g.key, name: prep(g.name) }));
  const P = playlists.map((p) => ({ id: p.id, name: prep(p.name), about: prep(p.description ?? "") }));

  return (query: string): SearchResults => {
    const q = fold(query);
    const qTokens = q.split(" ").filter(Boolean);
    if (!qTokens.length) return { tracks: [], artists: [], albums: [], genres: [], playlists: [] };

    const scoreTrack = (t: (typeof T)[number]) => {
      // allow "title artist" queries by matching across fields
      const combinedTokens = [...t.title.tokens, ...t.artists.tokens, ...t.extra.tokens];
      const s = Math.max(
        matchScore(qTokens, t.title.f, t.title.tokens) * 1.2,
        matchScore(qTokens, t.artists.f, t.artists.tokens) * 0.8,
        matchScore(qTokens, t.extra.f, t.extra.tokens) * 0.6,
        matchScore(qTokens, `${t.title.f} ${t.artists.f}`, combinedTokens) * 0.9,
      );
      return s;
    };
    const tracksScored = T.map((t) => ({ id: t.id, s: scoreTrack(t) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const artistsScored = A.map((a) => ({ id: a.id, s: matchScore(qTokens, a.name.f, a.name.tokens) * 1.3 + Math.min(1, a.weight / 20) * 0.3 }))
      .filter((x) => x.s > 0.3)
      .sort((a, b) => b.s - a.s);
    const albumsScored = L.map((a) => ({
      id: a.id,
      s: Math.max(matchScore(qTokens, a.title.f, a.title.tokens), matchScore(qTokens, a.artist.f, a.artist.tokens) * 0.7),
    }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    const genresScored = G.map((g) => ({ id: g.id, s: matchScore(qTokens, g.name.f, g.name.tokens) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const playlistsScored = P.map((p) => ({ id: p.id, s: Math.max(matchScore(qTokens, p.name.f, p.name.tokens), matchScore(qTokens, p.about.f, p.about.tokens) * 0.6) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);

    const candidates = [
      tracksScored[0] && { type: "track" as const, id: tracksScored[0].id, s: tracksScored[0].s },
      artistsScored[0] && { type: "artist" as const, id: artistsScored[0].id, s: artistsScored[0].s + 0.2 },
      albumsScored[0] && { type: "album" as const, id: albumsScored[0].id, s: albumsScored[0].s * 0.95 },
      playlistsScored[0] && { type: "playlist" as const, id: playlistsScored[0].id, s: playlistsScored[0].s * 0.9 },
    ].filter(Boolean) as { type: "track" | "artist" | "album" | "playlist"; id: string; s: number }[];
    candidates.sort((a, b) => b.s - a.s);

    return {
      top: candidates[0] ? { type: candidates[0].type, id: candidates[0].id } : undefined,
      tracks: tracksScored.slice(0, 50).map((x) => x.id),
      artists: artistsScored.slice(0, 20).map((x) => x.id),
      albums: albumsScored.slice(0, 20).map((x) => x.id),
      genres: genresScored.slice(0, 10).map((x) => x.id),
      playlists: playlistsScored.slice(0, 20).map((x) => x.id),
    };
  };
}

export function useCatalog() {
  const { data, error, isLoading, mutate } = useSWR<CatalogSnapshot>("/api/catalog", fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 10_000,
    keepPreviousData: true,
  });
  const index = data ? buildIndex(data) : null;
  return { catalog: index, error, isLoading, refresh: mutate };
}

export interface Popularity {
  [trackId: string]: { plays: number; pop: number; likes: number };
}

export function usePopularity() {
  return useSWR<Popularity>("/api/popularity", fetcher, { dedupingInterval: 30_000 });
}

export function artistImage(a?: Pick<ArtistView, "image" | "fallbackImage">): ImageSet | undefined {
  return a?.image ?? a?.fallbackImage;
}
