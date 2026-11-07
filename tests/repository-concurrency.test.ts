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
