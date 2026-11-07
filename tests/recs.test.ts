/**
 * Offline accuracy test for the recommender on a synthetic world with known structure:
 * listeners have favourite genres/artists, play in sessions, finish songs they like and skip
 * songs they don't. We train on the first 80% of each listener's history and check whether the
 * recommender predicts the *new* songs they go on to finish (hit-rate@10, recall@20) against
 * popularity and random baselines.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildPlayUpdate, classifyPlay } from "@/lib/analytics/score";
import { recommend, trending, type RecData } from "@/lib/recs/engine";
import { buildMixes } from "@/lib/recs/home";
import { LocalRepo } from "@/lib/server/db/local";
import type { AudioFeatures, CatalogTrack, PlayEvent, PlaySourceType } from "@/lib/types";
import { seededRandom } from "@/lib/util";

const GENRES = ["Modern Bollywood", "Punjabi Pop", "Indie Rock", "Hip-Hop", "Lo-Fi", "Classical"];
const CENTERS: AudioFeatures[] = [
  { bpm: 96, energy: 0.55, loudness: -11, brightness: 0.45, dynamics: 0.5, rhythm: 0.45, danceability: 0.55 },
  { bpm: 128, energy: 0.85, loudness: -7, brightness: 0.65, dynamics: 0.3, rhythm: 0.75, danceability: 0.85 },
  { bpm: 140, energy: 0.8, loudness: -8, brightness: 0.75, dynamics: 0.45, rhythm: 0.6, danceability: 0.45 },
  { bpm: 90, energy: 0.7, loudness: -8, brightness: 0.5, dynamics: 0.35, rhythm: 0.8, danceability: 0.8 },
  { bpm: 80, energy: 0.3, loudness: -16, brightness: 0.3, dynamics: 0.6, rhythm: 0.35, danceability: 0.5 },
  { bpm: 70, energy: 0.2, loudness: -20, brightness: 0.35, dynamics: 0.85, rhythm: 0.2, danceability: 0.15 },
];

const DAY = 86_400_000;
const START = Date.UTC(2026, 5, 1);
const SPLIT = START + 40 * DAY;
const dirs: string[] = [];
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 400)); // let debounced saves finish
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function world(seed = 7) {
  const rand = seededRandom(seed);
  const jitter = (v: number, s: number) => Math.min(1, Math.max(0, v + (rand() - 0.5) * s));
  const tracks: CatalogTrack[] = [];
  GENRES.forEach((genre, gi) => {
    for (let a = 0; a < 8; a++) {
      const artist = { id: `g${gi}-a${a}`, name: `${genre} Artist ${a}` };
      for (let k = 0; k < 6; k++) {
        const c = CENTERS[gi];
        tracks.push({
          id: `g${gi}a${a}t${k}`,
          title: `${genre} ${a}.${k}`,
          artists: [artist],
          album: { id: `g${gi}a${a}-album`, title: `Album ${gi}.${a}` },
          genres: [genre],
          year: 2015 + Math.floor(rand() * 10),
          durationMs: 200_000,
          hasLyrics: false,
          createdAt: START - 60 * DAY,
          features: {
            bpm: Math.round((c.bpm ?? 100) * (1 + (rand() - 0.5) * 0.12)),
            energy: jitter(c.energy, 0.16),
            loudness: c.loudness + (rand() - 0.5) * 3,
            brightness: jitter(c.brightness, 0.16),
            dynamics: jitter(c.dynamics, 0.16),
            rhythm: jitter(c.rhythm, 0.16),
            danceability: jitter(c.danceability, 0.16),
          },
        });
      }
    }
  });

  // Listeners: 1-2 favourite genres, 3 favourite artists in them, a few personal "anthems".
  const users = Array.from({ length: 60 }, (_, u) => {
    const g1 = Math.floor(rand() * GENRES.length);
    const g2 = rand() < 0.5 ? (g1 + 1 + Math.floor(rand() * (GENRES.length - 1))) % GENRES.length : -1;
    const favGenres = g2 >= 0 ? [g1, g2] : [g1];
    const favArtists = new Set(
      Array.from({ length: 3 }, () => `g${favGenres[Math.floor(rand() * favGenres.length)]}-a${Math.floor(rand() * 8)}`),
    );
    return { uid: `u${u}`, favGenres, favArtists };
  });

  const affinity = (user: (typeof users)[number], t: CatalogTrack) => {
    const gi = GENRES.indexOf(t.genres[0]);
    let p = user.favGenres.includes(gi) ? 1 : 0.04;
    if (user.favArtists.has(t.artists[0].id)) p *= 3;
    return p;
  };

  const events: PlayEvent[] = [];
  for (const user of users) {
    const weights = tracks.map((t) => affinity(user, t));
    const total = weights.reduce((a, b) => a + b, 0);
    const sessions = 14 + Math.floor(rand() * 8);
    for (let s = 0; s < sessions; s++) {
      let at = START + (s / sessions) * 55 * DAY + rand() * DAY * 0.5;
      let prev: string | undefined;
      const len = 6 + Math.floor(rand() * 8);
      for (let i = 0; i < len; i++) {
        // 85% taste-driven, 15% exploration
        let t: CatalogTrack;
        if (rand() < 0.85) {
          let r = rand() * total;
          let k = 0;
          while (r > weights[k]) r -= weights[k++];
          t = tracks[Math.min(k, tracks.length - 1)];
        } else t = tracks[Math.floor(rand() * tracks.length)];
        const likes = affinity(user, t) >= 1;
        const listenedMs = likes ? (rand() < 0.85 ? 200_000 : 120_000) : 3_000 + rand() * 15_000;
        const endReason = likes ? "ended" : "skip";
        const { outcome, weight } = classifyPlay({ listenedMs, durationMs: 200_000, endReason });
        events.push({
          id: `${user.uid}-${s}-${i}`,
          uid: user.uid,
          trackId: t.id,
          startedAt: at,
          at,
          listenedMs,
          durationMs: 200_000,
          endReason,
          source: { type: "search" as PlaySourceType },
          prevTrackId: prev,
          sessionId: `${user.uid}-${s}`,
          outcome,
          weight,
        });
        prev = outcome === "skip" ? prev : t.id;
        at += listenedMs + 1000;
      }
    }
  }
  return { tracks, users, events, rand };
}

async function train(tracks: CatalogTrack[], events: PlayEvent[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "pepper-recs-"));
  dirs.push(dir);
  const repo = new LocalRepo(dir);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  for (const e of events) await repo.recordPlay(e, buildPlayUpdate(e, byId.get(e.trackId), Boolean(e.prevTrackId)));
  return repo;
}

describe("recommender accuracy (synthetic listeners)", () => {
  it("beats popularity and random baselines on held-out discoveries", async () => {
    const { tracks, users, events, rand } = world();
    const trainEvents = events.filter((e) => e.at < SPLIT);
    const testEvents = events.filter((e) => e.at >= SPLIT);
    const repo = await train(tracks, trainEvents);
    const stats = await repo.getTrackStats();
    const allCooc = await repo.getCooccurrence(tracks.map((t) => t.id));

    let users_ = 0;
    const hits = { hybrid: 0, popular: 0, random: 0 };
    const recall = { hybrid: 0, popular: 0, random: 0 };
    for (const u of users) {
      const taste = await repo.getTaste(u.uid);
      const heard = new Set(Object.keys(taste.last));
      const truth = new Set(
        testEvents.filter((e) => e.uid === u.uid && e.outcome === "complete" && !heard.has(e.trackId)).map((e) => e.trackId),
      );
      if (!truth.size) continue;
      users_++;
      const data: RecData = { tracks, stats, taste, likes: {}, followed: {}, cooc: allCooc, now: SPLIT };
      const hybrid = recommend(data, { mode: "discover", limit: 20 }).map((r) => r.id);
      const popular = trending(data, 400).filter((id) => !heard.has(id)).slice(0, 20);
      const unheard = tracks.map((t) => t.id).filter((id) => !heard.has(id));
      const random = Array.from({ length: 20 }, () => unheard[Math.floor(rand() * unheard.length)]);
      for (const [name, list] of Object.entries({ hybrid, popular, random }) as [keyof typeof hits, string[]][]) {
        if (list.slice(0, 10).some((id) => truth.has(id))) hits[name]++;
        recall[name] += list.filter((id) => truth.has(id)).length / Math.min(truth.size, 20);
      }
    }
    const hr = (k: keyof typeof hits) => hits[k] / users_;
    const rc = (k: keyof typeof hits) => recall[k] / users_;
    console.log(
      `users=${users_}  HR@10 hybrid=${hr("hybrid").toFixed(2)} popular=${hr("popular").toFixed(2)} random=${hr("random").toFixed(2)}  ` +
        `Recall@20 hybrid=${rc("hybrid").toFixed(2)} popular=${rc("popular").toFixed(2)} random=${rc("random").toFixed(2)}`,
    );
    expect(users_).toBeGreaterThan(30);
    expect(hr("hybrid")).toBeGreaterThan(0.8);
    expect(hr("hybrid")).toBeGreaterThan(hr("popular") + 0.15);
    expect(rc("hybrid")).toBeGreaterThan(rc("popular") * 1.5);
    expect(rc("hybrid")).toBeGreaterThan(rc("random") * 2);
  });

  it("keeps recommendations inside a listener's taste and diverse across artists", async () => {
    const { tracks, users, events } = world(11);
    const repo = await train(tracks, events);
    const stats = await repo.getTrackStats();
    const cooc = await repo.getCooccurrence(tracks.map((t) => t.id));
    let inTaste = 0;
    let total = 0;
    for (const u of users.slice(0, 20)) {
      const taste = await repo.getTaste(u.uid);
      const recs = recommend({ tracks, stats, taste, likes: {}, followed: {}, cooc, now: START + 60 * DAY }, { mode: "discover", limit: 10 });
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const artists = new Map<string, number>();
      for (const r of recs) {
        const t = byId.get(r.id)!;
        total++;
        if (u.favGenres.includes(GENRES.indexOf(t.genres[0]))) inTaste++;
        artists.set(t.artists[0].id, (artists.get(t.artists[0].id) ?? 0) + 1);
        expect(r.reason.length).toBeGreaterThan(3);
      }
      expect(Math.max(...artists.values())).toBeLessThanOrEqual(2);
    }
    expect(inTaste / total).toBeGreaterThan(0.85);
  });

  it("radio follows the seed's vibe and cold start falls back to popularity", async () => {
    const { tracks, events } = world(3);
    const repo = await train(tracks, events);
    const stats = await repo.getTrackStats();
    const cooc = await repo.getCooccurrence(tracks.map((t) => t.id));
    const empty = await repo.getTaste("nobody");
    const data: RecData = { tracks, stats, taste: empty, likes: {}, followed: {}, cooc, now: START + 60 * DAY };
    const seed = tracks.find((t) => t.genres[0] === "Classical")!;
    const radio = recommend(data, { mode: "radio", seeds: [seed.id], limit: 15 });
    const sameGenre = radio.filter((r) => r.id.startsWith("g5")).length;
    expect(sameGenre / radio.length).toBeGreaterThan(0.8);
    expect(radio.some((r) => r.id === seed.id)).toBe(false);

    const cold = recommend(data, { mode: "discover", limit: 10 });
    const top = new Set(trending(data, 30));
    expect(cold.filter((r) => top.has(r.id)).length).toBeGreaterThanOrEqual(6);
  });

  it("builds genre-coherent daily mixes", async () => {
    const { tracks, users, events } = world(5);
    const repo = await train(tracks, events);
    const stats = await repo.getTrackStats();
    const u = users.find((x) => x.favGenres.length === 2)!;
    const taste = await repo.getTaste(u.uid);
    const cooc = await repo.getCooccurrence(Object.keys(taste.tracks));
    const mixes = buildMixes({ tracks, stats, taste, likes: {}, followed: {}, cooc, now: START + 60 * DAY });
    expect(mixes.length).toBeGreaterThanOrEqual(1);
    const byId = new Map(tracks.map((t) => [t.id, t]));
    for (const m of mixes) {
      expect(m.trackIds.length).toBeGreaterThanOrEqual(10);
      const genres = new Map<string, number>();
      for (const id of m.trackIds) genres.set(byId.get(id)!.genres[0], (genres.get(byId.get(id)!.genres[0]) ?? 0) + 1);
      const dominant = Math.max(...genres.values()) / m.trackIds.length;
      expect(dominant).toBeGreaterThan(0.6);
    }
  });
});
