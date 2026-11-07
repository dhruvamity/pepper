"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/client/api";
import { useCatalog } from "@/lib/client/catalog";
import { createPlaylist, updatePlaylist, useLibraryActions, useMe } from "@/lib/client/me";
import { shareLink, startRadio } from "@/lib/client/player/radio";
import { usePlayer } from "@/lib/client/player/store";
import { toast, useToasts } from "@/lib/client/toast";
import { useUI } from "@/lib/client/ui";
import { languageName, normalizeLanguage } from "@/lib/metadata/language";
import type { AudioFeatures, Lyrics, Track } from "@/lib/types";
import { formatBytes, formatDuration } from "@/lib/util";
import {
  AlbumIcon,
  ArtistIcon,
  CheckCircleIcon,
  EditIcon,
  HeartIcon,
  MusicNoteIcon,
  PlusCircleIcon,
  PlusIcon,
  QueueIcon,
  RadioIcon,
  ShareIcon,
  TrashIcon,
} from "../icons";
import { Cover } from "./cover";
import { Sheet, SheetItem } from "./sheet";

export function TrackMenuSheet() {
  const menu = useUI((s) => s.trackMenu);
  const close = useUI((s) => s.closeTrackMenu);
  const openAdd = useUI((s) => s.openAddToPlaylist);
  const openCredits = useUI((s) => s.openCredits);
  const { catalog } = useCatalog();
  const { data: me } = useMe();
  const { isLiked, toggleLike } = useLibraryActions();
  const router = useRouter();
  const t = menu ? catalog?.byId.get(menu.trackId) : undefined;
  if (!menu || !t) return null;
  const liked = isLiked(t.id);
  const ownPlaylist = menu.playlistId && me?.playlists.some((p) => p.id === menu.playlistId);
  const go = (href: string) => {
    close();
    router.push(href);
  };

  return (
    <Sheet open onClose={close} label={`Options for ${t.title}`}>
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <Cover image={t.cover} className="h-14 w-14 shrink-0" />
        <div className="min-w-0">
          <div className="truncate font-bold">{t.title}</div>
          <div className="truncate text-sm text-subdued">{t.artists.map((a) => a.name).join(", ")}</div>
        </div>
      </div>
      <div className="py-2">
        <SheetItem
          icon={liked ? <CheckCircleIcon className="text-accent" /> : <HeartIcon />}
          onClick={() => {
            toggleLike(t.id);
            close();
          }}
        >
          {liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
        </SheetItem>
        <SheetItem icon={<PlusCircleIcon />} onClick={() => openAdd([t.id])}>
          Add to playlist
        </SheetItem>
        {ownPlaylist && (
          <SheetItem
            icon={<TrashIcon />}
            onClick={async () => {
              close();
              await updatePlaylist(menu.playlistId!, { remove: [t.id] });
              toast("Removed from playlist");
            }}
          >
            Remove from this playlist
          </SheetItem>
        )}
        <SheetItem
          icon={<QueueIcon />}
          onClick={() => {
            usePlayer.getState().addToQueue([t.id]);
            toast("Added to queue");
            close();
          }}
        >
          Add to queue
        </SheetItem>
        <SheetItem
          icon={<PlusIcon />}
          onClick={() => {
            usePlayer.getState().playNext([t.id]);
            toast("Playing next");
            close();
          }}
        >
          Play next
        </SheetItem>
        <SheetItem
          icon={<RadioIcon />}
          onClick={() => {
            close();
            startRadio(t.id, t.title);
          }}
        >
          Go to song radio
        </SheetItem>
        <SheetItem icon={<AlbumIcon />} onClick={() => go(`/album/${t.album.id}`)}>
          View album
        </SheetItem>
        {t.artists.map((a) => (
          <SheetItem key={a.id} icon={<ArtistIcon />} onClick={() => go(`/artist/${a.id}`)}>
            View {a.name}
          </SheetItem>
        ))}
        <SheetItem icon={<MusicNoteIcon />} onClick={() => go(`/track/${t.id}`)}>
          Song page &amp; lyrics
        </SheetItem>
        <SheetItem icon={<EditIcon />} onClick={() => openCredits(t.id)}>
          Show credits
        </SheetItem>
        <SheetItem
          icon={<ShareIcon />}
          onClick={() => {
            close();
            shareLink(`/track/${t.id}`, t.title);
          }}
        >
          Share
        </SheetItem>
        {me?.user.isAdmin && (
          <SheetItem icon={<EditIcon />} onClick={() => go(`/admin/library?edit=${t.id}`)}>
            Edit details (admin)
          </SheetItem>
        )}
      </div>
    </Sheet>
  );
}

export function AddToPlaylistSheet() {
  const ids = useUI((s) => s.addToPlaylist);
  const close = useUI((s) => s.closeAddToPlaylist);
  const { data: me } = useMe();
  const [busy, setBusy] = useState(false);
  if (!ids) return null;
  const add = async (playlistId: string, name: string) => {
    setBusy(true);
    try {
      await updatePlaylist(playlistId, { add: ids });
      toast(`Added to ${name}`);
      close();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={close} label="Add to playlist">
      <div className="px-5 pb-2 pt-4 text-center text-base font-bold">Add to playlist</div>
      <div className="flex justify-center pb-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const p = await createPlaylist({ trackIds: ids });
              toast(`Added to ${p.name}`);
              close();
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition hover:scale-105"
        >
          New playlist
        </button>
      </div>
      <div className="max-h-[50dvh] overflow-y-auto pb-2">
        {me?.playlists.map((p) => (
          <SheetItem key={p.id} icon={<MusicNoteIcon />} onClick={() => add(p.id, p.name)}>
            <span className="block">{p.name}</span>
            <span className="block text-xs text-subdued">{p.trackIds.length} songs</span>
          </SheetItem>
        ))}
        {!me?.playlists.length && <p className="px-5 pb-4 text-center text-sm text-subdued">You don&apos;t have any playlists yet.</p>}
      </div>
    </Sheet>
  );
}

function Feature({ label, value, pct }: { label: string; value: string; pct?: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-subdued">
        <span>{label}</span>
        <span className="tabular-nums text-white">{value}</span>
      </div>
      {pct !== undefined && (
        <div className="mt-1 h-1 rounded-full bg-white/15">
          <div className="h-1 rounded-full bg-accent" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function AudioFeatureBars({ f }: { f: AudioFeatures }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      <Feature label="Tempo" value={f.bpm ? `${f.bpm} BPM` : "—"} />
      <Feature label="Loudness" value={`${f.loudness.toFixed(1)} dB`} />
      <Feature label="Energy" value={`${Math.round(f.energy * 100)}`} pct={f.energy} />
      <Feature label="Danceability" value={`${Math.round(f.danceability * 100)}`} pct={f.danceability} />
      <Feature label="Brightness" value={`${Math.round(f.brightness * 100)}`} pct={f.brightness} />
      <Feature label="Rhythm" value={`${Math.round(f.rhythm * 100)}`} pct={f.rhythm} />
    </div>
  );
}

type FullTrack = Omit<Track, "audio" | "uploadedBy"> & {
  format: { codec?: string; container?: string; bitrate?: number; sampleRate?: number; channels?: number; lossless?: boolean; size: number; provider: string };
};

export function CreditsSheet() {
  const id = useUI((s) => s.credits);
  const close = () => useUI.getState().openCredits(null);
  const { data } = useSWR<{ track: FullTrack; lyrics: Lyrics | null }>(id ? `/api/tracks/${id}` : null, fetcher);
  if (!id) return null;
  const t = data?.track;
  const rows: [string, React.ReactNode][] = t
    ? ([
        ["Performed by", t.artists.map((a) => a.name).join(", ")],
        ["Album artist", t.albumArtist?.name],
        ["Composed by", t.composers?.join(", ")],
        ["Lyrics by", t.lyricists?.join(", ")],
        ["Produced by", t.producers?.join(", ")],
        ["From", t.film],
        ["Album", t.album.title],
        ["Track", t.trackNo ? `${t.trackNo}${t.trackTotal ? ` of ${t.trackTotal}` : ""}${t.discNo && (t.discTotal ?? 1) > 1 ? ` · Disc ${t.discNo}` : ""}` : undefined],
        ["Genre", t.genres.join(", ")],
        ["Released", t.releaseDate ?? t.year],
        ["Duration", formatDuration(t.durationMs)],
        ["Label", t.label],
        ["Copyright", t.copyright],
        ["ISRC", t.isrc],
        ["Language", languageName(normalizeLanguage(t.language) ?? t.language)],
        [
          "File",
          [t.format.codec, t.format.bitrate ? `${Math.round(t.format.bitrate / 1000)} kbps` : "", t.format.sampleRate ? `${(t.format.sampleRate / 1000).toFixed(1)} kHz` : "", formatBytes(t.format.size)]
            .filter(Boolean)
            .join(" · "),
        ],
        ["Stored on", t.format.provider === "r2" ? "Cloudflare R2" : "Backblaze B2"],
        ["Source", t.sourceUrl ? <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">{t.sourceUrl}</a> : undefined],
      ] as [string, React.ReactNode][]).filter(([, v]) => v !== undefined && v !== "" && v !== null)
    : [];
  return (
    <Sheet open onClose={close} label="Credits" wide>
      <div className="px-6 pb-4 pt-5">
        <h2 className="text-xl font-bold">Credits</h2>
        {!t ? (
          <div className="mt-6 h-40 animate-pulse rounded-lg bg-white/5" />
        ) : (
          <>
            <div className="mt-4 flex items-center gap-3">
              <Cover image={t.cover} className="h-16 w-16" />
              <div className="min-w-0">
                <div className="truncate text-lg font-bold">{t.title}</div>
                {t.subtitle && <div className="truncate text-sm text-subdued">{t.subtitle}</div>}
              </div>
            </div>
            <dl className="mt-5 divide-y divide-white/5">
              {rows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[120px_1fr] gap-3 py-2 text-sm">
                  <dt className="text-subdued">{k}</dt>
                  <dd className="min-w-0 text-white">{v}</dd>
                </div>
              ))}
            </dl>
            {t.features && (
              <div className="mt-5">
                <h3 className="mb-3 text-sm font-bold">Audio analysis</h3>
                <AudioFeatureBars f={t.features} />
              </div>
            )}
            <div className="mt-5 flex gap-3">
              <Link href={`/album/${t.album.id}`} onClick={close} className="rounded-full border border-white/30 px-4 py-2 text-sm font-bold hover:border-white">
                View album
              </Link>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+var(--mini-player-h)+env(safe-area-inset-bottom)+16px)] z-[80] flex flex-col items-center gap-2 px-4 md:bottom-[calc(var(--player-bar-h)+24px)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`animate-fade-in rounded-lg px-4 py-3 text-sm font-semibold shadow-float ${t.tone === "error" ? "bg-danger text-black" : "bg-[#3d91f4] text-white"}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
