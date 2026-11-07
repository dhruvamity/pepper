"use client";

import { parseBlob } from "music-metadata";
import { fromMusicMetadata, normalizeTags, type TrackDraft } from "@/lib/metadata/normalize";
import { looksLikeLrc, parseLrc, syncedToPlain } from "@/lib/metadata/lrc";
import type { AudioFeatures, Lyrics } from "@/lib/types";
import { dominantColorFromPixels } from "@/lib/metadata/color";
import { analyzeAudioFile } from "./audio-features";

export interface CoverAsset {
  sm: Blob;
  lg: Blob;
  ext: "webp" | "jpg";
  hash: string;
  color: string;
  width: number;
  height: number;
  previewUrl: string;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function encode(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<{ blob: Blob; ext: "webp" | "jpg" }> {
  const toBlob = (type: string) =>
    "convertToBlob" in canvas
      ? (canvas as OffscreenCanvas).convertToBlob({ type, quality })
      : new Promise<Blob>((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, quality));
  const webp = await toBlob("image/webp");
  if (webp.type === "image/webp") return { blob: webp, ext: "webp" };
  return { blob: await toBlob("image/jpeg"), ext: "jpg" }; // Safari can't encode WebP
}

function draw(bitmap: ImageBitmap, size: number): HTMLCanvasElement {
  // Centre-crop to a square (covers are square, but some files embed 16:9 thumbnails).
  const s = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - s) / 2;
  const sy = (bitmap.height - s) / 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size);
  return c;
}

/** Dominant, reasonably vivid colour for page gradients (Spotify-style headers). */
export function dominantColor(bitmap: ImageBitmap): string {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, 48, 48);
  return dominantColorFromPixels(ctx.getImageData(0, 0, 48, 48).data);
}

export async function processCover(source: Blob): Promise<CoverAsset> {
  const bitmap = await createImageBitmap(source);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const lgSize = Math.min(1000, side);
    const lg = await encode(draw(bitmap, lgSize), 0.86);
    const sm = await encode(draw(bitmap, Math.min(300, side)), 0.82);
    const color = dominantColor(bitmap);
    const hash = (await sha256Hex(lg.blob)).slice(0, 20);
    return { sm: sm.blob, lg: lg.blob, ext: lg.ext === sm.ext ? lg.ext : "jpg", hash, color, width: bitmap.width, height: bitmap.height, previewUrl: URL.createObjectURL(sm.blob) };
  } finally {
    bitmap.close();
  }
}

export interface Prepared {
  draft: TrackDraft;
  cover?: CoverAsset;
  features: AudioFeatures | null;
  sha256: string;
  mime: string;
}

export async function readTags(file: File) {
  const meta = await parseBlob(file, { duration: true, skipCovers: false });
  const { tags, format, picture } = fromMusicMetadata(meta);
  const draft = normalizeTags(tags, format, file.name);
  return { draft, picture };
}

export function lyricsFromText(text: string): Lyrics | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (looksLikeLrc(t)) {
    const synced = parseLrc(t);
    if (synced.length) return { synced, plain: syncedToPlain(synced), source: "lrc" };
  }
  return { plain: t, source: "manual" };
}

export async function analyze(file: File) {
  return analyzeAudioFile(file);
}
