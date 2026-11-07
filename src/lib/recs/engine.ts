/**
 * Hybrid recommender.
 *
 *   score = Σ wᵢ · componentᵢ  (weights adapt to how much signal exists)
 *     cf       item-item collaborative filtering from listening sessions (co-plays, cosine-normalised)
 *     content  similarity to the user's seed tracks (shared playlists, artists, genres, film, era,
 *              audio features)
 *     artist   decayed affinity to the track's artists (+ follows, likes, onboarding picks)
 *     genre    decayed affinity to the track's genres
 *     pop      trending (14-day half-life) popularity
 *     quality  Bayesian completion rate across all listeners
 *     fresh    recently added to the catalog
 *   × penalties  recently played, repeatedly skipped, disliked artists
 *   → MMR re-ranking for diversity with a per-artist cap.
 *
 * Pure functions only — the API layer loads data and calls these.
 */
import { decayed, DAY, TASTE_HALF_LIFE, TREND_HALF_LIFE } from "../analytics/score";
import type { ArtistInfo, CatalogTrack, Playlist, RecItem, TrackStats, UserTaste } from "../types";
import { genreKey } from "../util";
import { buildArtistTraits, buildListTraits, contentSimilarity, genreTokens, playlistCoherence, redundancy, vecOf, type TrackVec } from "./similarity";

export type RecMode = "discover" | "mix" | "radio";

export interface RecData {
  tracks: CatalogTrack[];
  artists?: Record<string, ArtistInfo>;
  /** Shared playlists: which songs people put together. */
  playlists?: Playlist[];
  stats: Record<string, TrackStats>;
  taste: UserTaste;
  likes: Record<string, number>;
  followed: Record<string, number>;
  /** Co-occurrence rows for (at least) the seed tracks. */
  cooc: Record<string, Record<string, number>>;
  now: number;
}

export interface Index {
  byId: Map<string, CatalogTrack>;
  vecs: Map<string, TrackVec>;
  byArtist: Map<string, string[]>;
  byAlbum: Map<string, string[]>;
  byGenre: Map<string, string[]>;
}

const indexCache = new WeakMap<CatalogTrack[], { artists?: Record<string, ArtistInfo>; playlists?: Playlist[]; idx: Index }>();

/** Track vectors and lookups for one catalog snapshot (cached per snapshot). */
export function buildIndex(tracks: CatalogTrack[], artists?: Record<string, ArtistInfo>, playlists?: Playlist[]): Index {
  const hit = indexCache.get(tracks);
  if (hit && (!artists || hit.artists === artists) && hit.playlists === playlists) return hit.idx;
  const traits = buildArtistTraits(tracks, artists);
  // Song vectors first without playlists, to judge how consistent each playlist is.
  const plain = new Map(tracks.map((t) => [t.id, vecOf(t, traits)]));
  const lists = playlists?.length ? buildListTraits(playlists, (id) => plain.has(id), playlistCoherence(playlists, plain)) : new Map();
  const idx: Index = { byId: new Map(), vecs: new Map(), byArtist: new Map(), byAlbum: new Map(), byGenre: new Map() };
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  for (const t of tracks) {
    idx.byId.set(t.id, t);
    const v = plain.get(t.id)!;
    const l = lists.get(t.id);
    idx.vecs.set(t.id, l ? { ...v, lists: l } : v);
    for (const a of t.artists) push(idx.byArtist, a.id, t.id);
    push(idx.byAlbum, t.album.id, t.id);
    for (const g of t.genres) push(idx.byGenre, genreKey(g), t.id);
  }
  indexCache.set(tracks, { artists, playlists, idx });
  return idx;
}

export interface Profile {
  artistPref: Map<string, number>; // -1..1
  genrePref: Map<string, number>; // token -> -1..1
  trackPref: Map<string, number>; // raw decayed implicit score (+ likes)
  seeds: { id: string; w: number }[];
  hasSignal: boolean;
}

function normalizeMap(src: Record<string, number>, now: number, halfLife: number): Map<string, number> {
  const out = new Map<string, number>();
  let maxAbs = 0;
  for (const [k, v] of Object.entries(src)) {
    const d = decayed(v, now, halfLife);
    out.set(k, d);
    maxAbs = Math.max(maxAbs, Math.abs(d));
  }
  if (maxAbs > 0) for (const [k, v] of out) out.set(k, v / maxAbs);
  return out;
}

export function buildProfile(data: RecData, idx: Index, explicitSeeds?: string[]): Profile {
  const { taste, now } = data;
  const artistPref = normalizeMap(taste.artists, now, TASTE_HALF_LIFE);
  const genreRaw = normalizeMap(taste.genres, now, TASTE_HALF_LIFE);
  const trackPref = new Map<string, number>();
  for (const [id, v] of Object.entries(taste.tracks)) trackPref.set(id, decayed(v, now, TASTE_HALF_LIFE));

  // Explicit signals: likes and follows.
  for (const id of Object.keys(data.likes)) {
    trackPref.set(id, (trackPref.get(id) ?? 0) + 2);
    const t = idx.byId.get(id);
    if (t) for (const a of t.artists) artistPref.set(a.id, Math.min(1, (artistPref.get(a.id) ?? 0) + 0.25));
  }
  for (const id of Object.keys(data.followed)) artistPref.set(id, Math.min(1, (artistPref.get(id) ?? 0) + 0.5));

  // Spread genre preference onto genre tokens ("modern-bollywood" also informs "bollywood").
  const genrePref = new Map<string, number>();
  for (const [g, v] of genreRaw) {
    for (const [tok, w] of genreTokens([g.replace(/-/g, " ")])) {
      genrePref.set(tok, (genrePref.get(tok) ?? 0) + v * w);
    }
  }
  let gmax = 0;
  for (const v of genrePref.values()) gmax = Math.max(gmax, Math.abs(v));
  if (gmax > 0) for (const [k, v] of genrePref) genrePref.set(k, v / gmax);

  let seeds: { id: string; w: number }[];
  if (explicitSeeds?.length) {
    seeds = explicitSeeds.filter((id) => idx.byId.has(id)).map((id, i) => ({ id, w: 1 / (1 + i * 0.35) }));
  } else {
    const scored: { id: string; w: number }[] = [];
    for (const [id, pref] of trackPref) {
      if (pref <= 0 || !idx.byId.has(id)) continue;
      const last = taste.last[id] ?? 0;
      const recency = last ? Math.exp(-(now - last) / (7 * DAY)) : 0;
      scored.push({ id, w: pref * (0.6 + recency) });
    }
    scored.sort((a, b) => b.w - a.w);
    seeds = scored.slice(0, 15);
    const max = seeds[0]?.w ?? 1;
    seeds = seeds.map((s) => ({ id: s.id, w: s.w / max }));
  }

  return {
    artistPref,
    genrePref,
    trackPref,
    seeds,
    hasSignal: seeds.length > 0 || artistPref.size > 0 || genrePref.size > 0,
  };
}

export interface RecOptions {
  mode: RecMode;
  limit: number;
  seeds?: string[];
  exclude?: Iterable<string>;
  /** Restrict candidates (e.g. a genre or an artist cluster). */
  candidates?: Iterable<string>;
  /** Allow tracks the user already knows well (mixes). Default: mode !== "discover". */
  allowKnown?: boolean;
  maxPerArtist?: number;
  diversity?: number; // λ for MMR (1 = no diversification)
}

interface Scored {
  id: string;
  score: number;
  parts: Record<"cf" | "content" | "artist" | "genre" | "pop" | "quality" | "fresh" | "known", number>;
  seedForContent?: string;
  seedForCf?: string;
}

export function recommend(data: RecData, opts: RecOptions): RecItem[] {
  const idx = buildIndex(data.tracks, data.artists, data.playlists);
  const profile = buildProfile(data, idx, opts.seeds);
  const exclude = new Set(opts.exclude ?? []);
  if (opts.mode === "radio") for (const s of opts.seeds ?? []) exclude.add(s);
  const allowKnown = opts.allowKnown ?? opts.mode !== "discover";
  const now = data.now;

  // Popularity normalisation.
  let maxTrend = 0;
  const trend = new Map<string, number>();
  for (const [id, s] of Object.entries(data.stats)) {
    const v = decayed(s.trend, now, TREND_HALF_LIFE);
    trend.set(id, v);
    if (v > maxTrend) maxTrend = v;
  }
  const logMaxTrend = Math.log1p(maxTrend);

  // CF normalisation: co-plays / sqrt(plays_seed * plays_candidate).
  const playsOf = (id: string) => (data.stats[id]?.plays ?? 0) + 1;
  let coocMass = 0;
  for (const s of profile.seeds) for (const w of Object.values(data.cooc[s.id] ?? {})) coocMass += Math.max(0, w);

  const candidates = opts.candidates ? [...opts.candidates] : data.tracks.map((t) => t.id);
  const seedVecs = profile.seeds.map((s) => ({ ...s, vec: idx.vecs.get(s.id)! })).filter((s) => s.vec);
  const seedWeightSum = seedVecs.reduce((a, s) => a + s.w, 0) || 1;

  const scored: Scored[] = [];
  for (const id of candidates) {
    if (exclude.has(id)) continue;
    const t = idx.byId.get(id);
    const vec = idx.vecs.get(id);
    if (!t || !vec) continue;

    // Collaborative filtering
    let cf = 0;
    let bestCf = 0;
    let seedForCf: string | undefined;
    for (const s of profile.seeds) {
      const c = data.cooc[s.id]?.[id];
      if (!c) continue;
      const v = (s.w * c) / Math.sqrt(playsOf(s.id) * playsOf(id));
      cf += v;
      if (v > bestCf) {
        bestCf = v;
        seedForCf = s.id;
      }
    }

    // Content similarity to seeds (blend of weighted mean and best match)
    let content = 0;
    let bestContent = 0;
    let seedForContent: string | undefined;
    if (seedVecs.length) {
      let acc = 0;
      for (const s of seedVecs) {
        if (s.id === id) continue;
        const sim = contentSimilarity(s.vec, vec);
        acc += s.w * sim;
        if (sim * s.w > bestContent) {
          bestContent = sim * s.w;
          seedForContent = s.id;
        }
      }
      content = 0.5 * (acc / seedWeightSum) + 0.5 * bestContent;
    }

    // Artist & genre affinity
    let artist = 0;
    for (const a of t.artists) artist += profile.artistPref.get(a.id) ?? 0;
    artist /= Math.max(1, t.artists.length);
    let genre = 0;
    let gw = 0;
    for (const [tok, w] of vec.genres) {
      genre += (profile.genrePref.get(tok) ?? 0) * w;
      gw += w;
    }
    genre = gw ? genre / gw : 0;

    const st = data.stats[id];
    const pop = logMaxTrend > 0 ? Math.log1p(trend.get(id) ?? 0) / logMaxTrend : 0;
    const quality = st ? (st.completes + 1 + st.likes) / (st.plays + st.skips + 2 + st.likes) : 0.5;
    const ageDays = (now - t.createdAt) / DAY;
    const fresh = Math.max(0, 1 - ageDays / 21);
    const known = Math.max(0, profile.trackPref.get(id) ?? 0);

    scored.push({
      id,
      score: 0,
      parts: { cf, content, artist, genre, pop, quality, fresh, known },
      seedForCf,
      seedForContent,
    });
  }
  if (!scored.length) return [];

  // Normalise CF to 0..1 over candidates
  const maxCf = Math.max(...scored.map((s) => s.parts.cf), 0);
  const maxKnown = Math.max(...scored.map((s) => s.parts.known), 0);
  for (const s of scored) {
    s.parts.cf = maxCf > 0 ? s.parts.cf / maxCf : 0;
    s.parts.known = maxKnown > 0 ? s.parts.known / maxKnown : 0;
  }

  // Adaptive weights
  const w = weightsFor(opts.mode, profile, coocMass, seedVecs.length > 0);
  for (const s of scored) {
    const p = s.parts;
    let score =
      w.cf * p.cf +
      w.content * p.content +
      w.artist * p.artist +
      w.genre * p.genre +
      w.pop * p.pop +
      w.quality * p.quality +
      w.fresh * p.fresh +
      (allowKnown ? w.known * p.known : 0);

    // Penalties
    const last = data.taste.last[s.id];
    if (last) {
      const hours = (now - last) / 3_600_000;
      if (opts.mode === "discover") score *= hours < 24 ? 0.25 : hours < 24 * 7 ? 0.6 : 0.8;
      else if (hours < 3) score *= 0.5;
    }
    const plays = data.taste.plays[s.id] ?? 0;
    const skips = data.taste.skips[s.id] ?? 0;
    if (!allowKnown && plays >= 3) score *= 0.5;
    if (skips >= 2 && skips > plays) score *= 0.4;
    const pref = profile.trackPref.get(s.id) ?? 0;
    if (pref < 0) score *= Math.max(0.15, 1 + pref);
    const t = idx.byId.get(s.id)!;
    if (t.artists.some((a) => (profile.artistPref.get(a.id) ?? 0) < -0.3)) score *= 0.5;
    s.score = score;
  }

  scored.sort((a, b) => b.score - a.score);
  const ranked = diversify(scored.slice(0, Math.max(opts.limit * 6, 120)), idx, opts);
  return ranked.slice(0, opts.limit).map((s) => ({ id: s.id, score: Number(s.score.toFixed(4)), reason: reasonFor(s, w, idx, data, opts) }));
}

type Weights = Record<"cf" | "content" | "artist" | "genre" | "pop" | "quality" | "fresh" | "known", number>;

export function weightsFor(mode: RecMode, profile: Profile, coocMass: number, hasSeeds: boolean): Weights {
  let w: Weights;
  if (!profile.hasSignal) {
    w = { cf: 0, content: 0, artist: 0, genre: 0, pop: 0.5, quality: 0.25, fresh: 0.25, known: 0 };
  } else if (mode === "radio") {
    w = { cf: 0.34, content: 0.4, artist: 0.08, genre: 0.06, pop: 0.05, quality: 0.04, fresh: 0.01, known: 0.02 };
  } else if (mode === "mix") {
    w = { cf: 0.24, content: 0.24, artist: 0.18, genre: 0.08, pop: 0.05, quality: 0.04, fresh: 0.02, known: 0.15 };
  } else {
    w = { cf: 0.3, content: 0.28, artist: 0.14, genre: 0.1, pop: 0.08, quality: 0.05, fresh: 0.05, known: 0 };
  }
  // Re-distribute weight from signals that do not exist yet.
  const missing: (keyof Weights)[] = [];
  if (coocMass <= 0) missing.push("cf");
  if (!hasSeeds) missing.push("content");
  if (!profile.artistPref.size) missing.push("artist");
  if (!profile.genrePref.size) missing.push("genre");
  const freed = missing.reduce((a, k) => a + w[k], 0);
  if (freed > 0) {
    for (const k of missing) w[k] = 0;
    const keys = (Object.keys(w) as (keyof Weights)[]).filter((k) => !missing.includes(k) && w[k] > 0);
    const total = keys.reduce((a, k) => a + w[k], 0) || 1;
    for (const k of keys) w[k] += (freed * w[k]) / total;
  }
  return w;
}

/** Maximal Marginal Relevance + per-artist cap. */
function diversify(items: Scored[], idx: Index, opts: RecOptions): Scored[] {
  const lambda = opts.diversity ?? (opts.mode === "mix" ? 0.85 : opts.mode === "radio" ? 0.78 : 0.8);
  const maxPerArtist = opts.maxPerArtist ?? (opts.mode === "mix" ? 4 : 2);
  if (!items.length) return [];
  const top = items[0].score || 1;
  const pool = items.map((s) => ({ s, rel: s.score / top, vec: idx.vecs.get(s.id)! }));
  const picked: typeof pool = [];
  const perArtist = new Map<string, number>();
  const window = 10; // cap applies within each block of 10

  while (pool.length && picked.length < opts.limit) {
    let bestI = -1;
    let best = -Infinity;
    const block = Math.floor(picked.length / window);
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const capped = [...c.vec.artists].some((a) => (perArtist.get(`${block}:${a}`) ?? 0) >= maxPerArtist);
      let maxRed = 0;
      for (let j = Math.max(0, picked.length - 8); j < picked.length; j++) {
        const r = redundancy(c.vec, picked[j].vec);
        if (r > maxRed) maxRed = r;
      }
      const v = lambda * c.rel - (1 - lambda) * maxRed - (capped ? 1 : 0);
      if (v > best) {
        best = v;
        bestI = i;
      }
    }
    const [chosen] = pool.splice(bestI, 1);
    picked.push(chosen);
    for (const a of chosen.vec.artists) perArtist.set(`${block}:${a}`, (perArtist.get(`${block}:${a}`) ?? 0) + 1);
  }
  return picked.map((p) => p.s);
}

function reasonFor(s: Scored, w: Weights, idx: Index, data: RecData, opts: RecOptions): string {
  const contrib = (Object.keys(w) as (keyof Weights)[])
    .map((k) => [k, w[k] * s.parts[k]] as const)
    .sort((a, b) => b[1] - a[1]);
  const [top] = contrib[0] ?? ["pop", 0];
  const t = idx.byId.get(s.id);
  const title = (id?: string) => (id ? idx.byId.get(id)?.title : undefined);
  switch (top) {
    case "cf": {
      const seed = title(s.seedForCf);
      return seed ? `Listeners of “${seed}” also play this` : "Popular with listeners like you";
    }
    case "content": {
      const seed = title(s.seedForContent);
      return seed ? `Similar to “${seed}”` : "Similar to what you play";
    }
    case "artist": {
      const a = t?.artists.find((x) => idx.byArtist.has(x.id));
      return a ? `Because you like ${a.name}` : "From artists you like";
    }
    case "genre":
      return t?.genres[0] ? `More ${t.genres[0]}` : "Matches your taste";
    case "known":
      return "One of your favourites";
    case "fresh":
      return "New on Pepper";
    case "quality":
      return "Listeners finish this one";
    default:
      return opts.mode === "radio" ? "Fits this vibe" : "Trending on Pepper";
  }
}

/** Tracks ranked purely by trending popularity (fallback / charts). */
export function trending(data: Pick<RecData, "tracks" | "stats" | "now">, limit: number): string[] {
  return data.tracks
    .map((t) => ({ id: t.id, v: decayed(data.stats[t.id]?.trend ?? 0, data.now, TREND_HALF_LIFE) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, limit)
    .map((x) => x.id);
}
