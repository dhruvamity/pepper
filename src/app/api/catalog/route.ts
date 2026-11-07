import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import type { CatalogSnapshot } from "@/lib/types";

/**
 * The whole (compact) catalog. Clients cache it and derive albums, artists, genres, playlists and
 * search locally, which keeps navigation instant. Revalidated with an ETag on the catalog version.
 */
export const GET = route(async (req) => {
  await requireUser(req);
  const db = await repo();
  const catalog = await db.getCatalog();
  const etag = `"c${catalog.version}-${catalog.tracks.length}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  }
  // Related-artist lists only matter to the server's recommender; leave them out of the download.
  const artists: CatalogSnapshot["artists"] = {};
  for (const [id, a] of Object.entries(catalog.artists)) {
    const { related: _related, ...rest } = a;
    void _related;
    artists[id] = rest;
  }
  return Response.json({ ...catalog, artists }, { headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
});
