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
  // Next has already decoded route params. Decode them again and `img/../audio/...`
  // can pass this prefix check while LocalProvider.resolve normalizes it to an audio key.
  if (
    parts.length !== 3 || parts[0] !== "img" || !["covers", "artists"].includes(parts[1]) ||
    parts.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part))
  ) throw new HttpError(404, "Not found");
  const key = parts.join("/");
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

  // Image keys contain a hash of the image, so a key's bytes never change. Serve the bytes from
  // here with a year-long cache: Vercel's CDN then answers every later request for this image
  // without touching this function or the bucket (each bucket download counts against
  // Backblaze's free daily transactions), and browsers never refetch it.
  const url = await p.presignGet(key, { expiresIn: 600 });
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) throw new HttpError(upstream.status === 404 ? 404 : 502, "Image unavailable");
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return new Response(upstream.body, {
    headers: {
      "Content-Type": IMAGE_TYPES[ext] ?? upstream.headers.get("content-type") ?? "application/octet-stream",
      ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length")! } : {}),
      "Cache-Control": "public, max-age=31536000, immutable",
      "CDN-Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
