"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Equalizer, PlusIcon } from "@/components/icons";
import { Avatar, TopBar } from "@/components/nav/top-bar";
import { Collage, Cover } from "@/components/ui/cover";
import { AlbumCard, ArtistCard, LikedArt, PlaylistCard } from "@/components/ui/media";
import { PlayButton } from "@/components/ui/play-button";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { createPlaylist, useMe } from "@/lib/client/me";
import { useCollectionPlayback } from "@/lib/client/player/hooks";
import { usePlayer } from "@/lib/client/player/store";
import { useUI } from "@/lib/client/ui";
import type { ImageSet } from "@/lib/types";

type Filter = "all" | "playlists" | "artists" | "albums";
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
  const { data: me } = useMe();
  const { catalog } = useCatalog();
  const router = useRouter();
  const openProfile = useUI((s) => s.setProfileOpen);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"recent" | "alpha">("recent");
  const likedIds = useMemo(
    () =>
      Object.entries(me?.library.likes ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id)
        .filter((id) => catalog?.byId.has(id)),
    [me, catalog],
  );
  const likedPb = useCollectionPlayback({ type: "liked", name: "Liked Songs", href: "/liked" }, likedIds);

  const items = useMemo(() => {
    if (!me || !catalog) return [];
    const out: Item[] = [];
    for (const p of me.playlists) {
      out.push({
        key: `p-${p.id}`,
        kind: "playlist",
        id: p.id,
        title: p.name,
        subtitle: p.shared ? "Playlist" : `Playlist • ${p.ownerName}`,
        href: `/playlist/${p.id}`,
        images: p.trackIds.slice(0, 4).map((id) => catalog.byId.get(id)?.cover),
        at: p.updatedAt,
      });
    }
    for (const [id, at] of Object.entries(me.library.playlists ?? {})) {
      const p = catalog.playlists.get(id);
      if (!p || me.playlists.some((x) => x.id === id)) continue;
      out.push({
        key: `p-${id}`,
        kind: "playlist",
        id,
        title: p.name,
        subtitle: p.shared ? "Playlist" : `Playlist • ${p.ownerName}`,
        href: `/playlist/${id}`,
        images: p.trackIds.slice(0, 4).map((t) => catalog.byId.get(t)?.cover),
        at,
      });
    }
    for (const [id, at] of Object.entries(me.library.artists)) {
      const a = catalog.artists.get(id);
      if (a) out.push({ key: `a-${id}`, kind: "artist", id, title: a.name, subtitle: "Artist", href: `/artist/${id}`, image: artistImage(a), at });
    }
    for (const [id, at] of Object.entries(me.library.albums)) {
      const a = catalog.albums.get(id);
      if (a) out.push({ key: `l-${id}`, kind: "album", id, title: a.title, subtitle: `${a.kind} • ${a.artist.name}`, href: `/album/${id}`, image: a.cover, at });
    }
    return out
      .filter((i) => filter === "all" || `${i.kind}s` === filter)
      .sort((a, b) => (sort === "alpha" ? a.title.localeCompare(b.title) : b.at - a.at));
  }, [me, catalog, filter, sort]);

  const preview = likedIds
    .slice(0, 3)
    .map((id) => catalog?.byId.get(id))
    .filter(Boolean)
    .map((t) => `${t!.artists[0]?.name} ${t!.title}`)
    .join(" • ");

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

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
        {(["playlists", "artists", "albums"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(filter === f ? "all" : f)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${filter === f ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"}`}
          >
            {f}
          </button>
        ))}
        <button type="button" onClick={() => setSort(sort === "recent" ? "alpha" : "recent")} className="ml-auto shrink-0 px-2 text-sm font-semibold text-subdued hover:text-white">
          {sort === "recent" ? "Recents" : "Alphabetical"}
        </button>
      </div>

      {/* Phones: list (Spotify mobile) */}
      <div className="px-2 sm:hidden">
        {(filter === "all" || filter === "playlists") && (
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

      {/* Larger screens: grid with the wide Liked Songs card (Figma frame 8) */}
      <div className="hidden gap-6 px-6 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
        {(filter === "all" || filter === "playlists") && (
          <Link href="/liked" className="group relative col-span-2 flex min-h-[270px] flex-col justify-end gap-5 rounded-lg bg-gradient-to-br from-[#450af5] to-[#8e8ee5] p-5">
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
            const p = me!.playlists.find((x) => x.id === i.id) ?? catalog!.playlists.get(i.id)!;
            return <PlaylistCard key={i.key} playlist={p} />;
          }
          if (i.kind === "artist") return <ArtistCard key={i.key} artist={catalog!.artists.get(i.id)!} />;
          return <AlbumCard key={i.key} album={catalog!.albums.get(i.id)!} />;
        })}
      </div>

      {me && !items.length && filter !== "all" && <p className="px-6 py-10 text-center text-subdued">Nothing here yet — follow artists and save albums to see them in your library.</p>}
    </div>
  );
}
