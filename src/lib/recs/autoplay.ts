/**
 * Autoplay: what plays when the album, playlist or queue runs out.
 *
 * Modelled on how streaming services keep a session going (song radio / autoplay):
 *  - The session drives it. Songs the listener let play are the seeds, most recent first; the
 *    album/playlist they started from stays as a weaker "anchor" so a long session doesn't drift
 *    far from where it began. Recent context predicts the next song better than long-term taste.
 *  - Skips steer it. Songs skipped early count against anything similar to them.
 *  - It stays in the session's language when the listener has stuck to one.
 *  - Candidates come from the hybrid recommender (co-listening + genre/artist/audio similarity).
 *  - Order matters: no artist twice in a row, at most two songs per artist per batch, and tempo
 *    and energy change gradually from one song to the next.
 *  - One version of a song per session: after "Tum Hi Ho" it won't queue "Tum Hi Ho (Reprise)".
 *  - Shared playlists count as "these go together" evidence (see similarity.ts), so a song
 *    started from search continues with songs people put in the same playlists.
 */
import { languageSimilarity } from "../metadata/language";
import type { RecItem } from "../types";
import { buildIndex, recommend, type RecData } from "./engine";
import { audioSimilarity, contentSimilarity, redundancy, type TrackVec } from "./similarity";

export interface AutoplayOptions {
  /** Songs the listener let play this session, most recent first. */
  recent: string[];
  /** Songs the listener skipped early this session, most recent first. */
  skipped: string[];
  /** The album / playlist / song the session started from. */
  anchor: string[];
  /** Already played or queued. */
  exclude: Iterable<string>;
  limit: number;
}

/** The session's language, if the listener has mostly stuck to one. */
export function sessionLanguage(vecs: { vec: TrackVec; w: number }[]): string | undefined {
  const weights = new Map<string, number>();
  let total = 0;
  for (const { vec, w } of vecs) {
    if (!vec.lang) continue;
    const key = vec.lang === "ur" ? "hi" : vec.lang;
    weights.set(key, (weights.get(key) ?? 0) + w);
    total += w;
  }
  for (const [lang, w] of weights) if (w >= total * 0.65) return lang;
  return undefined;
}

export function autoplay(data: RecData, o: AutoplayOptions): RecItem[] {
  const idx = buildIndex(data.tracks, data.artists, data.playlists);
  const known = (id: string) => idx.byId.has(id);
  const recent = [...new Set(o.recent)].filter(known).slice(0, 6);
  const skipped = [...new Set(o.skipped)].filter((id) => known(id) && !recent.includes(id)).slice(0, 6);
  const anchor = [...new Set(o.anchor)].filter((id) => known(id) && !recent.includes(id) && !skipped.includes(id)).slice(-5);
  const exclude = new Set([...o.exclude, ...recent, ...skipped, ...anchor]);
  // Versions of songs already played this session (or coming up) are out too.
  const usedKeys = new Set<string>();
  for (const id of exclude) {
    const key = idx.vecs.get(id)?.key;
    if (key) usedKeys.add(key);
  }

  // Candidates and their relevance from the hybrid recommender, seeded by the session.
  const seeds = [...recent, ...anchor];
  const pool = recommend(data, {
    mode: "radio",
    seeds: seeds.length ? seeds : undefined,
    exclude,
    limit: Math.max(o.limit * 4, 40),
    diversity: 1, // ranking only: ordering happens below
    maxPerArtist: 1000,
  });
  if (!pool.length) return [];

  const lang = sessionLanguage([
    ...recent.map((id, i) => ({ vec: idx.vecs.get(id)!, w: 0.8 ** i })),
    ...anchor.map((id) => ({ vec: idx.vecs.get(id)!, w: 0.3 })),
  ]);
  const negatives = skipped.map((id, i) => ({ vec: idx.vecs.get(id)!, w: 0.75 ** i }));

  const scored = pool.map((item) => {
    const vec = idx.vecs.get(item.id)!;
    let s = item.score;
    if (lang) {
      const ls = languageSimilarity(lang, vec.lang);
      s *= ls === null ? 0.8 : 0.3 + 0.7 * ls;
    }
    // Several skips of the same kind of song say more than one: combine them like probabilities.
    let keep = 1;
    for (const n of negatives) keep *= 1 - n.w * contentSimilarity(n.vec, vec);
    s *= 1 - 0.7 * (1 - keep);
    return { item, vec, s };
  });
  scored.sort((a, b) => b.s - a.s);
  // Keep the best-ranked version when the pool has several of one song.
  const pool2 = scored.filter((c) => {
    if (usedKeys.has(c.vec.key)) return false;
    usedKeys.add(c.vec.key);
    return true;
  });
  if (!pool2.length) return [];

  // Sequence for flow, starting from the song that just played.
  const top = pool2[0].s || 1;
  let prev: TrackVec | undefined = idx.vecs.get(recent[0] ?? anchor[anchor.length - 1] ?? "");
  const remaining = pool2.slice(0, o.limit * 3);
  const out: typeof scored = [];
  const perArtist = new Map<string, number>();
  while (out.length < o.limit && remaining.length) {
    let bestI = 0;
    let best = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const flow = prev ? (audioSimilarity(prev.track.features, c.vec.track.features) ?? 0.6) : 0.6;
      const sameAsPrev = prev ? [...c.vec.artists].some((a) => prev!.artists.has(a)) : false;
      const capped = [...c.vec.artists].some((a) => (perArtist.get(a) ?? 0) >= 2);
      let red = 0;
      for (const p of out.slice(-4)) red = Math.max(red, redundancy(p.vec, c.vec));
      const v = (c.s / top) * (0.75 + 0.25 * flow) - 0.15 * red - (sameAsPrev ? 0.5 : 0) - (capped ? 1 : 0);
      if (v > best) {
        best = v;
        bestI = i;
      }
    }
    const [chosen] = remaining.splice(bestI, 1);
    out.push(chosen);
    for (const a of chosen.vec.artists) perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    prev = chosen.vec;
  }
  return out.map((c) => ({ ...c.item, score: Number(c.s.toFixed(4)) }));
}
