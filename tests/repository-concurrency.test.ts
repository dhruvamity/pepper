import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalRepo } from "@/lib/server/db/local";

let dir: string;
let db: LocalRepo;
beforeEach(async () => { vi.useFakeTimers(); dir = await mkdtemp(join(tmpdir(), "pepper-repo-test-")); db = new LocalRepo(dir); });
afterEach(async () => { await vi.runAllTimersAsync(); vi.useRealTimers(); await rm(dir, { recursive: true, force: true }); });

it("keeps every concurrent playlist addition and the shared catalog mirror", async () => {
  await db.savePlaylist({ id: "p", name: "P", ownerUid: "admin", ownerName: "Admin", shared: true, trackIds: [], createdAt: 0, updatedAt: 0 });
  await Promise.all(Array.from({ length: 15 }, (_, i) => db.updatePlaylist("p", (p) => ({ ...p!, trackIds: [...p!.trackIds, `t${i}`] }))));
  expect((await db.getPlaylist("p"))?.trackIds).toHaveLength(15);
  expect((await db.getCatalog()).playlists?.[0].trackIds).toHaveLength(15);
});

it("counts repeated simultaneous likes and unlikes only once per listener", async () => {
  await Promise.all(Array.from({ length: 10 }, () => db.setLibraryItem("u", "likes", "t", true)));
  await db.setLibraryItem("v", "likes", "t", true);
  expect((await db.getTrackStats()).t.likes).toBe(2);
  await Promise.all(Array.from({ length: 10 }, () => db.setLibraryItem("u", "likes", "t", false)));
  expect((await db.getTrackStats()).t.likes).toBe(1);
  expect((await db.getLibrary("v")).likes.t).toBeTruthy();
});

it("stores private contacts, opt-in presence, Jam requests and collaborator playlists", async () => {
  const expiresAt = Date.now() + 60_000;
  await db.saveUser({ uid: "owner", name: "Owner", createdAt: 0, lastSeenAt: 0, onboarded: true, activitySharing: true, activityVisibleTo: ["editor"] });
  await db.saveUser({ uid: "editor", name: "Editor", createdAt: 0, lastSeenAt: 0, onboarded: true });
  await db.updateConnection("pair", () => ({ id: "pair", requesterUid: "owner", otherUid: "editor", status: "accepted", createdAt: 1, updatedAt: 1 }));
  expect((await db.listConnections("editor")).map((connection) => connection.status)).toEqual(["accepted"]);
  await db.saveActivity("owner", { uid: "owner", name: "Owner", trackId: "t000000000000000", playing: true, positionMs: 10, updatedAt: 2, expiresAt });
  expect(await db.getActivity("owner")).toMatchObject({ trackId: "t000000000000000", playing: true });

  await db.savePlaylist({
    id: "private", name: "Shared edits", ownerUid: "owner", ownerName: "Owner", trackIds: [], createdAt: 1, updatedAt: 1,
    collaborators: [{ uid: "editor", name: "Editor" }], collaboratorUids: ["editor"],
  });
  expect((await db.listPlaylists("editor")).map((playlist) => playlist.id)).toEqual(["private"]);

  await db.saveJamRequest({ id: "request", fromUid: "owner", fromName: "Owner", toUid: "editor", status: "pending", createdAt: 2, expiresAt });
  expect((await db.listJamRequests("editor")).map((request) => request.id)).toEqual(["request"]);
  const jam = {
    id: "f".repeat(24), hostUid: "editor", members: [{ uid: "editor", name: "Editor" }, { uid: "owner", name: "Owner" }], queue: [],
    playback: { track: null, positionMs: 0, anchoredAt: 3, playing: false, sequence: 0, reason: "play" as const },
    guestsControlPlayback: true, guestsControlVolume: false, volume: 1, repeat: "off" as const, shuffle: false, version: 1,
    expiresAt, history: [], removed: [], closed: false,
  };
  const accepted = await db.resolveJamRequest("request", "accepted", jam);
  expect(accepted).toMatchObject({ status: "accepted", jamId: jam.id });
  expect((await db.getJam(jam.id))?.members).toHaveLength(2);
});
