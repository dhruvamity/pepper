"use client";

import Link from "next/link";
import { memo } from "react";
import { useLibraryActions } from "@/lib/client/me";
import { usePlayer, type PlayContext } from "@/lib/client/player/store";
import { useUI } from "@/lib/client/ui";
import type { CatalogTrack } from "@/lib/types";
import { formatDuration } from "@/lib/util";
import { Equalizer, ExplicitBadge, HeartIcon, MoreIcon, PauseIcon, PlayIcon } from "../icons";
import { Cover } from "./cover";

export function ArtistLinks({ artists, className = "" }: { artists: CatalogTrack["artists"]; className?: string }) {
  return (
    <span className={className}>
      {artists.map((a, i) => (
        <span key={a.id}>
          {i > 0 && ", "}
          <Link href={`/artist/${a.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-white hover:underline">
            {a.name}
          </Link>
        </span>
      ))}
    </span>
  );
}

interface Props {
  track: CatalogTrack;
  index?: number;
  showCover?: boolean;
  showAlbum?: boolean;
  showIndex?: boolean;
  reason?: string;
  meta?: string;
  context?: PlayContext;
  playlistId?: string;
  onPlay: () => void;
}

export const TrackRow = memo(function TrackRow({ track, index, showCover = true, showAlbum = true, showIndex = false, reason, meta, context, playlistId, onPlay }: Props) {
  const isCurrent = usePlayer((s) => s.currentId === track.id);
  const playing = usePlayer((s) => s.playing && s.currentId === track.id);
  const { isLiked, toggleLike } = useLibraryActions();
  const openMenu = useUI((s) => s.openTrackMenu);
  const liked = isLiked(track.id);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => {
        if (e.key === "Enter") onPlay();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(track.id, context, playlistId);
      }}
      className="group grid cursor-pointer select-none grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10 active:bg-white/5 md:grid-cols-[var(--track-cols)] md:gap-4 md:px-4"
      style={{ "--track-cols": showAlbum ? (showIndex ? "16px 6fr 4fr minmax(120px,1fr)" : "6fr 4fr minmax(120px,1fr)") : showIndex ? "16px 1fr minmax(120px,auto)" : "1fr minmax(120px,auto)" } as React.CSSProperties}
    >
      {showIndex && (
        <div className="hidden w-4 justify-center text-[15px] tabular-nums text-subdued md:flex">
          {isCurrent ? (
            <span className="group-hover:hidden">
              <Equalizer playing={playing} />
            </span>
          ) : (
            <span className="group-hover:hidden">{(index ?? 0) + 1}</span>
          )}
          <span className="hidden text-white group-hover:inline">{playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}</span>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-3">
        {showCover && <Cover image={track.cover} className="h-12 w-12 shrink-0 md:h-10 md:w-10" alt="" />}
        <div className="min-w-0">
          <div className={`truncate text-[15px] leading-tight md:text-base ${isCurrent ? "text-accent" : "text-white"}`}>
            {track.title}
            {track.subtitle && <span className="ml-1.5 text-[13px] text-subdued">{track.subtitle}</span>}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center text-[13px] text-subdued md:text-sm">
            {isCurrent && !showIndex && <Equalizer playing={playing} className="mr-1.5 md:hidden" />}
            {track.explicit && <ExplicitBadge />}
            <span className="truncate">
              {reason ? (
                <>
                  <ArtistLinks artists={track.artists} /> <span className="text-muted">· {reason}</span>
                </>
              ) : meta ? (
                meta
              ) : (
                <ArtistLinks artists={track.artists} />
              )}
            </span>
          </div>
        </div>
      </div>
      {showAlbum && (
        <Link
          href={`/album/${track.album.id}`}
          onClick={(e) => e.stopPropagation()}
          className="hidden truncate text-sm text-subdued hover:text-white hover:underline md:block"
        >
          {track.album.title}
        </Link>
      )}
      <div className="flex items-center justify-end gap-1 md:gap-3">
        <button
          type="button"
          aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track.id);
          }}
          className={`hidden md:inline-flex ${liked ? "text-accent" : "text-subdued opacity-0 hover:text-white group-hover:opacity-100"}`}
        >
          <HeartIcon filled={liked} size={16} />
        </button>
        <span className="hidden w-12 text-right text-sm tabular-nums text-subdued md:block">{formatDuration(track.durationMs)}</span>
        <button
          type="button"
          aria-label={`More options for ${track.title}`}
          onClick={(e) => {
            e.stopPropagation();
            openMenu(track.id, context, playlistId);
          }}
          className="inline-flex h-10 w-8 items-center justify-center text-subdued hover:text-white md:h-8 md:opacity-0 md:group-hover:opacity-100"
        >
          <MoreIcon size={20} />
        </button>
      </div>
    </div>
  );
});
