"use client";

/**
 * Admin upload queue. Lives at module level so uploads keep going while the admin browses
 * other pages. Pipeline per file:
 *   read tags → cover art → hash + audio analysis → presign → PUT to R2/B2 → create track.
 */
import { create } from "zustand";
import { cleanMeta, type EditableMeta } from "@/components/admin/track-form";
import { AUDIO_EXTENSIONS, audioMimeFor, type TrackDraft } from "@/lib/metadata/normalize";
import type { AudioFeatures, Lyrics, ProviderId } from "@/lib/types";
import { api, uploadBlob } from "../api";
import { analyze, lyricsFromText, processCover, readTags, sha256Hex, type CoverAsset } from "./process";

export type UploadStatus = "queued" | "reading" | "analyzing" | "ready" | "uploading" | "saving" | "done" | "duplicate" | "error";

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  draft?: TrackDraft;
  meta?: EditableMeta;
  cover?: CoverAsset;
  features?: AudioFeatures | null;
  sha256?: string;
  mime: string;
  lyrics?: Lyrics;
  warnings: string[];
  error?: string;
  trackId?: string;
  provider?: string;
  duplicateOf?: string;
}

interface QueueState {
  items: UploadItem[];
  autoUpload: boolean;
  enrichLyrics: boolean;
  enrichImages: boolean;
  set(patch: Partial<Pick<QueueState, "autoUpload" | "enrichLyrics" | "enrichImages">>): void;
  update(id: string, patch: Partial<UploadItem>): void;
  remove(id: string): void;
  clearFinished(): void;
}

export const useUploads = create<QueueState>((set) => ({
  items: [],
  autoUpload: true,
  enrichLyrics: true,
  enrichImages: true,
  set: (patch) => set(patch),
  update: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id || ["uploading", "saving"].includes(i.status)) })),
  clearFinished: () => set((s) => ({ items: s.items.filter((i) => !["done", "duplicate"].includes(i.status)) })),
}));

const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const base = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").toLowerCase();
const dir = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || "").replace(/[^/]*$/, "");
const FOLDER_ART = /^(cover|folder|front|album|artwork|albumart)$/;

let seq = 0;
const analysisSlots = { busy: 0, max: 2, waiting: [] as (() => void)[] };
const uploadSlots = { busy: 0, max: 2, waiting: [] as (() => void)[] };

async function withSlot<T>(slots: typeof analysisSlots, fn: () => Promise<T>): Promise<T> {
  if (slots.busy >= slots.max) await new Promise<void>((r) => slots.waiting.push(r));
  slots.busy++;
  try {
    return await fn();
  } finally {
    slots.busy--;
    slots.waiting.shift()?.();
  }
}

export function addFiles(list: FileList | File[], onUploaded: () => void) {
  const files = [...list];
  const audio = files.filter((f) => AUDIO_EXTENSIONS.includes(ext(f.name)) || f.type.startsWith("audio/"));
  const lrc = new Map(files.filter((f) => ext(f.name) === "lrc").map((f) => [base(f.name), f]));
  const images = files.filter((f) => f.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(ext(f.name)));
  const imageByBase = new Map(images.map((f) => [base(f.name), f]));
  const folderArt = new Map(images.filter((f) => FOLDER_ART.test(base(f.name))).map((f) => [dir(f), f]));
  const looseArt = images.length === 1 && audio.length > 0 ? images[0] : undefined;

  const items: UploadItem[] = audio.map((file) => ({
    id: `u${Date.now().toString(36)}${(seq++).toString(36)}`,
    file,
    status: "queued",
    progress: 0,
    mime: audioMimeFor(file.name, file.type),
    warnings: [],
  }));
  useUploads.setState((s) => ({ items: [...s.items, ...items] }));
  for (const it of items) {
    const sideLrc = lrc.get(base(it.file.name));
    const sideImg = imageByBase.get(base(it.file.name)) ?? folderArt.get(dir(it.file)) ?? looseArt;
    void prepare(it.id, sideLrc, sideImg, onUploaded);
  }
  return { audio: audio.length, ignored: files.length - audio.length - lrc.size - images.length };
}

async function prepare(id: string, sideLrc: File | undefined, sideImg: File | undefined, onUploaded: () => void) {
  const q = useUploads.getState();
  const item = q.items.find((i) => i.id === id);
  if (!item) return;
  await withSlot(analysisSlots, async () => {
    try {
      q.update(id, { status: "reading" });
      const { draft, picture } = await readTags(item.file);
      const warnings = [...draft.warnings];
      let cover: CoverAsset | undefined;
      try {
        if (picture?.data?.length) cover = await processCover(new Blob([picture.data as BlobPart], { type: picture.format || "image/jpeg" }));
        else if (sideImg) cover = await processCover(sideImg);
      } catch (err) {
        warnings.push(`Cover art could not be read (${(err as Error).message}).`);
      }
      if (!cover) warnings.push("No cover art found — add one after upload.");
      let lyrics = draft.lyrics;
      if (!lyrics && sideLrc) lyrics = lyricsFromText(await sideLrc.text());
      const meta: EditableMeta = { ...draft };
      q.update(id, { status: "analyzing", draft, meta, cover, lyrics, warnings });

      const [sha256, features] = await Promise.all([
        sha256Hex(item.file),
        draft.durationMs > 0 && draft.durationMs < 15 * 60_000 ? analyze(item.file) : Promise.resolve(null),
      ]);
      if (!features) warnings.push("Audio analysis skipped — recommendations will rely on tags and listening data.");
      useUploads.getState().update(id, { status: "ready", sha256, features, warnings });
      if (useUploads.getState().autoUpload) void upload(id, onUploaded);
    } catch (err) {
      useUploads.getState().update(id, { status: "error", error: `Couldn't read this file: ${(err as Error).message}` });
    }
  });
}

interface InitResponse {
  trackId: string;
  duplicate: boolean;
  existing?: { title: string };
  provider?: { id: string; label: string };
  audio?: { provider: ProviderId; key: string; contentType: string; upload: { url: string; method: string; headers: Record<string, string> } };
  cover?: Record<"sm" | "lg", { provider: ProviderId; key: string; contentType: string; upload: { url: string; method: string; headers: Record<string, string> } | null }>;
}

export async function upload(id: string, onUploaded: () => void) {
  const it0 = useUploads.getState().items.find((i) => i.id === id);
  if (!it0 || !["ready", "error"].includes(it0.status) || !it0.sha256 || !it0.meta || !it0.draft) return;
  await withSlot(uploadSlots, async () => {
    const it = useUploads.getState().items.find((i) => i.id === id)!;
    const upd = (p: Partial<UploadItem>) => useUploads.getState().update(id, p);
    try {
      upd({ status: "uploading", progress: 0, error: undefined });
      const fileExt = ext(it.file.name) || "mp3";
      const init = await api<InitResponse>("/api/admin/uploads", {
        body: {
          audio: { sha256: it.sha256, size: it.file.size, contentType: it.mime, ext: fileExt },
          cover: it.cover ? { hash: it.cover.hash, ext: it.cover.ext, sm: { size: it.cover.sm.size }, lg: { size: it.cover.lg.size } } : undefined,
        },
      });
      if (init.duplicate) {
        upd({ status: "duplicate", trackId: init.trackId, duplicateOf: init.existing?.title, progress: 1 });
        return;
      }
      upd({ provider: init.provider?.label });
      const total = it.file.size + (it.cover ? it.cover.sm.size + it.cover.lg.size : 0);
      let doneBytes = 0;
      await uploadBlob(init.audio!.upload, it.file, (f) => upd({ progress: (f * it.file.size) / total }));
      doneBytes += it.file.size;
      const newObjects: { provider: ProviderId; key: string; size: number; contentType: string }[] = [];
      if (it.cover && init.cover) {
        for (const size of ["sm", "lg"] as const) {
          const target = init.cover[size];
          const blob = it.cover[size];
          if (target.upload) {
            await uploadBlob(target.upload, blob, (f) => upd({ progress: (doneBytes + f * blob.size) / total }));
            newObjects.push({ provider: target.provider, key: target.key, size: blob.size, contentType: target.contentType });
          }
          doneBytes += blob.size;
        }
      }
      upd({ status: "saving", progress: 1 });
      const d = it.draft!;
      const meta = cleanMeta(it.meta!);
      const q = useUploads.getState();
      const { track } = await api<{ track: { id: string } }>("/api/admin/tracks", {
        body: {
          ...meta,
          trackId: init.trackId,
          rawTitle: d.rawTitle.slice(0, 500),
          durationMs: d.durationMs || 1,
          comment: d.comment?.slice(0, 1000),
          sourceUrl: d.sourceUrl && /^https?:\/\//.test(d.sourceUrl) ? d.sourceUrl.slice(0, 500) : undefined,
          audio: {
            provider: init.audio!.provider,
            key: init.audio!.key,
            size: it.file.size,
            contentType: it.mime,
            sha256: it.sha256,
            originalName: it.file.name.slice(0, 300),
            bitrate: d.format.bitrate,
            sampleRate: d.format.sampleRate,
            channels: d.format.channels,
            codec: d.format.codec?.slice(0, 60),
            container: d.format.container?.slice(0, 60),
            lossless: d.format.lossless,
          },
          cover:
            it.cover && init.cover
              ? {
                  sm: { provider: init.cover.sm.provider, key: init.cover.sm.key, size: it.cover.sm.size, contentType: init.cover.sm.contentType },
                  lg: { provider: init.cover.lg.provider, key: init.cover.lg.key, size: it.cover.lg.size, contentType: init.cover.lg.contentType },
                  color: it.cover.color,
                }
              : undefined,
          features: it.features ?? undefined,
          lyrics: it.lyrics,
          enrich: { lyrics: q.enrichLyrics, artistImages: q.enrichImages },
          newObjects,
        },
      });
      upd({ status: "done", trackId: track.id });
      onUploaded();
    } catch (err) {
      upd({ status: "error", error: (err as Error).message });
    }
  });
}

export function uploadAllReady(onUploaded: () => void) {
  for (const i of useUploads.getState().items) if (i.status === "ready") void upload(i.id, onUploaded);
}
