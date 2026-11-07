"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { CollectionTopBar, EmptyState, PageSkeleton } from "@/components/ui/collection";
import { Section } from "@/components/ui/cards";
import { Cover } from "@/components/ui/cover";
import { AlbumCard, ArtistCard } from "@/components/ui/media";
import { PlayButton } from "@/components/ui/play-button";
import { TrackRow } from "@/components/ui/track-row";
import { fetcher } from "@/lib/client/api";
import { artistImage, useCatalog, usePopularity } from "@/lib/client/catalog";
import { useLibraryActions } from "@/lib/client/me";
import { useCollectionPlayback } from "@/lib/client/player/hooks";
import { usePlayer } from "@/lib/client/player/store";
import { formatCount, shade } from "@/lib/util";

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const { catalog, isLoading } = useCatalog();
  const { data } = useSWR<{ popular: string[]; monthlyPlays: number; related: string[] }>(`/api/artists/${id}`, fetcher);
  const { data: pop } = usePopularity();
  const { isFollowing, toggleFollow } = useLibraryActions();
  const [showAll, setShowAll] = useState(false);
  const artist = catalog?.artists.get(id);
  const popular = (data?.popular ?? artist?.trackIds ?? []).filter((t) => catalog?.byId.has(t));
  const ctx = { type: "artist" as const, id, name: artist?.name, href: `/artist/${id}` };
  const all = artist ? [...new Set([...popular, ...artist.trackIds])] : [];
  const pb = useCollectionPlayback(ctx, all);
  if (!catalog && isLoading) return <PageSkeleton />;
  if (!artist) return <EmptyState title="Artist not found" />;
  const img = artistImage(artist);
  const color = img?.color ?? "#535353";
  const albums = artist.albumIds.map((a) => catalog!.albums.get(a)!).filter(Boolean);
  const appears = artist.appearsOn.map((a) => catalog!.albums.get(a)!).filter(Boolean);
  const related = (data?.related ?? []).map((a) => catalog!.artists.get(a)).filter(Boolean);
  const following = isFollowing(id);

  return (
    <div>
      <CollectionTopBar title={artist.name} color={color} ctx={ctx} ids={all} />
      <div className="relative -mt-14 h-[min(48vh,400px)] min-h-[280px] overflow-hidden sm:-mt-16">
        {artist.image ? (
          <Cover image={artist.image} size="lg" eager className="absolute inset-0 h-full w-full" rounded="" kind="artist" />
        ) : (
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${color}, ${shade(color, 0.5)})` }}>
            <Cover image={img} size="lg" eager className="absolute right-6 top-20 hidden h-56 w-56 shadow-cover sm:block" rounded="rounded-full" kind="artist" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70" />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-5 sm:px-6 sm:pb-6">
          <h1 className="text-balance text-5xl font-extrabold leading-none tracking-tight drop-shadow-lg sm:text-7xl lg:text-8xl">{artist.name}</h1>
          <p className="mt-3 text-sm font-medium text-white/90 sm:text-base">
            {data ? `${formatCount(data.monthlyPlays)} plays this month` : `${artist.trackIds.length} songs`}
          </p>
        </div>
      </div>
      <div style={{ background: `linear-gradient(180deg, ${shade(color, 0.6)} 0%, #121212 240px)` }}>
        <div className="flex items-center gap-6 px-4 py-5 sm:px-6">
          <PlayButton size={56} playing={pb.isPlaying} onClick={pb.toggle} />
          <button
            type="button"
            onClick={() => toggleFollow(id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-bold transition hover:scale-105 ${following ? "border-white text-white" : "border-white/50 text-white hover:border-white"}`}
          >
            {following ? "Following" : "Follow"}
          </button>
        </div>

        <section className="px-2 sm:px-4">
          <h2 className="px-2 pb-3 text-2xl font-bold sm:px-2">Popular</h2>
          {(showAll ? popular : popular.slice(0, 5)).map((tid, i) => {
            const t = catalog!.byId.get(tid)!;
            return (
              <TrackRow
                key={tid}
                track={t}
                index={i}
                showIndex
                showAlbum={false}
                meta={pop?.[tid]?.plays ? `${formatCount(pop[tid].plays)} plays` : undefined}
                context={ctx}
                onPlay={() => {
                  const st = usePlayer.getState();
                  if (st.currentId === tid) st.toggle();
                  else st.playList(all, tid, ctx);
                }}
              />
            );
          })}
          {popular.length > 5 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="px-4 py-3 text-sm font-bold text-subdued hover:text-white">
              {showAll ? "Show less" : "See more"}
            </button>
          )}
        </section>

        {albums.length > 0 && (
          <Section title="Discography">
            {albums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Section>
        )}
        {appears.length > 0 && (
          <Section title="Appears on">
            {appears.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Section>
        )}
        {related.length > 0 && (
          <Section title="Fans also like">
            {related.map((a) => (
              <ArtistCard key={a!.id} artist={a!} />
            ))}
          </Section>
        )}
        {artist.bio && (
          <section className="mt-8 px-4 sm:px-6">
            <h2 className="mb-3 text-2xl font-bold">About</h2>
            <p className="max-w-3xl whitespace-pre-line text-subdued">{artist.bio}</p>
          </section>
        )}
      </div>
    </div>
  );
}
