import { buildMixes, genreMixes } from "@/lib/recs/home";
import { requireUser } from "@/lib/server/auth";
import { HttpError, json, route } from "@/lib/server/http";
import { loadRecData } from "@/lib/server/recdata";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const u = await requireUser(req);
  const { id } = await ctx.params;
  const { data } = await loadRecData(u.uid);
  const mixes = id.startsWith("genre-") ? genreMixes(data, 12) : buildMixes(data, 4);
  const mix = mixes.find((m) => m.id === id);
  if (!mix) throw new HttpError(404, "Mix not found");
  return json(mix);
});
