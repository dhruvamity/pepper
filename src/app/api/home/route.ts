import { buildHome } from "@/lib/recs/home";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { loadRecData } from "@/lib/server/recdata";

export const GET = route(async (req) => {
  const u = await requireUser(req);
  const { data, library } = await loadRecData(u.uid);
  const sections = buildHome({ data, userName: u.name, savedPlaylists: library.playlists });
  return json({ sections, generatedAt: data.now });
});
