"use client";

import { Clock3, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";
import useSWR from "swr";
import { EditIcon, HeartIcon, MoreIcon, TrashIcon } from "@/components/icons";
import { ActionBar, CollectionHeader, CollectionTopBar, EmptyState, PageSkeleton, TrackTable, useTracks } from "@/components/ui/collection";
import { Collage } from "@/components/ui/cover";
import { Sheet, SheetItem } from "@/components/ui/sheet";
import { TrackRow } from "@/components/ui/track-row";
import { api, fetcher } from "@/lib/client/api";
import { useCatalog } from "@/lib/client/catalog";
import { setJamOpen, startListeningJam, useJam } from "@/lib/client/jam";
import { useLibraryActions, useMe, usePlaylistActions } from "@/lib/client/me";
import { toast } from "@/lib/client/toast";
import type { Playlist } from "@/lib/types";
import { formatLongDuration } from "@/lib/util";

export default function PlaylistPage() {
  const { deletePlaylist, updatePlaylist } = usePlaylistActions();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me } = useMe();
  const { catalog } = useCatalog();
  const jam = useJam((s) => s.room);
  const { data, error } = useSWR<{ playlist: Playlist }>(`/api/playlists/${id}`, fetcher);
  const { data: social } = useSWR<{ connections: { status: string; user: { uid: string; name: string } }[] }>("/api/connections", fetcher);
  const { mutate } = useSWRConfig();
  const { isPlaylistSaved, toggleSavePlaylist } = useLibraryActions();
  // Shared playlists come with the catalog, so they open instantly.
  const p = error ? undefined : data?.playlist ?? me?.playlists.find((x) => x.id === id) ?? catalog?.playlists.get(id);
  const tracks = useTracks(p?.trackIds);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [filter, setFilter] = useState("");
  const [manage, setManage] = useState(false);
  if (!p && !error) return <PageSkeleton />;
  if (!p) return <EmptyState title="Playlist not found" />;
  const owner = p.ownerUid === me?.user.uid;
  const collaborator = Boolean(p.collaboratorUids?.includes(me?.user.uid ?? "") || p.collaborators?.some((item) => item.uid === me?.user.uid));
  const own = owner || collaborator || Boolean(p.shared && me?.user.isAdmin);
  const color = tracks[0]?.cover?.color ?? "#535353";
  const ctx = { type: "playlist" as const, id: p.id, name: p.name, href: `/playlist/${p.id}` };
  const total = tracks.reduce((a, t) => a + t.durationMs, 0);
  const suggestions =
    own && catalog && filter.trim()
      ? catalog
          .search(filter)
          .tracks.filter((tid) => !p.trackIds.includes(tid))
          .slice(0, 8)
          .map((tid) => catalog.byId.get(tid)!)
      : [];

  return (
    <div>
      <CollectionTopBar title={p.name} color={color} ctx={ctx} ids={p.trackIds} />
      <CollectionHeader
        color={color}
        kind="Playlist"
        title={p.name}
        description={p.description}
        art={<Collage images={tracks.slice(0, 4).map((t) => t.cover)} className="aspect-square w-full" />}
        meta={
          <>
            {!p.shared && <span className="font-bold">{p.ownerName}</span>}
            <span className="text-white/70">
              {!p.shared && "• "}
              {tracks.length} song{tracks.length === 1 ? "" : "s"}
              {total > 0 && `, ${formatLongDuration(total)}`}
            </span>
          </>
        }
      />
      <ActionBar
        ctx={ctx}
        ids={p.trackIds}
        extra={
          <>
            {p.shared && p.ownerUid !== me?.user.uid && (
              <button
                type="button"
                aria-label={isPlaylistSaved(p.id) ? "Remove from Your Library" : "Save to Your Library"}
                onClick={() => toggleSavePlaylist(p.id)}
                className={isPlaylistSaved(p.id) ? "text-accent" : "text-subdued hover:text-white"}
              >
                <HeartIcon filled={isPlaylistSaved(p.id)} size={32} />
              </button>
            )}
            {tracks.length > 0 && (
              <button
                type="button" aria-label={jam ? "Open Jam" : "Start a Jam"} title={jam ? "Open Jam" : "Start a Jam"}
                className={jam ? "text-accent" : "text-subdued hover:text-white"}
                onClick={() => {
                  if (jam) setJamOpen(true);
                  else void startListeningJam(tracks.map((track) => track.id)).catch((error: Error) => toast(error.message, "error"));
                }}
              ><Users size={27} /></button>
            )}
            {own && (
              <button type="button" aria-label="Playlist options" onClick={() => setMenu(true)} className="text-subdued hover:text-white">
                <MoreIcon size={32} />
              </button>
            )}
          </>
        }
      />
      {tracks.length ? <TrackTable tracks={tracks} ctx={ctx} playlistId={own ? p.id : undefined} /> : <p className="px-6 text-subdued">This playlist is empty.</p>}

      {!!p.history?.length && (
        <details className="mx-4 my-8 rounded-lg bg-card px-4 py-3 sm:mx-6">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-subdued hover:text-white"><Clock3 size={16} /> Recent changes</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {[...p.history].reverse().slice(0, 10).map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex flex-wrap justify-between gap-x-4 text-subdued"><span><strong className="text-white">{entry.actorName}</strong> {entry.action}</span><time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time></li>
            ))}
          </ul>
        </details>
      )}

      {own && (
        <div className="mt-8 border-t border-white/10 px-4 pt-6 sm:px-6">
          <h2 className="text-xl font-bold">Let&apos;s find something for your playlist</h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search for songs"
            className="mt-3 h-10 w-full max-w-md rounded bg-white/10 px-3 text-sm outline-none placeholder:text-subdued focus:bg-white/15"
          />
          <div className="-mx-2 mt-3">
            {suggestions.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TrackRow track={t} showAlbum={false} onPlay={() => updatePlaylist(p.id, { add: [t.id] }).then(() => toast(`Added to ${p.name}`))} />
                </div>
                <button
                  type="button"
                  onClick={() => updatePlaylist(p.id, { add: [t.id] }).then(() => toast(`Added to ${p.name}`))}
                  className="shrink-0 rounded-full border border-white/40 px-4 py-1.5 text-sm font-bold hover:border-white"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} label="Playlist options">
        <div className="py-2">
          <SheetItem
            icon={<EditIcon />}
            onClick={() => {
              setName(p.name);
              setDesc(p.description ?? "");
              setMenu(false);
              setEditing(true);
            }}
          >
            Edit details
          </SheetItem>
          {owner && !p.shared && <SheetItem icon={<Users size={20} />} onClick={() => { setMenu(false); setManage(true); }}>Manage collaborators</SheetItem>}
          {owner && <SheetItem
            danger
            icon={<TrashIcon />}
            onClick={async () => {
              setMenu(false);
              if (!confirm(`Delete “${p.name}”?`)) return;
              await deletePlaylist(p.id);
              toast("Playlist deleted");
              router.push("/library");
            }}
          >
            Delete playlist
          </SheetItem>}
        </div>
      </Sheet>
      <Sheet open={manage} onClose={() => setManage(false)} label="Manage collaborators">
        <div className="space-y-4 p-5">
          <div>
            <h2 className="text-xl font-bold">Collaborators</h2>
            <p className="mt-1 text-sm text-subdued">Accepted contacts can add, remove and reorder songs. Only you can manage access or delete this playlist.</p>
          </div>
          {p.collaborators?.length ? <ul className="space-y-2">{p.collaborators.map((person) => (
            <li key={person.uid} className="flex items-center gap-3 rounded bg-white/5 px-3 py-2"><span className="min-w-0 flex-1 truncate">{person.name}</span><button type="button" className="text-sm text-subdued hover:text-white" onClick={async () => {
              try { const { playlist } = await api<{ playlist: Playlist }>(`/api/playlists/${p.id}/collaborators`, { method: "DELETE", body: { uid: person.uid } }); await mutate(`/api/playlists/${p.id}`, { playlist }, { revalidate: false }); await mutate("/api/me"); }
              catch (e) { toast((e as Error).message, "error"); }
            }}>Remove</button></li>
          ))}</ul> : <p className="text-sm text-subdued">No collaborators yet.</p>}
          <div className="space-y-2 border-t border-white/10 pt-4">
            <h3 className="text-sm font-semibold">Invite a contact</h3>
            {(social?.connections ?? []).filter((contact) => contact.status === "accepted" && !p.collaboratorUids?.includes(contact.user.uid) && !p.collaborators?.some((person) => person.uid === contact.user.uid)).map((contact) => (
              <div key={contact.user.uid} className="flex items-center gap-3 rounded bg-white/5 px-3 py-2"><span className="min-w-0 flex-1 truncate">{contact.user.name}</span><button type="button" className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black" onClick={async () => {
                try { const { playlist } = await api<{ playlist: Playlist }>(`/api/playlists/${p.id}/collaborators`, { body: { uid: contact.user.uid } }); await mutate(`/api/playlists/${p.id}`, { playlist }, { revalidate: false }); await mutate("/api/me"); }
                catch (e) { toast((e as Error).message, "error"); }
              }}>Invite</button></div>
            ))}
            {!social?.connections.some((contact) => contact.status === "accepted" && !p.collaboratorUids?.includes(contact.user.uid) && !p.collaborators?.some((person) => person.uid === contact.user.uid)) && <p className="text-sm text-subdued">Connect with someone on the Friends page first.</p>}
          </div>
        </div>
      </Sheet>
      <Sheet open={editing} onClose={() => setEditing(false)} label="Edit details">
        <form
          className="space-y-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            await updatePlaylist(p.id, { name: name.trim() || p.name, description: desc });
            setEditing(false);
            toast("Playlist updated");
          }}
        >
          <h2 className="text-xl font-bold">Edit details</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-11 w-full rounded bg-white/10 px-3 outline-none focus:ring-1 focus:ring-white/40" placeholder="Name" />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} rows={3} className="w-full rounded bg-white/10 p-3 outline-none focus:ring-1 focus:ring-white/40" placeholder="Add an optional description" />
          <div className="flex justify-end">
            <button type="submit" className="rounded-full bg-white px-8 py-3 font-bold text-black hover:scale-105">
              Save
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
