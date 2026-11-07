"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/client/api";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { useLibraryActions } from "@/lib/client/me";
import { shareLink } from "@/lib/client/player/radio";
import { upcomingFromContext, usePlayer } from "@/lib/client/player/store";
import { useUI } from "@/lib/client/ui";
import { formatCount, shade } from "@/lib/util";
import { ChevronDownIcon, HeartIcon, MoreIcon, QueueIcon, ShareIcon } from "../icons";
import { Cover } from "../ui/cover";
import { ArtistLinks } from "../ui/track-row";
import { Marquee, SeekBar, TransportControls } from "./controls";
import { LyricsView, useLyrics } from "./lyrics";

const CONTEXT_LABEL: Record<string, string> = {
  album: "PLAYING FROM ALBUM",
  artist: "PLAYING FROM ARTIST",
  playlist: "PLAYING FROM PLAYLIST",
  liked: "PLAYING FROM YOUR LIBRARY",
  search: "PLAYING FROM SEARCH",
  home: "PLAYING FROM HOME",
  mix: "PLAYING FROM YOUR MIX",
  radio: "PLAYING FROM RADIO",
  autoplay: "AUTOPLAY",
  genre: "PLAYING FROM GENRE",
  track: "PLAYING SONG",
  queue: "PLAYING FROM QUEUE",
  other: "NOW PLAYING",
};

export function NowPlaying() {
  const view = usePlayer((s) => s.view);
  const id = usePlayer((s) => s.currentId);
  const context = usePlayer((s) => s.context);
  const currentFrom = usePlayer((s) => s.currentFrom);
  const { catalog } = useCatalog();
  const { isLiked, toggleLike, isFollowing, toggleFollow } = useLibraryActions();
  const openMenu = useUI((s) => s.openTrackMenu);
  const openCredits = useUI((s) => s.openCredits);
  const router = useRouter();
  const t = id ? catalog?.byId.get(id) : undefined;
  const open = view === "now" && Boolean(t);
  const { data: full } = useLyrics(id, open);
  const mainArtist = t ? catalog?.artists.get(t.artists[0].id) : undefined;
  const { data: artistStats } = useSWR<{ monthlyPlays: number }>(open && mainArtist ? `/api/artists/${mainArtist.id}` : null, fetcher);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && usePlayer.getState().setView("none");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !t) return null;
  const color = t.cover?.color ?? "#535353";
  const close = () => usePlayer.getState().setView("none");
  const go = (href: string) => {
    close();
    router.push(href);
  };
  const liked = isLiked(t.id);
  const lyrics = full?.lyrics;
  const ctxLabel = currentFrom === "queue" ? CONTEXT_LABEL.queue : CONTEXT_LABEL[context?.type ?? "other"];
  const upcoming = upcomingFromContext(usePlayer.getState(), 3);

  return (
    <div
      className="fixed inset-0 z-[60] animate-slide-up overflow-y-auto"
      style={{ background: `linear-gradient(180deg, ${shade(color, 0.15)} 0%, ${shade(color, 0.55)} 45%, #121212 100%)` }}
      role="dialog"
      aria-label="Now playing"
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-6 pb-10 pt-[max(12px,env(safe-area-inset-top))] lg:grid lg:grid-cols-[1fr_420px] lg:gap-12 lg:px-10">
        <div className="flex min-h-[calc(100dvh-24px)] flex-col lg:min-h-0 lg:justify-center lg:py-10">
          <header className="flex items-center justify-between py-2 lg:absolute lg:inset-x-10 lg:top-4">
            <button type="button" onClick={close} aria-label="Close now playing" className="-ml-2 flex h-10 w-10 items-center justify-center text-white">
              <ChevronDownIcon size={24} />
            </button>
            <div className="min-w-0 px-2 text-center">
              <div className="text-[11px] font-semibold tracking-[0.15em] text-white/80">{ctxLabel}</div>
              {context?.name && currentFrom === "context" && (
                <button type="button" onClick={() => context.href && go(context.href)} className="max-w-[60vw] truncate text-[13px] font-bold text-white hover:underline">
                  {context.name}
                </button>
              )}
            </div>
            <button type="button" onClick={() => openMenu(t.id, context ?? undefined)} aria-label="More options" className="-mr-2 flex h-10 w-10 items-center justify-center text-white">
              <MoreIcon size={24} />
            </button>
          </header>

          <div className="flex flex-1 items-center justify-center py-6 lg:py-10">
            <Cover image={t.cover} size="lg" eager className="aspect-square w-full max-w-[min(88vw,52dvh)] shadow-[0_8px_40px_rgb(0_0_0/0.55)] lg:max-w-[min(520px,60dvh)]" rounded="rounded-lg" />
          </div>

          <div className="w-full lg:mx-auto lg:max-w-[520px]">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Marquee text={t.title} className="text-[22px] font-bold leading-tight text-white sm:text-2xl" />
                {t.subtitle && <div className="truncate text-sm text-white/70">{t.subtitle}</div>}
                <ArtistLinks artists={t.artists} className="block truncate text-base text-white/70" />
              </div>
              <button
                type="button"
                onClick={() => toggleLike(t.id)}
                aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
                className={`flex h-10 w-10 items-center justify-center ${liked ? "text-accent" : "text-white"}`}
              >
                <HeartIcon filled={liked} size={26} />
              </button>
            </div>
            <div className="mt-4">
              <SeekBar thumb />
            </div>
            <div className="mt-2">
              <TransportControls size="lg" />
            </div>
            <div className="mt-4 flex items-center justify-between text-white/80">
              <button type="button" aria-label="Share" onClick={() => shareLink(`/track/${t.id}`, t.title)} className="flex h-10 w-10 items-center justify-center hover:text-white">
                <ShareIcon size={20} />
              </button>
              <button type="button" aria-label="Queue" onClick={() => usePlayer.getState().setView("queue")} className="flex h-10 w-10 items-center justify-center hover:text-white">
                <QueueIcon size={22} />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4 pb-6 lg:overflow-y-auto lg:py-20">
          {lyrics && (lyrics.plain || lyrics.synced?.length) ? (
            <section className="rounded-xl p-5" style={{ backgroundColor: shade(color, 0.25) }}>
              <h3 className="mb-3 text-base font-bold">Lyrics</h3>
              <LyricsView trackId={t.id} lyrics={lyrics} compact color={color} />
            </section>
          ) : (
            <section className="rounded-xl bg-white/5 p-5 text-sm text-white/70">
              <h3 className="mb-1 text-base font-bold text-white">Lyrics</h3>
              No lyrics for this song yet.
            </section>
          )}

          {mainArtist && (
            <section className="overflow-hidden rounded-xl bg-elevated">
              <button type="button" onClick={() => go(`/artist/${mainArtist.id}`)} className="relative block w-full text-left">
                <Cover image={artistImage(mainArtist)} size="lg" className="aspect-[16/10] w-full" rounded="" kind="artist" />
                <span className="absolute left-4 top-4 text-base font-bold drop-shadow">About the artist</span>
              </button>
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <Link href={`/artist/${mainArtist.id}`} onClick={close} className="block truncate text-lg font-bold hover:underline">
                    {mainArtist.name}
                  </Link>
                  <div className="text-sm text-subdued">
                    {artistStats ? `${formatCount(artistStats.monthlyPlays)} plays this month` : `${mainArtist.trackIds.length} songs on Pepper`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleFollow(mainArtist.id)}
                  className="shrink-0 rounded-full border border-white/40 px-4 py-1.5 text-sm font-bold hover:border-white"
                >
                  {isFollowing(mainArtist.id) ? "Following" : "Follow"}
                </button>
              </div>
            </section>
          )}

          <section className="rounded-xl bg-elevated p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Credits</h3>
              <button type="button" onClick={() => openCredits(t.id)} className="text-sm font-bold text-subdued hover:text-white">
                Show all
              </button>
            </div>
            <ul className="mt-3 space-y-3 text-sm">
              {t.artists.map((a) => (
                <li key={a.id}>
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-subdued">Main Artist</div>
                </li>
              ))}
              {t.film && (
                <li>
                  <div className="font-semibold">{t.film}</div>
                  <div className="text-subdued">Film</div>
                </li>
              )}
            </ul>
          </section>

          {upcoming.length > 0 && (
            <section className="rounded-xl bg-elevated p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold">Next in queue</h3>
                <button type="button" onClick={() => usePlayer.getState().setView("queue")} className="text-sm font-bold text-subdued hover:text-white">
                  Open queue
                </button>
              </div>
              <ul className="mt-3 space-y-3">
                {upcoming.map((u) => {
                  const n = catalog?.byId.get(u.id);
                  if (!n) return null;
                  return (
                    <li key={u.index}>
                      <button type="button" onClick={() => usePlayer.getState().jumpToContext(u.index)} className="flex w-full items-center gap-3 text-left">
                        <Cover image={n.cover} className="h-12 w-12 shrink-0" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{n.title}</div>
                          <div className="truncate text-sm text-subdued">{n.artists.map((a) => a.name).join(", ")}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
