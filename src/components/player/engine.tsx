"use client";

/**
 * The one <audio> element behind the whole app. It survives client-side navigation (it lives in
 * the app shell), streams from signed R2/B2 URLs, wires up lock-screen / media-key controls via
 * the Media Session API, keeps autoplay going with radio recommendations, and reports listening
 * analytics (actual seconds listened, skip/complete, session transitions) back to the server.
 */
import { useEffect, useRef } from "react";
import { api, getToken } from "@/lib/client/api";
import { useCatalog } from "@/lib/client/catalog";
import { usePlayer } from "@/lib/client/player/store";
import { toast } from "@/lib/client/toast";
import type { CatalogTrack, PlayEndReason, PlayReport } from "@/lib/types";
import { mediaUrl } from "@/lib/util";

interface ActivePlay {
  trackId: string;
  startedAt: number;
  listenedMs: number;
  lastTime: number;
  durationMs: number;
  source: PlayReport["source"];
  prevTrackId?: string;
  reported: boolean;
}

const SESSION_GAP = 30 * 60 * 1000;
const PENDING_KEY = "pepper.pendingPlay";
const urlCache = new Map<string, { url: string; expiresAt: number }>();

export async function streamUrl(trackId: string, force = false): Promise<string> {
  const hit = urlCache.get(trackId);
  if (!force && hit && hit.expiresAt - Date.now() > 10 * 60 * 1000) return hit.url;
  const res = await api<{ url: string; expiresAt: number }>(`/api/tracks/${trackId}/stream`);
  urlCache.set(trackId, res);
  return res.url;
}

let audioEl: HTMLAudioElement | null = null;
let unlocked = false;

function silentWavUrl(): string {
  const buf = new Uint8Array(46);
  const v = new DataView(buf.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 38, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, "data");
  v.setUint32(40, 2, true);
  buf[44] = 128;
  buf[45] = 128;
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** iOS needs one play() inside a user gesture before programmatic playback works. */
function unlockAudio() {
  if (unlocked || !audioEl) return;
  unlocked = true;
  if (audioEl.src) return;
  const a = audioEl;
  a.src = silentWavUrl();
  a.play().then(
    () => a.pause(),
    () => {
      unlocked = false;
    },
  );
}

function sourceOf(): PlayReport["source"] {
  const s = usePlayer.getState();
  if (s.currentFrom === "queue") return { type: "queue" };
  return s.context ? { type: s.context.type, id: s.context.id } : { type: "other" };
}

function reasonFor(action: string, play: ActivePlay): PlayEndReason {
  if (action === "ended") return "ended";
  if (action === "next") return play.listenedMs >= play.durationMs - 3000 ? "ended" : "skip";
  if (action === "prev") return "prev";
  return "switch";
}

export function PlayerEngine() {
  const { catalog } = useCatalog();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const playRef = useRef<ActivePlay | null>(null);
  // played: every song this session; kept: songs the listener let play; skipped: early skips.
  const sessionRef = useRef({ id: "", lastActivity: 0, lastStreamed: undefined as string | undefined, played: [] as string[], kept: [] as string[], skipped: [] as string[] });
  const tokenRef = useRef<string | null>(null);
  const loadSeq = useRef(0);
  const catalogRef = useRef(catalog);
  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  const track = (id: string | null): CatalogTrack | undefined => (id ? catalogRef.current?.byId.get(id) : undefined);

  // ---------------------------------------------------------------- analytics helpers
  const sendReport = (play: ActivePlay, endReason: PlayEndReason, beacon = false) => {
    if (play.reported) return;
    play.reported = true;
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    // Ignore tracks that never really started (restored session, instant switch while buffering).
    if (play.listenedMs < (endReason === "skip" ? 300 : 1000)) return;
    const report: PlayReport = {
      trackId: play.trackId,
      startedAt: play.startedAt,
      listenedMs: Math.round(play.listenedMs),
      durationMs: play.durationMs,
      endReason,
      source: play.source,
      prevTrackId: play.prevTrackId,
      sessionId: sessionRef.current.id,
      shuffle: usePlayer.getState().shuffle,
      device: window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
      tz: new Date().getTimezoneOffset(),
    };
    if (play.listenedMs >= Math.min(30_000, play.durationMs * 0.5)) sessionRef.current.lastStreamed = play.trackId;
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/events/play", new Blob([JSON.stringify({ token: tokenRef.current, events: [report] })], { type: "text/plain" }));
    } else {
      api("/api/events/play", { body: { events: [report] }, keepalive: true }).catch(() => {
        /* analytics are best-effort */
      });
    }
  };

  // ---------------------------------------------------------------- autoplay requests
  /** Songs that fit this session: what the listener let play, minus what they skipped. */
  const fetchAutoplay = (includeCurrent: boolean): Promise<string[]> => {
    const s = usePlayer.getState();
    const sess = sessionRef.current;
    const recent = [...new Set([...(includeCurrent && s.currentId ? [s.currentId] : []), ...[...sess.kept].reverse()])].slice(0, 6);
    const skipped = [...sess.skipped].reverse().slice(0, 6);
    const anchor = s.context?.type === "autoplay" && s.autoplayAnchor.length ? s.autoplayAnchor : s.order.slice(Math.max(0, s.pos - 9), s.pos + 1);
    // Played songs and the current one are out; upcoming autoplay songs stay in, so a re-plan can re-rank them.
    const exclude = [...new Set([...sess.played, ...s.order.slice(Math.max(0, s.pos - 299), s.pos + 1), ...s.upNext.map((q) => q.id)])].slice(-400);
    const q = new URLSearchParams({ mode: "autoplay", limit: "25", seeds: recent.join(","), skipped: skipped.join(","), anchor: anchor.join(","), exclude: exclude.join(",") });
    return api<{ items: { id: string }[] }>(`/api/radio?${q}`).then((r) => r.items.map((i) => i.id));
  };

  // After an early skip in autoplay, swap the upcoming autoplay songs for ones that avoid it.
  const replanSeq = useRef(0);
  const replanSoon = () => {
    const seq = ++replanSeq.current;
    setTimeout(() => {
      const s = usePlayer.getState();
      if (seq !== replanSeq.current || s.context?.type !== "autoplay" || !s.autoplay) return;
      fetchAutoplay(false)
        .then((ids) => {
          if (seq !== replanSeq.current) return;
          const cur = usePlayer.getState().currentId;
          usePlayer.getState().replaceUpcoming(ids.filter((id) => id !== cur));
        })
        .catch(() => {});
    }, 0);
  };

  /** Remember how the listener reacted to a song: early skips steer autoplay away from it. */
  const noteOutcome = (p: ActivePlay, reason: PlayEndReason) => {
    const sess = sessionRef.current;
    const push = (list: string[]) => [...list.filter((x) => x !== p.trackId).slice(-49), p.trackId];
    if (reason === "skip" && p.listenedMs < Math.min(30_000, p.durationMs * 0.4)) {
      sess.skipped = push(sess.skipped);
      sess.kept = sess.kept.filter((x) => x !== p.trackId);
      // Skipped an autoplay song, or the song autoplay was just started from: re-plan what's next.
      if (p.source.type === "autoplay" || usePlayer.getState().context?.type === "autoplay") replanSoon();
    } else if (reason === "ended" || p.listenedMs >= Math.min(60_000, p.durationMs * 0.5)) {
      sess.kept = push(sess.kept);
    }
  };

  const finishCurrent = (reason: PlayEndReason, beacon = false) => {
    const p = playRef.current;
    if (!p || p.reported) return;
    noteOutcome(p, reason);
    sendReport(p, reason, beacon);
  };

  const startPlay = (id: string) => {
    const now = Date.now();
    const sess = sessionRef.current;
    if (!sess.id || now - sess.lastActivity > SESSION_GAP) {
      sess.id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sess.lastStreamed = undefined;
      sess.played = [];
      sess.kept = [];
      sess.skipped = [];
    }
    sess.lastActivity = now;
    sess.played = [...sess.played.slice(-199), id];
    const t = track(id);
    playRef.current = {
      trackId: id,
      startedAt: now,
      listenedMs: 0,
      lastTime: 0,
      durationMs: t?.durationMs ?? 0,
      source: sourceOf(),
      prevTrackId: sess.lastStreamed !== id ? sess.lastStreamed : undefined,
      reported: false,
    };
    getToken().then((tk) => (tokenRef.current = tk));
  };

  // ---------------------------------------------------------------- preload the next track
  const preloadedFor = useRef<string | null>(null);
  const prefetchedFor = useRef<string | null>(null);
  const maybePreloadNext = (posMs: number, durMs?: number) => {
    if (!durMs) return;
    const s = usePlayer.getState();
    const prefetched = s.prefetch?.after === s.currentId ? s.prefetch.ids[0] : undefined;
    const nextId = s.upNext[0]?.id ?? s.order[s.pos + 1] ?? prefetched;
    // Nothing after this song (the end of an album, or a song played on its own from search):
    // ask for autoplay songs a few seconds in, so the queue shows what's next and it starts on time.
    // The next song's audio itself is only preloaded from 60% on.
    if (posMs < (nextId ? durMs * 0.6 : Math.min(durMs * 0.6, 5000))) return;
    if (!nextId) {
      if (s.autoplay && s.repeat === "off" && s.currentId && prefetchedFor.current !== s.currentId) {
        const after = s.currentId;
        prefetchedFor.current = after;
        fetchAutoplay(true)
          .then((ids) => {
            if (usePlayer.getState().currentId === after && ids.length) usePlayer.setState({ prefetch: { after, ids } });
          })
          .catch(() => {
            prefetchedFor.current = null;
          });
      }
      return;
    }
    if (preloadedFor.current === nextId) return;
    preloadedFor.current = nextId;
    streamUrl(nextId)
      .then((url) => {
        if (preloadRef.current && navigator.onLine) preloadRef.current.src = url;
      })
      .catch(() => {});
  };

  // ---------------------------------------------------------------- setup
  useEffect(() => {
    usePlayer.persist.rehydrate();
    usePlayer.setState({ playing: false, needsAutoplay: false, view: "none" });
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    audioEl = audio;
    preloadRef.current = new Audio();
    preloadRef.current.preload = "auto";
    preloadRef.current.muted = true;

    // Resend a play that was interrupted by the tab being killed.
    try {
      const pending = localStorage.getItem(PENDING_KEY);
      if (pending) {
        localStorage.removeItem(PENDING_KEY);
        const p = JSON.parse(pending) as ActivePlay;
        if (p.listenedMs > 1000) api("/api/events/play", { body: { events: [{ ...p, endReason: "unload", sessionId: "restored" }] } }).catch(() => {});
      }
    } catch {
      /* ignore */
    }

    let lastTick = 0;
    let lastSave = 0;
    const onTime = () => {
      const t = audio.currentTime;
      const p = playRef.current;
      if (p && !audio.paused) {
        const delta = t - p.lastTime;
        if (delta > 0 && delta < 2.5) {
          if (p.listenedMs === 0) p.startedAt = Date.now() - delta * 1000; // actual start, not load time
          p.listenedMs += delta * 1000; // seeks are ignored
        }
        p.lastTime = t;
        sessionRef.current.lastActivity = Date.now();
        if (Date.now() - lastSave > 10_000) {
          lastSave = Date.now();
          try {
            localStorage.setItem(PENDING_KEY, JSON.stringify({ ...p, source: p.source }));
          } catch {
            /* ignore */
          }
        }
      }
      const now = performance.now();
      if (now - lastTick > 250) {
        lastTick = now;
        const d = Number.isFinite(audio.duration) ? audio.duration * 1000 : undefined;
        usePlayer.getState().setProgress(t * 1000, d);
        if (d && "mediaSession" in navigator && navigator.mediaSession.setPositionState) {
          try {
            navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(t, audio.duration), playbackRate: audio.playbackRate });
          } catch {
            /* ignore */
          }
        }
        maybePreloadNext(t * 1000, d);
      }
    };
    const onSeeked = () => {
      if (playRef.current) playRef.current.lastTime = audio.currentTime;
    };
    const onEnded = () => {
      finishCurrent("ended");
      const s = usePlayer.getState();
      const repeatOne = s.repeat === "one" && s.currentId;
      s.ended();
      if (repeatOne) startPlay(s.currentId!);
    };
    const onWaiting = () => usePlayer.getState().setBuffering(true);
    const onPlaying = () => usePlayer.getState().setBuffering(false);
    const onPause = () => {
      // OS-level pause (headphones unplugged, lock screen…)
      if (usePlayer.getState().playing && !audio.ended && audio.src && !audio.src.startsWith("blob:")) usePlayer.getState().setPlaying(false);
    };
    const onPlay = () => {
      if (!usePlayer.getState().playing && !audio.src.startsWith("blob:")) usePlayer.getState().setPlaying(true);
    };
    let retried = "";
    const onError = async () => {
      const id = usePlayer.getState().currentId;
      if (!id || audio.src.startsWith("blob:") || !audio.src) return;
      if (retried === id) {
        toast("Couldn't play this song — skipping", "error");
        usePlayer.getState().next();
        return;
      }
      retried = id;
      const at = audio.currentTime;
      try {
        audio.src = await streamUrl(id, true);
        audio.currentTime = at;
        if (usePlayer.getState().playing) await audio.play();
      } catch {
        toast("Playback error", "error");
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("error", onError);

    const onGesture = () => unlockAudio();
    document.addEventListener("pointerdown", onGesture, { capture: true });
    document.addEventListener("keydown", onGesture, { capture: true });

    const onPageHide = () => finishCurrent("unload", true);
    window.addEventListener("pagehide", onPageHide);

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const s = usePlayer.getState();
      if (e.code === "Space") {
        e.preventDefault();
        s.toggle();
      } else if (e.code === "ArrowRight" && (e.metaKey || e.ctrlKey)) s.next();
      else if (e.code === "ArrowLeft" && (e.metaKey || e.ctrlKey)) s.prev();
      else if (e.code === "ArrowRight" && e.shiftKey) s.seek(s.position + 10_000);
      else if (e.code === "ArrowLeft" && e.shiftKey) s.seek(Math.max(0, s.position - 10_000));
    };
    window.addEventListener("keydown", onKey);

    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
        try {
          ms.setActionHandler(a, h);
        } catch {
          /* unsupported action */
        }
      };
      set("play", () => usePlayer.getState().setPlaying(true));
      set("pause", () => usePlayer.getState().setPlaying(false));
      set("nexttrack", () => usePlayer.getState().next());
      set("previoustrack", () => usePlayer.getState().prev());
      set("seekto", (d) => d.seekTime != null && usePlayer.getState().seek(d.seekTime * 1000));
      set("seekforward", (d) => usePlayer.getState().seek(usePlayer.getState().position + (d.seekOffset ?? 10) * 1000));
      set("seekbackward", (d) => usePlayer.getState().seek(Math.max(0, usePlayer.getState().position - (d.seekOffset ?? 10) * 1000)));
    }

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("error", onError);
      document.removeEventListener("pointerdown", onGesture, { capture: true });
      document.removeEventListener("keydown", onGesture, { capture: true });
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("keydown", onKey);
      audioEl = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- load track on change
  const currentId = usePlayer((s) => s.currentId);
  const restartToken = usePlayer((s) => s.restartToken);
  const catalogReady = Boolean(catalog);
  const firstLoad = useRef(true);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !catalogReady) return;
    const id = currentId;
    const seq = ++loadSeq.current;
    const s = usePlayer.getState();

    if (playRef.current && !playRef.current.reported) finishCurrent(reasonFor(s.lastAction, playRef.current));
    if (!id) {
      audio.pause();
      audio.removeAttribute("src");
      playRef.current = null;
      return;
    }
    const t = track(id);
    if (!t) {
      // Track was deleted from the catalog.
      if (s.playing) s.next();
      return;
    }
    const resumeAt = firstLoad.current ? s.position : 0;
    firstLoad.current = false;
    startPlay(id);
    document.title = `${t.title} · ${t.artists.map((a) => a.name).join(", ")}`;
    if ("mediaSession" in navigator) {
      const art = (ref?: string, size = "512x512") => (ref ? [{ src: new URL(mediaUrl(ref)!, location.origin).href, sizes: size, type: ref.endsWith(".webp") ? "image/webp" : "image/jpeg" }] : []);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artists.map((a) => a.name).join(", "),
        album: t.album.title,
        artwork: [...art(t.cover?.sm, "300x300"), ...art(t.cover?.lg, "640x640")],
      });
    }
    usePlayer.getState().setBuffering(true);
    streamUrl(id)
      .then(async (url) => {
        if (seq !== loadSeq.current) return;
        audio.src = url;
        if (resumeAt > 0) audio.currentTime = resumeAt / 1000;
        if (playRef.current) playRef.current.lastTime = resumeAt / 1000;
        if (usePlayer.getState().playing) {
          try {
            await audio.play();
          } catch (err) {
            if ((err as DOMException).name === "NotAllowedError") usePlayer.getState().setPlaying(false);
          }
        } else usePlayer.getState().setBuffering(false);
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        usePlayer.getState().setBuffering(false);
        toast(`Can't stream this song: ${(err as Error).message}`, "error");
        usePlayer.getState().setPlaying(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, restartToken, catalogReady]);

  // ---------------------------------------------------------------- play / pause
  const playing = usePlayer((s) => s.playing);
  useEffect(() => {
    const audio = audioRef.current;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    if (!audio || !audio.src || audio.src.startsWith("blob:")) return;
    if (playing && audio.paused) {
      // Resuming a song whose play was already reported (queue ended, then play pressed again).
      const id = usePlayer.getState().currentId;
      if (id && playRef.current?.reported) {
        startPlay(id);
        if (playRef.current) playRef.current.lastTime = audio.currentTime;
      }
      sessionRef.current.lastActivity = Date.now();
      audio.play().catch((err) => {
        if ((err as DOMException).name === "NotAllowedError") usePlayer.getState().setPlaying(false);
      });
    } else if (!playing && !audio.paused) audio.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // ---------------------------------------------------------------- seek / volume
  const seekTo = usePlayer((s) => s.seekTo);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || seekTo == null) return;
    if (audio.src && !audio.src.startsWith("blob:")) {
      audio.currentTime = seekTo / 1000;
      if (playRef.current) playRef.current.lastTime = audio.currentTime;
      if (usePlayer.getState().playing && audio.paused) audio.play().catch(() => {});
    }
    usePlayer.setState({ seekTo: null });
  }, [seekTo]);

  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted]);

  // ---------------------------------------------------------------- autoplay radio
  const needsAutoplay = usePlayer((s) => s.needsAutoplay);
  useEffect(() => {
    if (!needsAutoplay) return;
    const s = usePlayer.getState();
    // The current song is over (skipped or finished) even though no new song has started yet.
    if (playRef.current && !playRef.current.reported) finishCurrent(reasonFor(s.lastAction, playRef.current));
    fetchAutoplay(false)
      .then((ids) => {
        if (!usePlayer.getState().needsAutoplay) return;
        if (!ids.length) {
          usePlayer.setState({ needsAutoplay: false, playing: false });
          return;
        }
        usePlayer.getState().appendAutoplay(ids);
      })
      .catch(() => usePlayer.setState({ needsAutoplay: false, playing: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAutoplay]);

  return null;
}
