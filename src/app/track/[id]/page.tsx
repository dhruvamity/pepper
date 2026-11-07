"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { HeartIcon, MoreIcon } from "@/components/icons";
import { LyricsView, useLyrics } from "@/components/player/lyrics";
import { Section } from "@/components/ui/cards";
import { CollectionHeader, CollectionTopBar, EmptyState, PageSkeleton } from "@/components/ui/collection";
import { Cover } from "@/components/ui/cover";
import { AudioFeatureBars } from "@/components/ui/global-sheets";
import { AlbumCard } from "@/components/ui/media";
import { PlayButton } from "@/components/ui/play-button";
import { TrackRow } from "@/components/ui/track-row";
import { fetcher } from "@/lib/client/api";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { useLibraryActions } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";
import { useUI } from "@/lib/client/ui";
import { formatDuration } from "@/lib/util";

/** Song page (Figma frame 9): big title, artist line, lyrics, artist card and similar songs. */
export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const { catalog, isLoading } = useCatalog();
  const t = catalog?.byId.get(id);
  const { data: full } = useLyrics(id);
  const { data: radio } = useSWR<{ items: { id: string; reason: string }[] }>(t ? `/api/radio?mode=radio&limit=10&seeds=${id}` : null, fetcher, { revalidateOnFocus: false });
  const { isLiked, toggleLike } = useLibraryActions();
  const openMenu = useUI((s) => s.openTrackMenu);
  const isCurrent = usePlayer((s) => s.currentId === id);
  const playing = usePlayer((s) => s.playing && s.currentId === id);
  if (!catalog && isLoading) return <PageSkeleton />;
  if (!t) return <EmptyState title="Song not found" />;
  const artist = catalog!.artists.get(t.artists[0].id);
  const album = catalog!.albums.get(t.album.id);
  const color = t.cover?.color ?? "#535353";
  const similar = (radio?.items ?? []).filter((r) => catalog!.byId.has(r.id));
  const ctx = { type: "track" as const, id: t.id, name: t.title, href: `/track/${t.id}` };
  const radioCtx = { type: "radio" as const, id: t.id, name: `${t.title} Radio`, href: `/track/${t.id}` };
  const play = () => {
    const st = usePlayer.getState();
    if (isCurrent) st.toggle();
    else st.playList([t.id, ...similar.map((s) => s.id)], 0, ctx, { shuffle: false });
  };
  const moreByArtist = artist ? artist.trackIds.filter((x) => x !== t.id).slice(0, 5) : [];
  const lyrics = full?.lyrics;

  return (
    <div>
      <CollectionTopBar title={t.title} color={color} ctx={ctx} ids={[t.id]} />
      <CollectionHeader
        color={color}
        kind="Song"
        title={t.title}
        description={t.subtitle}
        art={<Cover image={t.cover} size="lg" eager className="aspect-square w-full" rounded="rounded" />}
        meta={
          <>
            {artist && <Cover image={artistImage(artist)} className="mr-1 h-6 w-6" rounded="rounded-full" kind="artist" />}
            {t.artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && <span className="text-white/70">, </span>}
                <Link href={`/artist/${a.id}`} className="font-bold hover:underline">
                  {a.name}
                </Link>
              </span>
            ))}
            <span className="text-white/70">•</span>
            <Link href={`/album/${t.album.id}`} className="text-white/70 hover:underline">
              {t.album.title.length > 40 ? `${t.album.title.slice(0, 40)}…` : t.album.title}
            </Link>
            {t.year && <span className="text-white/70">• {t.year}</span>}
            <span className="text-white/70">• {formatDuration(t.durationMs)}</span>
          </>
        }
      />
      <div className="flex items-center gap-6 px-4 py-5 sm:px-6">
        <PlayButton size={56} playing={playing} onClick={play} />
        <button type="button" onClick={() => toggleLike(t.id)} aria-label={isLiked(t.id) ? "Remove from Liked Songs" : "Save to Liked Songs"} className={isLiked(t.id) ? "text-accent" : "text-subdued hover:text-white"}>
          <HeartIcon filled={isLiked(t.id)} size={32} />
        </button>
        <button type="button" onClick={() => openMenu(t.id, ctx)} aria-label="More options" className="text-subdued hover:text-white">
          <MoreIcon size={32} />
        </button>
      </div>

      <div className="grid gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <h2 className="mb-4 text-2xl font-bold">Lyrics</h2>
          {lyrics && (lyrics.plain || lyrics.synced?.length) ? (
            <div className="max-h-[480px] overflow-hidden rounded-xl p-5" style={{ backgroundColor: color }}>
              <LyricsView trackId={t.id} lyrics={lyrics} compact color={color} />
            </div>
          ) : (
            <p className="text-subdued">{full ? "Lyrics aren't available for this song yet." : "Loading…"}</p>
          )}
        </section>
        <aside className="space-y-4">
          {artist && (
            <Link href={`/artist/${artist.id}`} className="flex items-center gap-4 rounded-lg p-2 transition-colors hover:bg-white/10">
              <Cover image={artistImage(artist)} className="h-20 w-20 shrink-0" rounded="rounded-full" kind="artist" />
              <div>
                <div className="text-sm font-bold text-subdued">Artist</div>
                <div className="text-lg font-bold hover:underline">{artist.name}</div>
              </div>
            </Link>
          )}
          {t.features && (
            <div className="rounded-lg bg-card p-4">
              <h3 className="mb-3 text-sm font-bold">Audio analysis</h3>
              <AudioFeatureBars f={t.features} />
            </div>
          )}
        </aside>
      </div>

      {similar.length > 0 && (
        <section className="mt-8 px-2 sm:px-4">
          <h2 className="px-2 pb-1 text-2xl font-bold">Recommended</h2>
          <p className="px-2 pb-3 text-sm text-subdued">Based on what&apos;s in this song</p>
          {similar.map((r) => (
            <TrackRow
              key={r.id}
              track={catalog!.byId.get(r.id)!}
              reason={r.reason}
              context={radioCtx}
              onPlay={() => usePlayer.getState().playList([t.id, ...similar.map((s) => s.id)], r.id, radioCtx, { shuffle: false })}
            />
          ))}
        </section>
      )}

      {moreByArtist.length > 0 && artist && (
        <section className="mt-8 px-2 sm:px-4">
          <h2 className="px-2 pb-3 text-2xl font-bold">More by {artist.name}</h2>
          {moreByArtist.map((tid) => (
            <TrackRow
              key={tid}
              track={catalog!.byId.get(tid)!}
              context={{ type: "artist", id: artist.id, name: artist.name, href: `/artist/${artist.id}` }}
              onPlay={() => usePlayer.getState().playList(artist.trackIds, tid, { type: "artist", id: artist.id, name: artist.name, href: `/artist/${artist.id}` })}
            />
          ))}
        </section>
      )}

      {album && (
        <Section title="From the album">
          <AlbumCard album={album} />
        </Section>
      )}
    </div>
  );
}
