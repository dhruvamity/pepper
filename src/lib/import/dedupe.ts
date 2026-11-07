/**
 * Finding the same song in several files (pure logic, no file access).
 *
 * A downloaded collection repeats songs: the same file in several playlist folders, the same
 * recording from another release ("Humdard" and "Humdard (From "Ek Villain")"), or another
 * re-encode. Files are merged when any of these holds:
 *   1. identical bytes (same SHA-256),
 *   2. the same source link (YouTube Music video id in the tags) and about the same length,
 *   3. the same audio (Chromaprint fingerprints nearly identical) and about the same length,
 *   4. without fingerprints: the same title, a shared artist and the same length (±2 s).
 * Different versions of a song (remake, female version, reprise, slowed…) sound different, so
 * they stay separate songs; autoplay keeps them apart with songKey().
 */
import { songKey } from "@/lib/metadata/normalize";
import type { CatalogTrack } from "@/lib/types";
import { artistIdFor } from "@/lib/util";
import { fingerprintDistance, SAME_RECORDING } from "./fingerprint";

export interface ScannedFile {
  /** Path relative to the import folder, with "/" separators. */
  rel: string;
  /** Top-level folder (the playlist); "" for files directly in the import folder. */
  folder: string;
  size: number;
  mtimeMs: number;
  sha256?: string;
  fingerprint?: Uint32Array;
  durationMs: number;
  title?: string;
  artists?: string[];
  genres?: string[];
  year?: number;
  film?: string;
  albumArtist?: string;
  sourceUrl?: string;
  bitrate?: number;
  hasCover?: boolean;
  /** Why the file can't be imported (empty, unreadable…). */
  error?: string;
}

export type MergeReason = "same file" | "same link" | "same audio" | "same title, artist and length";

export interface Recording {
  /** The copy that gets imported. */
  primary: ScannedFile;
  /** Every copy, primary first. */
  files: ScannedFile[];
  reasons: MergeReason[];
}

export function youtubeId(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/)([\w-]{11})/);
  return m?.[1];
}

const artistIds = (f: { artists?: string[] }) => new Set((f.artists ?? []).map(artistIdFor));

export function sameSongByTags(a: ScannedFile, b: ScannedFile, toleranceMs = 2000): boolean {
  if (!a.title || !b.title || Math.abs(a.durationMs - b.durationMs) > toleranceMs) return false;
  if (songKey(a.title) !== songKey(b.title)) return false;
  // A version marker on one side only ("Female Version", "Reprise") means a different version.
  if (versionTag(a.title) !== versionTag(b.title)) return false;
  const ia = artistIds(a);
  return [...artistIds(b)].some((id) => ia.has(id));
}

function versionTag(title: string): string {
  const words = title.toLowerCase().match(/\b(slowed|reverb|lo-?fi|remix|unplugged|reprise|acoustic|female|male|live|instrumental|recreated|mashup|sad|cover|karaoke)\b/g);
  return words ? [...new Set(words)].sort().join("+") : "";
}

/** How good a copy is: bitrate first, then cover art and richer tags. */
function quality(f: ScannedFile): number {
  return (f.bitrate ?? 0) / 1000 + (f.hasCover ? 40 : 0) + (f.genres?.length ? 8 : 0) + (f.year ? 4 : 0) + (f.film ? 4 : 0) + (f.albumArtist ? 1 : 0);
}

export function groupRecordings(input: ScannedFile[]): Recording[] {
  const files = input.filter((f) => !f.error);
  const parent = files.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reasons = new Map<number, Set<MergeReason>>();
  const union = (i: number, j: number, why: MergeReason) => {
    const a = find(i);
    const b = find(j);
    if (a === b) return;
    parent[b] = a;
    const r = reasons.get(a) ?? new Set();
    for (const x of reasons.get(b) ?? []) r.add(x);
    r.add(why);
    reasons.set(a, r);
    reasons.delete(b);
  };

  // 1. identical bytes
  const bySha = new Map<string, number>();
  files.forEach((f, i) => {
    if (!f.sha256) return;
    const j = bySha.get(f.sha256);
    if (j === undefined) bySha.set(f.sha256, i);
    else union(j, i, "same file");
  });

  // 2. same source link
  const byLink = new Map<string, number[]>();
  files.forEach((f, i) => {
    const id = youtubeId(f.sourceUrl);
    if (id) byLink.set(id, [...(byLink.get(id) ?? []), i]);
  });
  for (const list of byLink.values()) {
    for (let k = 1; k < list.length; k++) {
      if (Math.abs(files[list[0]].durationMs - files[list[k]].durationMs) <= 4000) union(list[0], list[k], "same link");
    }
  }

  // 3./4. same audio, or same tags when a fingerprint is missing — only among files of about
  // the same length (sorted by duration, so each file is compared with its neighbours).
  const order = files.map((_, i) => i).sort((a, b) => files[a].durationMs - files[b].durationMs);
  for (let x = 0; x < order.length; x++) {
    const i = order[x];
    const a = files[i];
    for (let y = x + 1; y < order.length; y++) {
      const j = order[y];
      const b = files[j];
      if (b.durationMs - a.durationMs > 4000) break;
      if (find(i) === find(j)) continue;
      if (a.fingerprint && b.fingerprint) {
        if (fingerprintDistance(a.fingerprint, b.fingerprint) < SAME_RECORDING) union(i, j, "same audio");
      } else if (sameSongByTags(a, b)) {
        union(i, j, "same title, artist and length");
      }
    }
  }

  const groups = new Map<number, number[]>();
  files.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const out: Recording[] = [];
  for (const [root, members] of groups) {
    const list = members.map((i) => files[i]).sort((a, b) => quality(b) - quality(a) || a.rel.localeCompare(b.rel));
    out.push({ primary: list[0], files: list, reasons: [...(reasons.get(root) ?? [])] });
  }
  return out;
}

/**
 * A song already in the library: same original file (its id comes from the file hash), or the
 * same title, a shared artist and the same length.
 */
export function findExisting(rec: Recording, catalog: { byId: Map<string, CatalogTrack>; byKey: Map<string, CatalogTrack[]> }, idForSha: (sha: string) => string): string | undefined {
  for (const f of rec.files) {
    if (!f.sha256) continue;
    const id = idForSha(f.sha256);
    if (catalog.byId.has(id)) return id;
  }
  const p = rec.primary;
  if (!p.title) return undefined;
  const want = artistIds(p);
  for (const t of catalog.byKey.get(songKey(p.title)) ?? []) {
    if (Math.abs(t.durationMs - p.durationMs) > 2000) continue;
    if (versionTag(t.title + " " + (t.subtitle ?? "")) !== versionTag(p.title)) continue;
    if (t.artists.some((a) => want.has(a.id))) return t.id;
  }
  return undefined;
}

export function catalogLookup(tracks: CatalogTrack[]) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const byKey = new Map<string, CatalogTrack[]>();
  for (const t of tracks) {
    const k = songKey(t.title);
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  return { byId, byKey };
}
