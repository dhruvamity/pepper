"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PlaySourceType } from "@/lib/types";
import { shuffleInPlace } from "@/lib/util";

export interface PlayContext {
  type: PlaySourceType;
  id?: string;
  name?: string;
  href?: string;
}

export interface QueueItem {
  key: string;
  id: string;
}

export type Repeat = "off" | "all" | "one";
export type PlayerView = "none" | "now" | "queue";

interface PlayerState {
  base: string[];
  order: string[];
  pos: number;
  upNext: QueueItem[];
  currentId: string | null;
  currentFrom: "context" | "queue";
  context: PlayContext | null;

  playing: boolean;
  position: number;
  duration: number;
  buffering: boolean;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  muted: boolean;
  autoplay: boolean;
  view: PlayerView;

  /** What caused the last track change (used to classify plays as skips/completes). */
  lastAction: "play" | "next" | "prev" | "jump" | "ended";
  /** Engine commands */
  seekTo: number | null;
  restartToken: number;
  needsAutoplay: boolean;
  /** The album/playlist an autoplay session grew out of (keeps autoplay on course). */
  autoplayAnchor: string[];
  /** Autoplay songs fetched ahead of time, for when the song `after` ends. */
  prefetch: { after: string; ids: string[] } | null;

  playList(ids: string[], start?: string | number, context?: PlayContext, opts?: { shuffle?: boolean; randomStart?: boolean }): void;
  toggle(): void;
  setPlaying(p: boolean): void;
  next(): void;
  prev(): void;
  ended(): void;
  seek(ms: number): void;
  setProgress(position: number, duration?: number): void;
  setBuffering(b: boolean): void;
  setShuffle(on: boolean): void;
  cycleRepeat(): void;
  addToQueue(ids: string[]): void;
  playNext(ids: string[]): void;
  removeFromQueue(key: string): void;
  clearQueue(): void;
  jumpToQueue(key: string): void;
  jumpToContext(index: number): void;
  /** Continue with autoplay songs. keepAction: called from next(), so the skip stays a skip. */
  appendAutoplay(ids: string[], keepAction?: boolean): void;
  /** Swap the not-yet-played autoplay songs for a fresh batch (after the listener skipped). */
  replaceUpcoming(ids: string[]): void;
  setVolume(v: number): void;
  toggleMute(): void;
  setAutoplay(on: boolean): void;
  setView(v: PlayerView): void;
  stop(): void;
}

let keySeq = 0;
const qkey = () => `q${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      base: [],
      order: [],
      pos: -1,
      upNext: [],
      currentId: null,
      currentFrom: "context",
      context: null,
      playing: false,
      position: 0,
      duration: 0,
      buffering: false,
      shuffle: false,
      repeat: "off",
      volume: 1,
      muted: false,
      autoplay: true,
      view: "none",
      lastAction: "play",
      seekTo: null,
      restartToken: 0,
      needsAutoplay: false,
      autoplayAnchor: [],
      prefetch: null,

      playList(ids, start = 0, context, opts) {
        if (!ids.length) return;
        const shuffle = opts?.shuffle ?? get().shuffle;
        let startIndex = typeof start === "number" ? Math.max(0, Math.min(ids.length - 1, start)) : Math.max(0, ids.indexOf(start));
        // The big play button with shuffle on starts from a random track.
        if (shuffle && opts?.randomStart) startIndex = Math.floor(Math.random() * ids.length);
        const order = shuffle ? [ids[startIndex], ...shuffleInPlace(ids.filter((_, i) => i !== startIndex))] : [...ids];
        const pos = shuffle ? 0 : startIndex;
        set({
          base: [...ids],
          order,
          pos,
          currentId: order[pos],
          currentFrom: "context",
          context: context ?? null,
          playing: true,
          shuffle,
          position: 0,
          seekTo: null,
          restartToken: get().restartToken + 1,
          needsAutoplay: false,
          lastAction: "play",
          autoplayAnchor: [],
          prefetch: null,
        });
      },

      toggle() {
        if (!get().currentId) return;
        set({ playing: !get().playing });
      },
      setPlaying(p) {
        set({ playing: p });
      },

      next() {
        set({ lastAction: "next" });
        const s = get();
        const repeat = s.repeat === "one" ? "all" : s.repeat;
        if (s.upNext.length) {
          const [item, ...rest] = s.upNext;
          set({ upNext: rest, currentId: item.id, currentFrom: "queue", playing: true, position: 0, repeat, restartToken: s.restartToken + 1 });
          return;
        }
        if (s.pos + 1 < s.order.length) {
          set({ pos: s.pos + 1, currentId: s.order[s.pos + 1], currentFrom: "context", playing: true, position: 0, repeat, restartToken: s.restartToken + 1 });
          return;
        }
        if (s.repeat !== "off" && s.order.length) {
          const order = s.shuffle ? shuffleInPlace([...s.base]) : s.order;
          set({ order, pos: 0, currentId: order[0], currentFrom: "context", playing: true, position: 0, repeat, restartToken: s.restartToken + 1 });
          return;
        }
        if (s.autoplay && s.currentId) {
          // Songs fetched while this one played: start the next one with no wait.
          if (s.prefetch?.after === s.currentId && s.prefetch.ids.length) {
            get().appendAutoplay(s.prefetch.ids, true);
            return;
          }
          set({ needsAutoplay: true });
          return;
        }
        set({ playing: false, position: 0, seekTo: 0 });
      },

      prev() {
        set({ lastAction: "prev" });
        const s = get();
        if (s.position > 3000 || !s.currentId) {
          set({ seekTo: 0, position: 0 });
          return;
        }
        if (s.currentFrom === "queue" && s.pos >= 0 && s.order[s.pos]) {
          set({ currentId: s.order[s.pos], currentFrom: "context", position: 0, playing: true, restartToken: s.restartToken + 1 });
          return;
        }
        if (s.pos > 0) {
          set({ pos: s.pos - 1, currentId: s.order[s.pos - 1], currentFrom: "context", position: 0, playing: true, restartToken: s.restartToken + 1 });
          return;
        }
        if (s.repeat === "all" && s.order.length > 1) {
          const last = s.order.length - 1;
          set({ pos: last, currentId: s.order[last], currentFrom: "context", position: 0, playing: true, restartToken: s.restartToken + 1 });
          return;
        }
        set({ seekTo: 0, position: 0 });
      },

      ended() {
        const s = get();
        if (s.repeat === "one") {
          set({ seekTo: 0, position: 0, playing: true });
          return;
        }
        const keepRepeat = s.repeat;
        get().next();
        set({ repeat: keepRepeat, lastAction: "ended" });
      },

      seek(ms) {
        set({ seekTo: Math.max(0, ms), position: Math.max(0, ms) });
      },
      setProgress(position, duration) {
        set(duration !== undefined ? { position, duration } : { position });
      },
      setBuffering(b) {
        if (get().buffering !== b) set({ buffering: b });
      },

      setShuffle(on) {
        const s = get();
        if (on === s.shuffle) return;
        if (on) {
          const current = s.currentFrom === "context" ? s.currentId : null;
          const rest = shuffleInPlace(s.base.filter((id) => id !== current));
          const order = current ? [current, ...rest] : rest;
          set({ shuffle: true, order, pos: current ? 0 : -1 });
        } else {
          const pos = s.currentFrom === "context" && s.currentId ? s.base.indexOf(s.currentId) : s.base.indexOf(s.order[s.pos] ?? "");
          set({ shuffle: false, order: [...s.base], pos });
        }
      },
      cycleRepeat() {
        const r = get().repeat;
        set({ repeat: r === "off" ? "all" : r === "all" ? "one" : "off" });
      },

      addToQueue(ids) {
        set({ upNext: [...get().upNext, ...ids.map((id) => ({ key: qkey(), id }))] });
        if (!get().currentId) get().next();
      },
      playNext(ids) {
        set({ upNext: [...ids.map((id) => ({ key: qkey(), id })), ...get().upNext] });
        if (!get().currentId) get().next();
      },
      removeFromQueue(key) {
        set({ upNext: get().upNext.filter((q) => q.key !== key) });
      },
      clearQueue() {
        set({ upNext: [] });
      },
      jumpToQueue(key) {
        const s = get();
        const i = s.upNext.findIndex((q) => q.key === key);
        if (i < 0) return;
        set({
          upNext: s.upNext.slice(i + 1),
          currentId: s.upNext[i].id,
          currentFrom: "queue",
          playing: true,
          position: 0,
          restartToken: s.restartToken + 1,
          lastAction: "jump",
        });
      },
      jumpToContext(index) {
        const s = get();
        if (index < 0 || index >= s.order.length) return;
        set({ pos: index, currentId: s.order[index], currentFrom: "context", playing: true, position: 0, restartToken: s.restartToken + 1, lastAction: "jump" });
      },
      appendAutoplay(ids, keepAction = false) {
        const s = get();
        const fresh = ids.filter((id) => id !== s.currentId);
        if (!fresh.length) {
          set({ needsAutoplay: false, playing: false, prefetch: null });
          return;
        }
        const order = [...s.order, ...fresh];
        const pos = s.order.length;
        // Remember where the session started (the album/playlist around the last song played).
        const anchor = s.context?.type === "autoplay" && s.autoplayAnchor.length ? s.autoplayAnchor : s.order.slice(Math.max(0, s.pos - 9), s.pos + 1);
        set({
          base: [...s.base, ...fresh],
          order,
          pos,
          currentId: order[pos],
          currentFrom: "context",
          context: { type: "autoplay", name: "Autoplay · similar songs" },
          playing: true,
          position: 0,
          needsAutoplay: false,
          restartToken: s.restartToken + 1,
          lastAction: keepAction ? s.lastAction : "ended",
          autoplayAnchor: anchor,
          prefetch: null,
        });
      },
      replaceUpcoming(ids) {
        const s = get();
        if (s.context?.type !== "autoplay" || s.pos < 0) return;
        const kept = s.order.slice(0, s.pos + 1);
        const fresh = ids.filter((id) => !kept.includes(id));
        if (!fresh.length) return;
        const dropped = new Set(s.order.slice(s.pos + 1));
        set({ order: [...kept, ...fresh], base: [...s.base.filter((id) => !dropped.has(id)), ...fresh], prefetch: null });
      },

      setVolume(v) {
        set({ volume: Math.max(0, Math.min(1, v)), muted: v <= 0 });
      },
      toggleMute() {
        set({ muted: !get().muted });
      },
      setAutoplay(on) {
        set({ autoplay: on });
      },
      setView(v) {
        set({ view: v });
      },
      stop() {
        set({ base: [], order: [], pos: -1, upNext: [], currentId: null, playing: false, position: 0, duration: 0, context: null, autoplayAnchor: [], prefetch: null });
      },
    }),
    {
      name: "pepper.player",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        base: s.base.slice(0, 1000),
        order: s.order.slice(0, 1000),
        pos: s.pos,
        upNext: s.upNext.slice(0, 200),
        currentId: s.currentId,
        currentFrom: s.currentFrom,
        context: s.context,
        position: s.position,
        duration: s.duration,
        shuffle: s.shuffle,
        repeat: s.repeat,
        volume: s.volume,
        muted: s.muted,
        autoplay: s.autoplay,
        autoplayAnchor: s.autoplayAnchor.slice(0, 10),
      }),
    },
  ),
);

/** Upcoming context tracks after the current one (for the queue view). */
export function upcomingFromContext(s: Pick<PlayerState, "order" | "pos">, limit = 50): { index: number; id: string }[] {
  const out: { index: number; id: string }[] = [];
  for (let i = s.pos + 1; i < s.order.length && out.length < limit; i++) out.push({ index: i, id: s.order[i] });
  return out;
}
