import { buildHome } from "@/lib/recs/home";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { loadRecData } from "@/lib/server/recdata";

export const GET = route(async (req) => {
  const u = await requireUser(req);
  const db = await repo();
  const [{ data, library }, playlists] = await Promise.all([loadRecData(u.uid), db.listPlaylists(u.uid)]);
  const sections = buildHome({ data, userName: u.name, playlists, savedAlbums: library.albums, savedPlaylists: library.playlists });
  return json({ sections, generatedAt: data.now });
});
