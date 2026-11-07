"use client";

import { create } from "zustand";
import { jamPosition, type Jam, type JamSnapshot } from "@/lib/jam";
import type { JamAction } from "@/lib/server/jam";
import { ApiError, api, getToken } from "./api";
import { setJamControls, usePlayer } from "./player/store";
import { toast } from "./toast";

type Mode = "remote" | "in-person";
type Connection = "connecting" | "live" | "reconnecting";

interface JamClient {
  room: Jam | null;
  uid: string | null;
  mode: Mode;
  open: boolean;
  blocked: boolean;
  connection: Connection;
}

export const useJam = create<JamClient>(() => ({
  room: null,
  uid: null,
  mode: "remote",
  open: false,
  blocked: false,
  connection: "connecting",
}));

const storageKey = (uid: string) => `pepper.jam:${uid}`;
let listening: AbortController | null = null;
let roomId: string | null = null;
let offset = 0;
let clockRtt = Infinity;
let clockSampledAt = 0;
let advanceTimer: ReturnType<typeof setTimeout> | undefined;
let commands = Promise.resolve();
let entering = false;
let volumeTimer: ReturnType<typeof setTimeout> | undefined;

export function setSharedJamVolume(volume: number) {
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => void sendJamAction({ type: "volume", volume }), 160);
}

export const setJamOpen = (open: boolean) => useJam.setState({ open });
export const inJam = () => Boolean(useJam.getState().room);
export function jamAudioEnabled() {
  const { room, mode, blocked } = useJam.getState();
  return !room || (mode === "remote" && !blocked);
}
const now = () => performance.timeOrigin + performance.now();
const serverNow = () => now() + offset;

export function jamPlaybackPosition() {
  const room = useJam.getState().room;
  return room ? jamPosition(room.playback, serverNow()) : null;
}

function syncPlayer(room: Jam, previous: Jam | null, forceSeek = false) {
  const { uid } = useJam.getState();
  const s = usePlayer.getState();
  const p = room.playback;
  const restart = p.sequence !== previous?.playback.sequence;
  const time = jamPosition(p, serverNow());
  const seek = forceSeek || previous?.playback.anchoredAt !== p.anchoredAt;
  usePlayer.setState({
    base: [],
    order: [],
    pos: -1,
    upNext: room.queue.map(({ key, id }) => ({ key, id })),
    currentId: p.track?.id ?? null,
    currentFrom: "context",
    context: { type: "jam", id: room.id, name: "Jam", href: `/jam/${room.id}` },
    playing: p.playing,
    duration: p.track?.durationMs ?? 0,
    shuffle: room.shuffle,
    repeat: room.repeat,
    lastAction: p.reason,
    needsAutoplay: false,
    prefetch: null,
    ...(uid === room.hostUid && room.volume !== previous?.volume ? { volume: room.volume, muted: room.volume === 0 } : {}),
    ...(restart ? { restartToken: s.restartToken + 1, position: time, seekTo: null } : {}),
    ...(!restart && seek ? { position: time, seekTo: time } : {}),
  });
}

function apply(snapshot: JamSnapshot) {
  const room = snapshot.jam;
  if (!room || room.id !== roomId) return;
  const previous = useJam.getState().room;
  if (previous && previous.version >= room.version) return;
  if (!previous) {
    setJamControls((action) => {
      const current = useJam.getState().room;
      if (!current) return;
      const playback = current.playback;
      if (action.type === "playing" || action.type === "seek" || action.type === "next" || action.type === "prev" || action.type === "advance") {
        void sendJamAction({ ...action, sequence: playback.sequence });
      } else {
        void sendJamAction(action);
      }
    });
  }
  useJam.setState({ room });
  syncPlayer(room, previous);
  scheduleAdvance(room);
}

function scheduleAdvance(room: Jam) {
  clearTimeout(advanceTimer);
  const { playback } = room;
  if (!playback.playing || !playback.track) return;
  const remain = playback.track.durationMs - jamPosition(playback, serverNow());
  const advance = () => {
    if (useJam.getState().room?.playback !== playback) return;
    void sendJamAction({ type: "advance", sequence: playback.sequence }).then((next) => {
      if (!next || next.jam?.version === room.version) advanceTimer = setTimeout(advance, next ? 400 : 2000);
    });
  };
  // The host usually advances first. A guest can carry on if the host's tab sleeps.
  const host = room.hostUid === useJam.getState().uid;
  advanceTimer = setTimeout(advance, remain + (host ? 70 : 750));
}

export function enableJamAudio() {
  const { room } = useJam.getState();
  useJam.setState({ blocked: false, mode: "remote" });
  saveRoom();
  if (room) syncPlayer(room, room, true);
}

/** A browser audio policy can block one device while the rest of the Jam keeps playing. */
export function blockJamAudio() {
  useJam.setState({ blocked: true, open: true });
  usePlayer.setState({ buffering: false });
}

export function setJamMode(mode: Mode) {
  const { room, uid } = useJam.getState();
  if (!room || uid === room.hostUid) return;
  useJam.setState({ mode });
  saveRoom();
  syncPlayer(room, room, true);
}

function saveRoom() {
  const { uid, mode } = useJam.getState();
  if (!uid) return;
  try {
    if (roomId) sessionStorage.setItem(storageKey(uid), JSON.stringify({ id: roomId, mode }));
    else sessionStorage.removeItem(storageKey(uid));
  } catch {
    // The room can still run without browser storage.
  }
}

function resetRoom(forget = true) {
  listening?.abort();
  listening = null;
  roomId = null;
  clockRtt = Infinity;
  offset = 0;
  clearTimeout(advanceTimer);
  clearTimeout(volumeTimer);
  if (forget) saveRoom();
  setJamControls(null);
  useJam.setState({ room: null, blocked: false, mode: "remote", connection: "connecting", open: false });
}

function sampleClock(serverTime: number, sent: number) {
  const received = now();
  const rtt = received - sent;
  if (rtt < clockRtt || received - clockSampledAt > 120_000) {
    offset = serverTime - (sent + received) / 2;
    clockRtt = rtt;
    clockSampledAt = received;
  }
}

async function watch(id: string, signal: AbortSignal) {
  let delay = 250;
  while (!signal.aborted) {
    try {
      const token = await getToken();
      const sent = now();
      const res = await fetch(`/api/jams/${id}/events`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal,
      });
      if (res.status === 404 || res.status === 401 || res.status === 403) {
        resetRoom();
        toast("You’re no longer in this Jam");
        return;
      }
      if (!res.ok || !res.body) throw new Error("Jam connection interrupted");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let first = true;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || signal.aborted) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const event = JSON.parse(line) as Partial<JamSnapshot> & { serverTime: number };
            if (first) {
              sampleClock(event.serverTime, sent);
              useJam.setState({ connection: "live" });
              delay = 250;
              first = false;
            }
            if (event.jam === undefined) continue;
            if (!event.jam) {
              resetRoom();
              toast("You’re no longer in this Jam");
              return;
            }
            apply({ jam: event.jam, serverTime: event.serverTime });
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (first) throw new Error("Jam connection interrupted");
    } catch {
      if (signal.aborted) return;
      useJam.setState({ connection: "reconnecting" });
      delay = Math.min(delay * 2, 5000);
    }
    if (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function connect(id: string, mode: Mode, snapshot?: JamSnapshot) {
  listening?.abort();
  listening = new AbortController();
  roomId = id;
  useJam.setState({ mode, connection: "connecting" });
  saveRoom();
  if (snapshot) apply(snapshot);
  void watch(id, listening.signal);
}

export function connectSavedJam(uid: string) {
  resetRoom(false);
  useJam.setState({ uid });
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(uid)) ?? "null") as { id: string; mode: Mode } | null;
    if (saved && /^[a-f0-9]{24}$/.test(saved.id)) connect(saved.id, saved.mode === "in-person" ? "in-person" : "remote");
  } catch {
    // No valid room to reconnect to.
  }
  return () => {
    resetRoom(false);
    useJam.setState({ uid: null });
  };
}

async function enter(path: string, body: unknown, mode: Mode) {
  const { uid } = useJam.getState();
  if (!uid) return;
  if (roomId) throw new Error("Leave your current Jam first");
  if (entering) return;
  entering = true;
  try {
    const sent = now();
    const snapshot = await api<JamSnapshot>(path, { body });
    if (!snapshot.jam) throw new Error("This Jam has ended");
    if (uid !== useJam.getState().uid) return;
    sampleClock(snapshot.serverTime, sent);
    connect(snapshot.jam.id, mode, snapshot);
    setJamOpen(true);
  } finally {
    entering = false;
  }
}

export function startListeningJam(ids?: string[]) {
  const s = usePlayer.getState();
  const track = ids ? ids[0] ?? null : s.currentId;
  const queue = ids ? ids.slice(1) : [
    ...s.upNext.map((item) => item.id),
    ...s.order.slice(s.pos + 1),
    ...(s.prefetch?.after === s.currentId && s.autoplay ? s.prefetch.ids : []),
  ];
  return enter("/api/jams", {
    track, queue: queue.slice(0, 2000), positionMs: ids ? 0 : s.position, playing: ids ? Boolean(track) : s.playing,
    volume: s.muted ? 0 : s.volume, repeat: s.repeat, shuffle: ids ? false : s.shuffle,
  }, "remote");
}

export function joinListeningJam(id: string, mode: Mode) {
  return enter(`/api/jams/${id}`, { type: "join" }, mode);
}

export function sendJamAction(action: JamAction): Promise<JamSnapshot | undefined> {
  const id = roomId;
  if (!id) return Promise.resolve(undefined);
  const next = commands.then(async () => {
    if (roomId !== id) return undefined;
    const sent = now();
    try {
      const snapshot = await api<JamSnapshot>(`/api/jams/${id}`, { body: action });
      if (roomId !== id) return undefined;
      sampleClock(snapshot.serverTime, sent);
      if (!snapshot.jam) resetRoom();
      else apply(snapshot);
      return snapshot;
    } catch (err) {
      if (roomId !== id) return undefined;
      if (err instanceof ApiError && err.status === 404 && !("ids" in action)) resetRoom();
      if (action.type !== "advance") toast((err as Error).message, "error");
      return undefined;
    }
  });
  commands = next.then(() => {});
  return next;
}
