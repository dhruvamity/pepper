"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { HeartIcon, MoreIcon } from "@/components/icons";
import { Section } from "@/components/ui/cards";
import { ActionBar, CollectionHeader, CollectionTopBar, EmptyState, PageSkeleton, TrackTable, useTracks } from "@/components/ui/collection";
import { Cover } from "@/components/ui/cover";
import { AlbumCard } from "@/components/ui/media";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { useLibraryActions } from "@/lib/client/me";
import { useUI } from "@/lib/client/ui";
import { formatLongDuration } from "@/lib/util";

export function AlbumView() {
  const { id } = useParams<{ id: string }>();
  const { catalog, isLoading } = useCatalog();
  const { isSaved, toggleSave } = useLibraryActions();
  const openMenu = useUI((s) => s.openTrackMenu);
  const album = catalog?.albums.get(id);
  const tracks = useTracks(album?.trackIds);
  if (!catalog && isLoading) return <PageSkeleton />;
  if (!album) return <EmptyState title="Album not found" body="It may have been removed from the library." />;
  const owner = catalog!.artists.get(album.artist.id);
  const color = album.cover?.color ?? "#535353";
  const ctx = { type: "album" as const, id: album.id, name: album.title, href: `/album/${album.id}` };
  const first = tracks[0];
  const more = owner ? owner.albumIds.filter((a) => a !== album.id).map((a) => catalog!.albums.get(a)!).filter(Boolean) : [];
  const releaseDate = album.releaseDate ? new Date(album.releaseDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : album.year;

  return (
    <div>
      <CollectionTopBar title={album.title} color={color} ctx={ctx} ids={album.trackIds} />
      <CollectionHeader
        color={color}
        kind={album.kind}
        title={album.title}
        description={album.film && !album.title.includes(album.film) ? `From the film ${album.film}` : undefined}
        art={<Cover image={album.cover} size="lg" eager className="aspect-square w-full" rounded="rounded" />}
        meta={
          <>
            {owner && <Cover image={artistImage(owner)} className="mr-1 h-6 w-6" rounded="rounded-full" kind="artist" />}
            <Link href={`/artist/${album.artist.id}`} className="font-bold hover:underline">
              {album.artist.name}
            </Link>
            {album.year && <span className="text-white/70">• {album.year}</span>}
            <span className="text-white/70">
              • {tracks.length} song{tracks.length === 1 ? "" : "s"}, {formatLongDuration(album.durationMs)}
            </span>
          </>
        }
      />
      <div className="relative bg-gradient-to-b from-black/20 to-transparent">
        <ActionBar
          ctx={ctx}
          ids={album.trackIds}
          extra={
            <>
              <button type="button" onClick={() => toggleSave(album.id)} aria-label={isSaved(album.id) ? "Remove from Your Library" : "Save to Your Library"} className={isSaved(album.id) ? "text-accent" : "text-subdued hover:text-white"}>
                <HeartIcon filled={isSaved(album.id)} size={32} />
              </button>
              {first && (
                <button type="button" aria-label="More options" onClick={() => openMenu(first.id, ctx)} className="text-subdued hover:text-white">
                  <MoreIcon size={32} />
                </button>
              )}
            </>
          }
        />
        <TrackTable tracks={tracks} ctx={ctx} showAlbum={false} showCover={false} />
        <div className="px-4 pt-6 text-sm text-subdued sm:px-6">
          {releaseDate && <p className="font-semibold text-white">{releaseDate}</p>}
          {first?.genres.length ? <p className="mt-1">{first.genres.join(" · ")}</p> : null}
        </div>
        {more.length > 0 && (
          <Section title={`More by ${album.artist.name}`} href={`/artist/${album.artist.id}`}>
            {more.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
