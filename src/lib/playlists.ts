import type { Playlist } from "./types";

/** Playlists anyone with the link may open: admin-shared ones and those the owner opened up. Runtime-import free. */
export function playlistIsLinkable(p: Pick<Playlist, "shared" | "visibility"> | null | undefined): boolean {
  return Boolean(p && (p.shared || p.visibility === "link" || p.visibility === "public"));
}

export const VISIBILITY_LABEL: Record<"private" | "link" | "public", { title: string; body: string }> = {
  private: { title: "Private", body: "Only you and your collaborators" },
  link: { title: "Anyone with the link", body: "Not listed on your profile" },
  public: { title: "Public", body: "Listed on your profile for every listener" },
};
