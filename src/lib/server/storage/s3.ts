import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3ProviderConfig } from "../env";
import type { PresignGetOptions, PresignedUpload, StorageProvider } from "./types";

/**
 * Works with any S3-compatible service; used for both Cloudflare R2 and Backblaze B2.
 */
export class S3Provider implements StorageProvider {
  readonly kind = "s3" as const;
  readonly id;
  readonly label;
  readonly quotaBytes;
  private client: S3Client;

  constructor(private cfg: S3ProviderConfig) {
    this.id = cfg.id;
    this.label = cfg.label;
    this.quotaBytes = cfg.quotaBytes;
    const host = new URL(cfg.endpoint).hostname;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Local S3 servers (MinIO, s3rver) on localhost/IPs need bucket-in-path URLs.
      forcePathStyle: host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host),
      // Newer AWS SDKs add CRC32 checksums by default, which R2/B2 presigned uploads reject.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async presignPut(key: string, contentType: string): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType }),
      { expiresIn: 60 * 60 },
    );
    return { method: "PUT", url, headers: { "Content-Type": contentType } };
  }

  async presignGet(key: string, opts: PresignGetOptions): Promise<string> {
    if (this.cfg.publicBaseUrl && key.startsWith("img/")) {
      return `${this.cfg.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
    }
    const now = Date.now();
    const signingDate = opts.stableWindow
      ? new Date(Math.floor(now / (opts.stableWindow * 1000)) * opts.stableWindow * 1000)
      : new Date(now);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ResponseCacheControl: opts.cacheControl,
        ResponseContentType: opts.contentType,
      }),
      { expiresIn: Math.min(opts.expiresIn, 7 * 24 * 3600 - 60), signingDate },
    );
  }

  async head(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || status === 403 || (err as Error).name === "NotFound") return null;
      throw err;
    }
  }

  async put(key: string, body: Uint8Array, contentType: string, cacheControl?: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  /** Cheapest call that proves the key works for this bucket (lists at most one object). */
  async ping() {
    await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, MaxKeys: 1 }));
  }

  async measure() {
    let bytes = 0;
    let objects = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.cfg.bucket, ContinuationToken: token, MaxKeys: 1000 }),
      );
      for (const o of page.Contents ?? []) {
        bytes += Number(o.Size ?? 0);
        objects++;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return { bytes, objects };
  }

  /** Configure bucket CORS so browsers can upload directly and stream audio. */
  async setCors(origins: string[]) {
    const { PutBucketCorsCommand } = await import("@aws-sdk/client-s3");
    await this.client.send(
      new PutBucketCorsCommand({
        Bucket: this.cfg.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins,
              AllowedMethods: ["GET", "HEAD", "PUT"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      }),
    );
  }
}
