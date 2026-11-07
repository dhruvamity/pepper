"use client";

import Link from "next/link";
import useSWR from "swr";
import { Avatar, TopBar } from "@/components/nav/top-bar";
import { Section } from "@/components/ui/cards";
import { EmptyState } from "@/components/ui/collection";
import { AlbumCard, ArtistCard, MixCard, PlaylistCard, TrackCard } from "@/components/ui/media";
import { fetcher } from "@/lib/client/api";
import { useCatalog } from "@/lib/client/catalog";
import { useMe } from "@/lib/client/me";
import { useUI } from "@/lib/client/ui";
import type { HomeSection, MixSummary } from "@/lib/types";
import { greeting, shade } from "@/lib/util";

function SectionView({ section }: { section: HomeSection }) {
  const { catalog } = useCatalog();
  if (!catalog) return null;
  if (section.kind === "mixes") {
    return (
      <Section title={section.title} rail>
        {(section.items as MixSummary[]).map((m) => (
          <MixCard key={m.id} mix={m} />
        ))}
      </Section>
    );
  }
  if (section.kind === "tracks") {
    const ids = (section.items as string[]).filter((id) => catalog.byId.has(id));
    if (!ids.length) return null;
    const ctx = { type: "home" as const, id: section.id, name: section.title };
    if (section.id === "recent") {
      return (
        <section className="mt-5 px-4 sm:px-6">
          <h2 className="mb-3 text-[22px] font-bold tracking-tight sm:text-2xl">{section.title}</h2>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {ids.map((id, i) => (
              <TrackCard key={id} track={catalog.byId.get(id)!} list={ids} index={i} ctx={ctx} compact />
            ))}
          </div>
        </section>
      );
    }
    return (
      <Section title={section.title} subtitle={section.subtitle}>
        {ids.map((id, i) => (
          <TrackCard key={id} track={catalog.byId.get(id)!} list={ids} index={i} ctx={ctx} reason={section.reasons?.[id]} />
        ))}
      </Section>
    );
  }
  if (section.kind === "albums") {
    const albums = (section.items as string[]).map((id) => catalog.albums.get(id)).filter(Boolean);
    if (!albums.length) return null;
    return (
      <Section title={section.title}>
        {albums.map((a) => (
          <AlbumCard key={a!.id} album={a!} />
        ))}
      </Section>
    );
  }
  if (section.kind === "playlists") {
    const lists = (section.items as string[]).map((id) => catalog.playlists.get(id)).filter((p) => p && p.trackIds.length);
    if (!lists.length) return null;
    return (
      <Section title={section.title} subtitle={section.subtitle} rail>
        {lists.map((p) => (
          <PlaylistCard key={p!.id} playlist={p!} />
        ))}
      </Section>
    );
  }
  if (section.kind === "artists") {
    const artists = (section.items as string[]).map((id) => catalog.artists.get(id)).filter(Boolean);
    if (!artists.length) return null;
    return (
      <Section title={section.title}>
        {artists.map((a) => (
          <ArtistCard key={a!.id} artist={a!} />
        ))}
      </Section>
    );
  }
  return null;
}

export default function HomePage() {
  const { catalog, isLoading, error: catalogError, refresh } = useCatalog();
  const { data: me } = useMe();
  const {
    data,
    isLoading: homeLoading,
    error: homeError,
    mutate: reloadHome,
  } = useSWR<{ sections: HomeSection[] }>("/api/home", fetcher, { refreshInterval: 60_000, dedupingInterval: 10_000 });
  const loadError = (!catalog && catalogError) || (!data && homeError) ? ((catalogError ?? homeError) as Error) : null;
  const openProfile = useUI((s) => s.setProfileOpen);
  const sections = data?.sections ?? [];

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[332px]" style={{ background: `linear-gradient(180deg, ${shade("#3a2f6e", 0.35)} 0%, #121212 100%)` }} />
      <TopBar showBack={false}>
        <button type="button" onClick={() => openProfile(true)} className="md:hidden" aria-label="Account">
          <Avatar size={32} />
        </button>
        <span className="hidden md:block" />
      </TopBar>
      <div className="relative">
        <h1 className="px-4 text-2xl font-bold tracking-tight sm:px-6 sm:text-[32px]">{greeting()}</h1>

        {(isLoading || homeLoading) && !data && (
          <div className="grid animate-pulse grid-cols-2 gap-2 px-4 sm:gap-4 sm:px-6 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 rounded bg-white/10 sm:h-16" />
            ))}
          </div>
        )}

        {loadError && !(isLoading || homeLoading) && (
          <EmptyState
            title="Couldn't load your music"
            body={loadError.message || "Something went wrong on the server."}
            action={
              <button
                type="button"
                onClick={() => {
                  void refresh();
                  void reloadHome();
                }}
                className="rounded-full bg-white px-8 py-3 font-bold text-black hover:scale-105"
              >
                Try again
              </button>
            }
          />
        )}

        {catalog && catalog.tracks.length === 0 && (
          <EmptyState
            title="Your library is empty"
            body={me?.user.isAdmin ? "Upload your first songs — covers, titles, artists and lyrics are picked up automatically." : "An admin needs to upload some music first."}
            action={
              me?.user.isAdmin ? (
                <Link href="/admin/upload" className="rounded-full bg-accent px-8 py-3 font-bold text-black hover:scale-105">
                  Upload music
                </Link>
              ) : undefined
            }
          />
        )}

        {sections
          .filter((s) => s.kind !== "shortcuts")
          .map((s) => (
            <SectionView key={s.id} section={s} />
          ))}
      </div>
    </div>
  );
}
