/**
 * Several Backblaze accounts: reading B2_*, B2_2_*, B2_3_* settings, and choosing a bucket for
 * each upload by free space.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { choosePlacement } from "@/lib/server/storage";

const GB = 1024 ** 3;

function account(prefix: string, bucket: string, extra: Record<string, string> = {}) {
  return {
    [`${prefix}ENDPOINT`]: "https://s3.eu-central-003.backblazeb2.com",
    [`${prefix}KEY_ID`]: `key-${bucket}`,
    [`${prefix}APPLICATION_KEY`]: `secret-${bucket}`,
    [`${prefix}BUCKET`]: bucket,
    ...extra,
  };
}

async function loadConfig(vars: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  const { config } = await import("@/lib/server/env");
  return config.storage;
}

describe("Backblaze accounts from settings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads every numbered account, in number order", async () => {
    const storage = await loadConfig({
      ...account("B2_", "first"),
      ...account("B2_3_", "third", { B2_3_QUOTA_GB: "5", B2_3_LABEL: "Spare" }),
      ...account("B2_2_", "second"),
    });
    expect(storage.kind).toBe("s3");
    expect(storage.s3.map((p) => [p.id, p.bucket, p.kind])).toEqual([
      ["b2", "first", "b2"],
      ["b2_2", "second", "b2"],
      ["b2_3", "third", "b2"],
    ]);
    expect(storage.s3.map((p) => p.label)).toEqual(["Backblaze B2", "Backblaze B2 · account 2", "Spare"]);
    expect(storage.s3.map((p) => p.quotaBytes / GB)).toEqual([10, 10, 5]);
    expect(storage.s3[1]).toMatchObject({ region: "eu-central-003", accessKeyId: "key-second", secretAccessKey: "secret-second" });
  });

  it("accepts a quota of 0 (keeps the account, takes no new uploads)", async () => {
    const storage = await loadConfig({ ...account("B2_", "first", { B2_QUOTA_GB: "0" }), ...account("B2_2_", "second", { B2_2_QUOTA_GB: "" }) });
    expect(storage.s3.map((p) => p.quotaBytes / GB)).toEqual([0, 10]);
  });

  it("skips empty and half-filled accounts, warning only about the half-filled one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = await loadConfig({
      ...account("B2_", "first"),
      // Empty slots, as in a fresh .env.local: ignored silently.
      B2_2_ENDPOINT: "",
      B2_2_KEY_ID: "",
      B2_2_QUOTA_GB: "10",
      // Missing its application key: ignored with a warning.
      ...account("B2_3_", "third", { B2_3_APPLICATION_KEY: "" }),
    });
    expect(storage.s3.map((p) => p.id)).toEqual(["b2"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("B2_3_APPLICATION_KEY");
  });

  it("ignores an account that repeats another account's bucket", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = await loadConfig({ ...account("B2_", "same"), ...account("B2_2_", "same") });
    expect(storage.s3.map((p) => p.id)).toEqual(["b2"]);
    expect(String(warn.mock.calls[0][0])).toContain("b2_2");
  });
});

describe("choosing a bucket", () => {
  const buckets = [
    { id: "b2", quotaBytes: 10 * GB },
    { id: "b2_2", quotaBytes: 10 * GB },
    { id: "b2_3", quotaBytes: 10 * GB },
  ];
  const used = (a: number, b: number, c: number) => ({
    b2: { bytes: a * GB, objects: 1 },
    b2_2: { bytes: b * GB, objects: 1 },
    b2_3: { bytes: c * GB, objects: 1 },
  });
  const MB9 = 9 * 1024 ** 2;

  it("balance: picks the bucket with the most free space", () => {
    expect(choosePlacement(buckets, used(3, 1, 2), MB9, "balance", "r2", 0.02).id).toBe("b2_2");
    expect(choosePlacement(buckets, used(1, 3, 0.5), MB9, "balance", "r2", 0.02).id).toBe("b2_3");
    // Buckets with no usage recorded yet count as empty.
    expect(choosePlacement(buckets, { b2: { bytes: GB, objects: 1 } }, MB9, "balance", "r2", 0.02).id).toBe("b2_2");
  });

  it("balance: compares the share of each quota that is free", () => {
    const mixed = [
      { id: "b2", quotaBytes: 10 * GB },
      { id: "b2_2", quotaBytes: 100 * GB },
    ];
    // 4 GB free of 10 (40%) vs 50 GB free of 100 (50%).
    expect(choosePlacement(mixed, { b2: { bytes: 6 * GB, objects: 1 }, b2_2: { bytes: 50 * GB, objects: 1 } }, MB9, "balance", "r2", 0).id).toBe("b2_2");
  });

  it("fill-first: fills the buckets in order, moving on when one is full", () => {
    expect(choosePlacement(buckets, used(5, 0, 0), MB9, "fill-first", "r2", 0.02).id).toBe("b2");
    // 9.8 GB is the usable part of 10 GB with a 2% reserve.
    expect(choosePlacement(buckets, used(9.8, 2, 0), MB9, "fill-first", "r2", 0.02).id).toBe("b2_2");
    expect(choosePlacement(buckets, used(9.8, 9.8, 0), MB9, "fill-first", "r2", 0.02).id).toBe("b2_3");
  });

  it("never picks a bucket without room for the whole song", () => {
    const almost = 10 * GB * 0.98 - 5 * 1024 ** 2; // 5 MB left before the reserve
    const usage = { b2: { bytes: almost, objects: 1 }, b2_2: { bytes: almost, objects: 1 }, b2_3: { bytes: 2 * GB, objects: 1 } };
    expect(choosePlacement(buckets, usage, MB9, "fill-first", "r2", 0.02).id).toBe("b2_3");
  });

  it("says so when every bucket is full", () => {
    expect(() => choosePlacement(buckets, used(9.8, 9.8, 9.8), MB9, "balance", "r2", 0.02)).toThrow(/No bucket has room for this 9\.0 MB upload/);
  });

  it("a quota of 0 stops new uploads to that bucket", () => {
    const drained = [{ id: "b2", quotaBytes: 0 }, ...buckets.slice(1)];
    expect(choosePlacement(drained, used(0, 5, 6), MB9, "fill-first", "r2", 0.02).id).toBe("b2_2");
  });
});
