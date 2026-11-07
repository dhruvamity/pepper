"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { cleanMeta, TrackForm } from "@/components/admin/track-form";
import { CheckCircleIcon, CloseIcon, EditIcon, UploadIcon } from "@/components/icons";
import { addFiles, upload, uploadAllReady, useUploads, type UploadItem } from "@/lib/client/upload/queue";
import { toast } from "@/lib/client/toast";
import { formatBytes, formatDuration } from "@/lib/util";

const STATUS: Record<UploadItem["status"], string> = {
  queued: "Waiting…",
  reading: "Reading tags & artwork…",
  analyzing: "Analysing audio (tempo, energy)…",
  ready: "Ready to upload",
  uploading: "Uploading",
  saving: "Saving to library…",
  done: "Added to library",
  duplicate: "Already in library",
  error: "Failed",
};

function Pill({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "good" | "warn" }) {
  const cls = tone === "good" ? "bg-accent/15 text-accent" : tone === "warn" ? "bg-warning/15 text-warning" : "bg-white/10 text-subdued";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function Card({ it, onUploaded }: { it: UploadItem; onUploaded: () => void }) {
  const [open, setOpen] = useState(false);
  const update = useUploads((s) => s.update);
  const remove = useUploads((s) => s.remove);
  const m = it.meta;
  const busy = ["uploading", "saving"].includes(it.status);
  const pct = Math.round(it.progress * 100);
  return (
    <li className="overflow-hidden rounded-lg bg-card">
      <div className="flex gap-3 p-3 sm:gap-4 sm:p-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded bg-elevated sm:h-24 sm:w-24">
          {it.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.cover.previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">{it.status === "reading" || it.status === "queued" ? "…" : "No art"}</div>
          )}
          {it.cover && <span className="absolute bottom-1 left-1 h-3 w-3 rounded-full ring-2 ring-black/40" style={{ backgroundColor: it.cover.color }} title={`Accent colour ${it.cover.color}`} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-bold">{m?.title ?? it.file.name}</div>
              {m?.subtitle && <div className="truncate text-xs text-subdued">{m.subtitle}</div>}
              <div className="truncate text-sm text-subdued">{m ? m.artists.join(", ") : formatBytes(it.file.size)}</div>
              {m && (
                <div className="truncate text-xs text-muted">
                  {m.album}
                  {m.year ? ` · ${m.year}` : ""}
                </div>
              )}
            </div>
            {!busy && it.status !== "done" && (
              <button type="button" onClick={() => remove(it.id)} aria-label="Remove from queue" className="p-1 text-subdued hover:text-white">
                <CloseIcon size={16} />
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m?.genres.map((g) => (
              <Pill key={g}>{g}</Pill>
            ))}
            {it.draft?.durationMs ? <Pill>{formatDuration(it.draft.durationMs)}</Pill> : null}
            {it.draft?.format.bitrate ? <Pill>{Math.round(it.draft.format.bitrate / 1000)} kbps</Pill> : null}
            {it.features?.bpm ? <Pill>{it.features.bpm} BPM</Pill> : null}
            {it.features ? <Pill>Energy {Math.round(it.features.energy * 100)}</Pill> : null}
            {it.lyrics ? <Pill tone="good">{it.lyrics.synced?.length ? "Synced lyrics" : "Lyrics"}</Pill> : null}
            {m?.label ? <Pill>{m.label}</Pill> : null}
            {it.provider ? <Pill tone="good">→ {it.provider}</Pill> : null}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            {it.status === "done" ? (
              <span className="flex items-center gap-1 font-semibold text-accent">
                <CheckCircleIcon size={14} /> {STATUS.done}
              </span>
            ) : it.status === "error" ? (
              <span className="font-semibold text-danger">{it.error}</span>
            ) : it.status === "duplicate" ? (
              <span className="font-semibold text-warning">
                {STATUS.duplicate}
                {it.duplicateOf ? ` (“${it.duplicateOf}”)` : ""}
              </span>
            ) : (
              <span className="text-subdued">
                {STATUS[it.status]}
                {it.status === "uploading" ? ` ${pct}%` : ""}
              </span>
            )}
          </div>
          {(busy || it.status === "reading" || it.status === "analyzing") && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full bg-accent transition-[width] ${it.status === "uploading" ? "" : "w-1/3 animate-pulse"}`} style={it.status === "uploading" ? { width: `${pct}%` } : undefined} />
            </div>
          )}
          {it.warnings.length > 0 && it.status !== "done" && (
            <ul className="mt-2 space-y-0.5 text-xs text-warning/90">
              {it.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-white/5 px-3 py-2">
        {it.status === "done" && it.trackId && (
          <>
            <Link href={`/track/${it.trackId}`} className="rounded-full px-3 py-1.5 text-xs font-bold text-subdued hover:text-white">
              Open song
            </Link>
            <Link href={`/admin/library?edit=${it.trackId}`} className="rounded-full px-3 py-1.5 text-xs font-bold text-subdued hover:text-white">
              Edit
            </Link>
          </>
        )}
        {m && ["ready", "error"].includes(it.status) && (
          <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-subdued hover:text-white">
            <EditIcon size={12} /> {open ? "Done editing" : "Edit details"}
          </button>
        )}
        {["ready", "error"].includes(it.status) && it.sha256 && (
          <button type="button" onClick={() => upload(it.id, onUploaded)} className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black hover:scale-105">
            {it.status === "error" ? "Retry" : "Upload"}
          </button>
        )}
      </div>
      {open && m && (
        <div className="border-t border-white/5 p-4">
          <TrackForm value={m} onChange={(v) => update(it.id, { meta: { ...v, ...{ title: v.title } } })} />
          <p className="mt-3 text-xs text-muted">Preview of what will be saved: {cleanMeta(m).title} — {cleanMeta(m).artists.join(", ")}</p>
        </div>
      )}
    </li>
  );
}

export default function UploadPage() {
  const { mutate } = useSWRConfig();
  const onUploaded = () => {
    void mutate("/api/catalog");
    void mutate("/api/home");
  };
  const items = useUploads((s) => s.items);
  const autoUpload = useUploads((s) => s.autoUpload);
  const enrichLyrics = useUploads((s) => s.enrichLyrics);
  const enrichImages = useUploads((s) => s.enrichImages);
  const setOpts = useUploads((s) => s.set);
  const clearFinished = useUploads((s) => s.clearFinished);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const counts = items.reduce<Record<string, number>>((a, i) => ((a[i.status] = (a[i.status] ?? 0) + 1), a), {});
  const take = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const r = addFiles(files, onUploaded);
    if (!r.audio) toast("No audio files found in that selection", "error");
  };

  return (
    <div className="px-4 sm:px-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          take(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${drag ? "border-accent bg-accent/10" : "border-white/20 bg-white/[0.03]"}`}
      >
        <UploadIcon size={40} className="text-subdued" />
        <h2 className="mt-3 text-xl font-bold">Drop music here</h2>
        <p className="mt-1 max-w-md text-sm text-subdued">
          MP3, M4A, FLAC, OGG, OPUS or WAV. Title, artists, album, cover art, genre, year, label and embedded lyrics are read from the file automatically. Drop matching
          <code className="mx-1 text-white">.lrc</code>files or <code className="mx-1 text-white">cover.jpg</code> alongside to add synced lyrics or artwork.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-full bg-accent px-6 py-3 text-sm font-bold text-black transition hover:scale-105 hover:bg-accent-hover">
            Choose files
          </button>
          <button type="button" onClick={() => folderRef.current?.click()} className="rounded-full border border-white/40 px-6 py-3 text-sm font-bold transition hover:border-white">
            Choose a folder
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.aac,.lrc,image/*"
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[#1ed760]" checked={autoUpload} onChange={(e) => setOpts({ autoUpload: e.target.checked })} />
          Upload automatically after reading
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[#1ed760]" checked={enrichLyrics} onChange={(e) => setOpts({ enrichLyrics: e.target.checked })} />
          Find synced lyrics (LRCLIB)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[#1ed760]" checked={enrichImages} onChange={(e) => setOpts({ enrichImages: e.target.checked })} />
          Find artist photos (Deezer)
        </label>
      </div>

      {items.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-subdued">
              {items.length} file{items.length === 1 ? "" : "s"}
              {counts.done ? ` · ${counts.done} added` : ""}
              {counts.duplicate ? ` · ${counts.duplicate} duplicates` : ""}
              {counts.error ? ` · ${counts.error} failed` : ""}
            </div>
            <div className="flex gap-2">
              {counts.ready ? (
                <button type="button" onClick={() => uploadAllReady(onUploaded)} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-black hover:scale-105">
                  Upload {counts.ready} ready
                </button>
              ) : null}
              {counts.done || counts.duplicate ? (
                <button type="button" onClick={clearFinished} className="rounded-full border border-white/30 px-4 py-2 text-sm font-bold hover:border-white">
                  Clear finished
                </button>
              ) : null}
            </div>
          </div>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {items.map((it) => (
              <Card key={it.id} it={it} onUploaded={onUploaded} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
