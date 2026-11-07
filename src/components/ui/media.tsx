"use client";

import Link from "next/link";
import { artistImage, useCatalog, type AlbumView, type ArtistView } from "@/lib/client/catalog";
import { useCollectionPlayback } from "@/lib/client/player/hooks";
import { usePlayer, type PlayContext } from "@/lib/client/player/store";
import type { CatalogTrack, MixSummary, Playlist } from "@/lib/types";
import { shade } from "@/lib/util";
import { Cover } from "./cover";
import { MediaCard } from "./cards";
import { PlayButton } from "./play-button";

export function AlbumCard({ album }: { album: AlbumView }) {
  const ctx: PlayContext = { type: "album", id: album.id, name: album.title, href: `/album/${album.id}` };
  const pb = useCollectionPlayback(ctx, album.trackIds);
  return (
    <MediaCard
      href={`/album/${album.id}`}
      title={album.title}
      subtitle={`${album.year ?? ""}${album.year ? " • " : ""}${album.artist.name}`}
      image={album.cover}
      playing={pb.isPlaying}
      onPlay={pb.toggle}
    />
  );
}

export function ArtistCard({ artist }: { artist: ArtistView }) {
  const ctx: PlayContext = { type: "artist", id: artist.id, name: artist.name, href: `/artist/${artist.id}` };
  const pb = useCollectionPlayback(ctx, artist.trackIds);
  return <MediaCard href={`/artist/${artist.id}`} title={artist.name} subtitle="Artist" image={artistImage(artist)} round playing={pb.isPlaying} onPlay={pb.toggle} />;
}

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const { catalog } = useCatalog();
  const ctx: PlayContext = { type: "playlist", id: playlist.id, name: playlist.name, href: `/playlist/${playlist.id}` };
  const pb = useCollectionPlayback(ctx, playlist.trackIds);
  const covers = playlist.trackIds.slice(0, 4).map((id) => catalog?.byId.get(id)?.cover);
  return (
    <MediaCard
      href={`/playlist/${playlist.id}`}
      title={playlist.name}
      subtitle={`By ${playlist.ownerName}`}
      images={covers}
      playing={pb.isPlaying}
      onPlay={playlist.trackIds.length ? pb.toggle : undefined}
    />
  );
}

/** Daily-mix style artwork: cover photo with a coloured band and the mix name. */
export function MixArt({ mix, className = "" }: { mix: Pick<MixSummary, "title" | "color" | "coverTrackIds">; className?: string }) {
  const { catalog } = useCatalog();
  const cover = catalog?.byId.get(mix.coverTrackIds[0])?.cover;
  return (
    <div className={`relative aspect-square overflow-hidden rounded-md ${className}`} style={{ backgroundColor: mix.color }}>
      <Cover image={cover} size="lg" className="absolute inset-0 h-full w-full" rounded="" />
      <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 45%, ${mix.color} 100%)` }} />
      <div className="absolute left-0 top-0 h-full w-1.5" style={{ backgroundColor: mix.color }} />
      <span className="absolute bottom-3 left-3 right-3 text-[clamp(14px,4.5vw,22px)] font-extrabold leading-tight text-white drop-shadow sm:text-xl">{mix.title}</span>
    </div>
  );
}

export function MixCard({ mix }: { mix: MixSummary }) {
  const ctx: PlayContext = { type: "mix", id: mix.id, name: mix.title, href: `/mix/${mix.id}` };
  const pb = useCollectionPlayback(ctx, mix.trackIds);
  return (
    <Link href={`/mix/${mix.id}`} className="group relative flex w-[150px] shrink-0 flex-col gap-2 rounded-card transition-colors sm:w-auto sm:bg-card sm:p-3 sm:hover:bg-card-hover">
      <div className="relative">
        <MixArt mix={mix} className="w-full shadow-cover" />
        <div className={`absolute bottom-2 right-2 hidden transition-all sm:block ${pb.isPlaying ? "opacity-100" : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"}`}>
          <PlayButton size={48} playing={pb.isPlaying} onClick={pb.toggle} />
        </div>
      </div>
      <div className="line-clamp-2 text-[13px] leading-snug text-subdued sm:min-h-[40px] sm:text-sm">{mix.description}</div>
    </Link>
  );
}

/** Track card for shelves: tapping it plays the shelf from that song. */
export function TrackCard({ track, list, index, ctx, reason }: { track: CatalogTrack; list: string[]; index: number; ctx: PlayContext; reason?: string }) {
  const isCurrent = usePlayer((s) => s.currentId === track.id);
  const playing = usePlayer((s) => s.playing && s.currentId === track.id);
  const play = () => {
    const st = usePlayer.getState();
    if (isCurrent) st.toggle();
    else st.playList(list, index, ctx);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={play}
      onKeyDown={(e) => e.key === "Enter" && play()}
      className="group relative flex w-[150px] shrink-0 cursor-pointer flex-col gap-2 rounded-card text-left transition-colors sm:w-auto sm:bg-card sm:p-3 sm:hover:bg-card-hover"
    >
      <div className="relative">
        <Cover image={track.cover} className="aspect-square w-full shadow-cover" rounded="rounded-md" />
        <div className={`absolute bottom-2 right-2 hidden transition-all sm:block ${playing ? "opacity-100" : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"}`}>
          <PlayButton size={48} playing={playing} onClick={play} />
        </div>
      </div>
      <div className="min-w-0 sm:min-h-[62px]">
        <div className={`truncate text-[15px] font-bold ${isCurrent ? "text-accent" : "text-white"}`}>{track.title}</div>
        <div className="mt-1 line-clamp-2 text-[13px] leading-snug text-subdued sm:text-sm">{reason ?? track.artists.map((a) => a.name).join(", ")}</div>
      </div>
    </div>
  );
}

export function LikedArt({ className = "" }: { className?: string }) {
  return (
    <div className={`flex aspect-square items-center justify-center rounded-md bg-gradient-to-br from-[#450af5] to-[#c4efd9] ${className}`}>
      <svg viewBox="0 0 24 24" className="h-1/3 w-1/3 fill-white drop-shadow" aria-hidden="true">
        <path d="M15.724 4.22A4.313 4.313 0 0 0 12.192.814a4.269 4.269 0 0 0-3.622 1.13.837.837 0 0 1-1.14 0 4.272 4.272 0 0 0-6.21 5.855l5.916 7.05a1.128 1.128 0 0 0 1.727 0l5.916-7.05a4.228 4.228 0 0 0 .945-3.58z" transform="translate(4 4)" />
      </svg>
    </div>
  );
}

export function colorFor(album?: AlbumView, fallback = "#535353") {
  return album?.cover?.color ?? fallback;
}

export function darken(hex: string) {
  return shade(hex, 0.3);
}
