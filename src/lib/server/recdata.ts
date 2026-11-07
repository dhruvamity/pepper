import { buildIndex, buildProfile, type RecData } from "@/lib/recs/engine";
import type { CatalogSnapshot, UserLibrary } from "@/lib/types";
import { repo } from "./db";

/** Load everything the recommender needs for one listener. */
export async function loadRecData(
  uid: string,
  extraSeeds: string[] = [],
): Promise<{ data: RecData; catalog: CatalogSnapshot; library: UserLibrary }> {
  const db = await repo();
  const [catalog, stats, taste, library] = await Promise.all([db.getCatalog(), db.getTrackStats(), db.getTaste(uid), db.getLibrary(uid)]);
  const base: RecData = {
    tracks: catalog.tracks,
    artists: catalog.artists,
    playlists: catalog.playlists,
    stats,
    taste,
    likes: library.likes,
    followed: library.artists,
    cooc: {},
    now: Date.now(),
  };
  // Fetch co-play rows for the seeds the profile will use (plus recent plays and explicit seeds).
  const idx = buildIndex(catalog.tracks, catalog.artists, catalog.playlists);
  const profile = buildProfile(base, idx);
  const recent = Object.entries(taste.last)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);
  const favourites = [...profile.trackPref].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
  const seeds = [...new Set([...extraSeeds, ...profile.seeds.map((s) => s.id), ...recent, ...favourites])].filter((id) => idx.byId.has(id));
  base.cooc = await db.getCooccurrence(seeds.slice(0, 30));
  return { data: base, catalog, library };
}
