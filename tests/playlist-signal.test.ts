/**
 * Shared playlists as a "these go together" signal, on a made-up library where the playlists
 * carry something the tags and audio can't see: within Hindi romantic songs, one curator's
 * "Old romance" (four singers) versus "New romance" (four others), with related artists across
 * both, so artist and genre alone can't tell them apart. "Me" is a catch-all of everything.
 */
import { describe, expect, it } from "vitest";
import { autoplay } from "@/lib/recs/autoplay";
import { buildIndex, type RecData } from "@/lib/recs/engine";
import { evaluateAutoplay } from "@/lib/recs/eval";
import { buildListTraits, playlistFocus, togetherSimilarity } from "@/lib/recs/similarity";
import { emptyTaste } from "@/lib/server/db/types";
import type { ArtistInfo, CatalogTrack, Playlist } from "@/lib/types";
import { seededRandom } from "@/lib/util";

function world(seed = 5) {
  const rand = seededRandom(seed);
  const tracks: CatalogTrack[] = [];
  const artists: Record<string, ArtistInfo> = {};
  const groups: Record<string, string[]> = {};
  const clusters = [
    { key: "romance", genre: "Bollywood", lang: "hi", energy: 0.33, bpm: 88, singers: 8 },
    { key: "party", genre: "Bollywood", lang: "hi", energy: 0.86, bpm: 126, singers: 5 },
    { key: "punjabi", genre: "Punjabi Pop", lang: "pa", energy: 0.8, bpm: 104, singers: 5 },
  ];
  let n = 0;
  for (const c of clusters) {
    const ids = Array.from({ length: c.singers }, (_, i) => `${c.key}-singer-${i}`);
    for (const id of ids) artists[id] = { id, name: id, createdAt: 0, related: ids.filter((x) => x !== id) };
    for (const [i, artistId] of ids.entries()) {
      const group = c.key === "romance" ? (i < 4 ? "old" : "new") : c.key;
      for (let k = 0; k < 5; k++) {
        const id = `t${(n++).toString(16).padStart(15, "0")}`;
        (groups[group] ??= []).push(id);
        tracks.push({
          id,
          title: `${artistId} song ${k}`,
          artists: [{ id: artistId, name: artistId }],
          album: { id: `${artistId}-${k}`, title: `${artistId} single ${k}` },
          genres: [c.genre],
          language: c.lang,
          year: 2012 + Math.floor(rand() * 10),
          durationMs: 220_000,
          hasLyrics: false,
          createdAt: 0,
          features: {
            bpm: Math.round(c.bpm * (1 + (rand() - 0.5) * 0.1)),
            energy: c.energy + (rand() - 0.5) * 0.1,
            loudness: -12,
            brightness: 0.5 + (rand() - 0.5) * 0.1,
            dynamics: 0.45,
            rhythm: c.energy,
            danceability: c.energy,
          },
        });
      }
    }
  }
  const pl = (id: string, name: string, trackIds: string[]): Playlist => ({ id, ownerUid: "pepper", ownerName: "Pepper", name, trackIds, createdAt: 0, updatedAt: 0, shared: true });
  const playlists = [
    pl("old", "Old romance", groups.old),
    pl("new", "New romance", groups.new),
    // A curator's party mix across Hindi and Punjabi.
    pl("desi", "Desi party", [...groups.party, ...groups.punjabi]),
    // A big catch-all that cuts across everything.
    pl("me", "Me", tracks.filter(() => rand() < 0.4).map((t) => t.id)),
  ];
  const data: RecData = { tracks, artists, playlists, stats: {}, taste: emptyTaste(), likes: {}, followed: {}, cooc: {}, now: Date.UTC(2026, 10, 1) };
  return { data, groups };
}

describe("shared playlists signal", () => {
  it("scores songs in the same playlist high, overlapping playlists partly, others zero", () => {
    const lists = buildListTraits(
      [
        { id: "a", trackIds: ["1", "2", "3", "4"] },
        { id: "b", trackIds: ["3", "4", "5", "6"] },
        { id: "c", trackIds: ["7", "8"] },
      ],
      () => true,
    );
    const sim = (x: string, y: string) => togetherSimilarity(lists.get(x), lists.get(y));
    expect(sim("1", "2")).toBeCloseTo(1);
    expect(sim("1", "5")!).toBeGreaterThan(0.2);
    expect(sim("1", "5")!).toBeLessThan(0.6);
    expect(sim("1", "7")).toBe(0);
    expect(togetherSimilarity(lists.get("1"), undefined)).toBeNull();
    expect(playlistFocus(25)).toBe(1);
    expect(playlistFocus(240)).toBe(0.5);
  });

  it("keeps autoplay from a searched song inside its playlist's vibe", () => {
    const { data, groups } = world();
    const start = groups.old[0];
    const share = (withLists: boolean) => {
      const picks = autoplay({ ...data, playlists: withLists ? data.playlists : undefined }, { recent: [start], skipped: [], anchor: [], exclude: [], limit: 8 });
      return picks.filter((p) => groups.old.includes(p.id)).length / picks.length;
    };
    expect(share(true)).toBeGreaterThanOrEqual(0.75);
    expect(share(true)).toBeGreaterThan(share(false) + 0.2);
  });

  it("follows a curator's mix across languages without leaving the party", () => {
    const { data, groups } = world();
    const picks = autoplay(data, { recent: [groups.party[0]], skipped: [], anchor: [], exclude: [], limit: 10 });
    const party = new Set([...groups.party, ...groups.punjabi]);
    expect(picks.every((p) => party.has(p.id))).toBe(true);
  });

  it("never queues another version of a song from this session", () => {
    const { data, groups } = world();
    const start = data.tracks.find((t) => t.id === groups.old[0])!;
    const reprise: CatalogTrack = { ...start, id: "t" + "f".repeat(15), title: `${start.title} (Reprise)`, album: { id: "reprise", title: "Reprise" } };
    const d: RecData = { ...data, tracks: [...data.tracks, reprise], playlists: data.playlists!.map((p) => (p.id === "old" ? { ...p, trackIds: [...p.trackIds, reprise.id] } : p)) };
    expect(buildIndex(d.tracks, d.artists, d.playlists).vecs.get(reprise.id)!.key).toBe(buildIndex(d.tracks, d.artists, d.playlists).vecs.get(start.id)!.key);
    const picks = autoplay(d, { recent: [start.id], skipped: [], anchor: [], exclude: [], limit: 15 });
    expect(picks.map((p) => p.id)).not.toContain(reprise.id);
  });

  it("finds held-out playlist songs far better than chance", () => {
    const { data } = world();
    const r = evaluateAutoplay(data, { k: 10, splits: 2, seedsPerSplit: 3 });
    expect(r.playlists).toBe(4);
    expect(r.withPlaylists.found).toBeGreaterThan(r.random.found * 1.5);
    expect(r.withPlaylists.samePlaylist).toBeGreaterThan(r.random.samePlaylist);
    expect(r.withPlaylists.sameLanguage).toBeGreaterThan(0.8);
  });
});
