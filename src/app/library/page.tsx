"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import useSWR from "swr";
import { Equalizer, GridIcon, ListIcon, PlusIcon } from "@/components/icons";
import { Avatar, TopBar } from "@/components/nav/top-bar";
import { Collage, Cover } from "@/components/ui/cover";
import { AlbumCard, ArtistCard, LikedArt, PlaylistCard } from "@/components/ui/media";
import { PlayButton } from "@/components/ui/play-button";
import { fetcher } from "@/lib/client/api";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { useMe, usePlaylistActions } from "@/lib/client/me";
import { useCollectionPlayback } from "@/lib/client/player/hooks";
import { usePlayer } from "@/lib/client/player/store";
import { useLocalSetting } from "@/lib/client/settings";
import { useUI } from "@/lib/client/ui";
import type { ImageSet, PlaySourceType, Playlist } from "@/lib/types";

type Filter = "all" | "playlists" | "artists" | "albums" | "recent";
type View = "list" | "grid";
interface Item {
  key: string;
  kind: "playlist" | "artist" | "album";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  image?: ImageSet;
  images?: (ImageSet | undefined)[];
  at: number;
}
interface RecentPlay {
  trackId: string;
  at: number;
  source?: { type: PlaySourceType; id?: string };
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "playlists", label: "Playlists" },
  { id: "artists", label: "Artists" },
  { id: "albums", label: "Albums" },
  { id: "recent", label: "Recently played" },
];

function Row({ item }: { item: Item }) {
  const ctx = usePlayer((s) => s.context);
  const playing = usePlayer((s) => s.playing);
  const active = ctx?.id === item.id;
  return (
    <Link href={item.href} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/10 active:bg-white/5">
      {item.images ? (
        <Collage images={item.images} className="h-16 w-16 shrink-0" />
      ) : (
        <Cover image={item.image} className="h-16 w-16 shrink-0" rounded={item.kind === "artist" ? "rounded-full" : "rounded"} kind={item.kind === "artist" ? "artist" : "track"} />
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-base ${active ? "text-accent" : "text-white"}`}>{item.title}</div>
        <div className="truncate text-sm text-subdued">{item.subtitle}</div>
      </div>
      {active && <Equalizer playing={playing} className="mr-2" />}
    </Link>
  );
}

export default function LibraryPage() {
  const { createPlaylist } = usePlaylistActions();
  const { data: me } = useMe();
  const { catalog } = useCatalog();
  const router = useRouter();
  const openProfile = useUI((s) => s.setProfileOpen);
  const [filter, setFilter] = useLocalSetting<Filter>("pepper.libraryFilter", "all");
  const [sort, setSort] = useLocalSetting<"recent" | "alpha">("pepper.librarySort", "recent");
  // Phones default to a list, larger screens to a grid; the toggle remembers either.
  const [viewSetting, setView] = useLocalSetting<View | "auto">("pepper.libraryView", "auto");
  const { data: stats } = useSWR<{ recent: RecentPlay[] }>(filter === "recent" && me ? "/api/me/stats" : null, fetcher, { revalidateOnFocus: false });
  const likedIds = useMemo(
    () =>
      Object.entries(me?.library.likes ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id)
        .filter((id) => catalog?.byId.has(id)),
    [me, catalog],
  );
  const likedPb = useCollectionPlayback({ type: "liked", name: "Liked Songs", href: "/liked" }, likedIds);

  const playlistById = useMemo(() => {
    const map = new Map<string, Playlist>();
    for (const p of catalog?.playlists.values() ?? []) map.set(p.id, p);
    for (const p of me?.savedPlaylists ?? []) map.set(p.id, p);
    for (const p of me?.playlists ?? []) map.set(p.id, p);
    return map;
  }, [catalog, me]);

  const items = useMemo(() => {
    if (!me || !catalog) return [];
    const playlistItem = (p: Playlist, at: number): Item => ({
      key: `p-${p.id}`,
      kind: "playlist",
      id: p.id,
      title: p.name,
      subtitle: p.shared ? "Playlist" : `Playlist • ${p.ownerName}`,
      href: `/playlist/${p.id}`,
      image: p.cover,
      images: p.cover ? undefined : p.trackIds.slice(0, 4).map((id) => catalog.byId.get(id)?.cover),
      at,
    });
    const artistItem = (id: string, at: number): Item | null => {
      const a = catalog.artists.get(id);
      return a ? { key: `a-${id}`, kind: "artist", id, title: a.name, subtitle: "Artist", href: `/artist/${id}`, image: artistImage(a), at } : null;
    };
    const albumItem = (id: string, at: number): Item | null => {
      const a = catalog.albums.get(id);
      return a ? { key: `l-${id}`, kind: "album", id, title: a.title, subtitle: `${a.kind} • ${a.artist.name}`, href: `/album/${id}`, image: a.cover, at } : null;
    };

    if (filter === "recent") {
      // Collections behind the latest plays, newest first, each listed once.
      const seen = new Set<string>();
      const out: Item[] = [];
      for (const play of stats?.recent ?? []) {
        const track = catalog.byId.get(play.trackId);
        const source = play.source;
        let item: Item | null = null;
        if (source?.type === "playlist" && source.id && playlistById.has(source.id)) item = playlistItem(playlistById.get(source.id)!, play.at);
        else if (source?.type === "artist" && source.id) item = artistItem(source.id, play.at);
        else if (track) item = albumItem(track.album.id, play.at);
        if (item && !seen.has(item.key)) {
          seen.add(item.key);
          out.push(item);
        }
      }
      return out;
    }

    const out: Item[] = [];
    for (const p of me.playlists) out.push(playlistItem(p, p.updatedAt));
    for (const [id, at] of Object.entries(me.library.playlists ?? {})) {
      const p = playlistById.get(id);
      if (p && !me.playlists.some((x) => x.id === id)) out.push(playlistItem(p, at));
    }
    for (const [id, at] of Object.entries(me.library.artists)) {
      const item = artistItem(id, at);
      if (item) out.push(item);
    }
    for (const [id, at] of Object.entries(me.library.albums)) {
      const item = albumItem(id, at);
      if (item) out.push(item);
    }
    return out
      .filter((i) => filter === "all" || `${i.kind}s` === filter)
      .sort((a, b) => (sort === "alpha" ? a.title.localeCompare(b.title) : b.at - a.at));
  }, [me, catalog, filter, sort, stats, playlistById]);

  const preview = likedIds
    .slice(0, 3)
    .map((id) => catalog?.byId.get(id))
    .filter(Boolean)
    .map((t) => `${t!.artists[0]?.name} ${t!.title}`)
    .join(" • ");
  const showLiked = filter === "all" || filter === "playlists";
  const listClass = viewSetting === "list" ? "" : viewSetting === "grid" ? "hidden" : "sm:hidden";
  const gridClass = viewSetting === "grid" ? "grid" : viewSetting === "list" ? "hidden" : "hidden sm:grid";
  const toggleView = () => {
    const desktop = window.matchMedia("(min-width: 640px)").matches;
    const current: View = viewSetting === "auto" ? (desktop ? "grid" : "list") : viewSetting;
    setView(current === "grid" ? "list" : "grid");
  };

  return (
    <div>
      <TopBar showBack={false}>
        <button type="button" onClick={() => openProfile(true)} className="md:hidden" aria-label="Account">
          <Avatar size={32} />
        </button>
        <h1 className="text-2xl font-bold">Your Library</h1>
        <button
          type="button"
          aria-label="Create playlist"
          onClick={async () => {
            const p = await createPlaylist();
            router.push(`/playlist/${p.id}`);
          }}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-subdued hover:bg-white/10 hover:text-white md:hidden"
        >
          <PlusIcon size={22} />
        </button>
      </TopBar>

      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(filter === f.id ? "all" : f.id)}
            aria-pressed={filter === f.id}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${filter === f.id ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"}`}
          >
            {f.label}
          </button>
        ))}
        {filter !== "recent" && (
          <button type="button" onClick={() => setSort(sort === "recent" ? "alpha" : "recent")} className="ml-auto shrink-0 px-2 text-sm font-semibold text-subdued hover:text-white">
            {sort === "recent" ? "Recents" : "Alphabetical"}
          </button>
        )}
        <button type="button" onClick={toggleView} aria-label="Switch between list and grid" className={`${filter === "recent" ? "ml-auto" : ""} flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-subdued hover:bg-white/10 hover:text-white`}>
          <span className={viewSetting === "grid" ? "" : viewSetting === "list" ? "hidden" : "hidden sm:block"}><ListIcon size={18} /></span>
          <span className={viewSetting === "list" ? "" : viewSetting === "grid" ? "hidden" : "sm:hidden"}><GridIcon size={18} /></span>
        </button>
      </div>

      <div className={`px-2 ${listClass}`}>
        {showLiked && (
          <Link href="/liked" className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/10">
            <LikedArt className="h-16 w-16 shrink-0 rounded" />
            <div className="min-w-0">
              <div className="text-base">Liked Songs</div>
              <div className="text-sm text-subdued">Playlist • {likedIds.length} songs</div>
            </div>
          </Link>
        )}
        {items.map((i) => (
          <Row key={i.key} item={i} />
        ))}
      </div>

      <div className={`grid-cols-2 gap-3 px-4 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-6 sm:px-6 ${gridClass}`}>
        {showLiked && (
          <Link href="/liked" className="group relative col-span-2 flex min-h-[160px] flex-col justify-end gap-5 rounded-lg bg-gradient-to-br from-[#450af5] to-[#8e8ee5] p-5 sm:min-h-[270px]">
            <p className="line-clamp-3 text-base text-white/90">{preview || "Songs you like will appear here"}</p>
            <div>
              <div className="text-[32px] font-bold leading-tight">Liked Songs</div>
              <div className="mt-1 text-sm">
                {likedIds.length} liked song{likedIds.length === 1 ? "" : "s"}
              </div>
            </div>
            {likedIds.length > 0 && (
              <div className={`absolute bottom-5 right-5 transition-all ${likedPb.isPlaying ? "opacity-100" : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"}`}>
                <PlayButton size={56} playing={likedPb.isPlaying} onClick={likedPb.toggle} />
              </div>
            )}
          </Link>
        )}
        {items.map((i) => {
          if (i.kind === "playlist") {
            const p = playlistById.get(i.id);
            return p ? <PlaylistCard key={i.key} playlist={p} /> : null;
          }
          if (i.kind === "artist") return <ArtistCard key={i.key} artist={catalog!.artists.get(i.id)!} />;
          return <AlbumCard key={i.key} album={catalog!.albums.get(i.id)!} />;
        })}
      </div>

      {me && !items.length && filter !== "all" && (
        <p className="px-6 py-10 text-center text-subdued">{filter === "recent" ? (stats ? "Nothing played recently." : "Loading recent plays…") : "Nothing here yet — follow artists and save albums to see them in your library."}</p>
      )}
    </div>
  );
}
