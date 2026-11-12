"use client";

import { Check, Clock, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { TopBar } from "@/components/nav/top-bar";
import { Section } from "@/components/ui/cards";
import { EmptyState } from "@/components/ui/collection";
import { ArtistCard, PlaylistCard } from "@/components/ui/media";
import { api, fetcher } from "@/lib/client/api";
import { useCatalog } from "@/lib/client/catalog";
import { toast } from "@/lib/client/toast";
import type { Playlist } from "@/lib/types";

interface Profile {
  user: { uid: string; name: string; photoURL?: string; createdAt: number };
  self: boolean;
  status: "pending" | "accepted" | "declined" | null;
  requestedBy: string | null;
  private: boolean;
  topArtists: string[];
  playlists: Playlist[];
}

export function UserView() {
  const { id } = useParams<{ id: string }>();
  const { catalog } = useCatalog();
  const { mutate } = useSWRConfig();
  const { data, error, isLoading, mutate: refresh } = useSWR<Profile>(`/api/users/${encodeURIComponent(id)}`, fetcher, { shouldRetryOnError: false });
  const [busy, setBusy] = useState(false);
  if (error) return <><TopBar /><EmptyState title="Listener not found" body={(error as Error).message} /></>;
  if (!data || isLoading) return <><TopBar /><div className="animate-pulse px-6 pt-10"><div className="mx-auto h-32 w-32 rounded-full bg-white/10" /><div className="mx-auto mt-6 h-8 w-48 rounded bg-white/10" /></div></>;
  const { user } = data;
  const initial = user.name.trim().charAt(0).toUpperCase();
  const artists = data.topArtists.map((a) => catalog?.artists.get(a)).filter(Boolean);
  const joined = new Date(user.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const connect = async () => {
    setBusy(true);
    try {
      const { connection } = await api<{ connection: { status: string } }>("/api/connections", { body: { userId: user.uid } });
      await Promise.all([refresh(), mutate("/api/connections")]);
      toast(connection.status === "accepted" ? `You’re connected with ${user.name}` : `Contact request sent to ${user.name}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    setBusy(true);
    try {
      await api("/api/connections", { method: "PATCH", body: { userId: user.uid, action: "accept" } });
      await Promise.all([refresh(), mutate("/api/connections")]);
      toast(`You’re connected with ${user.name}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-10">
      <TopBar title={user.name} color="#3a2f6e" />
      <div className="page-gradient -mt-14 px-4 pb-6 pt-20 sm:-mt-16 sm:px-6 sm:pt-24" style={{ "--hdr": "#3a2f6e" } as React.CSSProperties}>
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:gap-6 sm:text-left">
          {user.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="h-36 w-36 rounded-full object-cover shadow-cover sm:h-44 sm:w-44" />
          ) : (
            <span className="flex h-36 w-36 items-center justify-center rounded-full bg-[#ff7d4d] text-6xl font-bold text-black shadow-cover sm:h-44 sm:w-44">{initial}</span>
          )}
          <div className="min-w-0">
            <span className="text-sm font-bold">Profile</span>
            <h1 className="text-balance text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">{user.name}</h1>
            <p className="mt-2 text-sm text-white/80">
              {data.playlists.length} public playlist{data.playlists.length === 1 ? "" : "s"} · Joined {joined}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {data.self ? (
                <Link href="/friends" className="rounded-full border border-white/40 px-4 py-2 text-sm font-bold hover:border-white">Profile settings</Link>
              ) : data.status === "accepted" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-accent"><Check size={16} /> Contact</span>
              ) : data.status === "pending" && data.requestedBy === user.uid ? (
                <button type="button" disabled={busy} onClick={() => void accept()} className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50"><Check size={16} /> Accept request</button>
              ) : data.status === "pending" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-subdued"><Clock size={16} /> Request sent</span>
              ) : (
                <button type="button" disabled={busy} onClick={() => void connect()} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black disabled:opacity-50"><UserPlus size={16} /> Connect</button>
              )}
              {data.status === "accepted" && <Link href="/friends" className="inline-flex items-center gap-1.5 rounded-full border border-white/40 px-4 py-2 text-sm font-bold hover:border-white"><Users size={16} /> Friends &amp; Jams</Link>}
            </div>
          </div>
        </div>
      </div>
      {data.private ? (
        <EmptyState title="This profile is private" body={`${user.name} only shares their profile with contacts.`} />
      ) : (
        <>
          {artists.length > 0 && (
            <Section title="Top artists" subtitle={data.self ? "Based on your listening. Hide this from your Friends page." : `What ${user.name} plays most`}>
              {artists.map((a) => <ArtistCard key={a!.id} artist={a!} />)}
            </Section>
          )}
          {data.playlists.length > 0 ? (
            <Section title="Public playlists">
              {data.playlists.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
            </Section>
          ) : (
            !artists.length && <p className="px-6 py-10 text-center text-subdued">{data.self ? "Make a playlist public from its options menu and it will show up here." : "Nothing public here yet."}</p>
          )}
        </>
      )}
    </div>
  );
}
