"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { TrackForm, cleanMeta, type EditableMeta } from "@/components/admin/track-form";
import { EditIcon, TrashIcon } from "@/components/icons";
import { Cover } from "@/components/ui/cover";
import { Sheet } from "@/components/ui/sheet";
import { api, uploadBlob } from "@/lib/client/api";
import { artistImage, useCatalog, usePopularity } from "@/lib/client/catalog";
import { toast } from "@/lib/client/toast";
import { lyricsFromText, processCover, type CoverAsset } from "@/lib/client/upload/process";
import { languageName } from "@/lib/metadata/language";
import type { Lyrics, ProviderId, Track } from "@/lib/types";
import { fold, formatDuration, providerName } from "@/lib/util";

/** Songs without genre/language details yet (e.g. uploaded before autoplay used them). */
function EnrichBanner({ missing }: { missing: number }) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  if (!missing && !busy) return null;
  const run = async () => {
    setBusy(true);
    setProgress({ done: 0, total: missing });
    try {
      for (;;) {
        const r = await api<{ updated: unknown[]; failed: number; remaining: { tracks: number; artists: number } }>("/api/admin/enrich", { body: { limit: 4 } });
        setProgress((p) => ({ done: p.done + r.updated.length, total: p.total }));
        if (!r.remaining.tracks && !r.remaining.artists) break;
        if (!r.updated.length && r.failed) {
          toast("Apple's catalog is busy. Try again in a minute.", "error");
          break;
        }
      }
      await mutate("/api/catalog");
      toast("Genres and languages filled in");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 text-subdued">
        {busy
          ? `Looking up genres and languages… ${progress.done} of ${progress.total} songs`
          : `${missing} ${missing === 1 ? "song doesn't" : "songs don't"} have genre and language details yet. Autoplay uses them to pick songs that fit.`}
      </p>
      <button type="button" disabled={busy} onClick={run} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black disabled:opacity-60">
        {busy ? "Working…" : "Fill them in"}
      </button>
    </div>
  );
}

type Upload = { provider: ProviderId; key: string; contentType: string; upload: { url: string; method: string; headers: Record<string, string> } | null };

async function uploadImage(asset: CoverAsset, purpose: "cover" | "artist") {
  const init = await api<{ cover: Record<"sm" | "lg", Upload> }>("/api/admin/uploads", {
    body: { cover: { hash: asset.hash, ext: asset.ext, purpose, sm: { size: asset.sm.size }, lg: { size: asset.lg.size } } },
  });
  const newObjects: { provider: ProviderId; key: string; size: number; contentType: string }[] = [];
  for (const size of ["sm", "lg"] as const) {
    const t = init.cover[size];
    if (t.upload) {
      await uploadBlob(t.upload, asset[size]);
      newObjects.push({ provider: t.provider, key: t.key, size: asset[size].size, contentType: t.contentType });
    }
  }
  const obj = (s: "sm" | "lg") => ({ provider: init.cover[s].provider, key: init.cover[s].key, size: asset[s].size, contentType: init.cover[s].contentType });
  return { image: { sm: obj("sm"), lg: obj("lg"), color: asset.color }, newObjects };
}

function lyricsToText(l: Lyrics | null): string {
  if (!l) return "";
  if (l.synced?.length) {
    return l.synced
      .map((x) => {
        const m = Math.floor(x.t / 60000);
        const s = ((x.t % 60000) / 1000).toFixed(2).padStart(5, "0");
        return `[${String(m).padStart(2, "0")}:${s}]${x.text}`;
      })
      .join("\n");
  }
  return l.plain ?? "";
}

function Editor({ id, onClose }: { id: string; onClose: () => void }) {
  const { mutate } = useSWRConfig();
  const [track, setTrack] = useState<Track | null>(null);
  const [meta, setMeta] = useState<EditableMeta | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [origLyrics, setOrigLyrics] = useState("");
  const [cover, setCover] = useState<CoverAsset | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ track: Track; lyrics: Lyrics | null }>(`/api/admin/tracks/${id}`)
      .then(({ track, lyrics }) => {
        setTrack(track);
        setMeta({
          title: track.title,
          subtitle: track.subtitle,
          artists: track.artists.map((a) => a.name),
          albumArtist: track.albumArtist?.name,
          album: track.album.title,
          film: track.film,
          genres: track.genres,
          year: track.year,
          releaseDate: track.releaseDate,
          trackNo: track.trackNo,
          trackTotal: track.trackTotal,
          discNo: track.discNo,
          label: track.label,
          copyright: track.copyright,
          explicit: track.explicit,
          composers: track.composers ?? [],
          lyricists: track.lyricists ?? [],
          language: track.language,
          isrc: track.isrc,
        });
        const text = lyricsToText(lyrics);
        setLyrics(text);
        setOrigLyrics(text);
      })
      .catch((e) => toast(e.message, "error"));
  }, [id]);

  const save = async () => {
    if (!meta) return;
    setBusy(true);
    try {
      let coverPatch = {};
      if (cover) {
        const up = await uploadImage(cover, "cover");
        coverPatch = { cover: up.image, newObjects: up.newObjects };
      }
      const lyricsPatch = lyrics !== origLyrics ? { lyrics: lyrics.trim() ? lyricsFromText(lyrics) : null } : {};
      await api(`/api/admin/tracks/${id}`, { method: "PATCH", body: { ...cleanMeta(meta), ...coverPatch, ...lyricsPatch } });
      await mutate("/api/catalog");
      await mutate(`/api/tracks/${id}`);
      toast("Saved");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!track || !confirm(`Delete “${track.title}” from the library? The audio file is removed from storage.`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/tracks/${id}`, { method: "DELETE" });
      await mutate("/api/catalog");
      toast("Deleted");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} label="Edit track" wide>
      <div className="p-5">
        <h2 className="text-xl font-bold">Edit details</h2>
        {!meta || !track ? (
          <div className="mt-4 h-60 animate-pulse rounded bg-white/5" />
        ) : (
          <>
            <div className="mt-4 flex items-center gap-4">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded bg-elevated">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {cover ? <img src={cover.previewUrl} alt="" className="h-full w-full object-cover" /> : <Cover image={track.cover} className="h-24 w-24" />}
              </div>
              <div className="text-sm">
                <label className="inline-block cursor-pointer rounded-full border border-white/40 px-4 py-2 font-bold hover:border-white">
                  Replace artwork
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setCover(await processCover(f));
                    }}
                  />
                </label>
                <p className="mt-2 text-xs text-subdued">
                  {track.audio.codec} · {track.audio.bitrate ? `${Math.round(track.audio.bitrate / 1000)} kbps · ` : ""}
                  {formatDuration(track.durationMs)} · stored on {providerName(track.audio.provider)}
                </p>
                <p className="mt-1 break-all text-xs text-muted">Original tag: {track.rawTitle}</p>
              </div>
            </div>
            <div className="mt-5">
              <TrackForm value={meta} onChange={setMeta} />
            </div>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold text-subdued">Lyrics — paste plain text or LRC ([mm:ss.xx] line) for synced lyrics</span>
              <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={6} className="w-full rounded-md bg-white/[0.07] p-3 font-mono text-xs outline-none ring-1 ring-white/10 focus:ring-white/40" />
            </label>
            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={del} disabled={busy} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-danger hover:bg-danger/10">
                <TrashIcon size={16} /> Delete
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-bold text-subdued hover:text-white">
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={busy} className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black hover:scale-105 disabled:opacity-50">
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function LibraryInner() {
  const { mutate } = useSWRConfig();
  const { catalog } = useCatalog();
  const { data: pop } = usePopularity();
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"tracks" | "artists">("tracks");
  const editing = params.get("edit");
  const rows = useMemo(() => {
    const list = catalog?.tracks ?? [];
    const f = fold(q);
    return f ? list.filter((t) => fold(`${t.title} ${t.artists.map((a) => a.name).join(" ")} ${t.album.title} ${t.genres.join(" ")}`).includes(f)) : list;
  }, [catalog, q]);
  const artists = useMemo(() => [...(catalog?.artists.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [catalog]);

  return (
    <div className="px-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, artist, album or genre" className="h-10 w-full max-w-sm rounded-full bg-white/10 px-4 text-sm outline-none placeholder:text-subdued focus:bg-white/15" />
        <div className="flex gap-2">
          {(["tracks", "artists"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize ${tab === t ? "bg-white text-black" : "bg-white/10 hover:bg-white/20"}`}>
              {t}
            </button>
          ))}
        </div>
        <span className="text-sm text-subdued">{tab === "tracks" ? `${rows.length} songs` : `${artists.length} artists`}</span>
      </div>
      <EnrichBanner missing={catalog?.tracks.filter((t) => !t.enrichedAt).length ?? 0} />

      {tab === "tracks" ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs text-subdued">
              <tr>
                <th className="py-2 pr-3 font-semibold">Title</th>
                <th className="py-2 pr-3 font-semibold">Album</th>
                <th className="py-2 pr-3 font-semibold">Genre · language</th>
                <th className="py-2 pr-3 font-semibold">Year</th>
                <th className="py-2 pr-3 font-semibold">Plays</th>
                <th className="py-2 pr-3 font-semibold">Added</th>
                <th className="py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="group border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-3">
                      <Cover image={t.cover} className="h-10 w-10 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{t.title}</div>
                        <div className="truncate text-xs text-subdued">{t.artists.map((a) => a.name).join(", ")}</div>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-[220px] truncate py-2 pr-3 text-subdued">{t.album.title}</td>
                  <td className="py-2 pr-3 text-subdued">{[t.genres.join(", "), languageName(t.language)].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-2 pr-3 tabular-nums text-subdued">{t.year ?? "—"}</td>
                  <td className="py-2 pr-3 tabular-nums text-subdued">{pop?.[t.id]?.plays ?? 0}</td>
                  <td className="py-2 pr-3 text-subdued">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => router.replace(`/admin/library?edit=${t.id}`)} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-subdued hover:bg-white/10 hover:text-white">
                      <EditIcon size={12} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="py-10 text-center text-subdued">No songs match.</p>}
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {artists.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-lg bg-card p-3">
              <Cover image={artistImage(a)} className="h-14 w-14 shrink-0" rounded="rounded-full" kind="artist" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{a.name}</div>
                <div className="text-xs text-subdued">
                  {a.trackIds.length} songs · {a.image ? "photo set" : "using album art"}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="cursor-pointer rounded-full bg-white/10 px-3 py-1 text-center text-xs font-bold hover:bg-white/20">
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        const up = await uploadImage(await processCover(f), "artist");
                        await api(`/api/admin/artists/${a.id}`, { method: "PATCH", body: { image: up.image, newObjects: up.newObjects } });
                        await mutate("/api/catalog");
                        toast("Artist photo updated");
                      } catch (err) {
                        toast((err as Error).message, "error");
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api(`/api/admin/artists/${a.id}`, { method: "PATCH", body: { refetchImage: true } });
                      await mutate("/api/catalog");
                      toast("Found a photo");
                    } catch (err) {
                      toast((err as Error).message, "error");
                    }
                  }}
                  className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold hover:bg-white/20"
                >
                  Find
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <Editor id={editing} onClose={() => router.replace("/admin/library")} />}
    </div>
  );
}

export default function AdminLibraryPage() {
  return (
    <Suspense>
      <LibraryInner />
    </Suspense>
  );
}
