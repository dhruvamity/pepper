import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderId } from "@/lib/types";
import { hmac, hmacVerify } from "../secret";
import type { PresignGetOptions, PresignedUpload, StorageProvider } from "./types";

/**
 * Stores objects on the local disk and mimics presigned URLs with HMAC-signed links served by
 * /api/storage/[provider]/[...key]. Two instances ("r2" and "b2" slots) let local mode exercise
 * the same capacity-aware placement as production.
 */
export class LocalProvider implements StorageProvider {
  readonly kind = "local" as const;
  readonly label: string;

  constructor(
    readonly id: ProviderId,
    readonly quotaBytes: number,
    private root: string,
  ) {
    this.label = id === "r2" ? "Local disk (R2 slot)" : "Local disk (B2 slot)";
  }

  /** Absolute path for a key, refusing anything that escapes the provider root. */
  resolve(key: string): string {
    const clean = path.normalize(key).replace(/^([/\\])+/, "");
    if (clean.startsWith("..") || path.isAbsolute(clean) || clean.includes("\0")) throw new Error("Invalid key");
    const full = path.join(this.root, this.id, clean);
    if (!full.startsWith(path.join(this.root, this.id) + path.sep)) throw new Error("Invalid key");
    return full;
  }

  private signedUrl(op: "get" | "put", key: string, exp: number, extra: Record<string, string> = {}) {
    const sig = hmac(`${op}:${this.id}:${key}:${exp}`);
    const qs = new URLSearchParams({ op, exp: String(exp), sig, ...extra });
    return `/api/storage/${this.id}/${key.split("/").map(encodeURIComponent).join("/")}?${qs}`;
  }

  verify(op: "get" | "put", key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    return hmacVerify(`${op}:${this.id}:${key}:${exp}`, sig);
  }

  async presignPut(key: string, contentType: string): Promise<PresignedUpload> {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return { method: "PUT", url: this.signedUrl("put", key, exp, { ct: contentType }), headers: { "Content-Type": contentType } };
  }

  async presignGet(key: string, opts: PresignGetOptions): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const base = opts.stableWindow ? Math.floor(nowSec / opts.stableWindow) * opts.stableWindow : nowSec;
    const extra: Record<string, string> = {};
    if (opts.cacheControl) extra.cc = opts.cacheControl;
    return this.signedUrl("get", key, base + opts.expiresIn, extra);
  }

  async head(key: string) {
    try {
      const s = await stat(this.resolve(key));
      return s.isFile() ? { size: s.size } : null;
    } catch {
      return null;
    }
  }

  async put(key: string, body: Uint8Array) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async measure() {
    let bytes = 0;
    let objects = 0;
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && !e.name.endsWith(".part")) {
          bytes += (await stat(p)).size;
          objects++;
        }
      }
    };
    await walk(path.join(this.root, this.id));
    return { bytes, objects };
  }
}
