import { describe, expect, it } from "vitest";
import { jamPosition, type JamDocument, type JamTrack } from "@/lib/jam";
import { applyJamAction } from "@/lib/server/jam";

const host = { uid: "host", name: "Host" };
const guest = { uid: "guest", name: "Guest" };
const song = (key: string, addedBy = host): JamTrack => ({
  key, id: key, durationMs: 10000, addedBy: addedBy.uid, addedByName: addedBy.name,
});

function room(): JamDocument {
  return {
    id: "room", hostUid: host.uid, members: [host, guest], queue: [song("b"), song("c")],
    playback: { track: song("a"), positionMs: 0, anchoredAt: 1000, playing: true, sequence: 0, reason: "play" },
    guestsControlPlayback: true, guestsControlVolume: false, repeat: "off", shuffle: false,
    version: 1, volume: 1, expiresAt: 60_000, closed: false, history: [], removed: [],
  };
}

describe("Jam", () => {
  it("anchors pause, seek and resume to the same clock for every listener", () => {
    const paused = applyJamAction(room(), guest, { type: "playing", playing: false, sequence: 0 }, [], 3600);
    expect(jamPosition(paused.playback, 4800)).toBe(2600);
    const sought = applyJamAction(paused, host, { type: "seek", positionMs: 7000, sequence: 0 }, [], 4800);
    const resumed = applyJamAction(sought, guest, { type: "playing", playing: true, sequence: 0 }, [], 5000);
    expect(jamPosition(resumed.playback, 5900)).toBe(7900);
    expect(jamPosition(resumed.playback, 4990)).toBe(7000);
  });

  it("ignores automatic advance before the track ends and duplicate advances after it ends", () => {
    const start = room();
    const command = { type: "advance", sequence: 0 } as const;
    expect(applyJamAction(start, host, command, [], 10999)).toBe(start);
    const advanced = applyJamAction(start, host, command, [], 11000);
    expect(advanced.playback).toMatchObject({ track: { id: "b" }, sequence: 1, reason: "ended" });
    expect(applyJamAction(advanced, guest, command, [], 11020)).toBe(advanced);
  });

  it("leaves guest queue additions available while the host locks playback and volume", () => {
    const locked = applyJamAction(room(), host, { type: "permissions", playback: false }, [], 1200);
    expect(() => applyJamAction(locked, guest, { type: "next", sequence: 0 }, [], 1300)).toThrow("host controls playback");
    expect(() => applyJamAction(locked, guest, { type: "volume", volume: 0 }, [], 1300)).toThrow("host controls the shared speaker");
    const added = applyJamAction(locked, guest, { type: "add", ids: ["d"], next: true }, [song("d", guest)], 1300);
    expect(added.queue.map((t) => t.id)).toEqual(["b", "c", "d"]);
    expect(added.queue.at(-1)?.addedBy).toBe(guest.uid);
  });

  it("distinguishes leaving, removal and ending a room", () => {
    const left = applyJamAction(room(), guest, { type: "leave" }, [], 1200);
    expect(left.closed).toBe(false);
    const joined = applyJamAction(left, guest, { type: "join" }, [], 1300);
    expect(joined.members).toEqual([host, guest]);
    const removed = applyJamAction(joined, host, { type: "remove", uid: guest.uid }, [], 1400);
    expect(() => applyJamAction(removed, guest, { type: "join" }, [], 1500)).toThrow("removed you");
    const closed = applyJamAction(removed, host, { type: "leave" }, [], 1600);
    expect(closed.closed).toBe(true);
    expect(() => applyJamAction(closed, guest, { type: "join" }, [], 1700)).toThrow("Jam has ended");
  });
});
