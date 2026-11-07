"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Avatar, TopBar } from "@/components/nav/top-bar";
import { ShortcutTile, Section } from "@/components/ui/cards";
import { EmptyState } from "@/components/ui/collection";
import { AlbumCard, ArtistCard, MixCard, PlaylistCard, TrackCard } from "@/components/ui/media";
import { fetcher } from "@/lib/client/api";
import { artistImage, useCatalog } from "@/lib/client/catalog";
import { useMe } from "@/lib/client/me";
import { useCollectionPlayback } from "@/lib/client/player/hooks";
import { useUI } from "@/lib/client/ui";
import type { HomeSection, MixSummary, Shortcut } from "@/lib/types";
import { greeting, shade } from "@/lib/util";

function ShortcutItem({ s, mixes, onHover }: { s: Shortcut; mixes: MixSummary[]; onHover: (c: string) => void }) {
  const { catalog } = useCatalog();
  const { data: me } = useMe();
  let href = "/";
  let title = "";
  let ids: string[] = [];
  let image;
  let images;
  let gradient;
  let color = "#535353";
  let ctxType: "liked" | "album" | "artist" | "playlist" | "mix" = s.type;
  if (s.type === "liked") {
    href = "/liked";
    title = "Liked Songs";
    ids = Object.entries(me?.library.likes ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .filter((id) => catalog?.byId.has(id));
    gradient = "linear-gradient(135deg,#450af5,#c4efd9)";
    color = "#5038a0";
  } else if (s.type === "album") {
    const a = catalog?.albums.get(s.id);
    if (!a) return null;
    href = `/album/${a.id}`;
    title = a.title;
    ids = a.trackIds;
    image = a.cover;
    color = a.cover?.color ?? color;
  } else if (s.type === "artist") {
    const a = catalog?.artists.get(s.id);
    if (!a) return null;
    href = `/artist/${a.id}`;
    title = a.name;
    ids = a.trackIds;
    image = artistImage(a);
    color = image?.color ?? color;
  } else if (s.type === "playlist") {
    const p = me?.playlists.find((x) => x.id === s.id) ?? catalog?.playlists.get(s.id);
    if (!p) return null;
    href = `/playlist/${p.id}`;
    title = p.name;
    ids = p.trackIds;
    images = p.trackIds.slice(0, 4).map((id) => catalog?.byId.get(id)?.cover);
  } else if (s.type === "mix") {
    const m = mixes.find((x) => x.id === s.id);
    if (!m) return null;
    href = `/mix/${m.id}`;
    title = m.title;
    ids = m.trackIds;
    image = catalog?.byId.get(m.coverTrackIds[0])?.cover;
    color = m.color;
    ctxType = "mix";
  }
  return (
    <div onMouseEnter={() => onHover(color)}>
      <ShortcutItemInner href={href} title={title} image={image} images={images} gradient={gradient} ids={ids} ctx={{ type: ctxType, id: s.id, name: title, href }} />
    </div>
  );
}

function ShortcutItemInner(props: {
  href: string;
  title: string;
  image?: Parameters<typeof ShortcutTile>[0]["image"];
  images?: Parameters<typeof ShortcutTile>[0]["images"];
  gradient?: string;
  ids: string[];
  ctx: { type: "liked" | "album" | "artist" | "playlist" | "mix"; id: string; name: string; href: string };
}) {
  const pb = useCollectionPlayback(props.ctx, props.ids);
  return <ShortcutTile href={props.href} title={props.title} image={props.image} images={props.images} gradient={props.gradient} playing={pb.isPlaying} onPlay={props.ids.length ? pb.toggle : undefined} />;
}

function SectionView({ section, mixes }: { section: HomeSection; mixes: MixSummary[] }) {
  const { catalog } = useCatalog();
  if (!catalog) return null;
  if (section.kind === "mixes") {
    return (
      <Section title={section.title}>
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
      <Section title={section.title} subtitle={section.subtitle}>
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
  void mixes;
  return null;
}

export default function HomePage() {
  const { catalog, isLoading } = useCatalog();
  const { data: me } = useMe();
  const { data, isLoading: homeLoading } = useSWR<{ sections: HomeSection[] }>("/api/home", fetcher, { revalidateOnFocus: false, dedupingInterval: 60_000 });
  const [hdr, setHdr] = useState<string | null>(null);
  const openProfile = useUI((s) => s.setProfileOpen);
  const sections = data?.sections ?? [];
  const shortcuts = sections.find((s) => s.kind === "shortcuts");
  const mixes = (sections.find((s) => s.kind === "mixes")?.items as MixSummary[] | undefined) ?? [];
  const firstColor = hdr ?? "#3a2f6e";

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[332px] transition-[background] duration-700" style={{ background: `linear-gradient(180deg, ${shade(firstColor, 0.35)} 0%, #121212 100%)` }} />
      <TopBar showBack={false}>
        <button type="button" onClick={() => openProfile(true)} className="md:hidden" aria-label="Account">
          <Avatar size={32} />
        </button>
        <span className="hidden md:block" />
      </TopBar>
      <div className="relative">
        <h1 className="px-4 pb-4 text-2xl font-bold tracking-tight sm:px-6 sm:text-[32px]">{greeting()}</h1>

        {(isLoading || homeLoading) && !data && (
          <div className="grid animate-pulse grid-cols-2 gap-2 px-4 sm:gap-4 sm:px-6 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 rounded bg-white/10 sm:h-16" />
            ))}
          </div>
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

        {shortcuts && (
          <div className="grid grid-cols-2 gap-2 px-4 sm:gap-x-6 sm:gap-y-4 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4" onMouseLeave={() => setHdr(null)}>
            {(shortcuts.items as Shortcut[]).map((s) => (
              <ShortcutItem key={`${s.type}-${s.id}`} s={s} mixes={mixes} onHover={setHdr} />
            ))}
          </div>
        )}

        {sections
          .filter((s) => s.kind !== "shortcuts")
          .map((s) => (
            <SectionView key={s.id} section={s} mixes={mixes} />
          ))}
      </div>
    </div>
  );
}
