/** Home feed and Daily Mix generation on top of the recommender. */
import { decayed, TREND_HALF_LIFE } from "../analytics/score";
import type { HomeSection, MixSummary, Playlist } from "../types";
import { genreKey, uniqueBy } from "../util";
import { buildIndex, buildProfile, recommend, trending, type RecData } from "./engine";
import { genreTokens, weightedJaccard, type TokenWeights } from "./similarity";

const MIX_COLORS = ["#e13300", "#1e3264", "#8d67ab", "#27856a", "#d84000", "#477d95", "#af2896", "#509bf5"];

interface Cluster {
  artists: string[];
  genres: TokenWeights;
  weight: number;
}

/** Cluster the user's favourite artists by genre and build one mix per cluster. */
export function buildMixes(data: RecData, max = 4): MixSummary[] {
  const idx = buildIndex(data.tracks, data.artists, data.playlists);
  const profile = buildProfile(data, idx);
  const topArtists = [...profile.artistPref]
    .filter(([id, v]) => v > 0.05 && idx.byArtist.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16);

  if (topArtists.length < 2) return genreMixes(data, max);

  const clusters: Cluster[] = [];
  for (const [artistId, pref] of topArtists) {
    const ids = idx.byArtist.get(artistId) ?? [];
    const g = genreTokens(ids.flatMap((id) => idx.byId.get(id)?.genres ?? []));
    let best: Cluster | undefined;
    let bestSim = -1;
    for (const c of clusters) {
      const sim = weightedJaccard(c.genres, g);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best && (bestSim >= 0.3 || clusters.length >= max)) {
      best.artists.push(artistId);
      best.weight += pref;
      for (const [k, v] of g) best.genres.set(k, Math.max(best.genres.get(k) ?? 0, v));
    } else {
      clusters.push({ artists: [artistId], genres: new Map(g), weight: pref });
    }
  }
  clusters.sort((a, b) => b.weight - a.weight);

  const mixes: MixSummary[] = [];
  const used = new Set<string>();
  clusters.slice(0, max).forEach((c, i) => {
    const artistTracks = c.artists.flatMap((a) => idx.byArtist.get(a) ?? []);
    const favourites = uniqueBy(artistTracks, (x) => x)
      .map((id) => ({ id, p: profile.trackPref.get(id) ?? 0 }))
      .sort((a, b) => b.p - a.p);
    const seeds = favourites.slice(0, 8).map((f) => f.id);
    const recs = recommend(data, { mode: "mix", seeds, limit: 30, allowKnown: true, maxPerArtist: 3 });
    const known = favourites.filter((f) => f.p > 0).slice(0, 12).map((f) => f.id);
    const fresh = recs.map((r) => r.id).filter((id) => !known.includes(id));
    const order: string[] = [];
    // Interleave familiar favourites with new discoveries (roughly 1:1).
    for (let k = 0; order.length < 30 && (k < known.length || k < fresh.length); k++) {
      if (k < known.length) order.push(known[k]);
      if (k < fresh.length) order.push(fresh[k]);
    }
    const trackIds = uniqueBy(order, (x) => x).slice(0, 30);
    if (trackIds.length < 4) return;
    const names = c.artists.map((a) => ({ name: data.artists?.[a]?.name ?? idx.byId.get(idx.byArtist.get(a)![0])!.artists.find((x) => x.id === a)!.name }));
    const coverTrackIds = uniqueBy(
      trackIds.map((id) => idx.byId.get(id)!).filter((t) => t.cover && !used.has(t.album.id)),
      (t) => t.album.id,
    )
      .slice(0, 4)
      .map((t) => t.id);
    coverTrackIds.forEach((id) => used.add(idx.byId.get(id)!.album.id));
    mixes.push({
      id: `daily-${i + 1}`,
      title: `Daily Mix ${i + 1}`,
      description: `${names.slice(0, 3).map((n) => n.name).join(", ")} and more`,
      color: MIX_COLORS[i % MIX_COLORS.length],
      coverTrackIds: coverTrackIds.length ? coverTrackIds : trackIds.slice(0, 1),
      trackIds,
    });
  });
  return mixes.length ? mixes : genreMixes(data, max);
}

/** Cold-start mixes: the most common genres in the catalog, ordered by popularity. */
export function genreMixes(data: Pick<RecData, "tracks" | "stats" | "now">, max = 4): MixSummary[] {
  const counts = new Map<string, { name: string; ids: string[] }>();
  for (const t of data.tracks) {
    for (const g of t.genres.slice(0, 2)) {
      const k = genreKey(g);
      const e = counts.get(k) ?? { name: g, ids: [] };
      e.ids.push(t.id);
      counts.set(k, e);
    }
  }
  const pop = (id: string) => decayed(data.stats[id]?.trend ?? 0, data.now, TREND_HALF_LIFE);
  return [...counts.entries()]
    .filter(([, v]) => v.ids.length >= 3)
    .sort((a, b) => b[1].ids.length - a[1].ids.length)
    .slice(0, max)
    .map(([k, v], i) => {
      const ids = [...v.ids].sort((a, b) => pop(b) - pop(a)).slice(0, 30);
      return {
        id: `genre-${k}`,
        title: `${v.name} Mix`,
        description: `The best of ${v.name}`,
        color: MIX_COLORS[(i + 3) % MIX_COLORS.length],
        coverTrackIds: ids.slice(0, 4),
        trackIds: ids,
      };
    });
}

export interface HomeInput {
  data: RecData;
  userName: string;
  /** Shared playlists the listener saved. */
  savedPlaylists?: Record<string, number>;
}

/**
 * Shared playlists, the ones closest to what the listener plays and likes first (share of their
 * songs the listener has played or liked, weighted by taste); new listeners see the biggest ones.
 */
export function rankSharedPlaylists(data: RecData, profile: ReturnType<typeof buildProfile>, saved: Record<string, number> = {}): Playlist[] {
  const lists = data.playlists ?? [];
  const score = (p: Playlist) => {
    let s = 0;
    for (const id of p.trackIds) s += Math.max(0, profile.trackPref.get(id) ?? 0) + (data.likes[id] ? 1 : 0) + (data.taste.last[id] ? 0.5 : 0);
    return s / Math.sqrt(Math.max(1, p.trackIds.length)) + (saved[p.id] ? 2 : 0);
  };
  return [...lists].sort((a, b) => score(b) - score(a) || b.trackIds.length - a.trackIds.length);
}

export function buildHome({ data, userName, savedPlaylists }: HomeInput): HomeSection[] {
  const idx = buildIndex(data.tracks, data.artists, data.playlists);
  const sections: HomeSection[] = [];
  const mixes = buildMixes(data, 4);

  // Recently played (most recent first)
  const recent = Object.entries(data.taste.last)
    .filter(([id]) => idx.byId.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const shared = rankSharedPlaylists(data, buildProfile(data, idx), savedPlaylists);

  if (mixes.length) {
    sections.push({ id: "mixes", title: `Made for ${userName.split(" ")[0]}`, kind: "mixes", items: mixes });
  }

  if (recent.length) sections.push({ id: "recent", title: "Recently played", kind: "tracks", items: recent.slice(0, 15) });

  if (shared.length) sections.push({ id: "shared-playlists", title: "Curated playlists", kind: "playlists", items: shared.slice(0, 20).map((p) => p.id) });

  const discover = recommend(data, { mode: "discover", limit: 20 });
  if (discover.length) {
    sections.push({
      id: "discover",
      title: "Recommended for today",
      subtitle: "Picked from what you play, like and skip",
      kind: "tracks",
      items: discover.map((r) => r.id),
      reasons: Object.fromEntries(discover.map((r) => [r.id, r.reason])),
    });
  }

  // "Because you listened to X"
  const anchor = recent.find((id) => (data.taste.tracks[id] ?? 0) > 0) ?? recent[0];
  if (anchor) {
    const radio = recommend(data, { mode: "radio", seeds: [anchor], limit: 12, exclude: discover.slice(0, 6).map((d) => d.id) });
    if (radio.length >= 3) {
      sections.push({
        id: `because-${anchor}`,
        title: `Because you listened to ${idx.byId.get(anchor)!.title}`,
        kind: "tracks",
        items: radio.map((r) => r.id),
        reasons: Object.fromEntries(radio.map((r) => [r.id, r.reason])),
      });
    }
  }

  const hot = trending(data, 20);
  if (hot.length >= 3) sections.push({ id: "trending", title: "Trending now", subtitle: "Most played lately", kind: "tracks", items: hot });

  const newest = [...data.tracks].sort((a, b) => b.createdAt - a.createdAt);
  const newAlbums = uniqueBy(newest, (t) => t.album.id).slice(0, 15).map((t) => t.album.id);
  if (newAlbums.length) sections.push({ id: "new", title: "Recently added", kind: "albums", items: newAlbums });

  // Artists: personal favourites, otherwise the most played
  const profile = buildProfile(data, idx);
  const favArtists = [...profile.artistPref]
    .filter(([id, v]) => v > 0 && idx.byArtist.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const popularArtists = uniqueBy(
    trending(data, 200).flatMap((id) => idx.byId.get(id)!.artists.map((a) => a.id)),
    (x) => x,
  );
  const allArtists = [...idx.byArtist.keys()].sort((a, b) => (idx.byArtist.get(b)!.length - idx.byArtist.get(a)!.length));
  const artists = uniqueBy([...favArtists, ...popularArtists, ...allArtists], (x) => x).slice(0, 12);
  if (artists.length) {
    sections.push({ id: "artists", title: favArtists.length ? "Your favourite artists" : "Popular artists", kind: "artists", items: artists });
  }

  // Albums for you: aggregate recommendation scores per album
  const albumScores = new Map<string, number>();
  for (const r of recommend(data, { mode: "mix", limit: 60, allowKnown: true, maxPerArtist: 6, diversity: 1 })) {
    const t = idx.byId.get(r.id)!;
    albumScores.set(t.album.id, Math.max(albumScores.get(t.album.id) ?? 0, r.score));
  }
  const albumsForYou = [...albumScores].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => !newAlbums.slice(0, 6).includes(id));
  if (albumsForYou.length >= 3) sections.push({ id: "albums", title: "Albums picked for you", kind: "albums", items: albumsForYou.slice(0, 12) });

  // A genre the user likes
  const topGenre = [...profile.genrePref].filter(([k]) => idx.byGenre.has(k)).sort((a, b) => b[1] - a[1])[0];
  if (topGenre) {
    const ids = idx.byGenre.get(topGenre[0])!.filter((id) => !data.taste.last[id]);
    const name = idx.byId.get(idx.byGenre.get(topGenre[0])![0])!.genres.find((g) => genreKey(g) === topGenre[0]) ?? topGenre[0];
    if (ids.length >= 3) sections.push({ id: `genre-${topGenre[0]}`, title: `More ${name} for you`, kind: "tracks", items: ids.slice(0, 15) });
  }

  // Nothing played yet: show everything new so the feed is never empty
  if (!recent.length && !discover.length) {
    sections.push({ id: "all", title: "Fresh uploads", kind: "tracks", items: newest.slice(0, 20).map((t) => t.id) });
  }
  return sections;
}
