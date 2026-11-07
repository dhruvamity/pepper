"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon, SearchIcon } from "@/components/icons";
import { TopBar } from "@/components/nav/top-bar";
import { Section } from "@/components/ui/cards";
import { EmptyState } from "@/components/ui/collection";
import { Collage, Cover } from "@/components/ui/cover";
import { AlbumCard, ArtistCard, PlaylistCard } from "@/components/ui/media";
import { PlayButton } from "@/components/ui/play-button";
import { TrackRow } from "@/components/ui/track-row";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { useCollectionPlayback } from "@/lib/client/player/hooks";
import { usePlayer } from "@/lib/client/player/store";

const RECENT_KEY = "pepper.recentSearches";

function GenreTile({ name, color, href, coverId }: { name: string; color: string; href: string; coverId?: string }) {
  const { catalog } = useCatalog();
  const cover = coverId ? catalog?.byId.get(coverId)?.cover : undefined;
  return (
    <Link href={href} className="relative block aspect-[16/9] overflow-hidden rounded-lg p-3 sm:aspect-square sm:p-4" style={{ backgroundColor: color }}>
      <span className="relative z-10 block max-w-[80%] break-words text-base font-bold leading-tight text-white sm:text-2xl">{name}</span>
      {cover && (
        <Cover image={cover} className="absolute! -bottom-1 -right-4 aspect-square h-[52%] rotate-[25deg] shadow-[0_2px_4px_rgb(0_0_0/0.2)] sm:h-[45%]" rounded="rounded-sm" />
      )}
    </Link>
  );
}

function TopResult({ type, id }: { type: "track" | "artist" | "album" | "playlist"; id: string }) {
  const { catalog } = useCatalog();
  const track = type === "track" ? catalog?.byId.get(id) : undefined;
  const artist = type === "artist" ? catalog?.artists.get(id) : undefined;
  const album = type === "album" ? catalog?.albums.get(id) : undefined;
  const playlist = type === "playlist" ? catalog?.playlists.get(id) : undefined;
  const ids = track ? [track.id] : artist ? artist.trackIds : album ? album.trackIds : (playlist?.trackIds ?? []);
  const ctx = track
    ? { type: "search" as const, name: track.title }
    : artist
      ? { type: "artist" as const, id: artist.id, name: artist.name, href: `/artist/${artist.id}` }
      : playlist
        ? { type: "playlist" as const, id: playlist.id, name: playlist.name, href: `/playlist/${playlist.id}` }
        : { type: "album" as const, id: album?.id, name: album?.title, href: `/album/${album?.id}` };
  const pb = useCollectionPlayback(ctx, ids);
  const href = track ? `/track/${track.id}` : artist ? `/artist/${artist.id}` : playlist ? `/playlist/${playlist.id}` : `/album/${album?.id}`;
  const image = track?.cover ?? (artist ? artistImage(artist) : album?.cover);
  const title = track?.title ?? artist?.name ?? album?.title ?? playlist?.name ?? "";
  const label = track ? "Song" : artist ? "Artist" : playlist ? "Playlist" : "Album";
  const sub = track ? track.artists.map((a) => a.name).join(", ") : album ? album.artist.name : playlist ? `${playlist.trackIds.length} songs` : "";
  return (
    <Link href={href} className="group relative flex flex-col gap-5 rounded-lg bg-card p-5 transition-colors hover:bg-card-hover">
      {playlist ? (
        <Collage images={playlist.trackIds.slice(0, 4).map((t) => catalog?.byId.get(t)?.cover)} className="h-24 w-24 shadow-cover" />
      ) : (
        <Cover image={image} className="h-24 w-24 shadow-cover" rounded={artist ? "rounded-full" : "rounded"} kind={artist ? "artist" : "track"} />
      )}
      <div>
        <div className="truncate text-3xl font-bold">{title}</div>
        <div className="mt-1 text-sm text-subdued">
          {sub && <span className="text-white">{sub} · </span>}
          <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-bold text-white">{label}</span>
        </div>
      </div>
      <div className="absolute bottom-5 right-5 translate-y-2 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
        <PlayButton size={48} playing={pb.isPlaying} onClick={pb.toggle} />
      </div>
    </Link>
  );
}

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { catalog } = useCatalog();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [filter, setFilter] = useState<"all" | "songs" | "playlists" | "artists" | "albums">("all");
  const [recent, setRecent] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const deferred = useDeferredValue(q);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const url = deferred ? `/search?q=${encodeURIComponent(deferred)}` : "/search";
      router.replace(url, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [deferred, router]);

  const results = useMemo(() => (catalog && deferred.trim() ? catalog.search(deferred) : null), [catalog, deferred]);

  const remember = () => {
    const term = q.trim();
    if (!term) return;
    const next = [term, ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const songs = (results?.tracks ?? []).map((id) => catalog!.byId.get(id)!).filter(Boolean);
  const ctx = { type: "search" as const, name: `“${deferred}”`, href: `/search?q=${encodeURIComponent(deferred)}` };
  // A song picked from search plays on its own, then autoplay continues with songs like it
  // (not with the rest of the search results, which can be anything with a similar name).
  const playSong = (id: string, title: string) => usePlayer.getState().playList([id], 0, { type: "search", name: title });
  const playlists = (results?.playlists ?? []).map((id) => catalog!.playlists.get(id)!).filter(Boolean);

  return (
    <div>
      <TopBar showBack={false}>
        <span className="text-2xl font-bold md:hidden">Search</span>
      </TopBar>
      <div className="px-4 sm:px-6">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            remember();
            inputRef.current?.blur();
          }}
          className="relative max-w-[480px]"
        >
          <SearchIcon size={22} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#121212]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={remember}
            placeholder="What do you want to listen to?"
            aria-label="Search songs, artists and albums"
            className="h-12 w-full rounded-md bg-white pl-11 pr-10 text-[15px] font-medium text-[#121212] outline-none placeholder:text-[#535353] focus:ring-2 focus:ring-white sm:rounded-full"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="none"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#121212]">
              <CloseIcon size={18} />
            </button>
          )}
        </form>
      </div>

      {!deferred.trim() ? (
        <>
          {recent.length > 0 && (
            <div className="px-4 pt-6 sm:px-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Recent searches</h2>
                <button
                  type="button"
                  onClick={() => {
                    setRecent([]);
                    localStorage.removeItem(RECENT_KEY);
                  }}
                  className="text-sm font-bold text-subdued hover:text-white"
                >
                  Clear
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button key={r} type="button" onClick={() => setQ(r)} className="rounded-full bg-elevated px-4 py-2 text-sm font-semibold hover:bg-highlight">
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
          <h2 className="px-4 pb-4 pt-8 text-xl font-bold sm:px-6 sm:text-2xl">Browse all</h2>
          <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-6 sm:px-6">
            <GenreTile name="New on Pepper" color="#e8115b" href="/genre/new" coverId={catalog?.tracks[0]?.id} />
            <GenreTile name="Made For You" color="#1e3264" href="/" coverId={catalog?.tracks[1]?.id} />
            <GenreTile name="Charts" color="#8d67ab" href="/genre/charts" coverId={catalog?.tracks[2]?.id} />
            {catalog?.genres.map((g) => <GenreTile key={g.key} name={g.name} color={g.color} href={`/genre/${g.key}`} coverId={g.coverTrackId} />)}
          </div>
        </>
      ) : !results || (!results.tracks.length && !results.artists.length && !results.albums.length && !results.playlists.length) ? (
        <EmptyState title={`No results found for “${deferred}”`} body="Check the spelling, or try a different song, artist or album name." />
      ) : (
        <div className="pb-6">
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-4 sm:px-6">
            {(["all", "songs", "playlists", "artists", "albums"] as const).filter((f) => f !== "playlists" || playlists.length > 0).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${filter === f ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"}`}
              >
                {f}
              </button>
            ))}
          </div>

          {filter === "all" && (
            <div className="grid gap-6 px-4 pt-6 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              {results.top && (
                <div>
                  <h2 className="mb-3 text-xl font-bold sm:text-2xl">Top result</h2>
                  <TopResult type={results.top.type} id={results.top.id} />
                </div>
              )}
              {songs.length > 0 && (
                <div className="min-w-0">
                  <h2 className="mb-3 text-xl font-bold sm:text-2xl">Songs</h2>
                  <div className="-mx-2">
                    {songs.slice(0, 4).map((t) => (
                      <TrackRow key={t.id} track={t} showAlbum={false} context={ctx} onPlay={() => playSong(t.id, t.title)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {filter === "songs" && (
            <div className="px-2 pt-4 sm:px-4">
              {songs.map((t) => (
                <TrackRow key={t.id} track={t} context={ctx} onPlay={() => playSong(t.id, t.title)} />
              ))}
            </div>
          )}

          {(filter === "all" || filter === "playlists") && playlists.length > 0 && (
            <Section title="Playlists">
              {playlists.map((p) => (
                <PlaylistCard key={p.id} playlist={p} />
              ))}
            </Section>
          )}
          {(filter === "all" || filter === "artists") && results.artists.length > 0 && (
            <Section title="Artists">
              {results.artists.map((id) => {
                const a = catalog!.artists.get(id);
                return a ? <ArtistCard key={id} artist={a} /> : null;
              })}
            </Section>
          )}
          {(filter === "all" || filter === "albums") && results.albums.length > 0 && (
            <Section title="Albums">
              {results.albums.map((id) => {
                const a = catalog!.albums.get(id);
                return a ? <AlbumCard key={id} album={a} /> : null;
              })}
            </Section>
          )}
          {filter === "all" && results.genres.length > 0 && (
            <div className="px-4 pt-8 sm:px-6">
              <h2 className="mb-3 text-xl font-bold sm:text-2xl">Genres</h2>
              <div className="flex flex-wrap gap-2">
                {results.genres.map((g) => {
                  const gv = catalog!.genres.find((x) => x.key === g);
                  return gv ? (
                    <Link key={g} href={`/genre/${g}`} className="rounded-full px-4 py-2 text-sm font-bold" style={{ backgroundColor: gv.color }}>
                      {gv.name}
                    </Link>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchInner />
    </Suspense>
  );
}
