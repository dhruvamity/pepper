import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { playlistIsLinkable } from "@/lib/playlists";
import type { UserProfile } from "@/lib/types";

/** Returns (and upserts) the signed-in user's profile, library and playlists. */
async function sync(req: Request) {
  const u = await requireUser(req);
  const db = await repo();
  const existing = await db.getUser(u.uid);
  const now = Date.now();
  const profile: UserProfile = {
    uid: u.uid,
    name: u.name || existing?.name || "Listener",
    email: u.email ?? existing?.email,
    photoURL: u.photoURL ?? existing?.photoURL,
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
    onboarded: existing?.onboarded ?? false,
    activitySharing: existing?.activitySharing ?? false,
    activityVisibleTo: existing?.activityVisibleTo ?? [],
    ...(existing?.inviteCode ? { inviteCode: existing.inviteCode } : {}),
    ...(existing?.profileVisibility ? { profileVisibility: existing.profileVisibility } : {}),
    ...(existing?.showTopArtists !== undefined ? { showTopArtists: existing.showTopArtists } : {}),
  };
  // Only write when something changed or once an hour, to save quota.
  if (!existing || now - existing.lastSeenAt > 3_600_000 || existing.name !== profile.name || existing.photoURL !== profile.photoURL) {
    await db.saveUser(profile);
  }
  const [library, playlists] = await Promise.all([db.getLibrary(u.uid), db.listPlaylists(u.uid)]);
  // Saved playlists from other listeners (link/public) are not in the catalog, so they ride along here.
  const own = new Set(playlists.map((p) => p.id));
  const savedIds = Object.keys(library.playlists ?? {}).filter((id) => !own.has(id));
  const savedPlaylists = savedIds.length ? (await db.getPlaylists(savedIds)).filter((p) => !p.shared && playlistIsLinkable(p)) : [];
  return json({ user: { ...profile, isAdmin: u.isAdmin }, library, playlists, savedPlaylists });
}

export const GET = route(sync);
export const POST = route(sync);
