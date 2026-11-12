"use client";

import useSWR, { useSWRConfig } from "swr";
import type { Playlist, PlaylistVisibility, UserLibrary, UserProfile } from "@/lib/types";
import { api, fetcher } from "./api";
import { useAuth } from "./auth";
import { toast } from "./toast";

export interface MeResponse {
  user: UserProfile & { isAdmin: boolean };
  library: UserLibrary;
  playlists: Playlist[];
  /** Other listeners' link/public playlists saved to the library (not part of the catalog). */
  savedPlaylists?: Playlist[];
}

export function useMe() {
  const { status } = useAuth();
  const swr = useSWR<MeResponse>(status === "signedIn" ? "/api/me" : null, fetcher, { revalidateOnFocus: false, dedupingInterval: 30_000 });
  return swr;
}

type Kind = keyof UserLibrary;
type Mutate = ReturnType<typeof useSWRConfig>["mutate"];

async function setItem(mutate: Mutate, kind: Kind, id: string, on: boolean) {
  await mutate<MeResponse>(
    "/api/me",
    async (cur) => {
      await api("/api/me/library", { method: "PUT", body: { kind, id, on } });
      if (!cur) return cur;
      const lib = { ...cur.library, [kind]: { ...(cur.library[kind] ?? {}) } };
      if (on) lib[kind][id] = Date.now();
      else delete lib[kind][id];
      return { ...cur, library: lib };
    },
    {
      optimisticData: (cur) => {
        if (!cur) return cur as unknown as MeResponse;
        const lib = { ...cur.library, [kind]: { ...(cur.library[kind] ?? {}) } };
        if (on) lib[kind][id] = Date.now();
        else delete lib[kind][id];
        return { ...cur, library: lib };
      },
      rollbackOnError: true,
      revalidate: false,
    },
  );
}

export function useLibraryActions() {
  const { data } = useMe();
  const lib = data?.library;
  const { mutate } = useSWRConfig();
  return {
    isLiked: (id: string) => Boolean(lib?.likes[id]),
    isFollowing: (id: string) => Boolean(lib?.artists[id]),
    isSaved: (id: string) => Boolean(lib?.albums[id]),
    isPlaylistSaved: (id: string) => Boolean(lib?.playlists?.[id]),
    async toggleLike(id: string) {
      const on = !lib?.likes[id];
      try {
        await setItem(mutate, "likes", id, on);
        toast(on ? "Added to Liked Songs" : "Removed from Liked Songs");
        mutate("/api/home");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    async toggleFollow(id: string) {
      const on = !lib?.artists[id];
      try {
        await setItem(mutate, "artists", id, on);
        toast(on ? "Following" : "Unfollowed");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    async toggleSave(id: string) {
      const on = !lib?.albums[id];
      try {
        await setItem(mutate, "albums", id, on);
        toast(on ? "Saved to Your Library" : "Removed from Your Library");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    async toggleSavePlaylist(id: string) {
      const on = !lib?.playlists?.[id];
      try {
        await setItem(mutate, "playlists", id, on);
        toast(on ? "Saved to Your Library" : "Removed from Your Library");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
  };
}

export function usePlaylistActions() {
  const { mutate } = useSWRConfig();

  async function createPlaylist(input: { name?: string; trackIds?: string[] } = {}): Promise<Playlist> {
    const { playlist } = await api<{ playlist: Playlist }>("/api/playlists", { body: input });
    await mutate<MeResponse>("/api/me", (cur) => (cur ? { ...cur, playlists: [playlist, ...cur.playlists] } : cur), { revalidate: false });
    if (playlist.shared) await Promise.all([mutate("/api/catalog"), mutate("/api/home")]);
    return playlist;
  }

  async function updatePlaylist(id: string, patch: { name?: string; description?: string; visibility?: PlaylistVisibility; add?: string[]; remove?: string[]; trackIds?: string[]; expectedRevision?: number }) {
    const { playlist } = await api<{ playlist: Playlist }>(`/api/playlists/${id}`, { method: "PATCH", body: patch });
    await mutate<MeResponse>(
      "/api/me",
      (cur) => (cur ? { ...cur, playlists: cur.playlists.map((p) => (p.id === id ? playlist : p)) } : cur),
      { revalidate: false },
    );
    await mutate(`/api/playlists/${id}`, { playlist }, { revalidate: false });
    // Shared playlists also live in the catalog everyone downloads.
    if (playlist.shared) await Promise.all([mutate("/api/catalog"), mutate("/api/home")]);
    return playlist;
  }

  async function deletePlaylist(id: string) {
    await api(`/api/playlists/${id}`, { method: "DELETE" });
    await mutate<MeResponse>("/api/me", (cur) => (cur ? { ...cur, playlists: cur.playlists.filter((p) => p.id !== id) } : cur), { revalidate: false });
    await Promise.all([mutate("/api/catalog"), mutate("/api/home")]);
  }

  return { createPlaylist, updatePlaylist, deletePlaylist };
}
