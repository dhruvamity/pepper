/**
 * Implicit-feedback scoring and time decay.
 *
 * Decay trick: instead of reading a score, decaying it and writing it back on every play, each
 * event adds `w * 2^((t - T0) / halfLife)`. Ranking by the stored sum is identical to ranking by
 * the decayed score, and the "current" value is `stored / 2^((now - T0) / halfLife)`. That lets
 * Firestore apply plain `increment()` writes (no reads) — important for the free tier quotas.
 */
import type { CatalogTrack, PlayEvent, PlayOutcome, PlayReport } from "../types";
import { genreKey } from "../util";

export const T0 = Date.UTC(2026, 0, 1);
export const DAY = 86_400_000;
export const TREND_HALF_LIFE = 14 * DAY;
export const TASTE_HALF_LIFE = 45 * DAY;

export function decayBoost(t: number, halfLife: number): number {
  return Math.pow(2, (t - T0) / halfLife);
}

export function decayed(stored: number, now: number, halfLife: number): number {
  return stored / decayBoost(now, halfLife);
}

/** A "stream" (counted play) needs 30s, or half of a short track. */
export const STREAM_MS = 30_000;

export function classifyPlay(r: Pick<PlayReport, "listenedMs" | "durationMs" | "endReason">): {
  outcome: PlayOutcome;
  weight: number;
} {
  const duration = Math.max(1, r.durationMs);
  const listened = Math.max(0, Math.min(r.listenedMs, duration * 1.5));
  const ratio = Math.min(1, listened / duration);
  const streamed = listened >= Math.min(STREAM_MS, duration * 0.5);

  if (ratio >= 0.8 || (r.endReason === "ended" && ratio >= 0.6)) return { outcome: "complete", weight: 1 };
  if (streamed) return { outcome: "stream", weight: Number((0.3 + 0.6 * ratio).toFixed(3)) };
  const activeSkip = r.endReason === "skip" || r.endReason === "switch";
  if (activeSkip) {
    // Skipping after 2s says more than skipping after 25s.
    const early = 1 - Math.min(1, listened / STREAM_MS);
    return { outcome: "skip", weight: Number((-0.15 - 0.55 * early).toFixed(3)) };
  }
  return { outcome: "brief", weight: 0 };
}

/** How much a transition "prev -> current" says about the two songs belonging together. */
export function transitionWeight(sourceType: PlayReport["source"]["type"], outcome: PlayOutcome): number {
  const base =
    sourceType === "radio" || sourceType === "autoplay" || sourceType === "mix"
      ? 0.4 // our own recommendations: damp the feedback loop
      : sourceType === "album"
        ? 0.6 // sequential album plays are partly forced
        : 1;
  if (outcome === "complete") return base;
  if (outcome === "stream") return base * 0.6;
  if (outcome === "skip") return -base * 0.3;
  return 0;
}

export interface PlayUpdate {
  day: string;
  hour: string;
  isStream: boolean;
  isSkip: boolean;
  isComplete: boolean;
  ms: number;
  tasteBoost: number;
  trendBoost: number;
  weight: number;
  artists: Record<string, number>;
  genres: Record<string, number>;
  cooc?: { a: string; b: string; w: number };
}

export function buildPlayUpdate(event: PlayEvent, track: CatalogTrack | undefined, prevExists: boolean): PlayUpdate {
  const isStream = event.outcome === "complete" || event.outcome === "stream";
  const tasteBoost = decayBoost(event.at, TASTE_HALF_LIFE);
  const trendBoost = isStream ? decayBoost(event.at, TREND_HALF_LIFE) : 0;
  const artists: Record<string, number> = {};
  const genres: Record<string, number> = {};
  if (track && event.weight !== 0) {
    const share = 1 / Math.sqrt(Math.max(1, track.artists.length));
    for (const a of track.artists) artists[a.id] = event.weight * share * tasteBoost;
    const gShare = 1 / Math.max(1, track.genres.length);
    for (const g of track.genres) genres[genreKey(g)] = event.weight * gShare * tasteBoost;
  }
  let cooc: PlayUpdate["cooc"];
  if (prevExists && event.prevTrackId && event.prevTrackId !== event.trackId) {
    const w = transitionWeight(event.source.type, event.outcome);
    if (w !== 0) cooc = { a: event.prevTrackId, b: event.trackId, w };
  }
  const d = new Date(event.at);
  const local = new Date(event.at - (event.tz ?? 0) * 60_000);
  return {
    day: d.toISOString().slice(0, 10),
    hour: String(local.getUTCHours()),
    isStream,
    isSkip: event.outcome === "skip",
    isComplete: event.outcome === "complete",
    ms: Math.round(Math.min(event.listenedMs, event.durationMs * 1.5)),
    tasteBoost,
    trendBoost,
    weight: event.weight,
    artists,
    genres,
    cooc,
  };
}
