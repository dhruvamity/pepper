"use client";

import { useCatalog } from "@/lib/client/catalog";
import { useCollectionPlayback } from "@/lib/client/player/hooks";
import { usePlayer, type PlayContext } from "@/lib/client/player/store";
import type { CatalogTrack } from "@/lib/types";
import { shade } from "@/lib/util";
import { ClockIcon, ShuffleIcon } from "../icons";
import { TopBar } from "../nav/top-bar";
import { PlayButton } from "./play-button";
import { TrackRow } from "./track-row";

/** Header with the page colour fading into the background (album / playlist / mix pages). */
export function CollectionHeader({
  color,
  art,
  kind,
  title,
  description,
  meta,
}: {
  color: string;
  art: React.ReactNode;
  kind: string;
  title: string;
  description?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  const size = title.length > 40 ? "text-3xl sm:text-4xl lg:text-5xl" : title.length > 20 ? "text-3xl sm:text-5xl lg:text-6xl" : "text-4xl sm:text-6xl lg:text-[5.5rem]";
  return (
    <div className="page-gradient -mt-14 px-4 pb-6 pt-16 sm:-mt-16 sm:px-6 sm:pt-20" style={{ "--hdr": shade(color, 0.1) } as React.CSSProperties}>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-end sm:gap-6">
        <div className="w-[min(62vw,240px)] shrink-0 shadow-[0_4px_60px_rgb(0_0_0/0.5)] sm:w-[192px] lg:w-[232px]">{art}</div>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:gap-3">
          <span className="hidden text-sm font-bold sm:block">{kind}</span>
          <h1 className={`text-balance font-extrabold leading-[1.05] tracking-tight text-white ${size}`}>{title}</h1>
          {description && <div className="line-clamp-2 text-sm text-white/70">{description}</div>}
          {meta && <div className="flex flex-wrap items-center gap-x-1 text-sm text-white/90">{meta}</div>}
        </div>
      </div>
    </div>
  );
}

export function ActionBar({
  ctx,
  ids,
  extra,
}: {
  ctx: PlayContext;
  ids: string[];
  extra?: React.ReactNode;
}) {
  const pb = useCollectionPlayback(ctx, ids);
  const shuffle = usePlayer((s) => s.shuffle);
  return (
    <div className="flex items-center gap-5 px-4 py-4 sm:gap-7 sm:px-6 sm:py-6">
      <PlayButton size={56} playing={pb.isPlaying} onClick={pb.toggle} label={pb.isPlaying ? "Pause" : `Play ${ctx.name ?? ""}`} />
      <button
        type="button"
        aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
        onClick={() => usePlayer.getState().setShuffle(!shuffle)}
        className={`relative ${shuffle ? "text-accent" : "text-subdued hover:text-white"}`}
      >
        <ShuffleIcon size={30} />
        {shuffle && <span className="absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
      </button>
      {extra}
    </div>
  );
}

/** Track table: header row on desktop, compact rows on phones. */
export function TrackTable({
  tracks,
  ctx,
  showAlbum = true,
  showCover = true,
  showIndex = true,
  reasons,
  meta,
  playlistId,
}: {
  tracks: CatalogTrack[];
  ctx: PlayContext;
  showAlbum?: boolean;
  showCover?: boolean;
  showIndex?: boolean;
  reasons?: Record<string, string>;
  meta?: (t: CatalogTrack) => string | undefined;
  playlistId?: string;
}) {
  const ids = tracks.map((t) => t.id);
  const pb = useCollectionPlayback(ctx, ids);
  return (
    <div className="px-2 sm:px-4">
      <div
        className="sticky top-14 z-20 hidden h-9 items-center gap-4 border-b border-white/10 bg-surface px-4 text-sm text-subdued sm:top-16 md:grid"
        style={{ gridTemplateColumns: showAlbum ? "16px 6fr 4fr minmax(120px,1fr)" : "16px 1fr minmax(120px,auto)" }}
      >
        <span>#</span>
        <span>Title</span>
        {showAlbum && <span>Album</span>}
        <span className="flex justify-end pr-10">
          <ClockIcon size={16} />
        </span>
      </div>
      <div className="mt-2 flex flex-col">
        {tracks.map((t, i) => (
          <TrackRow
            key={`${t.id}-${i}`}
            track={t}
            index={i}
            showIndex={showIndex}
            showAlbum={showAlbum}
            showCover={showCover}
            reason={reasons?.[t.id]}
            meta={meta?.(t)}
            context={ctx}
            playlistId={playlistId}
            onPlay={() => pb.playAt(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function useTracks(ids: string[] | undefined): CatalogTrack[] {
  const { catalog } = useCatalog();
  if (!catalog || !ids) return [];
  return ids.map((id) => catalog.byId.get(id)).filter(Boolean) as CatalogTrack[];
}

export function CollectionTopBar({ title, color, ctx, ids }: { title: string; color: string; ctx: PlayContext; ids: string[] }) {
  const pb = useCollectionPlayback(ctx, ids);
  return <TopBar title={title} color={shade(color, 0.35)} onPlay={pb.toggle} playing={pb.isPlaying} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <h2 className="text-2xl font-bold">{title}</h2>
      {body && <p className="mt-2 max-w-sm text-subdued">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse px-4 pt-20 sm:px-6">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-end">
        <div className="h-[200px] w-[200px] rounded bg-white/10" />
        <div className="w-full space-y-3">
          <div className="h-4 w-20 rounded bg-white/10" />
          <div className="h-12 w-2/3 rounded bg-white/10" />
          <div className="h-4 w-1/3 rounded bg-white/10" />
        </div>
      </div>
      <div className="mt-10 space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-12 rounded bg-white/5" />
        ))}
      </div>
    </div>
  );
}
