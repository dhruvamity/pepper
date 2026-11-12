import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ImageSet } from "@/lib/types";
import { mediaUrl } from "@/lib/util";
import { playlistIsLinkable } from "@/lib/playlists";
import { repo } from "./db";

/**
 * Link previews for shared pages. Every screen renders on the client behind sign-in, so the
 * <head> is the only thing a chat app or crawler sees: title, description and cover image.
 * Only catalog facts are exposed (a song's title, artists, album, cover); user playlists show
 * their name and cover only when their owner made them public or link-visible.
 */
export async function siteUrl(): Promise<URL> {
  const configured = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (configured) return new URL(configured);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return new URL(`${proto}://${host}`);
}

interface Preview {
  title: string;
  description?: string;
  path: string;
  image?: ImageSet;
  /** Open Graph type; music types make Discord/iMessage show a play-style card. */
  type?: "music.song" | "music.album" | "music.playlist" | "profile";
}

export async function previewMetadata(p: Preview): Promise<Metadata> {
  const base = await siteUrl();
  const image = p.image ? new URL(mediaUrl(p.image.lg) ?? mediaUrl(p.image.sm)!, base).href : undefined;
  return {
    title: p.title,
    description: p.description,
    metadataBase: base,
    openGraph: {
      title: `${p.title} · Pepper`,
      description: p.description,
      url: new URL(p.path, base).href,
      siteName: "Pepper",
      type: p.type === "profile" ? "profile" : "website",
      ...(image ? { images: [{ url: image, width: 640, height: 640, alt: p.title }] } : {}),
    },
    twitter: { card: "summary", title: `${p.title} · Pepper`, description: p.description, ...(image ? { images: [image] } : {}) },
  };
}

const names = (list: { name: string }[]) => list.map((a) => a.name).join(", ");

export async function trackPreview(id: string): Promise<Metadata> {
  const t = await (await repo()).getTrack(id).catch(() => null);
  if (!t) return previewMetadata({ title: "Song", path: `/track/${id}` });
  return previewMetadata({ title: t.title, description: `Song · ${names(t.artists)}${t.album.title ? ` · ${t.album.title}` : ""}`, path: `/track/${t.id}`, image: t.cover, type: "music.song" });
}

export async function albumPreview(id: string): Promise<Metadata> {
  const catalog = await (await repo()).getCatalog().catch(() => null);
  const tracks = catalog?.tracks.filter((t) => t.album.id === id) ?? [];
  if (!tracks.length) return previewMetadata({ title: "Album", path: `/album/${id}` });
  const first = tracks[0];
  const artist = first.albumArtist?.name ?? first.artists[0]?.name ?? "";
  const kind = tracks.length >= 7 ? "Album" : tracks.length >= 3 ? "EP" : "Single";
  const year = first.year ? ` · ${first.year}` : "";
  return previewMetadata({ title: first.album.title, description: `${kind} · ${artist}${year} · ${tracks.length} song${tracks.length === 1 ? "" : "s"}`, path: `/album/${id}`, image: tracks.find((t) => t.cover)?.cover, type: "music.album" });
}

export async function artistPreview(id: string): Promise<Metadata> {
  const catalog = await (await repo()).getCatalog().catch(() => null);
  const artist = catalog?.artists[id];
  if (!artist) return previewMetadata({ title: "Artist", path: `/artist/${id}` });
  const tracks = catalog!.tracks.filter((t) => t.artists.some((a) => a.id === id));
  const image = artist.image ?? tracks.find((t) => t.cover)?.cover;
  return previewMetadata({ title: artist.name, description: `Artist · ${tracks.length} song${tracks.length === 1 ? "" : "s"} on Pepper`, path: `/artist/${id}`, image, type: "profile" });
}

export async function userPreview(id: string): Promise<Metadata> {
  const user = await (await repo()).getUser(id).catch(() => null);
  // Contacts-only profiles stay anonymous in previews.
  if (!user || user.profileVisibility === "contacts") return previewMetadata({ title: "Listener", description: "A listener on Pepper", path: `/user/${id}` });
  return previewMetadata({ title: user.name, description: `${user.name} on Pepper · top artists and public playlists`, path: `/user/${id}`, type: "profile" });
}

export async function playlistPreview(id: string): Promise<Metadata> {
  const db = await repo();
  const p = await db.getPlaylist(id).catch(() => null);
  if (!p || !playlistIsLinkable(p)) return previewMetadata({ title: "Playlist", description: "A playlist on Pepper", path: `/playlist/${id}` });
  let image = p.cover;
  if (!image && p.trackIds.length) {
    const catalog = await db.getCatalog().catch(() => null);
    image = p.trackIds.map((tid) => catalog?.tracks.find((t) => t.id === tid)?.cover).find(Boolean);
  }
  const by = p.shared ? "" : ` · by ${p.ownerName}`;
  return previewMetadata({ title: p.name, description: `Playlist${by} · ${p.trackIds.length} song${p.trackIds.length === 1 ? "" : "s"}${p.description ? ` · ${p.description}` : ""}`, path: `/playlist/${id}`, image, type: "music.playlist" });
}
