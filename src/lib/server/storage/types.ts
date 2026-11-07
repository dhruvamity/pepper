import type { ProviderId, StorageUsage } from "@/lib/types";

export interface PresignedUpload {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
}

export interface PresignGetOptions {
  /** Lifetime of the URL in seconds. */
  expiresIn: number;
  /**
   * Sign with a timestamp floored to this window so repeated requests produce the same
   * URL and browsers/CDNs can reuse their cache. Must be smaller than expiresIn.
   */
  stableWindow?: number;
  cacheControl?: string;
  contentType?: string;
}

export interface StorageProvider {
  id: ProviderId;
  kind: "s3" | "local";
  label: string;
  quotaBytes: number;
  presignPut(key: string, contentType: string): Promise<PresignedUpload>;
  presignGet(key: string, opts: PresignGetOptions): Promise<string>;
  head(key: string): Promise<{ size: number; contentType?: string } | null>;
  put(key: string, body: Uint8Array, contentType: string, cacheControl?: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Sum of object sizes (used to reconcile the usage counters). */
  measure(): Promise<StorageUsage>;
}

export class StorageFullError extends Error {
  constructor(size: number) {
    super(`No bucket has room for this ${(size / 1024 / 1024).toFixed(1)} MB upload. Free up space, raise a quota, or add another bucket.`);
    this.name = "StorageFullError";
  }
}
