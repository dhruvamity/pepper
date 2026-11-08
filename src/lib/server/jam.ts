import { randomUUID } from "node:crypto";
import { z } from "zod";
import { jamPosition, type JamDocument, type JamMember, type JamSnapshot, type JamTrack } from "@/lib/jam";
import { shuffleInPlace } from "@/lib/util";
import { repo } from "./db";
import { HttpError } from "./http";

const CAPACITY = 20;
const MAX_QUEUE = 2000;
const JAM_LIFETIME = 8 * 3600_000;
export const jamId = z.string().regex(/^[a-f0-9]{24}$/);
const key = z.string().uuid();
const trackId = z.string().regex(/^t[a-f0-9]{15}$/);
const ids = z.array(trackId).max(MAX_QUEUE);
const position = z.number().min(0).max(6 * 3600_000);
const volume = z.number().min(0).max(1);
const sequence = z.number().int().nonnegative();

export const startJamBody = z.object({
  track: trackId.nullable(),
  queue: ids,
  positionMs: position,
  playing: z.boolean(),
  volume,
  repeat: z.enum(["off", "all", "one"]),
  shuffle: z.boolean(),
});

export const jamAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join") }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("remove"), uid: z.string().min(1).max(128) }),
  z.object({ type: z.literal("permissions"), playback: z.boolean().optional(), volume: z.boolean().optional() }),
  z.object({ type: z.literal("volume"), volume }),
  z.object({ type: z.literal("add"), ids: ids.min(1), next: z.boolean().optional() }),
  z.object({ type: z.literal("playList"), ids: ids.min(1), shuffle: z.boolean() }),
  z.object({ type: z.literal("playing"), playing: z.boolean(), sequence }),
  z.object({ type: z.literal("seek"), positionMs: position, sequence }),
  z.object({ type: z.literal("next"), sequence }),
  z.object({ type: z.literal("prev"), sequence }),
  z.object({ type: z.literal("advance"), sequence }),
  z.object({ type: z.literal("skip"), key }),
  z.object({ type: z.literal("jump"), key }),
  z.object({ type: z.literal("move"), key, to: key }),
  z.object({ type: z.literal("clear") }),
  z.object({ type: z.literal("repeat"), repeat: z.enum(["off", "all", "one"]) }),
  z.object({ type: z.literal("shuffle"), shuffle: z.boolean() }),
]);

export type JamAction = z.infer<typeof jamAction>;

export function isActive(jam: JamDocument | null, now = Date.now()): jam is JamDocument {
  return Boolean(jam && !jam.closed && jam.expiresAt > now);
}

export function isMember(jam: JamDocument, uid: string) {
  return jam.members.some((member) => member.uid === uid);
}

export function jamSnapshot(doc: JamDocument | null, uid: string): JamSnapshot {
  const serverTime = Date.now();
  if (!isActive(doc, serverTime) || !isMember(doc, uid)) return { jam: null, serverTime };
  const { history, removed, closed, ...jam } = doc;
  void history;
  void removed;
  void closed;
  return { jam, serverTime };
}

async function buildTracks(trackIds: string[], member: JamMember): Promise<JamTrack[]> {
  if (!trackIds.length) return [];
  const catalog = await (await repo()).getCatalog();
  const byId = new Map(catalog.tracks.map((track) => [track.id, track]));
  return trackIds.map((id) => {
    const track = byId.get(id);
    if (!track) throw new HttpError(404, "A song is no longer in the catalog");
    return { key: randomUUID(), id, durationMs: track.durationMs, addedBy: member.uid, addedByName: member.name.slice(0, 60) };
  });
}

export async function buildJamDocument(host: JamMember, input: z.infer<typeof startJamBody>, guest?: JamMember, id?: string): Promise<JamDocument> {
  const tracks = await buildTracks(input.track ? [input.track, ...input.queue] : input.queue, host);
  const track = tracks.shift() ?? null;
  const now = Date.now();
  const doc: JamDocument = {
    id: id ?? randomUUID().replace(/-/g, "").slice(0, 24),
    hostUid: host.uid,
    members: guest ? [host, guest] : [host],
    playback: {
      track, playing: Boolean(track && input.playing), sequence: 0, reason: "play",
      anchoredAt: now, positionMs: Math.min(track?.durationMs ?? 0, input.positionMs),
    },
    queue: tracks,
    history: [],
    removed: [],
    closed: false,
    guestsControlPlayback: true,
    guestsControlVolume: false,
    volume: input.volume,
    shuffle: input.shuffle,
    repeat: input.repeat,
    version: 1,
    expiresAt: now + JAM_LIFETIME,
  };
  return doc;
}

export async function startJam(host: JamMember, input: z.infer<typeof startJamBody>) {
  const doc = await buildJamDocument(host, input);
  await (await repo()).createJam(doc);
  return jamSnapshot(doc, host.uid);
}

function changeTrack(jam: JamDocument, track: JamTrack, now: number, reason: JamDocument["playback"]["reason"]) {
  jam.playback = { track, positionMs: 0, anchoredAt: now, playing: true, sequence: jam.playback.sequence + 1, reason };
}

function playNext(jam: JamDocument, now: number, auto: boolean) {
  const { track } = jam.playback;
  if (auto && jam.repeat === "one" && track) {
    changeTrack(jam, track, now, "ended");
    return;
  }
  if (track) jam.history = [...jam.history, track].slice(-MAX_QUEUE);
  if (!jam.queue.length && jam.repeat === "all") {
    jam.queue = jam.shuffle ? shuffleInPlace(jam.history) : jam.history;
    jam.history = [];
  }
  const [next, ...rest] = jam.queue;
  if (next) {
    jam.queue = rest;
    changeTrack(jam, next, now, auto ? "ended" : "next");
  } else if (track) {
    jam.playback = { ...jam.playback, playing: false, positionMs: auto ? track.durationMs : 0, anchoredAt: now };
    jam.history.pop();
  }
}

/** Applied inside the repository transaction so simultaneous guests never overwrite one another. */
export function applyJamAction(
  current: JamDocument | null,
  member: JamMember,
  action: JamAction,
  tracks: JamTrack[],
  now: number,
): JamDocument {
  if (!isActive(current, now)) throw new HttpError(404, "This Jam has ended or the invite is invalid");
  const { uid } = member;
  const host = current.hostUid === uid;
  const joined = isMember(current, uid);
  if (action.type === "join") {
    if (joined) return current;
    if (current.removed.includes(uid)) throw new HttpError(403, "The host removed you from this Jam");
    if (current.members.length >= CAPACITY) throw new HttpError(409, "This Jam is full");
    return { ...current, members: [...current.members, member], version: current.version + 1 };
  }
  if (!joined) throw new HttpError(403, "Join the Jam first");
  if (!host) {
    if (action.type === "remove" || action.type === "permissions") throw new HttpError(403, "Only the host can manage the Jam");
    if (action.type === "volume") {
      if (!current.guestsControlVolume) throw new HttpError(403, "The host controls the shared speaker volume");
    } else if (!current.guestsControlPlayback && !["add", "advance", "leave"].includes(action.type)) {
      throw new HttpError(403, "The host controls playback. You can still add songs.");
    }
  }
  if ("sequence" in action && action.sequence !== current.playback.sequence) return current;

  const jam = structuredClone(current);
  const playback = jam.playback;
  const at = jamPosition(playback, now);
  switch (action.type) {
    case "leave":
      if (host) jam.closed = true;
      else jam.members = jam.members.filter((person) => person.uid !== uid);
      break;
    case "remove":
      if (action.uid === uid || !isMember(jam, action.uid)) return current;
      jam.members = jam.members.filter((person) => person.uid !== action.uid);
      jam.removed.push(action.uid);
      break;
    case "permissions":
      jam.guestsControlPlayback = action.playback ?? jam.guestsControlPlayback;
      jam.guestsControlVolume = action.volume ?? jam.guestsControlVolume;
      break;
    case "volume":
      jam.volume = action.volume;
      break;
    case "add":
      if (jam.queue.length + tracks.length > MAX_QUEUE) throw new HttpError(409, "The Jam queue is full");
      jam.queue = action.next && (host || jam.guestsControlPlayback) ? [...tracks, ...jam.queue] : [...jam.queue, ...tracks];
      const keep = MAX_QUEUE - jam.queue.length;
      jam.history = jam.history.slice(Math.max(0, jam.history.length - keep));
      if (!playback.track) playNext(jam, now, false);
      break;
    case "playList": {
      const [track, ...rest] = tracks;
      if (!track) return current;
      jam.queue = rest;
      jam.history = [];
      jam.shuffle = action.shuffle;
      changeTrack(jam, track, now, "play");
      break;
    }
    case "playing":
      if (!playback.track || playback.playing === action.playing) return current;
      playback.positionMs = action.playing && at >= playback.track.durationMs ? 0 : at;
      playback.anchoredAt = now;
      playback.playing = action.playing;
      break;
    case "seek":
      if (!playback.track) return current;
      playback.positionMs = Math.min(action.positionMs, playback.track.durationMs);
      playback.anchoredAt = now;
      break;
    case "advance":
      if (!playback.playing || !playback.track || at < playback.track.durationMs) return current;
      playNext(jam, now, true);
      break;
    case "next":
      playNext(jam, now, false);
      break;
    case "prev": {
      const prev = at <= 3000 ? jam.history.pop() : undefined;
      if (prev && playback.track) {
        jam.queue.unshift(playback.track);
        changeTrack(jam, prev, now, "prev");
      } else {
        playback.positionMs = 0;
        playback.anchoredAt = now;
      }
      break;
    }
    case "skip":
      jam.queue = jam.queue.filter((track) => track.key !== action.key);
      break;
    case "jump": {
      const index = jam.queue.findIndex((track) => track.key === action.key);
      if (index < 0) return current;
      if (playback.track) jam.history = [...jam.history, playback.track].slice(-MAX_QUEUE);
      changeTrack(jam, jam.queue[index], now, "jump");
      jam.queue = jam.queue.slice(index + 1);
      break;
    }
    case "move": {
      const from = jam.queue.findIndex((track) => track.key === action.key);
      const to = jam.queue.findIndex((track) => track.key === action.to);
      if (from < 0 || to < 0 || from === to) return current;
      jam.queue.splice(to, 0, jam.queue.splice(from, 1)[0]);
      break;
    }
    case "clear":
      jam.queue = [];
      break;
    case "repeat":
      jam.repeat = action.repeat;
      break;
    case "shuffle":
      if (action.shuffle && !jam.shuffle) shuffleInPlace(jam.queue);
      jam.shuffle = action.shuffle;
      break;
  }
  return { ...jam, version: jam.version + 1 };
}

export async function changeJam(id: string, user: JamMember, action: JamAction) {
  const db = await repo();
  const tracks = "ids" in action ? await buildTracks(action.ids, user) : [];
  const doc = await db.updateJam(id, (current) => applyJamAction(current, user, action, tracks, Date.now()));
  return jamSnapshot(doc, user.uid);
}
