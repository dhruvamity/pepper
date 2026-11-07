import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { HttpError, route } from "@/lib/server/http";
import { provider } from "@/lib/server/storage";
import { LocalProvider } from "@/lib/server/storage/local";

type Ctx = { params: Promise<{ provider: string; key: string[] }> };

const IMAGE_TYPES: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", avif: "image/avif" };

/**
 * Public, cacheable image URLs (covers & artist photos). Redirects to a signed URL whose
 * signature only changes once a day, so browsers and CDNs can cache aggressively.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const { provider: pid, key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  if (!key.startsWith("img/")) throw new HttpError(404, "Not found");
  const p = provider(pid);
  if (!p) throw new HttpError(404, "Unknown provider");

  if (p instanceof LocalProvider) {
    const file = p.resolve(key);
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) throw new HttpError(404, "Not found");
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        "Content-Type": IMAGE_TYPES[ext] ?? "application/octet-stream",
        "Content-Length": String(s.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const url = await p.presignGet(key, {
    expiresIn: 7 * 24 * 3600,
    stableWindow: 24 * 3600,
    cacheControl: "public, max-age=604800, immutable",
  });
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
});
