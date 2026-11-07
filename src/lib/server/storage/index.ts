import path from "node:path";
import type { ProviderId, StorageUsage } from "@/lib/types";
import { config } from "../env";
import { LocalProvider } from "./local";
import { S3Provider } from "./s3";
import { StorageFullError, type StorageProvider } from "./types";

export { StorageFullError } from "./types";
export type { StorageProvider } from "./types";

const g = globalThis as unknown as { __pepperStorage?: StorageProvider[] };

export function providers(): StorageProvider[] {
  if (g.__pepperStorage) return g.__pepperStorage;
  const list: StorageProvider[] =
    config.storage.kind === "s3"
      ? config.storage.s3.map((cfg) => new S3Provider(cfg))
      : (["r2", "b2"] as const).map(
          (id) => new LocalProvider(id, config.storage.localQuotaBytes[id], path.join(config.dataDir, "storage")),
        );
  g.__pepperStorage = list;
  return list;
}

export function provider(id: string): StorageProvider | undefined {
  return providers().find((p) => p.id === id);
}

export type PlacementStrategy = "fill-first" | "balance";

/**
 * Pick where a new object of `size` bytes should live, among the buckets that still have room.
 *  - fill-first: fill the primary (R2: zero egress fees) first, then the other buckets in order
 *    (Backblaze account 1, 2, 3, …), moving on whenever one is full.
 *  - balance:    put each object in the bucket with the largest share of its quota still free,
 *    so all buckets fill up together.
 * Each bucket keeps `reserveRatio` of its quota free as a safety margin.
 */
export function choosePlacement<P extends { id: ProviderId; quotaBytes: number }>(
  list: P[],
  usage: Partial<Record<ProviderId, StorageUsage>>,
  size: number,
  strategy: PlacementStrategy,
  primary: ProviderId,
  reserveRatio = config.storage.reserveRatio,
): P {
  const withRoom = list
    .map((p) => {
      const used = usage[p.id]?.bytes ?? 0;
      const free = p.quotaBytes * (1 - reserveRatio) - used;
      return { p, free, ratio: free / p.quotaBytes };
    })
    .filter((x) => x.free >= size);
  if (!withRoom.length) throw new StorageFullError(size);
  if (strategy === "balance") {
    withRoom.sort((a, b) => b.ratio - a.ratio);
    return withRoom[0].p;
  }
  withRoom.sort((a, b) => (a.p.id === primary ? -1 : b.p.id === primary ? 1 : 0));
  return withRoom[0].p;
}

export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
