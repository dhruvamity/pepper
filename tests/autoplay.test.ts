/**
 * Autoplay on a made-up library with known structure: eight clusters (Hindi romantic, Hindi
 * party, Sufi, Punjabi pop, Punjabi sad, English pop, English hip-hop, Tamil), four artists
 * each, related artists within a cluster, and a third of the songs missing their genre and
 * language tags (as with real files). Checks that autoplay keeps the language and genre, follows
 * skips, spaces out artists and keeps tempo/energy changes smooth.
 */
import { describe, expect, it } from "vitest";
import { autoplay, sessionLanguage } from "@/lib/recs/autoplay";
import { buildIndex, type RecData } from "@/lib/recs/engine";
import { canonicalGenres, familiesOf } from "@/lib/recs/genres";
import { emptyTaste } from "@/lib/server/db/types";
import type { ArtistInfo, AudioFeatures, CatalogTrack } from "@/lib/types";
import { seededRandom } from "@/lib/util";

interface Cluster {
  key: string;
  genre: string;
  lang: string;
  bpm: number;
  energy: number;
  dance: number;
  bright: number;
}

const CLUSTERS: Cluster[] = [
  { key: "hi-romantic", genre: "Bollywood", lang: "hi", bpm: 86, energy: 0.32, dance: 0.38, bright: 0.35 },
  { key: "hi-party", genre: "Bollywood", lang: "hi", bpm: 128, energy: 0.88, dance: 0.86, bright: 0.7 },
  { key: "sufi", genre: "Sufi", lang: "ur", bpm: 100, energy: 0.55, dance: 0.45, bright: 0.45 },
  { key: "pa-pop", genre: "Punjabi Pop", lang: "pa", bpm: 104, energy: 0.78, dance: 0.82, bright: 0.65 },
  { key: "pa-sad", genre: "Punjabi", lang: "pa", bpm: 82, energy: 0.34, dance: 0.4, bright: 0.38 },
  { key: "en-pop", genre: "Pop", lang: "en", bpm: 116, energy: 0.7, dance: 0.72, bright: 0.68 },
  { key: "en-hiphop", genre: "Hip-Hop/Rap", lang: "en", bpm: 92, energy: 0.74, dance: 0.78, bright: 0.5 },
  { key: "ta-kuthu", genre: "Tamil", lang: "ta", bpm: 132, energy: 0.92, dance: 0.9, bright: 0.72 },
];

function world(seed = 7) {
  const rand = seededRandom(seed);
  const jitter = (v: number, d: number) => Math.min(1, Math.max(0, v + (rand() - 0.5) * 2 * d));
  const tracks: CatalogTrack[] = [];
  const artists: Record<string, ArtistInfo> = {};
  const clusterOf = new Map<string, Cluster>();
  let n = 0;
  for (const c of CLUSTERS) {
    const ids = [0, 1, 2, 3].map((i) => `${c.key}-artist-${i}`);
    for (const id of ids) artists[id] = { id, name: id, createdAt: 0, related: ids.filter((x) => x !== id && rand() < 0.7) };
    for (const artistId of ids) {
      for (let k = 0; k < 4; k++) {
        const id = `t${(n++).toString(16).padStart(15, "0")}`;
        const untagged = rand() < 0.33;
        const features: AudioFeatures = {
          bpm: Math.round(c.bpm * (1 + (rand() - 0.5) * 0.08)),
          energy: jitter(c.energy, 0.07),
          loudness: -12 + c.energy * 6,
          brightness: jitter(c.bright, 0.07),
          dynamics: jitter(0.45, 0.08),
          rhythm: jitter(c.dance, 0.08),
          danceability: jitter(c.dance, 0.07),
        };
        tracks.push({
          id,
          title: `${artistId} song ${k}`,
          artists: [{ id: artistId, name: artistId }],
          album: { id: `${artistId}-album`, title: `${artistId} album` },
          genres: untagged ? [] : [c.genre],
          language: untagged ? undefined : c.lang,
          year: 2015 + Math.floor(rand() * 8),
          durationMs: 200_000,
          hasLyrics: false,
          features,
          createdAt: 0,
        });
        clusterOf.set(id, c);
      }
    }
  }
  const data: RecData = { tracks, artists, stats: {}, taste: emptyTaste(), likes: {}, followed: {}, cooc: {}, now: Date.UTC(2026, 10, 1) };
  return { data, clusterOf };
}

const sameLang = (a: string, b: string) => a === b || (["hi", "ur"].includes(a) && ["hi", "ur"].includes(b));

describe("autoplay", () => {
  const { data, clusterOf } = world();
  const c = (id: string) => clusterOf.get(id)!;
  const fam = (id: string) => [...familiesOf(canonicalGenres([c(id).genre]))][0];

  it("stays in the seed's language and genre family, even for untagged songs", () => {
    let langOk = 0;
    let famOk = 0;
    let vibeOk = 0;
    let total = 0;
    let untaggedLangOk = 0;
    let untaggedTotal = 0;
    for (const seed of data.tracks) {
      const items = autoplay(data, { recent: [seed.id], skipped: [], anchor: [seed.id], exclude: [], limit: 10 });
      expect(items.length).toBe(10);
      for (const it of items) {
        total++;
        if (sameLang(c(it.id).lang, c(seed.id).lang)) langOk++;
        if (fam(it.id) === fam(seed.id)) famOk++;
        if (c(it.id).key === c(seed.id).key) vibeOk++;
        if (!seed.language) {
          untaggedTotal++;
          if (sameLang(c(it.id).lang, c(seed.id).lang)) untaggedLangOk++;
        }
      }
    }
    const langRate = langOk / total;
    const famRate = famOk / total;
    const vibeRate = vibeOk / total;
    console.log(
      `autoplay over ${data.tracks.length} seeds: same language ${(langRate * 100).toFixed(1)}%, same genre family ${(famRate * 100).toFixed(1)}%, same mood cluster ${(vibeRate * 100).toFixed(1)}%, untagged seeds same language ${((untaggedLangOk / untaggedTotal) * 100).toFixed(1)}%`,
    );
    expect(langRate).toBeGreaterThan(0.95);
    expect(famRate).toBeGreaterThan(0.85);
    expect(vibeRate).toBeGreaterThan(0.6);
    expect(untaggedLangOk / untaggedTotal).toBeGreaterThan(0.9);
  });

  it("moves away from what the listener skips", () => {
    const romantic = data.tracks.filter((t) => c(t.id).key === "hi-romantic");
    let before = 0;
    let after = 0;
    for (const seed of romantic) {
      const first = autoplay(data, { recent: [seed.id], skipped: [], anchor: [seed.id], exclude: [], limit: 10 });
      const party = first.filter((i) => c(i.id).key === "hi-party").map((i) => i.id);
      before += party.length;
      // The listener skips the first two upbeat songs autoplay offered (or two from the library).
      const skipped = (party.length >= 2 ? party : data.tracks.filter((t) => c(t.id).key === "hi-party").map((t) => t.id)).slice(0, 2);
      const second = autoplay(data, { recent: [seed.id], skipped, anchor: [seed.id], exclude: first.map((i) => i.id), limit: 10 });
      after += second.filter((i) => c(i.id).key === "hi-party").length;
    }
    console.log(`party songs offered after a romantic song: ${before} before skips, ${after} after skipping two`);
    expect(after).toBeLessThan(before * 0.5 + 1);
  });

  it("never plays an artist twice in a row, nor more than twice per batch", () => {
    for (const seed of data.tracks.slice(0, 40)) {
      const items = autoplay(data, { recent: [seed.id], skipped: [], anchor: [seed.id], exclude: [], limit: 12 });
      const artistOf = (id: string) => data.tracks.find((t) => t.id === id)!.artists[0].id;
      const counts = new Map<string, number>();
      items.forEach((it, i) => {
        if (i > 0) expect(artistOf(it.id)).not.toBe(artistOf(items[i - 1].id));
        counts.set(artistOf(it.id), (counts.get(artistOf(it.id)) ?? 0) + 1);
      });
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    }
  });

  it("orders songs so energy changes gradually", () => {
    const idx = buildIndex(data.tracks, data.artists);
    const energy = (id: string) => idx.byId.get(id)!.features!.energy;
    const rand = seededRandom(3);
    let ordered = 0;
    let shuffled = 0;
    for (const seed of data.tracks) {
      const ids = autoplay(data, { recent: [seed.id], skipped: [], anchor: [seed.id], exclude: [], limit: 10 }).map((i) => i.id);
      const steps = (list: string[]) => [seed.id, ...list].slice(1).reduce((s, id, i) => s + Math.abs(energy(id) - energy([seed.id, ...list][i])), 0);
      ordered += steps(ids);
      shuffled += steps([...ids].sort(() => rand() - 0.5));
    }
    console.log(`mean energy jump between songs: ${(ordered / data.tracks.length / 10).toFixed(3)} in autoplay order vs ${(shuffled / data.tracks.length / 10).toFixed(3)} shuffled`);
    expect(ordered).toBeLessThan(shuffled);
  });

  it("follows the session: recent songs outweigh the starting album", () => {
    const start = data.tracks.find((t) => c(t.id).key === "hi-romantic")!;
    const lately = data.tracks.filter((t) => c(t.id).key === "pa-pop").slice(0, 3).map((t) => t.id);
    const items = autoplay(data, { recent: [...lately].reverse(), skipped: [], anchor: [start.id], exclude: [], limit: 10 });
    const punjabi = items.filter((i) => c(i.id).lang === "pa").length;
    expect(punjabi).toBeGreaterThanOrEqual(7);
  });

  it("never repeats a played, queued or skipped song", () => {
    const seed = data.tracks[5].id;
    const exclude = data.tracks.slice(10, 40).map((t) => t.id);
    const skipped = [data.tracks[6].id];
    const items = autoplay(data, { recent: [seed], skipped, anchor: [data.tracks[4].id], exclude, limit: 25 });
    const banned = new Set([seed, ...exclude, ...skipped, data.tracks[4].id]);
    expect(items.some((i) => banned.has(i.id))).toBe(false);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("still plays something with no session to go on", () => {
    expect(autoplay(data, { recent: [], skipped: [], anchor: [], exclude: [], limit: 10 }).length).toBe(10);
  });

  it("works out the session language from what was played", () => {
    const idx = buildIndex(data.tracks, data.artists);
    const v = (key: string) => idx.vecs.get(data.tracks.find((t) => c(t.id).key === key && t.language)!.id)!;
    expect(sessionLanguage([{ vec: v("hi-romantic"), w: 1 }, { vec: v("sufi"), w: 0.8 }])).toBe("hi");
    expect(sessionLanguage([{ vec: v("hi-romantic"), w: 1 }, { vec: v("en-pop"), w: 1 }])).toBeUndefined();
  });
});
