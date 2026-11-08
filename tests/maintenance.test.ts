import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repo } from "@/lib/server/db/types";
import type { UploadIntent } from "@/lib/types";

const deps = vi.hoisted(() => ({ repo: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ repo: deps.repo }));
vi.mock("@/lib/server/storage", () => ({ provider: deps.provider }));

import { runMaintenance } from "@/lib/server/maintenance";

describe("scheduled maintenance", () => {
  let database: Record<string, ReturnType<typeof vi.fn>>;
  let deleteObject: ReturnType<typeof vi.fn>;
  const trackId = "t0123456789abcde";
  const intent: UploadIntent = {
    id: "expired",
    ownerUid: "admin",
    trackId,
    target: { kind: "track", id: trackId },
    createdAt: 0,
    expiresAt: 100,
    objects: [
      { provider: "r2", key: `audio/${trackId}.wav`, size: 10, contentType: "audio/wav" },
      { provider: "r2", key: "img/covers/keep.webp", size: 10, contentType: "image/webp" },
      { provider: "r2", key: "img/covers/active.webp", size: 10, contentType: "image/webp" },
      { provider: "r2", key: "img/covers/orphan.webp", size: 10, contentType: "image/webp" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deleteObject = vi.fn().mockResolvedValue(undefined);
    database = {
      listExpiredUploadIntents: vi.fn().mockResolvedValue([intent]),
      listActiveUploadIntents: vi.fn().mockResolvedValue([{ id: "active", ownerUid: "admin", expiresAt: 2000, objects: [{ provider: "r2", key: "img/covers/active.webp" }] }]),
      getCatalog: vi.fn().mockResolvedValue({
        tracks: [{ id: "some-track", cover: { sm: "r2:img/covers/keep.webp", lg: "r2:img/covers/keep-lg.webp" } }],
        artists: { artist: { image: { sm: "r2:img/artists/used.webp", lg: "r2:img/artists/used-lg.webp" } } },
      }),
      getTrack: vi.fn().mockResolvedValue(null),
      deleteUploadIntent: vi.fn().mockResolvedValue(undefined),
      deleteExpiredJams: vi.fn().mockResolvedValue(3),
      deleteExpiredJamRequests: vi.fn().mockResolvedValue(2),
      deleteExpiredActivities: vi.fn().mockResolvedValue(4),
    };
    deps.repo.mockResolvedValue(database as unknown as Repo);
    deps.provider.mockReturnValue({ delete: deleteObject });
  });

  it("deletes only unused objects from expired sessions and removes expired Jams", async () => {
    const result = await runMaintenance(1000);
    expect(deleteObject.mock.calls).toEqual([[`audio/${trackId}.wav`], ["img/covers/orphan.webp"]]);
    expect(database.deleteUploadIntent).toHaveBeenCalledWith("expired");
    expect(database.deleteExpiredJams).toHaveBeenCalledWith(1000, 500);
    expect(database.deleteExpiredJamRequests).toHaveBeenCalledWith(1000, 500);
    expect(database.deleteExpiredActivities).toHaveBeenCalledWith(1000, 500);
    expect(result).toEqual({ examinedUploadIntents: 1, removedUploadIntents: 1, deletedObjects: 2, failedUploadIntents: 0, deletedJams: 3, deletedJamRequests: 2, deletedActivities: 4 });
  });

  it("keeps a failed upload intent so the next scheduled run can retry", async () => {
    deleteObject.mockRejectedValue(new Error("bucket unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runMaintenance(1000);
    expect(database.deleteUploadIntent).not.toHaveBeenCalled();
    expect(result.failedUploadIntents).toBe(1);
    warn.mockRestore();
  });
});
