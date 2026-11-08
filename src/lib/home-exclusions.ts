import type { Playlist } from "./types";

export const HOME_EXCLUDED_PLAYLIST_NAME = "sleep music for deep sleeping";

export function homeExcludedPlaylist(playlists: Iterable<Playlist> | undefined) {
  return [...(playlists ?? [])].find((playlist) =>
    playlist.name.trim().replace(/\s+/g, " ").toLowerCase() === HOME_EXCLUDED_PLAYLIST_NAME,
  );
}
