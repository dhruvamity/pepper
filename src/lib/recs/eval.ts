/**
 * How well autoplay continues from one song, measured on the shared playlists (pure functions).
 *
 *  - Finds hidden songs: hide a quarter of a playlist, start autoplay from one of the other songs
 *    (as if picked from search) with the rest of the playlist already played, and count how many
 *    hidden songs come up in the next k. Hidden songs can only be found through how they sound,
 *    who sings them, their genre, language and era — and other playlists they're in. This is the
 *    playlist-continuation test used for playlist recommenders (e.g. RecSys Challenge 2018).
 *  - Stays with the playlist: share of the next k songs that share a playlist with the start song.
 *  - Same language: share of the next k songs in the start song's language.
 * Each is reported with and without the playlist signal, plus what random picks would score.
 */
import type { CatalogTrack, Playlist } from "../types";
import { seededRandom } from "../util";
import { autoplay } from "./autoplay";
import { buildIndex, type RecData } from "./engine";

export interface EvalResult {
  runs: number;
  /** Share of hidden songs found in the next k (recall@k), averaged over runs. */
  found: number;
  /** Share of the next k that share a playlist with the start song. */
  samePlaylist: number;
  /** Share of the next k in the start song's language (songs with a known language only). */
  sameLanguage: number;
}

export interface EvalReport {
  k: number;
  playlists: number;
  withPlaylists: EvalResult;
  withoutPlaylists: EvalResult;
  random: { found: number; samePlaylist: number };
}

export function evaluateAutoplay(data: RecData, opts: { k?: number; splits?: number; seedsPerSplit?: number; seed?: number } = {}): EvalReport {
  const k = opts.k ?? 10;
  const splits = opts.splits ?? 3;
  const seedsPerSplit = opts.seedsPerSplit ?? 4;
  const rand = seededRandom(opts.seed ?? 11);
  const known = new Map(data.tracks.map((t) => [t.id, t]));
  const lists = (data.playlists ?? []).map((p) => ({ ...p, trackIds: [...new Set(p.trackIds.filter((id) => known.has(id)))] })).filter((p) => p.trackIds.length >= 8);
  const memberOf = new Map<string, Set<string>>();
  for (const p of lists) for (const id of p.trackIds) memberOf.set(id, new Set([...(memberOf.get(id) ?? []), p.id]));
  const idx = buildIndex(data.tracks, data.artists);
  const langOf = (t: CatalogTrack) => idx.vecs.get(t.id)?.lang;

  const acc = {
    with: { runs: 0, found: 0, samePlaylist: 0, sameLanguage: 0, langRuns: 0 },
    without: { runs: 0, found: 0, samePlaylist: 0, sameLanguage: 0, langRuns: 0 },
  };
  let randomFound = 0;
  let randomSame = 0;
  let randomRuns = 0;
  const shuffle = <T>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  for (const p of lists) {
    for (let s = 0; s < splits; s++) {
      const order = shuffle(p.trackIds);
      const hidden = new Set(order.slice(0, Math.max(1, Math.round(order.length * 0.25))));
      const visible = order.filter((id) => !hidden.has(id));
      const reduced: Playlist[] = (data.playlists ?? []).map((x) => (x.id === p.id ? { ...x, trackIds: visible } : x));
      for (const start of visible.slice(0, seedsPerSplit)) {
        const exclude = visible.filter((id) => id !== start);
        const candidates = data.tracks.length - exclude.length - 1;
        const startTrack = known.get(start)!;
        const startLists = memberOf.get(start) ?? new Set();
        for (const mode of ["with", "without"] as const) {
          const picks = autoplay({ ...data, playlists: mode === "with" ? reduced : undefined }, { recent: [start], skipped: [], anchor: [], exclude, limit: k }).map((x) => x.id);
          const a = acc[mode];
          a.runs++;
          a.found += picks.filter((id) => hidden.has(id)).length / Math.min(k, hidden.size);
          a.samePlaylist += picks.filter((id) => [...(memberOf.get(id) ?? [])].some((l) => startLists.has(l))).length / Math.max(1, picks.length);
          const lang = langOf(startTrack);
          if (lang) {
            const withLang = picks.map((id) => langOf(known.get(id)!)).filter(Boolean);
            if (withLang.length) {
              a.sameLanguage += withLang.filter((l) => l === lang || (l === "ur" && lang === "hi") || (l === "hi" && lang === "ur")).length / withLang.length;
              a.langRuns++;
            }
          }
        }
        randomRuns++;
        randomFound += Math.min(1, (k * hidden.size) / Math.max(1, candidates) / Math.min(k, hidden.size));
        const inLists = data.tracks.filter((t) => t.id !== start && !exclude.includes(t.id) && [...(memberOf.get(t.id) ?? [])].some((l) => startLists.has(l))).length;
        randomSame += inLists / Math.max(1, candidates);
      }
    }
  }
  const done = (a: (typeof acc)["with"]): EvalResult => ({
    runs: a.runs,
    found: a.runs ? a.found / a.runs : 0,
    samePlaylist: a.runs ? a.samePlaylist / a.runs : 0,
    sameLanguage: a.langRuns ? a.sameLanguage / a.langRuns : 0,
  });
  return {
    k,
    playlists: lists.length,
    withPlaylists: done(acc.with),
    withoutPlaylists: done(acc.without),
    random: { found: randomRuns ? randomFound / randomRuns : 0, samePlaylist: randomRuns ? randomSame / randomRuns : 0 },
  };
}
