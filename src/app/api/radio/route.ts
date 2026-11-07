import { autoplay } from "@/lib/recs/autoplay";
import { recommend, type RecMode } from "@/lib/recs/engine";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { loadRecData } from "@/lib/server/recdata";

const ids = (v: string | null, max: number) => (v ?? "").split(",").filter(Boolean).slice(0, max);

/**
 * GET /api/radio?seeds=a,b&exclude=x,y&limit=30&mode=radio|discover|mix
 *   Song radio and generic recommendations.
 * GET /api/radio?mode=autoplay&seeds=…&skipped=…&anchor=…&exclude=…
 *   Autoplay: seeds are the songs played this session (most recent first), skipped are songs the
 *   listener skipped early, anchor is the album/playlist the session started from.
 */
export const GET = route(async (req) => {
  const u = await requireUser(req);
  const url = new URL(req.url);
  const seeds = ids(url.searchParams.get("seeds"), 10);
  const exclude = ids(url.searchParams.get("exclude"), 500);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const modeParam = url.searchParams.get("mode");

  if (modeParam === "autoplay") {
    const skipped = ids(url.searchParams.get("skipped"), 10);
    const anchor = ids(url.searchParams.get("anchor"), 10);
    const { data } = await loadRecData(u.uid, [...seeds, ...anchor]);
    return json({ items: autoplay(data, { recent: seeds, skipped, anchor, exclude, limit }) });
  }

  const mode: RecMode = modeParam === "discover" || modeParam === "mix" ? modeParam : seeds.length ? "radio" : "discover";
  const { data } = await loadRecData(u.uid, seeds);
  const items = recommend(data, { mode, seeds: seeds.length ? seeds : undefined, exclude, limit });
  return json({ items });
});
