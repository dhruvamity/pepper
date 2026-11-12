import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, route } from "@/lib/server/http";
import { connectionIdFor } from "@/lib/server/social";

/**
 * A listener's public profile: name, photo, top artists (from their taste profile, unless
 * switched off) and public playlists. Contacts-only profiles show just the name to others.
 */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  const db = await repo();
  const user = await db.getUser(id);
  if (!user) throw new HttpError(404, "Listener not found");
  const self = user.uid === me.uid;
  const connection = self ? null : await db.getConnection(connectionIdFor(me.uid, user.uid));
  const isContact = connection?.status === "accepted";
  const base = { uid: user.uid, name: user.name, photoURL: user.photoURL, createdAt: user.createdAt };
  const status = connection?.status ?? null;
  if (!self && !isContact && user.profileVisibility === "contacts") {
    return json({ user: base, self, status, requestedBy: connection?.requesterUid ?? null, private: true, topArtists: [], playlists: [] });
  }
  const [playlists, taste, catalog] = await Promise.all([db.listPublicPlaylists(user.uid), user.showTopArtists === false ? null : db.getTaste(user.uid), db.getCatalog()]);
  const byId = new Map(catalog.tracks.map((t) => [t.id, t]));
  const artistPlays = new Map<string, number>();
  for (const [trackId, plays] of Object.entries(taste?.plays ?? {})) {
    const t = byId.get(trackId);
    if (!t) continue;
    for (const a of t.artists) artistPlays.set(a.id, (artistPlays.get(a.id) ?? 0) + plays);
  }
  const topArtists = [...artistPlays].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([artistId]) => artistId);
  return json({
    user: base,
    self,
    status,
    requestedBy: connection?.requesterUid ?? null,
    private: false,
    topArtists,
    playlists: playlists.map((p) => ({ ...p, history: undefined, collaborators: undefined, collaboratorUids: undefined })),
  });
});
