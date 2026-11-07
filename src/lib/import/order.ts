/**
 * Playlist names and song order for an import folder (pure logic).
 *
 * Each top-level folder becomes a shared playlist: "01 - Soft romantic hindi songs 2026" is
 * shown as "Soft romantic hindi songs 2026". Songs keep the order they had in the source when a
 * listing like MUSIC_CATALOG.md (from the Telegram archive tool) is present; otherwise the order
 * they were downloaded in (file times), then by name.
 */
import { fnv1a, slugify } from "@/lib/util";

export function playlistNameFromFolder(folder: string): string {
  const name = folder
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || folder.trim();
}

/** Stable id for an imported playlist, so importing the folder again updates it. */
export function playlistIdFor(folder: string): string {
  const name = playlistNameFromFolder(folder);
  const slug = slugify(name, 40);
  return `pl_${slug || "playlist"}-${fnv1a(`import:${name.toLowerCase()}`).slice(0, 4)}`;
}

/**
 * Song order per folder from a markdown listing such as
 *   ## 📁 01 - Soft romantic hindi songs 2026 (28/28 downloaded | 275.89 MB)
 *   - [x] `[Msg 0003]` Arijit Singh - Dekha Hazaro Dafaa.mp3 (8.08 MB | ⏱ 03:27)
 * Returns folder name (as in the heading, without the size note) → file names in order.
 */
export function parseOrderListing(markdown: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{2,3}\s+(?:\S+\s+)?(\d{1,3}\s*-\s*.+?)(?:\s+\(\d+\/\d+ downloaded.*\))?$/u);
    if (h && !line.includes("](")) {
      current = [];
      out.set(h[1].trim(), current);
      continue;
    }
    if (!current) continue;
    const item = line.match(/^[-*]\s+(?:\[[ x]\]\s+)?(?:`[^`]*`\s+)?(.+?\.(?:mp3|m4a|flac|ogg|opus|wav|aac|webm))(?:\s+\(.*\))?$/i);
    if (item) current.push(item[1].trim());
  }
  for (const [k, v] of out) if (!v.length) out.delete(k);
  return out;
}

/** Sort a folder's files: listing order first, then download order (file time), then name. */
export function orderFiles<T extends { rel: string; mtimeMs: number }>(files: T[], listing?: string[]): T[] {
  const rank = new Map<string, number>();
  listing?.forEach((name, i) => {
    if (!rank.has(name.toLowerCase())) rank.set(name.toLowerCase(), i);
  });
  const base = (f: T) => f.rel.split("/").pop()!.toLowerCase();
  return [...files].sort((a, b) => {
    const ra = rank.get(base(a));
    const rb = rank.get(base(b));
    if (ra !== undefined || rb !== undefined) return (ra ?? Infinity) - (rb ?? Infinity) || a.rel.localeCompare(b.rel);
    return a.mtimeMs - b.mtimeMs || a.rel.localeCompare(b.rel);
  });
}
