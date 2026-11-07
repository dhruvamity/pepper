/**
 * File work for the import command (Node only): hashing, fingerprints (fpcalc), tags
 * (music-metadata), re-encoding plus audio analysis in one ffmpeg pass, and cover images (sharp).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { analyzeSamples, ANALYSIS_SAMPLE_RATE } from "@/lib/audio/features";
import { dominantColorFromPixels } from "@/lib/metadata/color";
import { fromMusicMetadata, normalizeTags, type RawPicture, type TrackDraft } from "@/lib/metadata/normalize";
import type { AudioFeatures } from "@/lib/types";
import { parseFpcalc, type Fingerprint } from "./fingerprint";

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => h.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

function run(cmd: string, args: string[], opts: { stdout?: (chunk: Buffer) => void; timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.stdout.on("data", (c: Buffer) => (opts.stdout ? opts.stdout(c) : (out += c.toString())));
    child.stderr.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-4000)));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

export async function hasCommand(cmd: string, args = ["-version"]): Promise<boolean> {
  try {
    return (await run(cmd, args, { timeoutMs: 10_000 })).code === 0;
  } catch {
    return false;
  }
}

/** Apple's AAC encoder (macOS) is the best ffmpeg has; elsewhere ffmpeg's own AAC encoder. */
export async function aacEncoder(): Promise<"aac_at" | "aac"> {
  const r = await run("ffmpeg", ["-hide_banner", "-encoders"], { timeoutMs: 10_000 });
  return /\baac_at\b/.test(r.out) ? "aac_at" : "aac";
}

export async function fingerprintFile(file: string): Promise<Fingerprint | null> {
  const r = await run("fpcalc", ["-raw", "-length", "120", file], { timeoutMs: 60_000 });
  return r.code === 0 ? parseFpcalc(r.out) : null;
}

export async function readTags(file: string): Promise<{ draft: TrackDraft; picture?: RawPicture }> {
  const { parseFile } = await import("music-metadata");
  const meta = await parseFile(file, { duration: true, skipCovers: false });
  const { tags, format, picture } = fromMusicMetadata(meta);
  return { draft: normalizeTags(tags, format, path.basename(file)), picture };
}

export interface Encoded {
  file: string;
  size: number;
  sha256: string;
  features: AudioFeatures | null;
}

/**
 * Re-encode to AAC in an .m4a (moov atom first, so playback starts before the download ends)
 * and, in the same ffmpeg pass, decode ~90 s from 20% in as mono samples for the analyser —
 * the same window the upload page analyses. `bitrateK` 0 copies the original audio instead.
 */
export async function encodeAndAnalyze(input: string, output: string, durationMs: number, bitrateK: number, encoder: "aac_at" | "aac"): Promise<Encoded> {
  const durS = durationMs / 1000;
  const start = Math.max(0, Math.min(durS * 0.2, durS - 90));
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input];
  if (bitrateK > 0) {
    args.push("-map", "0:a:0", "-vn", "-map_metadata", "0", "-c:a", encoder, "-b:a", `${bitrateK}k`);
    if (encoder === "aac") args.push("-aac_coder", "twoloop");
    args.push("-movflags", "+faststart", output);
  }
  args.push("-map", "0:a:0", "-vn", "-ss", start.toFixed(2), "-t", "90", "-ac", "1", "-ar", String(ANALYSIS_SAMPLE_RATE), "-f", "f32le", "pipe:1");
  const chunks: Buffer[] = [];
  const r = await run("ffmpeg", args, { stdout: (c) => chunks.push(c), timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new Error(`ffmpeg failed: ${r.err.trim().split("\n").pop() ?? r.code}`);
  const pcm = Buffer.concat(chunks);
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  let features: AudioFeatures | null = null;
  try {
    features = samples.length > ANALYSIS_SAMPLE_RATE * 5 ? analyzeSamples(new Float32Array(samples), ANALYSIS_SAMPLE_RATE) : null;
  } catch {
    features = null;
  }
  const file = bitrateK > 0 ? output : input;
  return { file, size: (await stat(file)).size, sha256: await sha256File(file), features };
}

export interface CoverImages {
  sm: Buffer;
  lg: Buffer;
  ext: "webp";
  hash: string;
  color: string;
}

/** Square-crop and resize like the upload page: ~1000 px and 300 px WebP, plus the page colour. */
export async function coverImages(data: Uint8Array): Promise<CoverImages | null> {
  const sharp = (await import("sharp")).default;
  try {
    const img = sharp(Buffer.from(data), { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const side = Math.min(meta.width ?? 0, meta.height ?? 0);
    if (side < 32) return null;
    const lg = await img.clone().resize(Math.min(1000, side), Math.min(1000, side), { fit: "cover" }).webp({ quality: 86 }).toBuffer();
    const sm = await img.clone().resize(Math.min(300, side), Math.min(300, side), { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    const { data: px } = await img.clone().resize(48, 48, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { sm, lg, ext: "webp", hash: createHash("sha256").update(lg).digest("hex").slice(0, 20), color: dominantColorFromPixels(px) };
  } catch {
    return null;
  }
}
