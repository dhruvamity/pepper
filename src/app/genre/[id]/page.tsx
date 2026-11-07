"use client";

import { useParams } from "next/navigation";
import { Section } from "@/components/ui/cards";
import { ActionBar, CollectionTopBar, EmptyState, PageSkeleton, TrackTable } from "@/components/ui/collection";
import { AlbumCard, ArtistCard } from "@/components/ui/media";
import { useCatalog, usePopularity } from "@/lib/client/catalog";
import type { CatalogTrack } from "@/lib/types";
import { shade, uniqueBy } from "@/lib/util";

export default function GenrePage() {
  const { id } = useParams<{ id: string }>();
  const { catalog, isLoading } = useCatalog();
  const { data: pop } = usePopularity();
  if (!catalog) return isLoading ? <PageSkeleton /> : null;
  let name = "";
  let color = "#535353";
  let tracks: CatalogTrack[] = [];
  const byPop = (a: CatalogTrack, b: CatalogTrack) => (pop?.[b.id]?.pop ?? 0) - (pop?.[a.id]?.pop ?? 0) || b.createdAt - a.createdAt;
  if (id === "new") {
    name = "New on Pepper";
    color = "#e8115b";
    tracks = catalog.tracks.slice(0, 50);
  } else if (id === "charts") {
    name = "Top 50 on Pepper";
    color = "#8d67ab";
    tracks = [...catalog.tracks].filter((t) => (pop?.[t.id]?.plays ?? 0) > 0).sort(byPop).slice(0, 50);
  } else {
    const g = catalog.genres.find((x) => x.key === id);
    if (!g) return <EmptyState title="Genre not found" />;
    name = g.name;
    color = g.color;
    tracks = g.trackIds.map((t) => catalog.byId.get(t)!).sort(byPop);
  }
  const ctx = { type: "genre" as const, id, name, href: `/genre/${id}` };
  const ids = tracks.map((t) => t.id);
  const artists = uniqueBy(tracks.flatMap((t) => t.artists), (a) => a.id)
    .map((a) => catalog.artists.get(a.id))
    .filter(Boolean)
    .slice(0, 12);
  const albums = uniqueBy(tracks, (t) => t.album.id)
    .map((t) => catalog.albums.get(t.album.id))
    .filter(Boolean)
    .slice(0, 12);
  return (
    <div>
      <CollectionTopBar title={name} color={color} ctx={ctx} ids={ids} />
      <div className="-mt-14 px-4 pb-6 pt-24 sm:-mt-16 sm:px-6 sm:pt-32" style={{ background: `linear-gradient(180deg, ${color} 0%, ${shade(color, 0.6)} 70%, #121212 100%)` }}>
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl lg:text-8xl">{name}</h1>
        <p className="mt-3 text-sm text-white/80">{tracks.length} songs</p>
      </div>
      {tracks.length ? (
        <>
          <ActionBar ctx={ctx} ids={ids} />
          <TrackTable tracks={tracks} ctx={ctx} />
          {artists.length > 1 && (
            <Section title="Artists">
              {artists.map((a) => (
                <ArtistCard key={a!.id} artist={a!} />
              ))}
            </Section>
          )}
          {albums.length > 1 && (
            <Section title="Albums">
              {albums.map((a) => (
                <AlbumCard key={a!.id} album={a!} />
              ))}
            </Section>
          )}
        </>
      ) : (
        <EmptyState title="Nothing here yet" body="Play some music and the charts will fill up." />
      )}
    </div>
  );
}
