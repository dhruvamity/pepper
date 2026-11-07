/**
 * Local-mode object storage endpoint that mimics S3 presigned URLs:
 *   PUT  ?op=put&exp&sig&ct   upload (what the browser does against R2/B2 in production)
 *   GET  ?op=get&exp&sig      download with HTTP Range support (seeking in <audio>)
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError, json, route } from "@/lib/server/http";
import { provider } from "@/lib/server/storage";
import { LocalProvider } from "@/lib/server/storage/local";

type Ctx = { params: Promise<{ provider: string; key: string[] }> };

const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB
const TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  webm: "audio/webm",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

async function resolve(req: Request, ctx: Ctx, op: "get" | "put") {
  const { provider: pid, key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  const p = provider(pid);
  if (!(p instanceof LocalProvider)) throw new HttpError(404, "Not found");
  const url = new URL(req.url);
  if (url.searchParams.get("op") !== op) throw new HttpError(403, "Wrong operation");
  if (!p.verify(op, key, Number(url.searchParams.get("exp")), url.searchParams.get("sig") ?? "")) {
    throw new HttpError(403, "Invalid or expired signature");
  }
  return { p, key, file: p.resolve(key), url };
}

export const PUT = route<Ctx>(async (req, ctx) => {
  const { file, url } = await resolve(req, ctx, "put");
  const expected = url.searchParams.get("ct");
  const got = req.headers.get("content-type")?.split(";")[0];
  if (expected && got !== expected) throw new HttpError(400, `Content-Type must be ${expected}`);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD) throw new HttpError(413, "File too large");
  if (!req.body) throw new HttpError(400, "Empty body");
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.part`;
  let written = 0;
  const source = Readable.fromWeb(req.body as import("node:stream/web").ReadableStream<Uint8Array>);
  source.on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > MAX_UPLOAD) source.destroy(new HttpError(413, "File too large"));
  });
  try {
    await pipeline(source, createWriteStream(tmp));
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return json({ ok: true, size: written });
});

export const GET = route<Ctx>(async (req, ctx) => {
  const { file, key, url } = await resolve(req, ctx, "get");
  const s = await stat(file).catch(() => null);
  if (!s?.isFile()) throw new HttpError(404, "Not found");
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext] ?? "application/octet-stream";
  const cc = url.searchParams.get("cc");
  const cacheControl = cc && /^(public|private), max-age=\d+(, immutable)?$/.test(cc) ? cc : "private, max-age=3600";
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cacheControl };

  if (range) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : NaN;
    if (Number.isNaN(start)) {
      start = Math.max(0, s.size - end);
      end = s.size - 1;
    } else if (Number.isNaN(end) || end >= s.size) {
      end = s.size - 1;
    }
    if (start > end || start >= s.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${s.size}` } });
    }
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${s.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { ...headers, "Content-Length": String(s.size) },
  });
});
