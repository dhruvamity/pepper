"use client";

import Link from "next/link";
import { Avatar } from "@/components/nav/top-bar";
import { ActionBar, CollectionHeader, CollectionTopBar, EmptyState, TrackTable, useTracks } from "@/components/ui/collection";
import { LikedArt } from "@/components/ui/media";
import { useAuth } from "@/lib/client/auth";
import { useMe } from "@/lib/client/me";

export default function LikedPage() {
  const { data: me } = useMe();
  const { user } = useAuth();
  const ids = Object.entries(me?.library.likes ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const tracks = useTracks(ids);
  const ctx = { type: "liked" as const, name: "Liked Songs", href: "/liked" };
  return (
    <div>
      <CollectionTopBar title="Liked Songs" color="#5038a0" ctx={ctx} ids={tracks.map((t) => t.id)} />
      <CollectionHeader
        color="#5038a0"
        kind="Playlist"
        title="Liked Songs"
        art={<LikedArt className="w-full" />}
        meta={
          <>
            <Avatar size={24} className="mr-1" />
            <span className="font-bold">{user?.name}</span>
            <span className="text-white/70">
              • {tracks.length} song{tracks.length === 1 ? "" : "s"}
            </span>
          </>
        }
      />
      {tracks.length ? (
        <>
          <ActionBar ctx={ctx} ids={tracks.map((t) => t.id)} />
          <TrackTable tracks={tracks} ctx={ctx} />
        </>
      ) : (
        <EmptyState
          title="Songs you like will appear here"
          body="Save songs by tapping the heart icon."
          action={
            <Link href="/search" className="rounded-full bg-white px-8 py-3 font-bold text-black hover:scale-105">
              Find songs
            </Link>
          }
        />
      )}
    </div>
  );
}
